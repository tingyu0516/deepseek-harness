import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_WORKSPACE_TREE_PATH,
  handleDesktopWorkspaceFileRequest,
  validateWorkspaceFilePath,
} from '../src/workspace-file-route.ts'

function request(path: string, endpoint = '/api/desktop/workspace-file', method = 'GET'): IncomingMessage {
  return {
    method,
    url: `${endpoint}?path=${encodeURIComponent(path)}`,
    headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  } as IncomingMessage
}
function response(): ServerResponse & { body: string; setHeader: (name: string, value: string) => void } {
  const result = { statusCode: 200, body: '', setHeader: () => {}, end(body?: string) { result.body = body ?? '' } }
  return result as unknown as ServerResponse & typeof result
}

const origin = 'http://127.0.0.1:43120'

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
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
