/** Client fetch for the Desktop Changes route. */
import type {
  DesktopChangeCommit,
  DesktopChangeFile,
  DesktopChangeSummary,
  DesktopChangeView,
} from '../workspace-changes-types.ts'

export const DESKTOP_WORKSPACE_CHANGES_PATH = '/api/desktop/workspace-changes'

export type { DesktopChangeCommit, DesktopChangeFile, DesktopChangeSummary, DesktopChangeView }

export interface DesktopChangesQuery {
  readonly root: string
  readonly view: DesktopChangeView
  readonly path?: string
  readonly commit?: string
  readonly files?: readonly string[]
  readonly signal?: AbortSignal
}

function isChangeFile(value: unknown): value is DesktopChangeFile {
  if (typeof value !== 'object' || value === null) return false
  const file = value as { path?: unknown; status?: unknown; additions?: unknown; deletions?: unknown }
  return typeof file.path === 'string'
    && typeof file.status === 'string'
    && (file.additions === null || typeof file.additions === 'number')
    && (file.deletions === null || typeof file.deletions === 'number')
}

function isCommit(value: unknown): value is DesktopChangeCommit {
  if (typeof value !== 'object' || value === null) return false
  const commit = value as { hash?: unknown; short?: unknown; subject?: unknown }
  return typeof commit.hash === 'string' && typeof commit.short === 'string' && typeof commit.subject === 'string'
}

/** Request one Changes listing or patch from the Desktop-owned git route.
 * @param query - workspace root, view, and optional file, commit, or last-turn paths.
 * @returns the parsed Changes summary.
 */
export async function requestDesktopWorkspaceChanges(query: DesktopChangesQuery): Promise<DesktopChangeSummary> {
  const params = new URLSearchParams({
    root: query.root,
    view: query.view,
  })
  if (query.path !== undefined) params.set('path', query.path)
  if (query.commit !== undefined) params.set('commit', query.commit)
  for (const file of query.files ?? []) params.append('file', file)
  const requestInit: RequestInit = query.signal === undefined ? {} : { signal: query.signal }
  const response = await fetch(`${DESKTOP_WORKSPACE_CHANGES_PATH}?${params}`, requestInit)
  const value: unknown = await response.json()
  if (!response.ok || typeof value !== 'object' || value === null) {
    const error = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : 'Unable to read workspace changes'
    throw new Error(error)
  }
  const body = value as {
    repository?: unknown
    branch?: unknown
    view?: unknown
    additions?: unknown
    deletions?: unknown
    files?: unknown
    commits?: unknown
    commit?: unknown
    selectedPath?: unknown
    patch?: unknown
    truncated?: unknown
  }
  if (typeof body.repository !== 'boolean' || typeof body.branch !== 'string' || typeof body.view !== 'string') {
    throw new Error('Invalid workspace changes response')
  }
  const files = Array.isArray(body.files) ? body.files.filter(isChangeFile) : []
  const commits = Array.isArray(body.commits) ? body.commits.filter(isCommit) : undefined
  return {
    repository: body.repository,
    branch: body.branch,
    view: query.view,
    additions: typeof body.additions === 'number' ? body.additions : 0,
    deletions: typeof body.deletions === 'number' ? body.deletions : 0,
    files,
    ...(commits === undefined ? {} : { commits }),
    ...(isCommit(body.commit) ? { commit: body.commit } : {}),
    ...(typeof body.selectedPath === 'string' ? { selectedPath: body.selectedPath } : {}),
    ...(typeof body.patch === 'string' ? { patch: body.patch } : {}),
    ...(body.truncated === true ? { truncated: true } : {}),
  }
}

/** Read the current git branch without listing files or patches.
 * Uses the last-turn view with no paths so the Host only runs `rev-parse`.
 * @param root - workspace directory already admitted by the Host route.
 * @param signal - optional abort for unmount or workspace switch.
 * @returns the branch name, or undefined when the directory is not a repository.
 */
export async function requestDesktopWorkspaceBranch(root: string, signal?: AbortSignal): Promise<string | undefined> {
  const summary = await requestDesktopWorkspaceChanges({
    root,
    view: 'agent-turn',
    ...(signal === undefined ? {} : { signal }),
  })
  if (summary.repository !== true || summary.branch === '') return undefined
  return summary.branch
}

/** Changed-line positions of one unified diff, addressed on the new (current) side. */
export interface ChangedLines {
  /** 1-based current-content line numbers that contain added lines. */
  readonly added: ReadonlySet<number>
  /** 1-based current-content positions where removed lines sat; several removals share the following surviving line, which may sit one past the final line. */
  readonly removed: ReadonlySet<number>
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u

/**
 * Fold a unified diff into changed-line positions on the new side.
 * @param patch - unified diff text as produced by `git diff`; '' yields empty sets.
 * @returns added line numbers and removed-line positions.
 */
export function changedLinesFromUnifiedDiff(patch: string): ChangedLines {
  const added = new Set<number>()
  const removed = new Set<number>()
  let line = 0
  let inside = false
  for (const raw of patch.split('\n')) {
    if (!inside || raw.startsWith('@@')) {
      const header = HUNK_HEADER.exec(raw)
      if (header !== null) {
        line = Number.parseInt(header[1] ?? '0', 10)
        inside = true
      }
      continue
    }
    if (raw.startsWith('+')) {
      added.add(line)
      line += 1
    } else if (raw.startsWith('-')) {
      removed.add(line)
    } else if (raw.startsWith(' ') || raw === '') {
      line += 1
    }
    // '\ No newline at end of file' and anything else leaves the counter alone.
  }
  return { added, removed }
}

/** Changed-line positions marking every line of `content` as added (an untracked new file). */
export function addedEntireFile(content: string): ChangedLines {
  const rows = content === '' ? [] : content.split('\n')
  return { added: new Set(rows.map((_, index) => index + 1)), removed: new Set() }
}

/** Highlight kind for one preview row. */
export type DiffRowKind = 'added' | 'removed' | 'none'

/**
 * Map changed-line positions onto the current content rows.
 * Removed positions clamp into the content (an end-of-file deletion marks the final line); added rows win over removed.
 * @param content - current file text.
 * @param changed - positions from {@link changedLinesFromUnifiedDiff} or {@link addedEntireFile}.
 * @returns one kind per line, in order.
 */
export function diffRowKinds(content: string, changed: ChangedLines): readonly DiffRowKind[] {
  const rows = content === '' ? [] : content.split('\n')
  const removedRows = new Set([...changed.removed].map(position => Math.min(position, rows.length)))
  return rows.map((_, index) => {
    const position = index + 1
    if (changed.added.has(position)) return 'added'
    return removedRows.has(position) ? 'removed' : 'none'
  })
}
