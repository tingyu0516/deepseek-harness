import { Terminal } from '@xterm/xterm'
import { FileDiff, FolderTree, Plus, SquareTerminal, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { DesktopChangesPanel } from './ChangesPanel.tsx'
import { DesktopFileManager } from './FileManager.tsx'
import {
  BASE_DRAWER_TABS,
  INITIAL_DRAWER_TAB_KEY,
  addDrawerTab,
  drawerTabKey,
  drawerTabLabel,
  drawerTabOrdinal,
  nextDrawerTabId,
  removeDrawerTab,
  resolveDrawerTabAfterClose,
  type DrawerTab,
} from './drawer-tabs.ts'

export const DESKTOP_TERMINAL_CHANNEL_PROTOCOL = 'dsh-desktop-terminal-v1'
const DESKTOP_TERMINAL_CHANNEL_PATH = '/api/desktop/terminal/channel'
const DESKTOP_WORKSPACE_TREE_PATH = '/api/desktop/workspace-tree'

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

interface TerminalSessionProps {
  /** Whether this session's tab is the one on screen. */
  readonly active: boolean
  /** Host terminal WebSocket URL; absent uses the same-origin channel path. */
  readonly url: string | undefined
  readonly getCwd?: () => string | undefined
}

interface TerminalSessionHandle {
  terminal?: Terminal
  socket?: WebSocket
  sendSize?: () => void
  dispose?: () => void
}

/**
 * One independent PTY view: its own xterm instance and WebSocket channel, so
 * several tabs run several shells at once. The session is created lazily on
 * first activation with a measurable viewport (hidden tabs report zero
 * width), survives tab switches, and ends when unmounting — drawer close or
 * tab removal.
 */
function TerminalSession({ active, url, getCwd }: TerminalSessionProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<TerminalSessionHandle>({})
  const getCwdRef = useRef(getCwd)
  getCwdRef.current = getCwd
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!active) return
    const element = viewportRef.current
    if (element === null || element.clientWidth === 0) return
    const session = sessionRef.current
    if (session.dispose !== undefined) {
      session.sendSize?.()
      session.terminal?.focus()
      return
    }
    setError(undefined)
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      scrollback: 2000,
      theme: { background: 'rgba(0, 0, 0, 0)' },
    })
    terminal.open(element)
    const socket = new WebSocket(url ?? defaultTerminalWebSocketUrl(), DESKTOP_TERMINAL_CHANNEL_PROTOCOL)
    socket.addEventListener('open', () => {
      const directory = currentCwd ?? getCwdRef.current?.()
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
      const current = viewportRef.current
      if (current === null || current.clientWidth === 0) return
      const message = createTerminalResizeMessage(current.clientWidth / 8, current.clientHeight / 18)
      terminal.resize(message.cols, message.rows)
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }
    const observer = new ResizeObserver(sendSize)
    observer.observe(element)
    terminal.onData(data => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })
    sendSize()
    sessionRef.current = {
      terminal,
      socket,
      sendSize,
      dispose: () => {
        observer.disconnect()
        terminal.dispose()
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
      },
    }
  }, [active, url])

  // Unmount (drawer closed or tab removed) always ends this PTY channel.
  useEffect(() => () => { sessionRef.current.dispose?.() }, [])

  return (
    <div className="dshDesktopTerminalDrawerSession">
      {error !== undefined && <div className="dshDesktopTerminalDrawerError" role="alert">{error}</div>}
      <div ref={viewportRef} className="dshDesktopTerminalDrawerViewport" />
    </div>
  )
}

