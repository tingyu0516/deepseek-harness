/** Changes tab: last agent turn, working tree, and recent commits. */
import { Check, ChevronDown, FileDiff, GitBranch } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DesktopChangeView } from './workspace-changes-api.ts'
import {
  requestDesktopWorkspaceChanges,
  type DesktopChangeCommit,
  type DesktopChangeFile,
  type DesktopChangeSummary,
} from './workspace-changes-api.ts'

const VIEWS: readonly { id: DesktopChangeView; label: string }[] = [
  { id: 'agent-turn', label: 'Last Agent Turn' },
  { id: 'uncommitted', label: 'Uncommitted' },
  { id: 'staged', label: 'Staged' },
  { id: 'unstaged', label: 'Unstaged' },
  { id: 'commits', label: 'Commits' },
]

export interface DesktopChangesPanelProps {
  readonly workspaceRoot?: () => string | undefined
  readonly lastAgentFiles?: () => readonly string[]
}

function viewLabel(view: DesktopChangeView): string {
  return VIEWS.find(item => item.id === view)?.label ?? view
}

function statsLabel(additions: number, deletions: number): string {
  if (additions === 0 && deletions === 0) return ''
  return `+${String(additions)} −${String(deletions)}`
}

function fileStatusLabel(file: DesktopChangeFile): string {
  if (file.status === 'untracked' || file.status === 'added') return 'New'
  if (file.status === 'deleted') return 'Deleted'
  if (file.status === 'renamed') return 'Renamed'
  if (file.status === 'unmerged') return 'Unmerged'
  if (file.additions === null && file.deletions === null) return 'Binary'
  return statsLabel(file.additions ?? 0, file.deletions ?? 0)
}

function basename(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/')
  return parts[parts.length - 1] ?? path
}

