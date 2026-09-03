/** Editable workspace file tree for the right-sidebar drawer. */
import { ChevronRight, FilePlus, FileText, Folder, FolderOpen, FolderPlus, FolderTree, FoldVertical, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { relativizeWorkspaceFile } from './last-agent-turn.ts'
import type { DesktopFileEntry, DesktopTerminalDrawerProps, DesktopWorkspaceListing } from './TerminalDrawer.tsx'
import { createDesktopWorkspaceEntry, deleteDesktopWorkspaceFile, requestDesktopWorkspaceFile, saveDesktopWorkspaceFile } from './workspace-file-api.ts'

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function workspaceFolderName(root: string): string {
  const posix = root.replaceAll('\\', '/').replace(/\/+$/u, '') || root
  return posix.split('/').at(-1) || root
}

function workspaceFileDisplayPath(root: string | undefined, path: string, fallbackName: string): string {
  if (root === undefined) return fallbackName
  return relativizeWorkspaceFile(root, path) ?? fallbackName
}

function parentDirectory(path: string): string {
  const unix = !path.includes('\\')
  const value = unix ? path.replace(/\/+$/u, '') : path.replace(/[\\/]+$/u, '')
  const separator = unix ? '/' : '\\'
  const cut = value.lastIndexOf(separator)
  if (cut < 0) return value
  const parent = value.slice(0, cut)
  if (!unix && /^[A-Za-z]:$/u.test(parent)) return `${parent}\\`
  return parent === '' && unix ? '/' : parent
}

function joinWorkspaceChild(parent: string, name: string): string {
  const trimmed = parent.replace(/[\\/]+$/u, '') || parent
  return parent.includes('\\') ? `${trimmed}\\${name}` : `${trimmed}/${name}`
}

function isEntryName(value: string): boolean {
  return value !== '' && value !== '.' && value !== '..' && !value.includes('\0') && !/[\\/]/u.test(value)
}

function matchesFileQuery(name: string, query: string): boolean {
  return query === '' || name.toLowerCase().includes(query.toLowerCase())
}

function treeEntryVisible(
  entry: DesktopFileEntry,
  directories: Record<string, DesktopWorkspaceListing>,
  query: string,
): boolean {
  if (matchesFileQuery(entry.name, query)) return true
  if (entry.kind !== 'directory') return false
  const children = directories[entry.path]?.entries
  return children !== undefined && children.some(child => treeEntryVisible(child, directories, query))
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
  const [deleting, setDeleting] = useState(false)
  const [working, setWorking] = useState(false)
  const [anchorDir, setAnchorDir] = useState<string>()
  const [treeError, setTreeError] = useState<string>()
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const dirty = content !== undefined && draft !== content
  const busy = saving || deleting || working
  const query = search.trim()

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
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

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
    setAnchorDir(parentDirectory(entry.path))
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

  const removeFile = async (): Promise<void> => {
    if (selected === undefined || deleting) return
    const path = selected.path
    const label = workspaceFileDisplayPath(rootPath, path, selected.name)
    if (!window.confirm(`Delete ${label}?`)) return
    setDeleting(true)
    setFileError(undefined)
    try {
      await deleteDesktopWorkspaceFile(path)
      setDirectories(previous => {
        const next = { ...previous }
        for (const [dir, listing] of Object.entries(next)) {
          if (listing.entries.some(entry => entry.path === path)) {
            next[dir] = { ...listing, entries: listing.entries.filter(entry => entry.path !== path) }
          }
        }
        delete next[path]
        return next
      })
      if (selectedRef.current?.path === path) {
        setSelected(undefined)
        setContent(undefined)
        setDraft('')
      }
    } catch (cause: unknown) {
      if (selectedRef.current?.path === path) {
        setFileError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setDeleting(false)
    }
  }

  const createEntry = async (kind: 'file' | 'directory'): Promise<void> => {
    const parent = anchorDir ?? rootPath
    if (parent === undefined || busy) return
    const folder = workspaceFileDisplayPath(rootPath, parent, workspaceFolderName(parent))
    const raw = window.prompt(kind === 'file' ? `New file name (${folder})` : `New folder name (${folder})`)
    if (raw === null) return
    const name = raw.trim()
    if (!isEntryName(name)) {
      setTreeError('Enter a single name without path separators')
      return
    }
    if (kind === 'file' && dirty && !window.confirm('Discard unsaved changes?')) return
    const path = joinWorkspaceChild(parent, name)
    setWorking(true)
    setTreeError(undefined)
    try {
      const created = await createDesktopWorkspaceEntry(path, kind)
      setExpanded(previous => new Set(previous).add(parent))
      await loadDirectory(parent === rootPath ? undefined : parent)
      if (created.kind === 'directory') {
        setAnchorDir(created.path)
        setExpanded(previous => new Set(previous).add(created.path))
        await loadDirectory(created.path)
        return
      }
      setAnchorDir(parent)
      setSelected({
        name,
        path: created.path,
        kind: 'file',
        hidden: name.startsWith('.'),
      })
    } catch (cause: unknown) {
      setTreeError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }

  const refresh = async (): Promise<void> => {
    if (busy) return
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    setWorking(true)
    setTreeError(undefined)
    const open = [...expanded]
    const selectedPath = selected?.path
    try {
      setDirectories(previous => {
        const next: Record<string, DesktopWorkspaceListing> = {}
        if (rootPath !== undefined && previous[rootPath] !== undefined) next[rootPath] = previous[rootPath]
        for (const directory of open) {
          if (previous[directory] !== undefined) next[directory] = previous[directory]
        }
        return next
      })
      await loadDirectory()
      await Promise.all(open.filter(directory => directory !== rootPath).map(directory => loadDirectory(directory)))
      if (selectedPath === undefined || selectedRef.current?.path !== selectedPath) return
      const text = await requestDesktopWorkspaceFile(selectedPath)
      if (selectedRef.current?.path !== selectedPath) return
      setContent(text)
      setDraft(text)
      setFileError(undefined)
    } catch (cause: unknown) {
      if (selectedPath !== undefined && selectedRef.current?.path === selectedPath) {
        setFileError(cause instanceof Error ? cause.message : String(cause))
      } else {
        setTreeError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setWorking(false)
    }
  }

  const toggleDirectory = (entry: DesktopFileEntry): void => {
    if (entry.kind !== 'directory') return
    setAnchorDir(entry.path)
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
    if (directories[entry.path] === undefined) void loadDirectory(entry.path)
  }

  const toggleSearch = (): void => {
    if (searchOpen) {
      setSearchOpen(false)
      setSearch('')
      return
    }
    setSearchOpen(true)
  }

  const collapseTree = (): void => {
    setExpanded(new Set())
  }

  const renderEntries = (entries: readonly DesktopFileEntry[], depth: number): JSX.Element[] => entries.flatMap(entry => {
    if (!treeEntryVisible(entry, directories, query)) return []
    const childListing = directories[entry.path]
    const containsMatch = query !== '' && entry.kind === 'directory'
      && childListing?.entries.some(child => treeEntryVisible(child, directories, query)) === true
    const isExpanded = expanded.has(entry.path) || containsMatch
    const pending = loading.has(entry.path)
    return [(
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
    )]
  })

  const rootListing = rootPath === undefined ? undefined : directories[rootPath]
  return (
    <div className="dshDesktopFileManager">
      <main className="dshDesktopFileManagerContent">
        {selected === undefined && <div className="dshDesktopFileManagerStatus">Select a file to edit</div>}
        {selected !== undefined && <>
          <div className="dshDesktopFileManagerToolbar">
            <div className="dshDesktopFileManagerPath">{workspaceFileDisplayPath(rootPath, selected.path, selected.name)}</div>
            {dirty && <span className="dshDesktopFileManagerDirty">Unsaved</span>}
            <button type="button" className="dshDesktopFileManagerSave" disabled={!dirty || busy} onClick={() => { void save() }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="dshDesktopFileManagerDelete" disabled={busy} onClick={() => { void removeFile() }}>
              {deleting ? 'Deleting...' : 'Delete'}
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
        <div className="dshDesktopFileManagerTreeHeader">
          <FolderTree size={15} aria-hidden="true" />
          <strong>{rootPath === undefined ? 'Workspace' : workspaceFolderName(rootPath)}</strong>
          <div className="dshDesktopFileManagerTreeActions">
            <button type="button" aria-label="Search files" title="Search files" aria-pressed={searchOpen} disabled={rootPath === undefined} onClick={toggleSearch}>
              <Search size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="New file" title="New file" disabled={rootPath === undefined || busy} onClick={() => { void createEntry('file') }}>
              <FilePlus size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="New folder" title="New folder" disabled={rootPath === undefined || busy} onClick={() => { void createEntry('directory') }}>
              <FolderPlus size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Collapse folders" title="Collapse folders" disabled={expanded.size === 0} onClick={collapseTree}>
              <FoldVertical size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Refresh" title="Refresh" disabled={busy} onClick={() => { void refresh() }}>
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
        {searchOpen && (
          <input
            ref={searchRef}
            className="dshDesktopFileManagerSearch"
            aria-label="Search files"
            placeholder="Search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setSearch('')
                setSearchOpen(false)
              }
            }}
          />
        )}
        {treeError !== undefined && <div className="dshDesktopFileTreeStatus is-error" role="alert">{treeError}</div>}
        {directoryErrors.root !== undefined && <div className="dshDesktopFileTreeStatus is-error" role="alert">{directoryErrors.root}</div>}
        <div className="dshDesktopFileManagerTreeBody">
          {rootListing !== undefined && renderEntries(rootListing.entries, 0)}
          {query !== '' && rootListing !== undefined && !rootListing.entries.some(entry => treeEntryVisible(entry, directories, query))
            && <div className="dshDesktopFileTreeStatus">No matching files</div>}
          {rootListing?.truncated === true && <div className="dshDesktopFileTreeStatus">Some entries are hidden</div>}
        </div>
      </aside>
    </div>
  )
}
