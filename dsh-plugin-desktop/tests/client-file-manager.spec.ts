import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_WORKSPACE_FILE_PATH,
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
})