export function DesktopChangesPanel({ workspaceRoot, lastAgentFiles }: DesktopChangesPanelProps) {
  const [view, setView] = useState<DesktopChangeView>('uncommitted')
  const [menuOpen, setMenuOpen] = useState(false)
  const [summary, setSummary] = useState<DesktopChangeSummary>()
  const [error, setError] = useState<string>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [selectedCommit, setSelectedCommit] = useState<DesktopChangeCommit>()
  const [patch, setPatch] = useState<string>()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [menuOpen])

  useEffect(() => {
    const root = workspaceRoot?.()
    if (root === undefined) {
      setSummary(undefined)
      setError('No current workspace is selected')
      return
    }
    const controller = new AbortController()
    setError(undefined)
    setPatch(undefined)
    const files = view === 'agent-turn' ? lastAgentFiles?.() : undefined
    void requestDesktopWorkspaceChanges({
      root,
      view,
      ...(selectedCommit === undefined ? {} : { commit: selectedCommit.hash }),
      ...(files === undefined ? {} : { files }),
      signal: controller.signal,
    }).then(next => {
      setSummary(next)
      if (view !== 'commits') setSelectedCommit(undefined)
    }).catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setSummary(undefined)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })
    return () => controller.abort()
  }, [lastAgentFiles, selectedCommit, view, workspaceRoot])

  useEffect(() => {
    const root = workspaceRoot?.()
    if (root === undefined || selectedPath === undefined) {
      setPatch(undefined)
      return
    }
    const controller = new AbortController()
    const files = view === 'agent-turn' ? lastAgentFiles?.() : undefined
    void requestDesktopWorkspaceChanges({
      root,
      view,
      path: selectedPath,
      ...(selectedCommit === undefined ? {} : { commit: selectedCommit.hash }),
      ...(files === undefined ? {} : { files }),
      signal: controller.signal,
    }).then(next => {
      setPatch(next.patch ?? (next.files.find(file => file.path === selectedPath)?.status === 'untracked' ? 'New file' : ''))
    }).catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setPatch(cause instanceof Error ? cause.message : String(cause))
      }
    })
    return () => controller.abort()
  }, [lastAgentFiles, selectedCommit, selectedPath, view, workspaceRoot])

  const chooseView = (next: DesktopChangeView): void => {
    setView(next)
    setMenuOpen(false)
    setSelectedPath(undefined)
    setSelectedCommit(undefined)
    setPatch(undefined)
  }

  const files = summary?.files ?? []
  const commits = summary?.commits ?? []
  const showCommits = view === 'commits' && selectedCommit === undefined

  return (
    <div className="dshDesktopChanges">
      <div className="dshDesktopChangesToolbar">
        <div className="dshDesktopChangesView" ref={menuRef}>
          <button type="button" aria-haspopup="listbox" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
            <FileDiff size={14} aria-hidden="true" />
            <span>{viewLabel(view)}</span>
            {summary !== undefined && summary.repository && !showCommits && (
              <span className="dshDesktopChangesStats">
                <span className="dshDesktopChangesPlus">+{summary.additions}</span>
                <span className="dshDesktopChangesMinus">−{summary.deletions}</span>
              </span>
            )}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {menuOpen && (
            <ul role="listbox" className="dshDesktopChangesMenu">
              {VIEWS.map(item => (
                <li key={item.id}>
                  <button type="button" role="option" aria-selected={item.id === view} onClick={() => chooseView(item.id)}>
                    <span>{item.label}</span>
                    {item.id === view && <Check size={14} aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {summary?.repository === true && summary.branch !== '' && (
          <div className="dshDesktopChangesBranch" title={summary.branch}>
            <GitBranch size={14} aria-hidden="true" />
            <span>{summary.branch}</span>
          </div>
        )}
      </div>
      <div className="dshDesktopChangesSplit">
        <main className="dshDesktopChangesDiff">
          {error !== undefined && <div className="dshDesktopFileManagerError" role="alert">{error}</div>}
          {error === undefined && selectedPath === undefined && (
            <div className="dshDesktopFileManagerStatus">Select a file to see the diff</div>
          )}
          {error === undefined && selectedPath !== undefined && patch === undefined && (
            <div className="dshDesktopFileManagerStatus">Loading...</div>
          )}
          {error === undefined && selectedPath !== undefined && patch !== undefined && (
            <>
              <div className="dshDesktopFileManagerPath">{selectedPath}</div>
              <pre>{patch === '' ? 'No textual diff' : patch}</pre>
            </>
          )}
        </main>
        <aside className="dshDesktopChangesList" aria-label="Changes">
          {summary?.repository === false && <div className="dshDesktopFileTreeStatus">Not a git repository</div>}
          {summary?.repository === true && showCommits && commits.length === 0 && (
            <div className="dshDesktopFileTreeStatus">No commits</div>
          )}
          {summary?.repository === true && !showCommits && files.length === 0 && (
            <div className="dshDesktopFileTreeStatus">
              {view === 'agent-turn' ? 'No write or edit calls in the last agent turn' : 'No changes'}
            </div>
          )}
          {showCommits && commits.map(commit => (
            <button
              key={commit.hash}
              type="button"
              className="dshDesktopChangesRow"
              onClick={() => { setSelectedCommit(commit); setSelectedPath(undefined) }}
            >
              <FileDiff size={14} aria-hidden="true" />
              <span className="dshDesktopChangesRowName">{commit.subject}</span>
              <span className="dshDesktopChangesRowMeta">{commit.short}</span>
            </button>
          ))}
          {view === 'commits' && selectedCommit !== undefined && (
            <button type="button" className="dshDesktopChangesRow" onClick={() => { setSelectedCommit(undefined); setSelectedPath(undefined) }}>
              <span>← {selectedCommit.subject}</span>
            </button>
          )}
          {!showCommits && files.map(file => (
            <button
              key={file.path}
              type="button"
              className={selectedPath === file.path ? 'dshDesktopChangesRow is-selected' : 'dshDesktopChangesRow'}
              onClick={() => setSelectedPath(file.path)}
            >
              <span className="dshDesktopChangesRowName" title={file.path}>{basename(file.path)}</span>
              <span className="dshDesktopChangesRowMeta">{fileStatusLabel(file)}</span>
            </button>
          ))}
          {summary?.truncated === true && <div className="dshDesktopFileTreeStatus">Some entries are hidden</div>}
        </aside>
      </div>
    </div>
  )
}