/** Root overlay occupant. It owns the tab list, xterm sessions, and sockets. */
export function DesktopTerminalDrawer({ getCwd, workspaceRoot, lastAgentFiles, listDirectory }: DesktopTerminalDrawerProps) {
  const isOpen = useSyncExternalStore(subscribe, snapshot, () => false)
  const [extraTabs, setExtraTabs] = useState<readonly DrawerTab[]>([])
  const [activeKey, setActiveKey] = useState<string>(INITIAL_DRAWER_TAB_KEY)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addWrapRef = useRef<HTMLDivElement | null>(null)
  const [config] = useState(() => readTerminalWebSocketConfig(typeof window === 'undefined' ? '' : window.location.search))

  // Closing the drawer ends every session, so the dynamic tabs reset with it.
  useEffect(() => {
    if (isOpen) return
    setExtraTabs([])
    setActiveKey(INITIAL_DRAWER_TAB_KEY)
    setAddMenuOpen(false)
  }, [isOpen])

  useEffect(() => {
    if (!addMenuOpen || typeof document === 'undefined') return
    const handle = (event: PointerEvent): void => {
      const wrap = addWrapRef.current
      if (wrap !== null && event.target instanceof Node && wrap.contains(event.target)) return
      setAddMenuOpen(false)
    }
    document.addEventListener('pointerdown', handle)
    return () => document.removeEventListener('pointerdown', handle)
  }, [addMenuOpen])

  const addTab = (kind: DrawerTab['kind']): void => {
    const id = nextDrawerTabId([...BASE_DRAWER_TABS, ...extraTabs])
    const tab: DrawerTab = { id, kind, closable: true }
    setExtraTabs(previous => addDrawerTab(previous, kind, id))
    setActiveKey(drawerTabKey(tab))
    setAddMenuOpen(false)
  }

  const removeTab = (tab: DrawerTab): void => {
    setExtraTabs(previous => removeDrawerTab(previous, tab.id))
    setActiveKey(previous => resolveDrawerTabAfterClose(previous, drawerTabKey(tab)))
  }

  if (!isOpen) return null
  const tabs = [...BASE_DRAWER_TABS, ...extraTabs]
  return (
    <section className="dshDesktopTerminalDrawer" role="dialog" aria-label="Terminal, File Manager, and Changes" aria-modal="false">
      <header className="dshDesktopTerminalDrawerHeader">
        <div className="dshDesktopTerminalDrawerTabs" role="tablist">
          {tabs.map(tab => {
            const key = drawerTabKey(tab)
            const label = drawerTabLabel(tab, drawerTabOrdinal(tabs, tab))
            const active = activeKey === key
            return (
              <div key={key} className="dshDesktopDrawerTab">
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={active ? 'is-active' : ''}
                  title={label}
                  onClick={() => setActiveKey(key)}
                >
                  {tab.kind === 'terminal' ? <SquareTerminal size={15} aria-hidden="true" /> : <FolderTree size={15} aria-hidden="true" />}
                  <span>{label}</span>
                </button>
                {tab.closable && (
                  <button type="button" className="dshDesktopDrawerTabClose" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => removeTab(tab)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })}
          <button type="button" role="tab" aria-selected={activeKey === 'changes'} className={activeKey === 'changes' ? 'is-active' : ''} onClick={() => setActiveKey('changes')}><FileDiff size={15} aria-hidden="true" />Changes</button>
          <div className="dshDesktopTerminalDrawerAddWrap" ref={addWrapRef}>
            <button
              type="button"
              className="dshDesktopTerminalDrawerAdd"
              aria-label="New drawer tab"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              title="New terminal or file manager"
              onClick={() => setAddMenuOpen(current => !current)}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            {addMenuOpen && (
              <div className="dshDesktopTerminalDrawerAddMenu" role="menu">
                <button type="button" role="menuitem" onClick={() => addTab('terminal')}><SquareTerminal size={14} aria-hidden="true" />New terminal</button>
                <button type="button" role="menuitem" onClick={() => addTab('files')}><FolderTree size={14} aria-hidden="true" />New file manager</button>
              </div>
            )}
          </div>
        </div>
        <button type="button" aria-label="Close terminal" title="Close terminal" onClick={closeDesktopTerminalDrawer}><X size={16} aria-hidden="true" /></button>
      </header>
      {tabs.filter(tab => tab.kind === 'terminal').map(tab => {
        const key = drawerTabKey(tab)
        return (
          <div key={key} className="dshDesktopTerminalDrawerTabPane" hidden={activeKey !== key}>
            <TerminalSession active={activeKey === key} url={config.url} {...(getCwd === undefined ? {} : { getCwd })} />
          </div>
        )
      })}
      {tabs.filter(tab => tab.kind === 'files').map(tab => {
        const key = drawerTabKey(tab)
        return (
          <div key={key} className="dshDesktopTerminalDrawerTabPane" hidden={activeKey !== key}>
            <DesktopFileManager listDirectory={listDirectory} />
          </div>
        )
      })}
      {activeKey === 'changes' && (
        <DesktopChangesPanel
          {...(workspaceRoot === undefined ? {} : { workspaceRoot })}
          {...(lastAgentFiles === undefined ? {} : { lastAgentFiles })}
        />
      )}
    </section>
  )
}
