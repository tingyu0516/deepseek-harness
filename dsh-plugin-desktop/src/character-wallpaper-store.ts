/** Persist imported Hu Tao / Furina wallpapers under Electron userData. */

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'
import {
  CHARACTER_WALLPAPER_ASSET_PREFIX,
  DEFAULT_CHARACTER_WALLPAPER_ID,
  isCustomCharacterWallpaperId,
  type CharacterWallpaperCatalog,
  type CharacterWallpaperThemeId,
  type CharacterWallpaperView,
} from './character-wallpaper-contract.ts'

/** Directory name under `userData` that owns imported wallpapers and their catalog. */
export const CHARACTER_WALLPAPER_ROOT = 'character-wallpapers'

/** Maximum imported wallpapers kept for one character theme. */
export const MAX_CUSTOM_WALLPAPERS_PER_THEME = 24

/** Reject source files larger than this many bytes. */
export const MAX_WALLPAPER_BYTES = 12 * 1024 * 1024

const CATALOG_FILENAME = 'catalog.json'
const CATALOG_VERSION = 1

const IMAGE_KINDS = [
  {
    mime: 'image/png',
    ext: '.png',
    test: (bytes: Buffer) => bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    ext: '.jpg',
    test: (bytes: Buffer) => bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mime: 'image/gif',
    ext: '.gif',
    test: (bytes: Buffer) => bytes.length >= 6 && bytes.subarray(0, 6).toString('ascii').startsWith('GIF8'),
  },
  {
    mime: 'image/webp',
    ext: '.webp',
    test: (bytes: Buffer) => bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
  },
] as const

type WallpaperMime = (typeof IMAGE_KINDS)[number]['mime']
type WallpaperExt = (typeof IMAGE_KINDS)[number]['ext']

interface CatalogItem {
  readonly id: string
  readonly theme: CharacterWallpaperThemeId
  readonly file: string
  readonly name: string
  readonly mime: WallpaperMime
}

interface CatalogDocument {
  readonly version: typeof CATALOG_VERSION
  readonly items: readonly CatalogItem[]
}

/** Typed failure codes returned to the loopback wallpaper API. */
export class CharacterWallpaperError extends Error {
  constructor(
    readonly code:
      | 'unsupported-image'
      | 'too-large'
      | 'limit-reached'
      | 'not-found'
      | 'cannot-delete-default'
      | 'invalid-path',
  ) {
    super(code)
    this.name = 'CharacterWallpaperError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isWallpaperMime(value: unknown): value is WallpaperMime {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/gif' || value === 'image/webp'
}

function detectImage(bytes: Buffer): { mime: WallpaperMime; ext: WallpaperExt } | undefined {
  return IMAGE_KINDS.find(kind => kind.test(bytes))
}

function displayName(sourcePath: string): string {
  const name = basename(sourcePath).replace(/[\u0000-\u001f\u007f]/gu, '').trim()
  if (name.length === 0) return 'wallpaper'
  return name.length > 80 ? `${name.slice(0, 77)}...` : name
}

function builtinView(theme: CharacterWallpaperThemeId): CharacterWallpaperView {
  return Object.freeze({
    id: DEFAULT_CHARACTER_WALLPAPER_ID,
    theme,
    url: `/themes/${theme}.png`,
    label: DEFAULT_CHARACTER_WALLPAPER_ID,
    deletable: false,
  })
}

function customView(item: CatalogItem): CharacterWallpaperView {
  return Object.freeze({
    id: item.id,
    theme: item.theme,
    url: `${CHARACTER_WALLPAPER_ASSET_PREFIX}/${item.theme}/${item.id}`,
    label: item.name,
    deletable: true,
  })
}

function parseCatalogItem(value: unknown): CatalogItem | undefined {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !isCustomCharacterWallpaperId(value.id)
    || (value.theme !== 'hutao' && value.theme !== 'furina')
    || typeof value.file !== 'string'
    || typeof value.name !== 'string'
    || !isWallpaperMime(value.mime)) {
    return undefined
  }
  const expectedExt = IMAGE_KINDS.find(kind => kind.mime === value.mime)?.ext
  if (expectedExt === undefined || value.file !== `${value.id}${expectedExt}`) return undefined
  if (basename(value.file) !== value.file || extname(value.file) !== expectedExt) return undefined
  const name = value.name.trim()
  if (name.length === 0 || name.length > 80) return undefined
  return {
    id: value.id,
    theme: value.theme,
    file: value.file,
    name,
    mime: value.mime,
  }
}

