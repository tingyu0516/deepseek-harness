import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_WORKSPACE_TREE_PATH,
  handleDesktopWorkspaceFileRequest,
  validateWorkspaceFilePath,
} from '../src/workspace-file-route.ts'

const origin = 'http://127.0.0.1:43120'
const MAX_FILE_BYTES = 2 * 1024 * 1024

function request(path: string, endpoint = '/api/desktop/workspace-file', method = 'GET'): IncomingMessage {
  return {
    method,
    url: `${endpoint}?path=${encodeURIComponent(path)}`,
    headers: { host: '127.0.0.1:43120', origin, 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  } as IncomingMessage
}

function jsonPut(path: string, content: string, headers: Record<string, string> = {}): IncomingMessage {
  const body = JSON.stringify({ path, content })
  const req = Readable.from([body]) as IncomingMessage
  req.method = 'PUT'
  req.url = '/api/desktop/workspace-file'
  req.headers = {
    host: '127.0.0.1:43120',
    origin,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    ...headers,
  }
  Object.defineProperty(req, 'socket', { configurable: true, value: { remoteAddress: '127.0.0.1' } })
  return req
}

function response(): ServerResponse & { body: string; headers: Record<string, string> } {
  const result = {
    statusCode: 200,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { result.headers[name.toLowerCase()] = value },
    end(body?: string) { result.body = body ?? '' },
  }
  return result as unknown as ServerResponse & typeof result
}

describe('desktop workspace file route', () => {
  it('reads a UTF-8 file for same-origin loopback callers inside an allowed workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-route-'))
    const file = join(root, 'note.txt')
    await writeFile(file, 'hello desktop', 'utf8')
    try {
      const res = response()
      await handleDesktopWorkspaceFileRequest(request(file), res, origin, [root])
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ path: file, content: 'hello desktop' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('overwrites an existing UTF-8 file and refuses missing, directory, and out-of-workspace paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-route-'))
    const nested = join(root, 'src')
    const file = join(root, 'note.txt')
    await mkdir(nested)
    await writeFile(file, 'hello desktop', 'utf8')
    try {
      const saved = response()
      await handleDesktopWorkspaceFileRequest(jsonPut(file, 'edited'), saved, origin, [root])
      expect(saved.statusCode).toBe(200)
      expect(JSON.parse(saved.body)).toEqual({ path: file, saved: true })
      expect(await readFile(file, 'utf8')).toBe('edited')

      const stillReadable = response()
      await handleDesktopWorkspaceFileRequest(request(file), stillReadable, origin, [root])
      expect(JSON.parse(stillReadable.body)).toEqual({ path: file, content: 'edited' })

      const missing = response()
      await handleDesktopWorkspaceFileRequest(jsonPut(join(root, 'gone.txt'), 'nope'), missing, origin, [root])
      expect(missing.statusCode).toBe(404)
      expect(JSON.parse(missing.body)).toEqual({ error: 'file unavailable' })

      const directory = response()
      await handleDesktopWorkspaceFileRequest(jsonPut(nested, 'nope'), directory, origin, [root])
      expect(directory.statusCode).toBe(400)
      expect(JSON.parse(directory.body)).toEqual({ error: 'path is not a file' })

      const outside = response()
      await handleDesktopWorkspaceFileRequest(jsonPut(join(tmpdir(), 'outside.txt'), 'nope'), outside, origin, [root])
      expect(outside.statusCode).toBe(403)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects oversized writes, invalid bodies, and non-GET/PUT methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-route-'))
    const file = join(root, 'note.txt')
    await writeFile(file, 'keep', 'utf8')
    try {
      const tooLarge = response()
      await handleDesktopWorkspaceFileRequest(jsonPut(file, 'x'.repeat(MAX_FILE_BYTES + 1)), tooLarge, origin, [root])
      expect(tooLarge.statusCode).toBe(413)
      expect(await readFile(file, 'utf8')).toBe('keep')

      const invalid = response()
      await handleDesktopWorkspaceFileRequest(jsonPut(file, 'ok', { 'content-type': 'text/plain' }), invalid, origin, [root])
      expect(invalid.statusCode).toBe(400)

      const disallowed = response()
      await handleDesktopWorkspaceFileRequest(request(file, '/api/desktop/workspace-file', 'POST'), disallowed, origin, [root])
      expect(disallowed.statusCode).toBe(405)
      expect(disallowed.headers.allow).toBe('GET, PUT')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('lists files and directories while rejecting paths outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-route-'))
    const source = join(root, 'src')
    await mkdir(source)
    await writeFile(join(root, 'README.md'), '# Desktop', 'utf8')
    try {
      const res = response()
      await handleDesktopWorkspaceFileRequest(request(root, DESKTOP_WORKSPACE_TREE_PATH), res, origin, [root])
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'README.md', kind: 'file' }),
        expect.objectContaining({ name: 'src', kind: 'directory' }),
      ]))

      const missingDir = response()
      await handleDesktopWorkspaceFileRequest(request(join(root, 'gone'), DESKTOP_WORKSPACE_TREE_PATH), missingDir, origin, [root])
      expect(missingDir.statusCode).toBe(404)

      const outside = response()
      await handleDesktopWorkspaceFileRequest(request(join(tmpdir(), 'outside.txt')), outside, origin, [root])
      expect(outside.statusCode).toBe(403)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('lists a workspace when the allowed root has a trailing separator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-route-'))
    await writeFile(join(root, 'README.md'), '# Desktop', 'utf8')
    try {
      const res = response()
      await handleDesktopWorkspaceFileRequest(
        request(`${root}${sep}`, DESKTOP_WORKSPACE_TREE_PATH),
        res,
        origin,
        [`${root}${sep}`],
      )
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).path).toBe(root)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('skips a missing allowed root and still lists an existing workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-route-'))
    const missing = join(root, 'missing-root')
    await writeFile(join(root, 'README.md'), '# Desktop', 'utf8')
    try {
      const res = response()
      await handleDesktopWorkspaceFileRequest(request(root, DESKTOP_WORKSPACE_TREE_PATH), res, origin, [missing, root])
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'README.md', kind: 'file' }),
      ]))
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects traversal and cross-origin requests', async () => {
    expect(validateWorkspaceFilePath('relative.txt')).toBeUndefined()
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-route-'))
    try {
      const traversal = response()
      await handleDesktopWorkspaceFileRequest(request(`${root}\\..\\outside.txt`), traversal, origin, [root])
      expect(traversal.statusCode).toBe(400)
      const crossOrigin = request(join(root, 'missing.txt'))
      crossOrigin.headers.origin = 'https://example.com'
      const forbidden = response()
      await handleDesktopWorkspaceFileRequest(crossOrigin, forbidden, origin, [root])
      expect(forbidden.statusCode).toBe(403)

      const mutatingWithoutOrigin = jsonPut(join(root, 'note.txt'), 'nope')
      delete mutatingWithoutOrigin.headers.origin
      const blocked = response()
      await handleDesktopWorkspaceFileRequest(mutatingWithoutOrigin, blocked, origin, [root])
      expect(blocked.statusCode).toBe(403)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
