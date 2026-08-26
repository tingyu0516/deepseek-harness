/** Private same-origin API and loopback asset paths for character wallpapers. */

/** List custom and bundled wallpapers for Hu Tao and Furina. */
export const DESKTOP_CHARACTER_WALLPAPERS_PATH = '/api/desktop/character-wallpapers'

/** Open the native image picker and import one wallpaper for a character theme. */
export const DESKTOP_CHARACTER_WALLPAPER_IMPORT_PATH = '/api/desktop/character-wallpapers/import'

/** Delete one imported wallpaper. Bundled defaults cannot be removed. */
export const DESKTOP_CHARACTER_WALLPAPER_DELETE_PATH = '/api/desktop/character-wallpapers/delete'

/** Prefix served for imported wallpapers stored in Electron userData. */
export const CHARACTER_WALLPAPER_ASSET_PREFIX = '/themes/custom'

/** Built-in wallpaper id that maps onto the packaged Hu Tao / Furina PNG. */
export const DEFAULT_CHARACTER_WALLPAPER_ID = 'default'

/** Imported wallpaper ids written by Desktop (`wp_` plus 16 lowercase hex chars). */
export const CUSTOM_CHARACTER_WALLPAPER_ID_PATTERN = /^wp_[0-9a-f]{16}$/

/** Character themes that own a wallpaper library. */
export type CharacterWallpaperThemeId = 'hutao' | 'furina'

/** Renderer-safe wallpaper card. */
export interface CharacterWallpaperView {
  /** Stable id used by Desktop settings (`default` or an imported `wp_…` id). */
  readonly id: string
  /** Theme library that owns this wallpaper. */
  readonly theme: CharacterWallpaperThemeId
  /** Loopback URL used by CSS `url()` and settings thumbnails. */
  readonly url: string
  /** Original filename for imported images; unused for the bundled default. */
  readonly label: string
  /** Whether the settings UI may delete this entry. Bundled defaults are false. */
  readonly deletable: boolean
}

/** Complete wallpaper libraries projected to the renderer. */
export interface CharacterWallpaperCatalog {
  readonly hutao: readonly CharacterWallpaperView[]
  readonly furina: readonly CharacterWallpaperView[]
}

/** Exact body accepted by the import endpoint. */
export interface CharacterWallpaperImportRequest {
  readonly theme: CharacterWallpaperThemeId
}

/** Import outcome. `cancelled` is true when the native picker was dismissed. */
export interface CharacterWallpaperImportResponse {
  readonly cancelled: boolean
  readonly catalog: CharacterWallpaperCatalog
}

/** Exact body accepted by the delete endpoint. */
export interface CharacterWallpaperDeleteRequest {
  readonly theme: CharacterWallpaperThemeId
  readonly id: string
}

/** Successful deletion returns the remaining libraries. */
export type CharacterWallpaperDeleteResponse = CharacterWallpaperCatalog

/** Stable API failure shape that never contains native paths. */
export interface CharacterWallpaperErrorResponse {
  readonly error: string
}

/**
 * @param id - candidate wallpaper id from settings or an API body.
 * @returns whether the id is a Desktop-owned imported wallpaper.
 */
export function isCustomCharacterWallpaperId(id: string): boolean {
  return CUSTOM_CHARACTER_WALLPAPER_ID_PATTERN.test(id)
}

/**
 * @param value - candidate theme id from an API body.
 */
export function isCharacterWallpaperThemeId(value: unknown): value is CharacterWallpaperThemeId {
  return value === 'hutao' || value === 'furina'
}

/**
 * Loopback URL for one wallpaper. Unknown custom ids fall back to the bundled PNG.
 * @param theme - Hu Tao or Furina library.
 * @param wallpaperId - `default` or an imported `wp_…` id.
 */
export function characterWallpaperAssetUrl(
  theme: CharacterWallpaperThemeId,
  wallpaperId: string,
): string {
  if (wallpaperId === DEFAULT_CHARACTER_WALLPAPER_ID || !isCustomCharacterWallpaperId(wallpaperId)) {
    return `/themes/${theme}.png`
  }
  return `${CHARACTER_WALLPAPER_ASSET_PREFIX}/${theme}/${wallpaperId}`
}

/**
 * Parse a custom wallpaper loopback path.
 * @param pathname - request pathname, without query string.
 */
export function parseCharacterWallpaperAssetPath(pathname: string): {
  readonly theme: CharacterWallpaperThemeId
  readonly id: string
} | undefined {
  const match = /^\/themes\/custom\/(hutao|furina)\/(wp_[0-9a-f]{16})$/.exec(pathname)
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined
  if (!isCharacterWallpaperThemeId(match[1])) return undefined
  return { theme: match[1], id: match[2] }
}
