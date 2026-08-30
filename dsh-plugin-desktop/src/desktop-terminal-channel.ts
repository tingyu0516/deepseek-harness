/** Strict same-origin WebSocket bridge for one Desktop-owned interactive PTY. */

import type { IncomingMessage } from 'node:http'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { spawn as spawnPty, type IPty, type IPtyForkOptions } from 'node-pty'
import WebSocket, { WebSocketServer } from 'ws'
import {
  DESKTOP_TERMINAL_WORKING_DIRECTORY,
  prepareDesktopEmbeddedTerminal,
  type DesktopTerminalProfileOptions,
} from './desktop-terminal.ts'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'

export const DESKTOP_TERMINAL_CHANNEL_PATH = '/api/desktop/terminal/channel'
export const DESKTOP_TERMINAL_CHANNEL_PROTOCOL = 'dsh-desktop-terminal-v1'

const MAX_MESSAGE_BYTES = 64 * 1024
const MAX_INPUT_BYTES = 32 * 1024
const MAX_BUFFERED_OUTPUT_BYTES = 1024 * 1024
const MIN_COLUMNS = 2
const MAX_COLUMNS = 500
const MIN_ROWS = 1
const MAX_ROWS = 200

type TerminalPtyFactory = (
  file: string,
  args: readonly string[],
  options: IPtyForkOptions,
) => IPty

interface TerminalWebSocket {
  readonly readyState: number
  readonly bufferedAmount: number
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): void
  once(event: 'close' | 'error', listener: () => void): void
  send(data: string): void
  close(code?: number, reason?: string): void
  terminate(): void
}

interface TerminalUpgradeServer {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    accept: (websocket: TerminalWebSocket) => void,
  ): void
  close(): Promise<void>
}

export interface DesktopTerminalChannelOptions {
  terminal: DesktopTerminalProfileOptions
  createPty?: TerminalPtyFactory
  upgradeServer?: TerminalUpgradeServer
  reportError?: (operation: string, cause: unknown) => void
}

function createUpgradeServer(): TerminalUpgradeServer {
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  })
  return {
    handleUpgrade(req, socket, head, accept) {
      server.handleUpgrade(req, socket, head, (websocket) => {
        accept(websocket as unknown as TerminalWebSocket)
      })
    },
    async close() {
      for (const websocket of server.clients) websocket.terminate()
      await new Promise<void>((resolve, reject) => {
        server.close((cause) => {
          if (cause === undefined) resolve()
          else reject(cause)
        })
      })
    },
  }
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function tokenHeaderContains(value: string | undefined, token: string): boolean {
  return value?.split(',').some(part => part.trim().toLowerCase() === token) ?? false
}

function requestHasExactPath(req: IncomingMessage): boolean {
  try {
    const url = new URL(req.url ?? '/', 'http://desktop.invalid')
    return url.pathname === DESKTOP_TERMINAL_CHANNEL_PATH && url.search === ''
  } catch {
    return false
  }
}

function rejectUpgrade(socket: Duplex, statusCode: 400 | 403 | 409, reason: string): void {
  const status = statusCode === 400 ? 'Bad Request' : statusCode === 403 ? 'Forbidden' : 'Conflict'
  socket.end([
    `HTTP/1.1 ${String(statusCode)} ${status}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${String(Buffer.byteLength(reason))}`,
    '',
    reason,
  ].join('\r\n'))
}

function rawMessageBuffer(data: unknown): Buffer | undefined {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (Array.isArray(data) && data.every(Buffer.isBuffer)) return Buffer.concat(data)
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

function isDimension(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
}

function resolveTerminalCwd(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !isAbsolute(value)) return fallback
  try {
    return statSync(realpathSync(value)).isDirectory() ? realpathSync(value) : fallback
  } catch {
    return fallback
  }
}


/** One process-local, single-session PTY authority for the Desktop renderer. */
export class DesktopTerminalChannel {
  private readonly terminal: DesktopTerminalProfileOptions
  private readonly createPty: TerminalPtyFactory
  private readonly upgradeServer: TerminalUpgradeServer
  private readonly reportError: (operation: string, cause: unknown) => void
  private websocket: TerminalWebSocket | undefined
  private pty: IPty | undefined
  private ptyData: { dispose(): void } | undefined
  private ptyExit: { dispose(): void } | undefined
  private closing = false

