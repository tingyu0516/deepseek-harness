import { mkdtempSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_CHARACTER_WALLPAPER_DELETE_PATH,
  DESKTOP_CHARACTER_WALLPAPER_IMPORT_PATH,
  DESKTOP_CHARACTER_WALLPAPERS_PATH,
} from '../src/character-wallpaper-contract.ts'
import {
  handleCharacterWallpaperAssetRequest,
  handleCharacterWallpaperDeleteRequest,
  handleCharacterWallpaperImportRequest,
  handleCharacterWallpaperListRequest,
} from '../src/character-wallpaper-route.ts'
import { CharacterWallpaperStore } from '../src/character-wallpaper-store.ts'

const ORIGIN = 'http://127.0.0.1:43120'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

interface RequestOptions {
  readonly body?: string | Buffer
  readonly headers?: Readonly<Record<string, string | undefined>>
  readonly url?: string
}

function request(method: string, options: RequestOptions = {}): IncomingMessage {
  const req = Readable.from(options.body === undefined ? [] : [options.body]) as IncomingMessage
  req.method = method
  req.url = options.url ?? '/'
  req.headers = {
    host: '127.0.0.1:43120',
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    ...options.headers,
  }
  Object.defineProperty(req, 'socket', {
    configurable: true,
    value: { remoteAddress: '127.0.0.1' },
  })
  return req
}

function jsonRequest(value: unknown, options: RequestOptions = {}): IncomingMessage {
  const body = JSON.stringify(value)
  return request('POST', {
    ...options,
    body,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      ...options.headers,
    },
  })
}

function response(): ServerResponse & {
  body: Buffer
  end: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
} {
  const res = {
    body: Buffer.alloc(0),
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((body?: string | Buffer) => {
      if (body === undefined) {
        res.body = Buffer.alloc(0)
        return
      }
      res.body = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)
    }),
  }
  return res as unknown as ServerResponse & typeof res
}

describe('character wallpaper routes', () => {
  it('lists bundled defaults on a same-origin GET', async () => {
    const store = new CharacterWallpaperStore(mkdtempSync(join(tmpdir(), 'dsh-wallpaper-route-')))
    const res = response()
    await handleCharacterWallpaperListRequest(
      request('GET', { url: DESKTOP_CHARACTER_WALLPAPERS_PATH, headers: { origin: undefined, referer: ORIGIN } }),
      res,
      ORIGIN,
      store,
    )
    expect(res.statusCode).toBe(200)
    const catalog = JSON.parse(res.body.toString('utf8')) as { hutao: unknown[] }
    expect(catalog.hutao).toHaveLength(1)
  })

  it('imports through the native picker and selects the new wallpaper', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'dsh-wallpaper-import-route-'))
    const source = join(userData, 'picked.png')
    writeFileSync(source, PNG)
    const store = new CharacterWallpaperStore(userData)
    const selected: Record<string, string> = { hutao: 'default', furina: 'default' }
    const res = response()
    await handleCharacterWallpaperImportRequest(
      jsonRequest({ theme: 'hutao' }, { url: DESKTOP_CHARACTER_WALLPAPER_IMPORT_PATH }),
      res,
      ORIGIN,
      store,
      async () => source,
      {
        selected: theme => selected[theme] ?? 'default',
        async select(theme, id) { selected[theme] = id },
      },
    )
    const payload = JSON.parse(res.body.toString('utf8')) as {
      cancelled: boolean
      catalog: { hutao: Array<{ id: string; deletable: boolean }> }
    }
    expect(res.statusCode).toBe(200)
    expect(payload.cancelled).toBe(false)
    expect(payload.catalog.hutao).toHaveLength(2)
    const imported = payload.catalog.hutao[1]
    expect(imported?.deletable).toBe(true)
    expect(selected.hutao).toBe(imported?.id)
  })

  it('returns cancelled without changing the catalog when the picker is dismissed', async () => {
    const store = new CharacterWallpaperStore(mkdtempSync(join(tmpdir(), 'dsh-wallpaper-cancel-')))
    const res = response()
    await handleCharacterWallpaperImportRequest(
      jsonRequest({ theme: 'furina' }, { url: DESKTOP_CHARACTER_WALLPAPER_IMPORT_PATH }),
      res,
      ORIGIN,
      store,
      async () => null,
      { selected: () => 'default', select: async () => {} },
    )
    expect(JSON.parse(res.body.toString('utf8'))).toMatchObject({ cancelled: true })
    expect((await store.list()).furina).toHaveLength(1)
  })

  it('deletes an import and restores the default selection', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'dsh-wallpaper-delete-route-'))
    const source = join(userData, 'picked.png')
    writeFileSync(source, PNG)
    const store = new CharacterWallpaperStore(userData)
    const imported = await store.importFromPath('hutao', source)
    const selected = { hutao: imported.id, furina: 'default' }
    const res = response()
    await handleCharacterWallpaperDeleteRequest(
      jsonRequest({ theme: 'hutao', id: imported.id }, { url: DESKTOP_CHARACTER_WALLPAPER_DELETE_PATH }),
      res,
      ORIGIN,
      store,
      {
        selected: theme => selected[theme],
        async select(theme, id) { selected[theme] = id },
      },
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body.toString('utf8')).hutao).toHaveLength(1)
    expect(selected.hutao).toBe('default')
  })

  it('refuses cross-origin wallpaper mutation', async () => {
    const store = new CharacterWallpaperStore(mkdtempSync(join(tmpdir(), 'dsh-wallpaper-origin-')))
    const res = response()
    await handleCharacterWallpaperImportRequest(
      jsonRequest({ theme: 'hutao' }, { headers: { origin: 'http://example.test' } }),
      res,
      ORIGIN,
      store,
      async () => { throw new Error('picker should not open') },
      { selected: () => 'default', select: async () => {} },
    )
    expect(res.statusCode).toBe(403)
  })

  it('serves an imported PNG on the custom asset prefix', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'dsh-wallpaper-asset-'))
    const source = join(userData, 'picked.png')
    writeFileSync(source, PNG)
    const store = new CharacterWallpaperStore(userData)
    const imported = await store.importFromPath('furina', source)
    const res = response()
    await handleCharacterWallpaperAssetRequest(
      request('HEAD', { url: `/themes/custom/furina/${imported.id}` }),
      res,
      store,
    )
    expect(res.statusCode).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'image/png')
    expect(res.body.byteLength).toBe(0)

    const missing = response()
    await handleCharacterWallpaperAssetRequest(
      request('GET', { url: '/themes/custom/furina/wp_0123456789abcdef' }),
      missing,
      store,
    )
    expect(missing.statusCode).toBe(404)
  })
})
