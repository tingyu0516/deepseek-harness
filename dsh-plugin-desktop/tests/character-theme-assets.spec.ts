import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CHARACTER_THEME_ASSET_ROUTES,
  characterThemeAssetFile,
  handleCharacterThemeAsset,
  resolveCharacterThemeAssetsDir,
} from '../src/character-theme-assets.ts'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const temps: string[] = []

afterEach(() => {
  temps.length = 0
})

function tempPng(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-character-theme-'))
  temps.push(dir)
  const filePath = join(dir, name)
  writeFileSync(filePath, PNG)
  return filePath
}

async function request(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  method: string,
  path = '/themes/hutao.png',
): Promise<{ status: number; headers: Headers; body: Buffer }> {
  const server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server has no address')
  try {
    const response = await fetch(`http://127.0.0.1:${String(address.port)}${path}`, { method })
    return {
      status: response.status,
      headers: response.headers,
      body: Buffer.from(await response.arrayBuffer()),
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

describe('character theme assets', () => {
  it('exposes exact Hu Tao and Furina loopback paths', () => {
    expect(CHARACTER_THEME_ASSET_ROUTES).toEqual([
      { id: 'hutao', path: '/themes/hutao.png', file: 'hutao.png' },
      { id: 'furina', path: '/themes/furina.png', file: 'furina.png' },
    ])
  })

  it('rejects path traversal before reading the packaged directory', () => {
    expect(() => characterThemeAssetFile('/tmp', '../hutao.png')).toThrow('unknown character theme asset')
    expect(() => characterThemeAssetFile('/tmp', 'missing.png')).toThrow('unknown character theme asset')
  })

  it('serves a packaged PNG on GET and omits the body on HEAD', async () => {
    const filePath = tempPng('hutao.png')
    const get = await request((req, res) => handleCharacterThemeAsset(req, res, filePath), 'GET')
    const head = await request((req, res) => handleCharacterThemeAsset(req, res, filePath), 'HEAD')

    expect(get.status).toBe(200)
    expect(get.headers.get('content-type')).toBe('image/png')
    expect(get.body.equals(PNG)).toBe(true)
    expect(head.status).toBe(200)
    expect(head.body.length).toBe(0)
  })

  it('rejects non-GET methods and missing files', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'dsh-character-theme-')), 'hutao.png')
    const post = await request((req, res) => handleCharacterThemeAsset(req, res, missing), 'POST')
    const absent = await request((req, res) => handleCharacterThemeAsset(req, res, missing), 'GET')

    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
    expect(absent.status).toBe(404)
  })

  it('prefers packaged wallpapers over the upstream checkout', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-character-theme-ws-'))
    temps.push(workspace)
    const packageRoot = join(workspace, 'dsh-plugin-desktop')
    const packaged = join(packageRoot, 'build', 'themes')
    const upstream = join(workspace, 'deepseek-harness', 'themes', 'images')
    mkdirSync(packaged, { recursive: true })
    mkdirSync(upstream, { recursive: true })
    writeFileSync(join(packaged, 'hutao.png'), PNG)
    writeFileSync(join(packaged, 'furina.png'), PNG)
    writeFileSync(join(upstream, 'hutao.png'), PNG)
    writeFileSync(join(upstream, 'furina.png'), PNG)
    expect(resolveCharacterThemeAssetsDir(packageRoot)).toBe(packaged)
  })

  it('uses package-owned theme assets when the build copy is missing', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-character-theme-owned-'))
    temps.push(workspace)
    const packageRoot = join(workspace, 'dsh-plugin-desktop')
    const owned = join(packageRoot, 'assets', 'themes')
    mkdirSync(owned, { recursive: true })
    writeFileSync(join(owned, 'hutao.png'), PNG)
    writeFileSync(join(owned, 'furina.png'), PNG)
    expect(resolveCharacterThemeAssetsDir(packageRoot)).toBe(owned)
  })

  it('falls back to upstream theme images when the package copy is missing', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-character-theme-fb-'))
    temps.push(workspace)
    const packageRoot = join(workspace, 'dsh-plugin-desktop')
    mkdirSync(packageRoot, { recursive: true })
    expect(resolveCharacterThemeAssetsDir(packageRoot)).toBeUndefined()

    const upstream = join(workspace, 'deepseek-harness', 'themes', 'images')
    mkdirSync(upstream, { recursive: true })
    writeFileSync(join(upstream, 'hutao.png'), PNG)
    writeFileSync(join(upstream, 'furina.png'), PNG)
    expect(resolveCharacterThemeAssetsDir(packageRoot)).toBe(upstream)
  })
})
