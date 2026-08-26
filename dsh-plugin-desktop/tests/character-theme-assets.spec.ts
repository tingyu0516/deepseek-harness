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
  path = '/themes/hutao.jpg',
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
      { id: 'hutao', path: '/themes/hutao.jpg', file: 'hutao.jpg' },
      { id: 'furina', path: '/themes/furina.jpg', file: 'furina.jpg' },
    ])
  })

  it('rejects path traversal before reading the packaged directory', () => {
    expect(() => characterThemeAssetFile('/tmp', '../hutao.jpg')).toThrow('unknown character theme asset')
    expect(() => characterThemeAssetFile('/tmp', 'missing.jpg')).toThrow('unknown character theme asset')
  })

  it('serves a packaged JPEG on GET and omits the body on HEAD', async () => {
    const filePath = tempPng('hutao.jpg')
    const get = await request((req, res) => handleCharacterThemeAsset(req, res, filePath), 'GET')
    const head = await request((req, res) => handleCharacterThemeAsset(req, res, filePath), 'HEAD')

    expect(get.status).toBe(200)
    expect(get.headers.get('content-type')).toBe('image/jpeg')
    expect(get.body.equals(PNG)).toBe(true)
    expect(head.status).toBe(200)
    expect(head.body.length).toBe(0)
  })

  it('rejects non-GET methods and missing files', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'dsh-character-theme-')), 'hutao.jpg')
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
    writeFileSync(join(packaged, 'hutao.jpg'), PNG)
    writeFileSync(join(packaged, 'furina.jpg'), PNG)
    writeFileSync(join(upstream, 'hutao.jpg'), PNG)
    writeFileSync(join(upstream, 'furina.jpg'), PNG)
    expect(resolveCharacterThemeAssetsDir(packageRoot)).toBe(packaged)
  })

  it('uses package-owned theme assets when the build copy is missing', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-character-theme-owned-'))
    temps.push(workspace)
    const packageRoot = join(workspace, 'dsh-plugin-desktop')
    const owned = join(packageRoot, 'assets', 'themes')
    mkdirSync(owned, { recursive: true })
    writeFileSync(join(owned, 'hutao.jpg'), PNG)
    writeFileSync(join(owned, 'furina.jpg'), PNG)
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
    writeFileSync(join(upstream, 'hutao.jpg'), PNG)
    writeFileSync(join(upstream, 'furina.jpg'), PNG)
    expect(resolveCharacterThemeAssetsDir(packageRoot)).toBe(upstream)
  })
})
