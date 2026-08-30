import type { IncomingMessage } from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { IPty, IPtyForkOptions } from 'node-pty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_TERMINAL_CHANNEL_PATH,
  DESKTOP_TERMINAL_CHANNEL_PROTOCOL,
  DesktopTerminalChannel,
  desktopTerminalChannelLimits,
} from '../src/desktop-terminal-channel.ts'
import type { DesktopTerminalProfileOptions } from '../src/desktop-terminal.ts'

const ORIGIN = 'http://127.0.0.1:43120'
const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-terminal-channel-'))
  temporaryDirectories.push(dir)
  return dir
}

function terminalOptions(): DesktopTerminalProfileOptions {
  const root = temporaryDirectory()
  return {
    platform: 'darwin',
    appExecutable: '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop',
    dshBootstrapPath: '/Applications/DSH Desktop.app/Contents/Resources/app.asar/lib/desktop-cli.js',
    pnpmBinPath: '/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules/pnpm/bin/pnpm.mjs',
    electronVersion: '43.4.0',
    profileName: 'desktop',
    productVersion: '2.0.3',
    profileDir: join(root, 'profile'),
    homeDir: join(root, 'home'),
    stateDir: join(root, 'state'),
    environment: { PATH: '/usr/bin:/bin', HOME: join(root, 'user') },
  }
}

function request(overrides: {
  origin?: string
  path?: string
  protocol?: string
  remoteAddress?: string
} = {}): IncomingMessage {
  const req = new PassThrough() as unknown as IncomingMessage
  req.method = 'GET'
  req.url = overrides.path ?? DESKTOP_TERMINAL_CHANNEL_PATH
  req.headers = {
    host: '127.0.0.1:43120',
    origin: overrides.origin ?? ORIGIN,
    connection: 'keep-alive, Upgrade',
    upgrade: 'websocket',
    'sec-fetch-site': 'same-origin',
    'sec-websocket-protocol': overrides.protocol ?? DESKTOP_TERMINAL_CHANNEL_PROTOCOL,
  }
  Object.defineProperty(req, 'socket', {
    configurable: true,
    value: { remoteAddress: overrides.remoteAddress ?? '127.0.0.1' },
  })
  return req
}

class FakeSocket extends EventEmitter {
  readyState = 1
  bufferedAmount = 0
  readonly sent: string[] = []
  readonly close = vi.fn((code?: number, reason?: string) => {
    this.readyState = 2
    return { code, reason }
  })
  readonly terminate = vi.fn(() => { this.readyState = 3 })
  readonly send = vi.fn((data: string) => { this.sent.push(data) })

  message(value: unknown, binary = false): void {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))
    this.emit('message', data, binary)
  }
}

class UpgradeHarness {
  readonly handleUpgrade = vi.fn((
    _req: IncomingMessage,
    _socket: PassThrough,
    _head: Buffer,
    accept: (socket: FakeSocket) => void,
  ) => { accept(this.websocket) })
  readonly close = vi.fn(async () => {})

  constructor(readonly websocket = new FakeSocket()) {}
}

interface PtyHarness {
  pty: IPty
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData(data: string): void
  emitExit(exitCode: number, signal?: number): void
}

function ptyHarness(): PtyHarness {
  let dataListener: ((data: string) => void) | undefined
  let exitListener: ((event: { exitCode: number, signal?: number }) => void) | undefined
  const write = vi.fn()
  const resize = vi.fn()
  const kill = vi.fn()
  const pty = {
    pid: 4321,
    cols: 80,
    rows: 24,
    process: 'zsh',
    handleFlowControl: false,
    onData: vi.fn((listener: (data: string) => void) => {
      dataListener = listener
      return { dispose: vi.fn(() => { dataListener = undefined }) }
    }),
    onExit: vi.fn((listener: (event: { exitCode: number, signal?: number }) => void) => {
      exitListener = listener
      return { dispose: vi.fn(() => { exitListener = undefined }) }
    }),
    write,
    resize,
    kill,
    clear: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  } as unknown as IPty
  return {
    pty,
    write,
    resize,
    kill,
    emitData: data => { dataListener?.(data) },
    emitExit: (exitCode, signal) => { exitListener?.({ exitCode, ...(signal === undefined ? {} : { signal }) }) },
  }
}

function rawUpgradeSocket(): PassThrough & { output: string } {
  const socket = new PassThrough() as PassThrough & { output: string }
  socket.output = ''
  socket.on('data', chunk => { socket.output += String(chunk) })
  return socket
}

function messages(socket: FakeSocket): unknown[] {
  return socket.sent.map(value => JSON.parse(value) as unknown)
}

function createChannel(harness = new UpgradeHarness(), pty = ptyHarness()): {
  channel: DesktopTerminalChannel
  upgrade: UpgradeHarness
  pty: PtyHarness
  createPty: ReturnType<typeof vi.fn>
} {
  const createPty = vi.fn((_file: string, _args: readonly string[], _options: IPtyForkOptions) => pty.pty)
  return {
    channel: new DesktopTerminalChannel({
      terminal: terminalOptions(),
      createPty,
      upgradeServer: harness,
    }),
    upgrade: harness,
    pty,
    createPty,
  }
}

