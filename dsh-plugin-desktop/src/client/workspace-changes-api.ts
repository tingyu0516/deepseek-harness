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