function parseCatalog(value: unknown): CatalogDocument {
  if (!isRecord(value) || value.version !== CATALOG_VERSION || !Array.isArray(value.items)) {
    return { version: CATALOG_VERSION, items: [] }
  }
  const items: CatalogItem[] = []
  const seen = new Set<string>()
  for (const entry of value.items) {
    const item = parseCatalogItem(entry)
    if (item === undefined || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  return { version: CATALOG_VERSION, items }
}

function assertAbsolutePath(label: string, value: string): string {
  if (value.length === 0 || /[\0\r\n]/u.test(value) || !isAbsolute(value)) {
    throw new Error(`dsh-plugin-desktop: invalid ${label}`)
  }
  return resolve(value)
}

function containedFile(root: string, file: string): string {
  const resolvedRoot = resolve(root)
  const resolved = resolve(resolvedRoot, file)
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new CharacterWallpaperError('invalid-path')
  }
  return resolved
}

/**
 * Own the imported wallpaper catalog and files for one Desktop userData tree.
 */
export class CharacterWallpaperStore {
  private readonly root: string
  private readonly catalogPath: string

  constructor(userDataDir: string) {
    this.root = join(assertAbsolutePath('userDataDir', userDataDir), CHARACTER_WALLPAPER_ROOT)
    this.catalogPath = join(this.root, CATALOG_FILENAME)
  }

  /** Bundled defaults plus imported wallpapers, grouped by character theme. */
  async list(): Promise<CharacterWallpaperCatalog> {
    const catalog = await this.readCatalog()
    return this.project(catalog)
  }

  /**
   * Copy one local image into the theme library after magic-byte validation.
   * @param theme - library that will own the imported file.
   * @param sourcePath - absolute path returned by the native image picker.
   */
  async importFromPath(theme: CharacterWallpaperThemeId, sourcePath: string): Promise<CharacterWallpaperView> {
    const source = assertAbsolutePath('wallpaper source', sourcePath)
    const catalog = await this.readCatalog()
    if (catalog.items.filter(item => item.theme === theme).length >= MAX_CUSTOM_WALLPAPERS_PER_THEME) {
      throw new CharacterWallpaperError('limit-reached')
    }
    let bytes: Buffer
    try {
      bytes = await readFile(source)
    } catch {
      throw new CharacterWallpaperError('not-found')
    }
    if (bytes.byteLength > MAX_WALLPAPER_BYTES) throw new CharacterWallpaperError('too-large')
    const kind = detectImage(bytes)
    if (kind === undefined) throw new CharacterWallpaperError('unsupported-image')
    const id = `wp_${randomBytes(8).toString('hex')}`
    const item: CatalogItem = {
      id,
      theme,
      file: `${id}${kind.ext}`,
      name: displayName(source),
      mime: kind.mime,
    }
    await mkdir(this.root, { recursive: true })
    await writeFile(containedFile(this.root, item.file), bytes)
    const next: CatalogDocument = { version: CATALOG_VERSION, items: [...catalog.items, item] }
    await this.writeCatalog(next)
    return customView(item)
  }

  /**
   * Remove one imported wallpaper. Bundled defaults cannot be deleted.
   * @param theme - library that owns the wallpaper.
   * @param id - imported `wp_…` id.
   */
  async delete(theme: CharacterWallpaperThemeId, id: string): Promise<CharacterWallpaperCatalog> {
    if (id === DEFAULT_CHARACTER_WALLPAPER_ID) throw new CharacterWallpaperError('cannot-delete-default')
    if (!isCustomCharacterWallpaperId(id)) throw new CharacterWallpaperError('not-found')
    const catalog = await this.readCatalog()
    const item = catalog.items.find(entry => entry.theme === theme && entry.id === id)
    if (item === undefined) throw new CharacterWallpaperError('not-found')
    const next: CatalogDocument = {
      version: CATALOG_VERSION,
      items: catalog.items.filter(entry => entry.id !== id),
    }
    await this.writeCatalog(next)
    try {
      await unlink(containedFile(this.root, item.file))
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    return this.project(next)
  }

  /**
   * Resolve one imported wallpaper for the loopback asset route.
   * @param theme - library that owns the wallpaper.
   * @param id - imported `wp_…` id.
   */
  async resolveCustomAsset(theme: CharacterWallpaperThemeId, id: string): Promise<{
    readonly filePath: string
    readonly mime: WallpaperMime
  } | undefined> {
    if (!isCustomCharacterWallpaperId(id)) return undefined
    const catalog = await this.readCatalog()
    const item = catalog.items.find(entry => entry.theme === theme && entry.id === id)
    if (item === undefined) return undefined
    const filePath = containedFile(this.root, item.file)
    if (!existsSync(filePath)) return undefined
    return { filePath, mime: item.mime }
  }

  private project(catalog: CatalogDocument): CharacterWallpaperCatalog {
    const customs = catalog.items.map(customView)
    return Object.freeze({
      hutao: Object.freeze([builtinView('hutao'), ...customs.filter(item => item.theme === 'hutao')]),
      furina: Object.freeze([builtinView('furina'), ...customs.filter(item => item.theme === 'furina')]),
    })
  }

  private async readCatalog(): Promise<CatalogDocument> {
    try {
      return parseCatalog(JSON.parse(await readFile(this.catalogPath, 'utf8')) as unknown)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: CATALOG_VERSION, items: [] }
      }
      return { version: CATALOG_VERSION, items: [] }
    }
  }

  private async writeCatalog(catalog: CatalogDocument): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const tempPath = `${this.catalogPath}.${process.pid}.tmp`
    await writeFile(tempPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.catalogPath)
  }
}