function accept(channel: DesktopTerminalChannel, req = request()): FakeSocket {
  const socket = rawUpgradeSocket()
  channel.handleUpgrade(req, socket, Buffer.alloc(0), ORIGIN)
  return (channel as unknown as { websocket: FakeSocket }).websocket
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('desktop terminal WebSocket channel', () => {
  it.each([
    ['cross-origin', request({ origin: 'https://example.com' }), 403],
    ['non-loopback', request({ remoteAddress: '192.0.2.4' }), 403],
    ['query string', request({ path: `${DESKTOP_TERMINAL_CHANNEL_PATH}?token=unsafe` }), 400],
    ['wrong subprotocol', request({ protocol: 'untrusted' }), 400],
  ])('rejects a %s upgrade before WebSocket negotiation', (_label, req, status) => {
    const target = createChannel()
    const socket = rawUpgradeSocket()

    target.channel.handleUpgrade(req, socket, Buffer.alloc(0), ORIGIN)

    expect(target.upgrade.handleUpgrade).not.toHaveBeenCalled()
    expect(socket.output).toContain(`HTTP/1.1 ${String(status)}`)
  })

  it('accepts only one active same-origin session', () => {
    const target = createChannel()
    accept(target.channel)
    const second = rawUpgradeSocket()

    target.channel.handleUpgrade(request(), second, Buffer.alloc(0), ORIGIN)

    expect(target.upgrade.handleUpgrade).toHaveBeenCalledOnce()
    expect(second.output).toContain('HTTP/1.1 409 Conflict')
  })

  it('spawns the fixed profile shell and relays bounded input, resize, output, and exit', () => {
    const target = createChannel()
    const websocket = accept(target.channel)

    websocket.message({ type: 'spawn', cols: 120, rows: 36 })

    expect(target.createPty).toHaveBeenCalledWith(
      '/bin/sh',
      [expect.stringMatching(/welcome\.command$/u)],
      expect.objectContaining({
        name: 'xterm-256color',
        cols: 120,
        rows: 36,
        cwd: expect.stringMatching(/profile$/u),
        env: expect.objectContaining({ DSH_HOME: expect.stringMatching(/home$/u) }),
      }),
    )
    expect(messages(websocket)).toContainEqual({ type: 'ready', pid: 4321 })

    websocket.message({ type: 'input', data: 'printf test\r' })
    websocket.message({ type: 'resize', cols: 132, rows: 42 })
    target.pty.emitData('test\r\n')

    expect(target.pty.write).toHaveBeenCalledWith('printf test\r')
    expect(target.pty.resize).toHaveBeenCalledWith(132, 42)
    expect(messages(websocket)).toContainEqual({ type: 'output', data: 'test\r\n' })

    target.pty.emitExit(0)
    expect(messages(websocket)).toContainEqual({ type: 'exit', exitCode: 0, signal: null })
    expect(websocket.close).toHaveBeenLastCalledWith(1000, 'terminal exited')
    expect(target.pty.kill).not.toHaveBeenCalled()
  })

  it('closes the PTY from an exact close message and releases it on socket close', () => {
    const target = createChannel()
    const websocket = accept(target.channel)
    websocket.message({ type: 'spawn', cols: 80, rows: 24 })

    websocket.message({ type: 'close' })

    expect(target.pty.kill).toHaveBeenCalledOnce()
    expect(messages(websocket)).toContainEqual({ type: 'closed' })
    expect(websocket.close).toHaveBeenCalledWith(1000, 'terminal closed')
    websocket.emit('close')
    expect(target.pty.kill).toHaveBeenCalledOnce()
  })

  it.each([
    ['empty frame', Buffer.alloc(0)],
    ['input before spawn', { type: 'input', data: 'pwd\r' }],
    ['empty input', { type: 'input', data: '' }],
    ['oversized input', { type: 'input', data: 'x'.repeat(desktopTerminalChannelLimits.maxInputBytes + 1) }],
    ['invalid resize', { type: 'resize', cols: 0, rows: 24 }],
    ['extra key', { type: 'close', force: true }],
  ])('closes on %s without forwarding unsafe data', (_label, message) => {
    const target = createChannel()
    const websocket = accept(target.channel)

    websocket.message(message)

    expect(target.pty.write).not.toHaveBeenCalled()
    expect(target.pty.resize).not.toHaveBeenCalled()
    expect(websocket.close).toHaveBeenCalledWith(1008, expect.any(String))
  })

  it('terminates the socket and PTY during Host disposal', async () => {
    const target = createChannel()
    const websocket = accept(target.channel)
    websocket.message({ type: 'spawn', cols: 80, rows: 24 })

    await target.channel.close()

    expect(target.pty.kill).toHaveBeenCalledOnce()
    expect(websocket.terminate).toHaveBeenCalledOnce()
    expect(target.upgrade.close).toHaveBeenCalledOnce()
  })
})
