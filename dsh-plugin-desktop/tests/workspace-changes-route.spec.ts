import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_WORKSPACE_CHANGES_PATH,
  handleDesktopWorkspaceChangesRequest,
} from '../src/workspace-changes-route.ts'

const execFileAsync = promisify(execFile)
const origin = 'http://127.0.0.1:43120'

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

function request(query: string, method = 'GET'): IncomingMessage {
  return {
    method,
    url: `${DESKTOP_WORKSPACE_CHANGES_PATH}?${query}`,
    headers: { host: '127.0.0.1:43120', origin, 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  } as IncomingMessage
}

function response(): ServerResponse & { body: string } {
  const result = { statusCode: 200, body: '', setHeader: () => {}, end(body?: string) { result.body = body ?? '' } }
  return result as unknown as ServerResponse & typeof result
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 8_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@dsh.local',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@dsh.local',
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_PAGER: '',
      PAGER: '',
    },
  })
}

describe.skipIf(!gitAvailable())('desktop workspace changes route', () => {
  it('lists uncommitted, staged, unstaged, commits, and last-turn files inside the workspace', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-changes-'))
    try {
      await git(root, ['init'])
      await writeFile(join(root, 'tracked.ts'), 'one\n', 'utf8')
      await git(root, ['add', 'tracked.ts'])
      await git(root, ['-c', 'user.name=test', '-c', 'user.email=test@dsh.local', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'])
      await writeFile(join(root, 'tracked.ts'), 'one\ntwo\n', 'utf8')
      await writeFile(join(root, 'staged.ts'), 'staged\n', 'utf8')
      await git(root, ['add', 'staged.ts'])
      await writeFile(join(root, 'unstaged.ts'), 'loose\n', 'utf8')

      const uncommitted = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(root)}&view=uncommitted`),
        uncommitted,
        origin,
        [root],
      )
      expect(uncommitted.statusCode).toBe(200)
      const uncommittedBody = JSON.parse(uncommitted.body) as {
        repository: boolean
        files: Array<{ path: string; status: string }>
      }
      expect(uncommittedBody.repository).toBe(true)
      expect(uncommittedBody.files.map(file => file.path)).toEqual(
        expect.arrayContaining(['tracked.ts', 'staged.ts', 'unstaged.ts']),
      )

      const staged = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(root)}&view=staged`),
        staged,
        origin,
        [root],
      )
      expect(JSON.parse(staged.body).files.map((file: { path: string }) => file.path)).toEqual(['staged.ts'])

      const unstaged = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(root)}&view=unstaged`),
        unstaged,
        origin,
        [root],
      )
      expect(JSON.parse(unstaged.body).files.map((file: { path: string }) => file.path)).toEqual(
        expect.arrayContaining(['tracked.ts', 'unstaged.ts']),
      )

      const agent = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(root)}&view=agent-turn&file=tracked.ts`),
        agent,
        origin,
        [root],
      )
      expect(JSON.parse(agent.body).files).toEqual([
        expect.objectContaining({ path: 'tracked.ts' }),
      ])

      const commits = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(root)}&view=commits`),
        commits,
        origin,
        [root],
      )
      const commitList = JSON.parse(commits.body) as { commits: Array<{ subject: string; hash: string }> }
      expect(commitList.commits[0]?.subject).toBe('init')

      const patch = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(root)}&view=uncommitted&path=tracked.ts`),
        patch,
        origin,
        [root],
      )
      expect(JSON.parse(patch.body).patch).toContain('+two')

      const commitFiles = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(root)}&view=commits&commit=${commitList.commits[0]!.hash}`),
        commitFiles,
        origin,
        [root],
      )
      expect(JSON.parse(commitFiles.body).files).toEqual([
        expect.objectContaining({ path: 'tracked.ts' }),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects views, traversal, and paths outside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-changes-out-'))
    try {
      const invalid = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(root)}&view=other`),
        invalid,
        origin,
        [root],
      )
      expect(invalid.statusCode).toBe(400)

      const outside = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(join(tmpdir(), 'outside'))}&view=uncommitted`),
        outside,
        origin,
        [root],
      )
      expect(outside.statusCode).toBe(403)

      const traversal = response()
      await handleDesktopWorkspaceChangesRequest(
        request(`root=${encodeURIComponent(root)}&view=uncommitted&file=../secret.ts`),
        traversal,
        origin,
        [root],
      )
      expect(traversal.statusCode).toBe(400)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
