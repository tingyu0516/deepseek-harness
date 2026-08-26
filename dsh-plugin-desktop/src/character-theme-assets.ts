/** Loopback PNG routes for Desktop-registered character themes. */

import { createReadStream, existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'

/** Exact loopback paths served for Hu Tao and Furina wallpapers. */
export const CHARACTER_THEME_ASSET_ROUTES = [
  { id: 'hutao', path: '/themes/hutao.png', file: 'hutao.png' },
  { id: 'furina', path: '/themes/furina.png', file: 'furina.png' },
] as const

/** Theme ids that own a packaged wallpaper. */
export type CharacterThemeId = (typeof CHARACTER_THEME_ASSET_ROUTES)[number]['id']

/**
 * Directories that may contain Hu Tao / Furina wallpapers during build or `yarn dev`.
 * @param packageRoot - `dsh-plugin-desktop` package directory.
 */
export function characterThemeAssetDirectories(packageRoot: string): string[] {
  return [
    join(packageRoot, 'build', 'themes'),
    join(packageRoot, 'assets', 'themes'),
    join(packageRoot, '..', 'deepseek-harness', 'themes', 'images'),
    join(packageRoot, '..', 'deepseek-harness', 'apps', 'web', 'public', 'themes'),
  ]
}

/**
 * Pick the first directory that currently has both packaged wallpapers.
 * @param packageRoot - `dsh-plugin-desktop` package directory.
 */
export function resolveCharacterThemeAssetsDir(packageRoot: string): string | undefined {
  return characterThemeAssetDirectories(packageRoot).find(dir =>
    CHARACTER_THEME_ASSET_ROUTES.every(asset => existsSync(join(dir, asset.file))),
  )
}

/**
 * Resolve one packaged wallpaper inside the Desktop theme asset directory.
 * @param assetsDir - directory containing the copied PNG files.
 * @param file - basename of one registered wallpaper.
 * @returns the absolute file path.
 */
export function characterThemeAssetFile(assetsDir: string, file: string): string {
  const name = basename(file)
  if (name !== file || !CHARACTER_THEME_ASSET_ROUTES.some(route => route.file === name)) {
    throw new Error(`dsh-plugin-desktop: unknown character theme asset ${JSON.stringify(file)}`)
  }
  return join(assetsDir, name)
}

/**
 * Serve one exact wallpaper from the packaged Desktop theme directory.
 * @param req - incoming loopback request.
 * @param res - loopback response.
 * @param filePath - absolute PNG path produced by {@link characterThemeAssetFile}.
 */
export function handleCharacterThemeAsset(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('allow', 'GET, HEAD')
    res.end()
    return
  }
  if (!existsSync(filePath)) {
    res.statusCode = 404
    res.end()
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', 'image/png')
  res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}
