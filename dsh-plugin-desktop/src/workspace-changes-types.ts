/** Shared Changes inventory types and git-output parsers. */

export type DesktopChangeView = 'agent-turn' | 'uncommitted' | 'staged' | 'unstaged' | 'commits'
export type DesktopChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unmerged'

export interface DesktopChangeFile {
  readonly path: string
  readonly status: DesktopChangeStatus
  readonly additions: number | null
  readonly deletions: number | null
}

export interface DesktopChangeCommit {
  readonly hash: string
  readonly short: string
  readonly subject: string
  readonly author: string
  readonly committedAt: string
}

export interface DesktopChangeSummary {
  readonly repository: boolean
  readonly branch: string
  readonly view: DesktopChangeView
  readonly additions: number
  readonly deletions: number
  readonly files: readonly DesktopChangeFile[]
  readonly commits?: readonly DesktopChangeCommit[]
  readonly commit?: DesktopChangeCommit
  readonly selectedPath?: string
  readonly patch?: string
  readonly truncated?: boolean
}

export const DESKTOP_CHANGE_VIEWS: readonly DesktopChangeView[] = [
  'agent-turn', 'uncommitted', 'staged', 'unstaged', 'commits',
]

export interface PorcelainEntry {
  readonly path: string
  readonly index: string
  readonly worktree: string
}

export interface NumstatEntry {
  readonly path: string
  readonly additions: number | null
  readonly deletions: number | null
}

/** Parse a Changes view query; unknown values are rejected.
 * @param value - `view` query string, or null for the default Uncommitted view.
 * @returns the view, or undefined when the query is not a known view.
 */
export function parseDesktopChangeView(value: string | null): DesktopChangeView | undefined {
  if (value === null) return 'uncommitted'
  return DESKTOP_CHANGE_VIEWS.find(view => view === value)
}

/** Reject absolute, empty, or traversing git pathspecs.
 * @param value - candidate relative path from the renderer.
 * @returns a posix relative path, or undefined when the pathspec is unsafe.
 */
export function validateGitPathspec(value: string): string | undefined {
  if (value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value)) return undefined
  const normalized = value.replaceAll('\\', '/')
  if (normalized === '' || normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    return undefined
  }
  return normalized
}

/** Accept a shortened or full commit object name.
 * @param value - `commit` query string.
 * @returns the object name, or undefined when it is not a hex prefix.
 */
export function validateCommitId(value: string | null): string | undefined {
  if (value === null || !/^[0-9a-f]{7,40}$/iu.test(value)) return undefined
  return value
}

function unquoteGitPath(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('\\n', '\n').replaceAll('\\t', '\t').replaceAll('\\\\', '\\').replaceAll('\\"', '"')
  }
  return value
}

/** Parse `git status --porcelain=v1` into index/worktree letters.
 * @param stdout - porcelain status text.
 * @returns one entry per path, using the rename destination when present.
 */
export function parsePorcelainStatus(stdout: string): readonly PorcelainEntry[] {
  const entries: PorcelainEntry[] = []
  for (const raw of stdout.split('\n')) {
    if (raw.length < 4) continue
    const index = raw[0] ?? ' '
    const worktree = raw[1] ?? ' '
    const rest = raw.slice(3)
    const arrow = rest.indexOf(' -> ')
    const path = unquoteGitPath(arrow === -1 ? rest : rest.slice(arrow + 4))
    if (path === '') continue
    entries.push({ path, index, worktree })
  }
  return entries
}

/** Parse `git diff --numstat` rows, including binary `-` counts.
 * @param stdout - numstat text.
 * @returns additions and deletions keyed by the destination path.
 */
export function parseNumstat(stdout: string): readonly NumstatEntry[] {
  const entries: NumstatEntry[] = []
  for (const raw of stdout.split('\n')) {
    if (raw === '') continue
    const parts = raw.split('\t')
    if (parts.length < 3) continue
    const pathField = parts.slice(2).join('\t')
    const arrow = pathField.indexOf(' => ')
    const path = unquoteGitPath(arrow === -1 ? pathField : pathField.slice(arrow + 4))
    if (path === '') continue
    entries.push({
      path,
      additions: parts[0] === '-' ? null : Number.parseInt(parts[0] ?? '', 10),
      deletions: parts[1] === '-' ? null : Number.parseInt(parts[1] ?? '', 10),
    })
  }
  return entries
}

/** Parse `git log` records separated by unit separators.
 * @param stdout - log text using `%H%x1f%h%x1f%s%x1f%an%x1f%aI`.
 * @returns newest-first commits.
 */
export function parseCommitLog(stdout: string): readonly DesktopChangeCommit[] {
  const commits: DesktopChangeCommit[] = []
  for (const raw of stdout.split('\n')) {
    if (raw === '') continue
    const [hash, short, subject, author, committedAt] = raw.split('\u001f')
    if (hash === undefined || short === undefined || subject === undefined) continue
    commits.push({
      hash,
      short,
      subject,
      author: author ?? '',
      committedAt: committedAt ?? '',
    })
  }
  return commits
}

function statusFromLetters(index: string, worktree: string, view: Exclude<DesktopChangeView, 'commits'>): DesktopChangeStatus {
  const letter = view === 'staged' ? index : view === 'unstaged' ? worktree : (index !== ' ' && index !== '?' ? index : worktree)
  if (letter === '?' || (index === '?' && worktree === '?')) return 'untracked'
  if (letter === 'A') return 'added'
  if (letter === 'D') return 'deleted'
  if (letter === 'R' || letter === 'C') return 'renamed'
  if (letter === 'U' || index === 'U' || worktree === 'U') return 'unmerged'
  return 'modified'
}

function includePorcelain(entry: PorcelainEntry, view: Exclude<DesktopChangeView, 'commits'>): boolean {
  if (view === 'staged') return entry.index !== ' ' && entry.index !== '?'
  if (view === 'unstaged') return entry.worktree !== ' '
  return true
}

const MAX_FILES = 500

/**
 * Combine porcelain status with numstat counts for one working-tree view.
 * @param porcelain - `git status --porcelain=v1` entries.
 * @param numstat - `git diff --numstat` rows.
 * @param view - working-tree filter; last-agent-turn uses uncommitted then `allow`.
 * @param allow - optional pathspec set for last-agent-turn.
 * @param limit - maximum files returned.
 * @returns files, aggregate counts, and whether more matching paths exist.
 */
export function mergeChangeFiles(
  porcelain: readonly PorcelainEntry[],
  numstat: readonly NumstatEntry[],
  view: Exclude<DesktopChangeView, 'commits'>,
  allow: ReadonlySet<string> | undefined,
  limit = MAX_FILES,
): { files: DesktopChangeFile[]; additions: number; deletions: number; truncated: boolean } {
  const stats = new Map(numstat.map(entry => [entry.path, entry]))
  const files: DesktopChangeFile[] = []
  let additions = 0
  let deletions = 0
  let matched = 0
  for (const entry of porcelain) {
    if (!includePorcelain(entry, view)) continue
    if (allow !== undefined && !allow.has(entry.path)) continue
    matched += 1
    if (files.length >= limit) continue
    const stat = stats.get(entry.path)
    const added = stat?.additions ?? null
    const removed = stat?.deletions ?? null
    if (added !== null && Number.isFinite(added)) additions += added
    if (removed !== null && Number.isFinite(removed)) deletions += removed
    files.push({
      path: entry.path,
      status: statusFromLetters(entry.index, entry.worktree, view),
      additions: added,
      deletions: removed,
    })
  }
  return { files, additions, deletions, truncated: matched > files.length }
}