  constructor(options: DesktopTerminalChannelOptions) {
    this.terminal = { ...options.terminal }
    this.createPty = options.createPty ?? ((file, args, spawnOptions) => (
      spawnPty(file, [...args], spawnOptions)
    ))
    this.upgradeServer = options.upgradeServer ?? createUpgradeServer()
    this.reportError = options.reportError ?? (() => {})
  }

  /** Authenticate and accept exactly one renderer WebSocket. */
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    expectedOrigin: string,
  ): void {
    if (this.closing) return rejectUpgrade(socket, 409, 'terminal channel is closing')
    if (req.method !== 'GET'
      || !requestHasExactPath(req)
      || req.headers.upgrade?.toLowerCase() !== 'websocket'
      || !tokenHeaderContains(req.headers.connection, 'upgrade')
      || req.headers['sec-websocket-protocol'] !== DESKTOP_TERMINAL_CHANNEL_PROTOCOL) {
      return rejectUpgrade(socket, 400, 'invalid terminal upgrade')
    }
    if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
      return rejectUpgrade(socket, 403, 'forbidden')
    }
    if (this.websocket !== undefined) return rejectUpgrade(socket, 409, 'terminal session already active')

    this.upgradeServer.handleUpgrade(req, socket, head, (websocket) => {
      if (this.closing || this.websocket !== undefined) {
        websocket.close(1013, 'terminal session unavailable')
        return
      }
      this.websocket = websocket
      websocket.on('message', (data, isBinary) => { this.handleMessage(websocket, data, isBinary) })
      websocket.once('close', () => { this.releaseSocket(websocket) })
      websocket.once('error', () => { this.releaseSocket(websocket) })
    })
  }

  /** Terminate the active PTY and stop accepting upgrades. */
  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    this.disposePty()
    const websocket = this.websocket
    this.websocket = undefined
    websocket?.terminate()
    await this.upgradeServer.close()
  }

  private handleMessage(websocket: TerminalWebSocket, data: unknown, isBinary: boolean): void {
    if (websocket !== this.websocket) return
    if (isBinary) return this.protocolFailure(websocket, 'binary terminal messages are not allowed')
    const raw = rawMessageBuffer(data)
    if (raw === undefined || raw.byteLength === 0 || raw.byteLength > MAX_MESSAGE_BYTES) {
      return this.protocolFailure(websocket, 'invalid terminal message size')
    }
    let value: unknown
    try {
      value = JSON.parse(raw.toString('utf8')) as unknown
    } catch {
      return this.protocolFailure(websocket, 'invalid terminal message')
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)
      && (value as { type?: unknown }).type === 'spawn'
      && Object.keys(value).every(key => key === 'type' || key === 'cols' || key === 'rows' || key === 'cwd')
      && Object.keys(value).length >= 3 && Object.keys(value).length <= 4
      && Object.prototype.hasOwnProperty.call(value, 'cols')
      && Object.prototype.hasOwnProperty.call(value, 'rows')) {
      return this.spawn(websocket, (value as { cols: unknown }).cols, (value as { rows: unknown }).rows, (value as { cwd?: unknown }).cwd)
    }
    if (exactRecord(value, ['type', 'data']) && value.type === 'input') {
      return this.input(websocket, value.data)
    }
    if (exactRecord(value, ['type', 'cols', 'rows']) && value.type === 'resize') {
      return this.resize(websocket, value.cols, value.rows)
    }
    if (exactRecord(value, ['type']) && value.type === 'close') {
      this.disposePty()
      this.send(websocket, { type: 'closed' })
      websocket.close(1000, 'terminal closed')
      return
    }
    this.protocolFailure(websocket, 'invalid terminal message')
  }

  private spawn(websocket: TerminalWebSocket, cols: unknown, rows: unknown, cwd: unknown): void {
    if (this.pty !== undefined) return this.protocolFailure(websocket, 'terminal already spawned')
    if (!isDimension(cols, MIN_COLUMNS, MAX_COLUMNS) || !isDimension(rows, MIN_ROWS, MAX_ROWS)) {
      return this.protocolFailure(websocket, 'invalid terminal dimensions')
    }
    try {
      const spec = prepareDesktopEmbeddedTerminal(this.terminal)
      const workingDirectory = resolveTerminalCwd(cwd, spec.cwd)
      const pty = this.createPty(spec.command, spec.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: workingDirectory,
        env: { ...spec.env, [DESKTOP_TERMINAL_WORKING_DIRECTORY]: workingDirectory },
      })
      this.pty = pty
      this.ptyData = pty.onData(data => { this.sendOutput(websocket, data) })
      this.ptyExit = pty.onExit(event => {
        if (this.pty !== pty) return
        this.disposePty(false)
        this.send(websocket, { type: 'exit', exitCode: event.exitCode, signal: event.signal ?? null })
        websocket.close(1000, 'terminal exited')
      })
      this.send(websocket, { type: 'ready', pid: pty.pid })
    } catch (cause) {
      this.reportError('spawn terminal drawer PTY', cause)
      this.send(websocket, { type: 'error', error: 'terminal could not be started' })
      websocket.close(1011, 'terminal unavailable')
    }
  }

  private input(websocket: TerminalWebSocket, data: unknown): void {
    if (this.pty === undefined) return this.protocolFailure(websocket, 'terminal is not spawned')
    if (typeof data !== 'string' || data.length === 0 || Buffer.byteLength(data, 'utf8') > MAX_INPUT_BYTES) {
      return this.protocolFailure(websocket, 'invalid terminal input')
    }
    try {
      this.pty.write(data)
    } catch (cause) {
      this.reportError('write terminal drawer input', cause)
      this.protocolFailure(websocket, 'terminal input failed', 1011)
    }
  }

  private resize(websocket: TerminalWebSocket, cols: unknown, rows: unknown): void {
    if (this.pty === undefined) return this.protocolFailure(websocket, 'terminal is not spawned')
    if (!isDimension(cols, MIN_COLUMNS, MAX_COLUMNS) || !isDimension(rows, MIN_ROWS, MAX_ROWS)) {
      return this.protocolFailure(websocket, 'invalid terminal dimensions')
    }
    try {
      this.pty.resize(cols, rows)
    } catch (cause) {
      this.reportError('resize terminal drawer PTY', cause)
      this.protocolFailure(websocket, 'terminal resize failed', 1011)
    }
  }

  private sendOutput(websocket: TerminalWebSocket, data: string): void {
    if (data.length === 0 || websocket !== this.websocket) return
    if (websocket.bufferedAmount > MAX_BUFFERED_OUTPUT_BYTES) {
      this.protocolFailure(websocket, 'terminal output exceeded client capacity', 1013)
      return
    }
    this.send(websocket, { type: 'output', data })
  }

  private send(websocket: TerminalWebSocket, value: object): void {
    if (websocket.readyState !== WebSocket.OPEN) return
    try {
      websocket.send(JSON.stringify(value))
    } catch (cause) {
      this.reportError('send terminal drawer message', cause)
      this.releaseSocket(websocket)
    }
  }

  private protocolFailure(websocket: TerminalWebSocket, error: string, code = 1008): void {
    this.send(websocket, { type: 'error', error })
    this.disposePty()
    websocket.close(code, error)
  }

  private releaseSocket(websocket: TerminalWebSocket): void {
    if (this.websocket !== websocket) return
    this.websocket = undefined
    this.disposePty()
  }

  private disposePty(kill = true): void {
    const pty = this.pty
    this.pty = undefined
    this.ptyData?.dispose()
    this.ptyData = undefined
    this.ptyExit?.dispose()
    this.ptyExit = undefined
    if (!kill || pty === undefined) return
    try {
      pty.kill()
    } catch (cause) {
      this.reportError('close terminal drawer PTY', cause)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopTerminalChannel: DesktopTerminalChannel
  }
}

export const desktopTerminalChannelLimits = Object.freeze({
  maxMessageBytes: MAX_MESSAGE_BYTES,
  maxInputBytes: MAX_INPUT_BYTES,
  minColumns: MIN_COLUMNS,
  maxColumns: MAX_COLUMNS,
  minRows: MIN_ROWS,
  maxRows: MAX_ROWS,
})

export type DesktopTerminalChannelContext = Context
