import { Terminal } from '@xterm/xterm'
import { ChevronRight, FileDiff, FileText, Folder, FolderOpen, FolderTree, SquareTerminal, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { DesktopChangesPanel } from './ChangesPanel.tsx'

export const DESKTOP_TERMINAL_CHANNEL_PROTOCOL = 'dsh-desktop-terminal-v1'
const DESKTOP_TERMINAL_CHANNEL_PATH = '/api/desktop/terminal/channel'
const DESKTOP_WORKSPACE_TREE_PATH = '/api/desktop/workspace-tree'
const DESKTOP_WORKSPACE_FILE_PATH = '/api/desktop/workspace-file'

export interface TerminalWebSocketResizeMessage {
  readonly type: 'resize'
  readonly cols: number
  readonly rows: number
}

export interface TerminalWebSocketConfig {
  readonly url: string | undefined
}

export interface DesktopFileEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly hidden: boolean
}

export interface DesktopWorkspaceListing {
  readonly path: string
  readonly entries: readonly DesktopFileEntry[]
  readonly truncated: boolean
}

export interface DesktopTerminalDrawerProps {
  readonly getCwd?: () => string | undefined
  readonly workspaceRoot?: () => string | undefined
  readonly lastAgentFiles?: () => readonly string[]
  readonly listDirectory?: (path?: string, signal?: AbortSignal) => Promise<DesktopWorkspaceListing>
}

/** Read the optional Host terminal WebSocket URL from the renderer query. */
export function readTerminalWebSocketConfig(search: string): TerminalWebSocketConfig {
  const params = new URLSearchParams(search)
  const value = params.get('terminalWsUrl')
  return { url: value === null || value.trim() === '' ? undefined : value }
}

function defaultTerminalWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${DESKTOP_TERMINAL_CHANNEL_PATH}`
}

export function createTerminalResizeMessage(cols: number, rows: number): TerminalWebSocketResizeMessage {
  return { type: 'resize', cols: Math.max(2, Math.floor(cols)), rows: Math.max(2, Math.floor(rows)) }
}

/** Request one directory level from the Desktop-owned workspace tree route. */
export async function requestDesktopWorkspaceTree(path: string, signal?: AbortSignal): Promise<DesktopWorkspaceListing> {
  const requestInit: RequestInit = signal === undefined ? {} : { signal }
  const response = await fetch(`${DESKTOP_WORKSPACE_TREE_PATH}?path=${encodeURIComponent(path)}`, requestInit)
  const value: unknown = await response.json()
  if (!response.ok || typeof value !== 'object' || value === null || !('path' in value) || !('entries' in value)) {
    const error = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : 'Unable to list workspace directory'
    throw new Error(error)
  }
  const listing = value as { path?: unknown; entries?: unknown; truncated?: unknown }
  if (typeof listing.path !== 'string' || !Array.isArray(listing.entries)) throw new Error('Invalid workspace directory response')
  const entries: DesktopFileEntry[] = []
  for (const entry of listing.entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as { name?: unknown; path?: unknown; kind?: unknown; hidden?: unknown }
    if (typeof item.name !== 'string' || typeof item.path !== 'string') continue
    if (item.kind !== 'file' && item.kind !== 'directory') continue
    entries.push({ name: item.name, path: item.path, kind: item.kind, hidden: item.hidden === true })
  }
  return { path: listing.path, entries, truncated: listing.truncated === true }
}

type Listener = () => void
let open = false
const listeners = new Set<Listener>()

function setDrawerState(next: boolean): void {
  if (typeof document !== 'undefined') document.body.toggleAttribute('data-dsh-terminal-open', next)
}

let currentCwd: string | undefined

export function openDesktopTerminalDrawer(cwd?: string): void {
  if (cwd !== undefined && cwd !== '') currentCwd = cwd
  open = true
  setDrawerState(true)
  listeners.forEach(listener => listener())
}

export function closeDesktopTerminalDrawer(): void {
  open = false
  setDrawerState(false)
  listeners.forEach(listener => listener())
}

/** Open or close the right sidebar drawer. */
export function toggleDesktopTerminalDrawer(cwd?: string): void {
  if (open) closeDesktopTerminalDrawer()
  else openDesktopTerminalDrawer(cwd)
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): boolean { return open }

export function useDesktopTerminalDrawerOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

function FileManager({ listDirectory }: { readonly listDirectory?: DesktopTerminalDrawerProps['listDirectory'] }) {
  const [directories, setDirectories] = useState<Record<string, DesktopWorkspaceListing>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [directoryErrors, setDirectoryErrors] = useState<Record<string, string>>({})
  const [rootPath, setRootPath] = useState<string>()
  const [selected, setSelected] = useState<DesktopFileEntry>()
  const [content, setContent] = useState<string>()
  const [fileError, setFileError] = useState<string>()

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
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
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
    setFileError(undefined)
    fetch(`${DESKTOP_WORKSPACE_FILE_PATH}?path=${encodeURIComponent(selected.path)}`, { signal: controller.signal })
      .then(async response => {
        const value: unknown = await response.json()
        if (!response.ok || typeof value !== 'object' || value === null || !('content' in value) || typeof value.content !== 'string') {
          const message = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
            ? value.error
            : 'Unable to read file'
          throw new Error(message)
        }
        return value.content
      })
      .then(setContent)
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setFileError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => controller.abort()
  }, [selected])

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
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => entry.kind === 'directory' ? toggleDirectory(entry) : setSelected(entry)}
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
        {selected !== undefined && <>
          <div className="dshDesktopFileManagerPath">{selected.path}</div>
          {fileError !== undefined && <div className="dshDesktopFileManagerError" role="alert">{fileError}</div>}
          {fileError === undefined && content === undefined && <div className="dshDesktopFileManagerStatus">Loading...</div>}
          {fileError === undefined && content !== undefined && <pre>{content}</pre>}
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

/** Root overlay occupant. It owns xterm and the socket lifecycle. */
export function DesktopTerminalDrawer({ getCwd, workspaceRoot, lastAgentFiles, listDirectory }: DesktopTerminalDrawerProps) {
  const isOpen = useSyncExternalStore(subscribe, snapshot, () => false)
  const [tab, setTab] = useState<'terminal' | 'files' | 'changes'>('terminal')
  const terminalRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const terminalInstanceRef = useRef<Terminal | undefined>(undefined)
  const [config] = useState(() => readTerminalWebSocketConfig(typeof window === 'undefined' ? '' : window.location.search))
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!isOpen || tab !== 'terminal' || terminalRef.current === null) return
    setError(undefined)
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      scrollback: 2000,
      theme: { background: 'rgba(0, 0, 0, 0)' },
    })
    terminal.open(terminalRef.current)
    terminalInstanceRef.current = terminal
    const url = config.url ?? defaultTerminalWebSocketUrl()
    const socket = new WebSocket(url, DESKTOP_TERMINAL_CHANNEL_PROTOCOL)
    socketRef.current = socket
    socket.addEventListener('open', () => {
      const directory = currentCwd ?? getCwd?.()
      socket.send(JSON.stringify({
        type: 'spawn',
        cols: 80,
        rows: 24,
        ...(directory === undefined ? {} : { cwd: directory }),
      }))
      terminal.focus()
    })
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data) as { type?: string; data?: unknown; error?: unknown }
        if (message.type === 'output' && typeof message.data === 'string') terminal.write(message.data)
        else if (message.type === 'error' && typeof message.error === 'string') setError(message.error)
      } catch { setError('Invalid terminal message') }
    })
    socket.addEventListener('error', () => { setError('Terminal WebSocket connection failed') })
    socket.addEventListener('close', event => {
      if (!event.wasClean) setError(`Terminal WebSocket closed (${String(event.code)})`)
    })
    const sendSize = (): void => {
      const element = terminalRef.current
      if (element === null) return
      const message = createTerminalResizeMessage(element.clientWidth / 8, element.clientHeight / 18)
      terminal.resize(message.cols, message.rows)
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }
    const observer = new ResizeObserver(sendSize)
    observer.observe(terminalRef.current)
    terminal.onData(data => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })
    sendSize()
    return () => {
      observer.disconnect()
      terminal.dispose()
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
      terminalInstanceRef.current = undefined
      socketRef.current = undefined
    }
  }, [config.url, getCwd, isOpen, tab])

  if (!isOpen) return null
  return (
    <section className="dshDesktopTerminalDrawer" role="dialog" aria-label="Terminal, File Manager, and Changes" aria-modal="false">
      <header className="dshDesktopTerminalDrawerHeader">
        <div className="dshDesktopTerminalDrawerTabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'terminal'} className={tab === 'terminal' ? 'is-active' : ''} onClick={() => setTab('terminal')}><SquareTerminal size={15} aria-hidden="true" />Terminal</button>
          <button type="button" role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'is-active' : ''} onClick={() => setTab('files')}><FolderTree size={15} aria-hidden="true" />File Manager</button>
          <button type="button" role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'is-active' : ''} onClick={() => setTab('changes')}><FileDiff size={15} aria-hidden="true" />Changes</button>
        </div>
        <button type="button" aria-label="Close terminal" title="Close terminal" onClick={closeDesktopTerminalDrawer}><X size={16} aria-hidden="true" /></button>
      </header>
      {tab === 'terminal' && error !== undefined && <div className="dshDesktopTerminalDrawerError" role="alert">{error}</div>}
      {tab === 'terminal' && <div ref={terminalRef} className="dshDesktopTerminalDrawerViewport" />}
      {tab === 'files' && <FileManager listDirectory={listDirectory} />}
      {tab === 'changes' && (
        <DesktopChangesPanel
          {...(workspaceRoot === undefined ? {} : { workspaceRoot })}
          {...(lastAgentFiles === undefined ? {} : { lastAgentFiles })}
        />
      )}
    </section>
  )
}
