/** Read-only git inventory for the Desktop Changes panel. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  mergeChangeFiles,
  parseCommitLog,
  parseNumstat,
  parsePorcelainStatus,
  type DesktopChangeFile,
  type DesktopChangeSummary,
  type DesktopChangeView,
} from './workspace-changes-types.ts'

export type {
  DesktopChangeCommit,
  DesktopChangeFile,
  DesktopChangeStatus,
  DesktopChangeSummary,
  DesktopChangeView,
} from './workspace-changes-types.ts'
export {
  DESKTOP_CHANGE_VIEWS,
  parseCommitLog,
  parseDesktopChangeView,
  parseNumstat,
  parsePorcelainStatus,
  validateCommitId,
  validateGitPathspec,
} from './workspace-changes-types.ts'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 15_000
const GIT_MAX_BUFFER = 4 * 1024 * 1024
const MAX_FILES = 500
const MAX_COMMITS = 40
const MAX_PATCH_CHARS = 512 * 1024

interface GitRunResult {
  readonly stdout: string
  readonly stderr: string
  readonly status: number
}

async function runGit(cwd: string, args: readonly string[]): Promise<GitRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: '',
      },
    })
    return { stdout, stderr, status: 0 }
  } catch (cause: unknown) {
    if (typeof cause === 'object' && cause !== null && 'stdout' in cause) {
      const failure = cause as { stdout?: string; stderr?: string; status?: number | null; code?: string | number }
      return {
        stdout: typeof failure.stdout === 'string' ? failure.stdout : '',
        stderr: typeof failure.stderr === 'string' ? failure.stderr : '',
        status: typeof failure.status === 'number' ? failure.status : (failure.code === 'ENOENT' ? 127 : 1),
      }
    }
    throw cause
  }
}

function emptySummary(view: DesktopChangeView, repository: boolean, branch = ''): DesktopChangeSummary {
  return { repository, branch, view, additions: 0, deletions: 0, files: [] }
}

function gitDiff(
  view: Exclude<DesktopChangeView, 'commits'>,
  flags: readonly string[],
  pathspec: readonly string[] = [],
): string[] {
  const command = view === 'staged' ? ['diff', '--cached'] : view === 'unstaged' ? ['diff'] : ['diff', 'HEAD']
  return pathspec.length === 0 ? [...command, ...flags] : [...command, ...flags, '--', ...pathspec]
}

/**
 * Read one Changes view from a validated workspace directory.
 * @param cwd - workspace directory already confined to an allowed root.
 * @param view - Changes dropdown selection.
 * @param options - optional path, commit, or last-agent-turn pathspecs.
 */
export async function readDesktopChanges(
  cwd: string,
  view: DesktopChangeView,
  options: {
    readonly path?: string
    readonly commit?: string
    readonly files?: readonly string[]
  } = {},
): Promise<DesktopChangeSummary | { error: string; status: number }> {
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inside.status === 127) return { error: 'git is not available', status: 503 }
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') return emptySummary(view, false)
  const branchResult = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : ''

  if (view === 'commits') {
    if (options.commit === undefined) {
      const log = await runGit(cwd, [
        'log', `-${String(MAX_COMMITS)}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI',
      ])
      if (log.status !== 0) return emptySummary(view, true, branch)
      return { ...emptySummary(view, true, branch), commits: parseCommitLog(log.stdout) }
    }
    const log = await runGit(cwd, [
      'log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI', options.commit,
    ])
    const commit = parseCommitLog(log.stdout)[0]
    if (log.status !== 0 || commit === undefined) return { error: 'commit is unavailable', status: 404 }
    if (options.path !== undefined) {
      const show = await runGit(cwd, ['show', options.commit, '--', options.path])
      const patch = show.stdout.length > MAX_PATCH_CHARS ? `${show.stdout.slice(0, MAX_PATCH_CHARS)}\n...truncated` : show.stdout
      return {
        repository: true, branch, view, additions: 0, deletions: 0, files: [],
        commit, selectedPath: options.path, patch, truncated: show.stdout.length > MAX_PATCH_CHARS,
      }
    }
    const numstat = parseNumstat((await runGit(cwd, ['show', '--numstat', '--format=', options.commit])).stdout)
    const files: DesktopChangeFile[] = numstat.slice(0, MAX_FILES).map(entry => ({
      path: entry.path,
      status: 'modified',
      additions: entry.additions,
      deletions: entry.deletions,
    }))
    let additions = 0
    let deletions = 0
    for (const file of files) {
      if (file.additions !== null) additions += file.additions
      if (file.deletions !== null) deletions += file.deletions
    }
    return {
      repository: true, branch, view, additions, deletions, files, commit,
      truncated: numstat.length > files.length,
    }
  }

  const allow = view === 'agent-turn' ? new Set(options.files ?? []) : undefined
  if (view === 'agent-turn' && (allow === undefined || allow.size === 0) && options.path === undefined) {
    return emptySummary(view, true, branch)
  }
  const inventoryView = view === 'agent-turn' ? 'uncommitted' : view
  const porcelain = parsePorcelainStatus((await runGit(cwd, ['status', '--porcelain=v1', '-uall'])).stdout)
  const numstat = parseNumstat((await runGit(cwd, gitDiff(inventoryView, ['--numstat']))).stdout)
  const merged = mergeChangeFiles(porcelain, numstat, inventoryView, allow)
  if (options.path !== undefined) {
    const entry = merged.files.find(file => file.path === options.path)
    if (entry === undefined) return { error: 'path is not in this view', status: 404 }
    if (entry.status === 'untracked') {
      return { repository: true, branch, view, ...merged, selectedPath: options.path, patch: '' }
    }
    const diff = await runGit(cwd, gitDiff(inventoryView, [], [options.path]))
    const patch = diff.stdout.length > MAX_PATCH_CHARS ? `${diff.stdout.slice(0, MAX_PATCH_CHARS)}\n...truncated` : diff.stdout
    return {
      repository: true, branch, view, ...merged, selectedPath: options.path, patch,
      truncated: merged.truncated || diff.stdout.length > MAX_PATCH_CHARS,
    }
  }
  return { repository: true, branch, view, ...merged }
}
