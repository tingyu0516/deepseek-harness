import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CHARACTER_WALLPAPER_ID,
  isCustomCharacterWallpaperId,
  parseCharacterWallpaperAssetPath,
} from '../src/character-wallpaper-contract.ts'
import {
  CharacterWallpaperError,
  CharacterWallpaperStore,
  MAX_CUSTOM_WALLPAPERS_PER_THEME,
  MAX_WALLPAPER_BYTES,
} from '../src/character-wallpaper-store.ts'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const temps: string[] = []

afterEach(() => {
  temps.length = 0
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

function writePng(dir: string, name: string): string {
  const filePath = join(dir, name)
  writeFileSync(filePath, PNG)
  return filePath
}

describe('character wallpaper contract', () => {
  it('parses imported wallpaper asset paths and rejects traversal', () => {
    expect(parseCharacterWallpaperAssetPath('/themes/custom/hutao/wp_0123456789abcdef')).toEqual({
      theme: 'hutao',
      id: 'wp_0123456789abcdef',
    })
    expect(parseCharacterWallpaperAssetPath('/themes/custom/furina/wp_fedcba9876543210')).toEqual({
      theme: 'furina',
      id: 'wp_fedcba9876543210',
    })
    expect(parseCharacterWallpaperAssetPath('/themes/custom/hutao/../wp_0123456789abcdef')).toBeUndefined()
    expect(parseCharacterWallpaperAssetPath('/themes/custom/hutao/default')).toBeUndefined()
    expect(parseCharacterWallpaperAssetPath('/themes/hutao.jpg')).toBeUndefined()
  })
})

describe('character wallpaper store', () => {
  it('lists bundled defaults before any imports', async () => {
    const store = new CharacterWallpaperStore(tempDir('dsh-wallpaper-empty-'))
    const catalog = await store.list()
    expect(catalog.hutao).toEqual([
      {
        id: DEFAULT_CHARACTER_WALLPAPER_ID,
        theme: 'hutao',
        url: '/themes/hutao.jpg',
        label: 'default',
        deletable: false,
      },
    ])
    expect(catalog.furina[0]).toMatchObject({ id: 'default', theme: 'furina', deletable: false })
  })

  it('imports a PNG into one theme library without removing the default', async () => {
    const userData = tempDir('dsh-wallpaper-import-')
    const source = writePng(tempDir('dsh-wallpaper-src-'), 'my-hutao.png')
    const store = new CharacterWallpaperStore(userData)
    const imported = await store.importFromPath('hutao', source)
    const catalog = await store.list()

    expect(isCustomCharacterWallpaperId(imported.id)).toBe(true)
    expect(imported).toMatchObject({
      theme: 'hutao',
      label: 'my-hutao.png',
      deletable: true,
      url: `/themes/custom/hutao/${imported.id}`,
    })
    expect(catalog.hutao.map(item => item.id)).toEqual(['default', imported.id])
    expect(catalog.furina).toHaveLength(1)
    const asset = await store.resolveCustomAsset('hutao', imported.id)
    expect(asset?.mime).toBe('image/png')
    expect(asset?.filePath.startsWith(join(userData, 'character-wallpapers'))).toBe(true)
  })

  it('keeps the other theme library unchanged and can delete only imports', async () => {
    const store = new CharacterWallpaperStore(tempDir('dsh-wallpaper-delete-'))
    const imported = await store.importFromPath('furina', writePng(tempDir('dsh-wallpaper-src-'), 'stage.png'))
    await expect(store.delete('furina', 'default')).rejects.toMatchObject({ code: 'cannot-delete-default' })
    const catalog = await store.delete('furina', imported.id)
    expect(catalog.furina).toEqual([
      expect.objectContaining({ id: 'default', deletable: false }),
    ])
    expect(await store.resolveCustomAsset('furina', imported.id)).toBeUndefined()
  })

  it('rejects unsupported bytes, oversized files, and relative paths', async () => {
    const store = new CharacterWallpaperStore(tempDir('dsh-wallpaper-reject-'))
    const dir = tempDir('dsh-wallpaper-bad-')
    writeFileSync(join(dir, 'notes.txt'), 'hello')
    await expect(store.importFromPath('hutao', join(dir, 'notes.txt'))).rejects.toBeInstanceOf(CharacterWallpaperError)
    await expect(store.importFromPath('hutao', join(dir, 'notes.txt'))).rejects.toMatchObject({ code: 'unsupported-image' })
    await expect(store.importFromPath('hutao', 'relative.png')).rejects.toThrow('invalid wallpaper source')

    const huge = join(dir, 'huge.png')
    const payload = Buffer.alloc(MAX_WALLPAPER_BYTES + 1, 0)
    PNG.copy(payload, 0, 0, PNG.byteLength)
    writeFileSync(huge, payload)
    await expect(store.importFromPath('hutao', huge)).rejects.toMatchObject({ code: 'too-large' })
  })

  it('caps imported wallpapers per theme', async () => {
    const store = new CharacterWallpaperStore(tempDir('dsh-wallpaper-limit-'))
    const source = writePng(tempDir('dsh-wallpaper-src-'), 'tile.png')
    for (let index = 0; index < MAX_CUSTOM_WALLPAPERS_PER_THEME; index += 1) {
      await store.importFromPath('hutao', source)
    }
    await expect(store.importFromPath('hutao', source)).rejects.toMatchObject({ code: 'limit-reached' })
    await store.importFromPath('furina', source)
    expect((await store.list()).furina).toHaveLength(2)
  })
})
