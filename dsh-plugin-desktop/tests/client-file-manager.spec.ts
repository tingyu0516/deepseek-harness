import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_WORKSPACE_FILE_PATH,
  createDesktopWorkspaceEntry,
  deleteDesktopWorkspaceFile,
  requestDesktopWorkspaceFile,
  saveDesktopWorkspaceFile,
} from '../src/client/workspace-file-api.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop workspace file client', () => {
  it('reads UTF-8 content from the Host file route', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: 'E:\\repo\\note.txt', content: 'hello' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await expect(requestDesktopWorkspaceFile('E:\\repo\\note.txt')).resolves.toBe('hello')
    expect(fetch).toHaveBeenCalledWith(
      `${DESKTOP_WORKSPACE_FILE_PATH}?path=${encodeURIComponent('E:\\repo\\note.txt')}`,
      {},
    )
  })

  it('saves UTF-8 content through PUT and surfaces Host errors', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: 'E:\\repo\\note.txt', saved: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await saveDesktopWorkspaceFile('E:\\repo\\note.txt', 'edited')
    expect(fetch).toHaveBeenCalledWith(DESKTOP_WORKSPACE_FILE_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'E:\\repo\\note.txt', content: 'edited' }),
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'path is outside the workspace' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })))
    await expect(saveDesktopWorkspaceFile('C:\\Windows\\notes.txt', 'nope')).rejects.toThrow('path is outside the workspace')
  })

  it('deletes a workspace file through DELETE and surfaces Host errors', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: 'E:\\repo\\note.txt', deleted: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await deleteDesktopWorkspaceFile('E:\\repo\\note.txt')
    expect(fetch).toHaveBeenCalledWith(
      `${DESKTOP_WORKSPACE_FILE_PATH}?path=${encodeURIComponent('E:\\repo\\note.txt')}`,
      { method: 'DELETE' },
    )

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'path is not a file' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })))
    await expect(deleteDesktopWorkspaceFile('E:\\repo\\src')).rejects.toThrow('path is not a file')
  })

  it('creates a file or directory through POST and surfaces Host errors', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: 'E:\\repo\\note.txt', created: true, kind: 'file' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    await expect(createDesktopWorkspaceEntry('E:\\repo\\note.txt', 'file')).resolves.toEqual({
      path: 'E:\\repo\\note.txt',
      kind: 'file',
    })
    expect(fetch).toHaveBeenCalledWith(DESKTOP_WORKSPACE_FILE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'E:\\repo\\note.txt', kind: 'file' }),
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'path already exists' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })))
    await expect(createDesktopWorkspaceEntry('E:\\repo\\src', 'directory')).rejects.toThrow('path already exists')
  })
})
