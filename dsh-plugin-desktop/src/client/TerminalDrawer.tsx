import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

export const DESKTOP_TERMINAL_CHANNEL_PROTOCOL = 'dsh-desktop-terminal-v1'
const DESKTOP_TERMINAL_CHANNEL_PATH = '/api/desktop/terminal/channel'

export interface TerminalWebSocketResizeMessage {
  readonly type: 'resize'
  readonly cols: number
  readonly rows: number
}

export interface TerminalWebSocketConfig {
  readonly url: string | undefined
}

/** Client-side contract for the future Host terminal WebSocket adapter. */
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

type Listener = () => void
let open = false
const listeners = new Set<Listener>()

export function openDesktopTerminalDrawer(): void {
  open = true
  listeners.forEach(listener => listener())
}

export function closeDesktopTerminalDrawer(): void {
  open = false
  listeners.forEach(listener => listener())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): boolean { return open }

/** Root overlay occupant. It owns xterm and the socket lifecycle. */
export function DesktopTerminalDrawer() {
  const isOpen = useSyncExternalStore(subscribe, snapshot, () => false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const terminalInstanceRef = useRef<Terminal | undefined>(undefined)
  const [config] = useState(() => readTerminalWebSocketConfig(typeof window === 'undefined' ? '' : window.location.search))
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!isOpen || terminalRef.current === null) return
    setError(undefined)
    const terminal = new Terminal({ convertEol: true, cursorBlink: true, fontSize: 13, scrollback: 2000 })
    terminal.open(terminalRef.current)
    terminalInstanceRef.current = terminal
    const url = config.url ?? defaultTerminalWebSocketUrl()
    const socket = new WebSocket(url, DESKTOP_TERMINAL_CHANNEL_PROTOCOL)
    socketRef.current = socket
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'spawn', cols: 80, rows: 24 }))
      terminal.focus()
    })
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data) as { type?: string, data?: unknown, error?: unknown }
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
  }, [config.url, isOpen, setError])

  if (!isOpen) return null
  return (
    <section className="dshDesktopTerminalDrawer" role="dialog" aria-label="Terminal" aria-modal="false">
      <header className="dshDesktopTerminalDrawerHeader">
        <strong>Terminal</strong>
        <button type="button" aria-label="Close terminal" title="Close terminal" onClick={closeDesktopTerminalDrawer}>×</button>
      </header>
      {error !== undefined && <div className="dshDesktopTerminalDrawerError" role="alert">{error}</div>}
      <div ref={terminalRef} className="dshDesktopTerminalDrawerViewport" />
    </section>
  )
}
