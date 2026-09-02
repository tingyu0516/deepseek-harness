/** Editable workspace file tree for the right-sidebar drawer. */
import { ChevronRight, FileText, Folder, FolderOpen, FolderTree } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopFileEntry, DesktopTerminalDrawerProps, DesktopWorkspaceListing } from './TerminalDrawer.tsx'
import { requestDesktopWorkspaceFile, saveDesktopWorkspaceFile } from './workspace-file-api.ts'

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/** Right-sidebar workspace tree with an in-place UTF-8 editor for existing files. */
export function DesktopFileManager({ listDirectory }: { readonly listDirectory?: DesktopTerminalDrawerProps['listDirectory'] }) {
  const [directories, setDirectories] = useState<Record<string, DesktopWorkspaceListing>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [directoryErrors, setDirectoryErrors] = useState<Record<string, string>>({})
  const [rootPath, setRootPath] = useState<string>()
  const [selected, setSelected] = useState<DesktopFileEntry>()
  const [content, setContent] = useState<string>()
  const [draft, setDraft] = useState('')
  const [fileError, setFileError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const dirty = content !== undefined && draft !== content

  const loadDirectory = useCallback(async (path?: string): Promise<void> => {
    if (listDirectory === undefined) {
      setDirectoryErrors(previous => ({ ...previous, root: 'Workspace directory is unavailable' }))
      return
    }
    const key = path ?? 'root'
    setLoading(previous => new Set(previous).add(key))
    setDirectoryErrors(previous => {
      const next = { ...previous }
      delete next[key]
      return next
    })
    try {
      const listing = await listDirectory(path)
      setDirectories(previous => ({ ...previous, [listing.path]: listing }))
      if (path === undefined) setRootPath(listing.path)
    } catch (cause: unknown) {
      if (!isAbort(cause)) {
        setDirectoryErrors(previous => ({ ...previous, [key]: cause instanceof Error ? cause.message : String(cause) }))
      }
    } finally {
      setLoading(previous => {
        const next = new Set(previous)
        next.delete(key)
        return next
      })
    }
  }, [listDirectory])

  useEffect(() => { void loadDirectory() }, [loadDirectory])

  useEffect(() => {
    if (selected === undefined) return
    const controller = new AbortController()
    setContent(undefined)
    setDraft('')
    setFileError(undefined)
    void requestDesktopWorkspaceFile(selected.path, controller.signal)
      .then(text => {
        setContent(text)
        setDraft(text)
      })
      .catch((cause: unknown) => {
        if (!isAbort(cause)) setFileError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => controller.abort()
  }, [selected])

  const selectFile = (entry: DesktopFileEntry): void => {
    if (selected?.path === entry.path) return
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    setSelected(entry)
  }

  const save = async (): Promise<void> => {
    if (selected === undefined || content === undefined || draft === content || saving) return
    const path = selected.path
    const text = draft
    setSaving(true)
    setFileError(undefined)
    try {
      await saveDesktopWorkspaceFile(path, text)
      if (selectedRef.current?.path === path) setContent(text)
    } catch (cause: unknown) {
      if (selectedRef.current?.path === path) {
        setFileError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setSaving(false)
    }
  }

  const toggleDirectory = (entry: DesktopFileEntry): void => {
    if (entry.kind !== 'directory') return
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
    if (directories[entry.path] === undefined) void loadDirectory(entry.path)
  }

  const renderEntries = (entries: readonly DesktopFileEntry[], depth: number): JSX.Element[] => entries.map(entry => {
    const isExpanded = expanded.has(entry.path)
    const childListing = directories[entry.path]
    const pending = loading.has(entry.path)
    return (
      <div key={entry.path} className="dshDesktopFileTreeNode">
        <button
          type="button"
          className="dshDesktopFileTreeEntry"
          data-kind={entry.kind}
          data-hidden={entry.hidden || undefined}
          aria-current={selected?.path === entry.path ? 'true' : undefined}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => entry.kind === 'directory' ? toggleDirectory(entry) : selectFile(entry)}
        >
          {entry.kind === 'directory'
            ? (isExpanded ? <ChevronRight className="is-expanded" size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />)
            : <span className="dshDesktopFileTreeIndent" aria-hidden="true" />}
          {entry.kind === 'directory'
            ? (isExpanded ? <FolderOpen size={15} aria-hidden="true" /> : <Folder size={15} aria-hidden="true" />)
            : <FileText size={14} aria-hidden="true" />}
          <span>{entry.name}</span>
        </button>
        {entry.kind === 'directory' && isExpanded && (
          <>
            {pending && <div className="dshDesktopFileTreeStatus" style={{ paddingLeft: `${24 + depth * 16}px` }}>Loading...</div>}
            {directoryErrors[entry.path] !== undefined && <div className="dshDesktopFileTreeStatus is-error" style={{ paddingLeft: `${24 + depth * 16}px` }}>{directoryErrors[entry.path]}</div>}
            {childListing !== undefined && renderEntries(childListing.entries, depth + 1)}
          </>
        )}
      </div>
    )
  })

  const rootListing = rootPath === undefined ? undefined : directories[rootPath]
  return (
    <div className="dshDesktopFileManager">
      <main className="dshDesktopFileManagerContent">
        {selected === undefined && <div className="dshDesktopFileManagerStatus">Select a file to edit</div>}
        {selected !== undefined && <>
          <div className="dshDesktopFileManagerToolbar">
            <div className="dshDesktopFileManagerPath">{selected.path}</div>
            {dirty && <span className="dshDesktopFileManagerDirty">Unsaved</span>}
            <button type="button" className="dshDesktopFileManagerSave" disabled={!dirty || saving} onClick={() => { void save() }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          {fileError !== undefined && <div className="dshDesktopFileManagerError" role="alert">{fileError}</div>}
          {fileError === undefined && content === undefined && <div className="dshDesktopFileManagerStatus">Loading...</div>}
          {content !== undefined && (
            <textarea
              className="dshDesktopFileManagerEditor"
              aria-label="File contents"
              spellCheck={false}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault()
                  void save()
                }
              }}
            />
          )}
        </>}
      </main>
      <aside className="dshDesktopFileManagerTree" aria-label="Workspace files">
        <div className="dshDesktopFileManagerTreeHeader"><FolderTree size={15} aria-hidden="true" /><strong>{rootPath ?? 'Workspace'}</strong></div>
        {directoryErrors.root !== undefined && <div className="dshDesktopFileTreeStatus is-error" role="alert">{directoryErrors.root}</div>}
        {rootListing !== undefined && renderEntries(rootListing.entries, 0)}
        {rootListing?.truncated === true && <div className="dshDesktopFileTreeStatus">Some entries are hidden</div>}
      </aside>
    </div>
  )
}
