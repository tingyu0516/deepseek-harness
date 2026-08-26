/** Strict loopback HTTP handlers for character wallpaper import, deletion, and assets. */

import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  DESKTOP_CHARACTER_WALLPAPERS_PATH,
  isCharacterWallpaperThemeId,
  parseCharacterWallpaperAssetPath,
  type CharacterWallpaperCatalog,
  type CharacterWallpaperImportResponse,
  type CharacterWallpaperThemeId,
} from './character-wallpaper-contract.ts'
import {
  CharacterWallpaperError,
  CharacterWallpaperStore,
} from './character-wallpaper-store.ts'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'

const MAX_BODY_BYTES = 16 * 1024

class BodyTooLargeError extends Error {}

function finishJson(
  res: ServerResponse,
  statusCode: number,
  value: object,
  allow?: 'GET' | 'POST',
): void {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(value))
}

function error(message: string): { error: string } {
  return { error: message }
}

function isJsonRequest(req: IncomingMessage): boolean {
  return req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) throw new SyntaxError('invalid content length')
    if (Number(declaredLength) > MAX_BODY_BYTES) throw new BodyTooLargeError()
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

const INVALID_BODY = Symbol('invalid body')

async function parsePostBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown | typeof INVALID_BODY> {
  if (!isJsonRequest(req)) {
    finishJson(res, 415, error('content type must be application/json'))
    return INVALID_BODY
  }
  try {
    return await readJson(req)
  } catch (cause) {
    const tooLarge = cause instanceof BodyTooLargeError
    finishJson(res, tooLarge ? 413 : 400, error(tooLarge ? 'request body is too large' : 'invalid JSON request'))
    return INVALID_BODY
  }
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function wallpaperStatus(code: CharacterWallpaperError['code']): number {
  if (code === 'not-found') return 404
  if (code === 'limit-reached' || code === 'cannot-delete-default') return 409
  if (code === 'too-large') return 413
  return 400
}

function failWallpaper(
  res: ServerResponse,
  cause: unknown,
  reportError: (operation: string, cause: unknown) => void,
  operation: string,
): void {
  if (cause instanceof CharacterWallpaperError) {
    finishJson(res, wallpaperStatus(cause.code), error(cause.code))
    return
  }
  reportError(operation, cause)
  finishJson(res, 500, error('character wallpaper operation failed'))
}

function requestPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  } catch {
    return ''
  }
}

/** Settings writes used when an import is selected or a selected wallpaper is deleted. */
export interface CharacterWallpaperSelection {
  selected(theme: CharacterWallpaperThemeId): string
  select(theme: CharacterWallpaperThemeId, id: string): Promise<void>
}

/** List bundled defaults plus imported wallpapers. */
export async function handleCharacterWallpaperListRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  store: CharacterWallpaperStore,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'GET') return finishJson(res, 405, error('method not allowed'), 'GET')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, false)) {
    return finishJson(res, 403, error('forbidden'))
  }
  try {
    finishJson(res, 200, await store.list())
  } catch (cause) {
    reportError('list character wallpapers', cause)
    finishJson(res, 500, error('character wallpapers unavailable'))
  }
}

/** Open the native image picker and copy the chosen file into userData. */
export async function handleCharacterWallpaperImportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  store: CharacterWallpaperStore,
  pickImageFile: () => Promise<string | null>,
  selection: CharacterWallpaperSelection,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isExactRecord(value, ['theme']) || !isCharacterWallpaperThemeId(value.theme)) {
    return finishJson(res, 400, error('invalid wallpaper import request'))
  }
  try {
    const sourcePath = await pickImageFile()
    if (sourcePath === null) {
      const response: CharacterWallpaperImportResponse = {
        cancelled: true,
        catalog: await store.list(),
      }
      finishJson(res, 200, response)
      return
    }
    const imported = await store.importFromPath(value.theme, sourcePath)
    await selection.select(value.theme, imported.id)
    const response: CharacterWallpaperImportResponse = {
      cancelled: false,
      catalog: await store.list(),
    }
    finishJson(res, 200, response)
  } catch (cause) {
    failWallpaper(res, cause, reportError, 'import character wallpaper')
  }
}

/** Delete one imported wallpaper and fall back to the bundled default when it was selected. */
export async function handleCharacterWallpaperDeleteRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  store: CharacterWallpaperStore,
  selection: CharacterWallpaperSelection,
  reportError: (operation: string, cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, error('method not allowed'), 'POST')
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    return finishJson(res, 403, error('forbidden'))
  }
  const value = await parsePostBody(req, res)
  if (value === INVALID_BODY) return
  if (!isExactRecord(value, ['theme', 'id'])
    || !isCharacterWallpaperThemeId(value.theme)
    || typeof value.id !== 'string') {
    return finishJson(res, 400, error('invalid wallpaper deletion request'))
  }
  try {
    const catalog: CharacterWallpaperCatalog = await store.delete(value.theme, value.id)
    if (selection.selected(value.theme) === value.id) {
      await selection.select(value.theme, 'default')
    }
    finishJson(res, 200, catalog)
  } catch (cause) {
    failWallpaper(res, cause, reportError, 'delete character wallpaper')
  }
}

/** Serve one imported wallpaper from userData. Bundled defaults use the packaged PNG routes. */
export async function handleCharacterWallpaperAssetRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: CharacterWallpaperStore,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('allow', 'GET, HEAD')
    res.end()
    return
  }
  const parsed = parseCharacterWallpaperAssetPath(requestPathname(req))
  if (parsed === undefined) {
    res.statusCode = 404
    res.end()
    return
  }
  const asset = await store.resolveCustomAsset(parsed.theme, parsed.id)
  if (asset === undefined) {
    res.statusCode = 404
    res.end()
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', asset.mime)
  res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(asset.filePath).pipe(res)
}

export const characterWallpaperRouteConstants = Object.freeze({
  list: DESKTOP_CHARACTER_WALLPAPERS_PATH,
  maxBodyBytes: MAX_BODY_BYTES,
})
