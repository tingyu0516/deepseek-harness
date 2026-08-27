import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePetCharacterDocument, type PetCharacterDocument } from '../src/contracts.ts'
import {
  PET_SPEECH_SLOT_PX,
  petStatePath,
  PetWindowController,
  type PetElectron,
  type PetRectangle,
} from '../src/pet-window.ts'
import { makeEmptyDir, makeLive2DFixture } from './live2d-fixture.ts'

type Listener = (...args: unknown[]) => void

class FakeWebContents {
  readonly executed: string[] = []
  private readonly listeners = new Map<string, Listener[]>()
  loadedFile: { path: string, options?: { query?: Record<string, string> } } | undefined
  windowOpenHandler: (() => { action: string }) | undefined

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  setWindowOpenHandler(handler: () => { action: string }): void {
    this.windowOpenHandler = handler
  }

  executeJavaScript(code: string): Promise<unknown> {
    this.executed.push(code)
    // A real sandboxed page answers the wrapper-class probe with 'ok' once
    // the combined core evaluation has published window.Live2DCubismCore.
    if (code.includes('window.Live2DCubismCore') && code.includes('ns.Model')) {
      return Promise.resolve('ok')
    }
    return Promise.resolve(undefined)
  }

  loadFile(path: string, options?: { query?: Record<string, string> }): Promise<void> {
    this.loadedFile = options === undefined ? { path } : { path, options }
    return Promise.resolve()
  }
}

class FakeWindow {
  static created: FakeWindow[] = []
  readonly options: Record<string, unknown>
  readonly webContents = new FakeWebContents()
  private readonly listeners = new Map<string, Listener[]>()
  private destroyed = false
  private visible = false
  private bounds: PetRectangle
  alwaysOnTop: { flag: boolean, level?: string } | undefined

  constructor(options: Record<string, unknown>) {
    this.options = options
    this.bounds = {
      x: typeof options.x === 'number' ? options.x : 0,
      y: typeof options.y === 'number' ? options.y : 0,
      width: typeof options.width === 'number' ? options.width : 216,
      height: typeof options.height === 'number' ? options.height : 300,
    }
    FakeWindow.created.push(this)
  }

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  once(event: string, listener: Listener): void {
    this.listeners.set(`once:${event}`, [listener])
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
    for (const listener of this.listeners.get(`once:${event}`) ?? []) listener(...args)
  }

  isDestroyed(): boolean { return this.destroyed }
  close(): void {
    this.destroyed = true
    this.emit('closed')
  }
  show(): void { this.visible = true }
  isVisible(): boolean { return this.visible }
  getBounds(): PetRectangle { return { ...this.bounds } }
  setBounds(bounds: PetRectangle): void {
    const moved = bounds.x !== this.bounds.x || bounds.y !== this.bounds.y
    this.bounds = { ...bounds }
    if (moved) this.emit('moved')
  }
  setPosition(x: number, y: number): void {
    this.bounds = { ...this.bounds, x, y }
    this.emit('moved')
  }
  setAlwaysOnTop(flag: boolean, level?: string): void {
    this.alwaysOnTop = level === undefined ? { flag } : { flag, level }
  }
}

function fakeElectron(workArea: PetRectangle = { x: 0, y: 0, width: 1920, height: 1040 }): PetElectron {
  return {
    BrowserWindow: FakeWindow as unknown as PetElectron['BrowserWindow'],
    screen: { getDisplayMatching: () => ({ workArea }) },
  }
}

function character(): PetCharacterDocument {
  return parsePetCharacterDocument({
    id: 'hutao',
    copy: {
      zh: {
        label: '胡桃',
        lines: {
          greet: ['嗨！'], idle: ['无'], work: ['工'], cheer: ['棒'], sad: ['呜'], pat: ['拍'], special: ['特'],
        },
      },
      en: {
        label: 'Hu Tao',
        lines: {
          greet: ['Hi!'], idle: ['id'], work: ['wk'], cheer: ['yay'], sad: ['aw'], pat: ['pat'], special: ['sp'],
        },
      },
    },
    palette: { accent: '#e05252', bubbleBg: '#2e2027', bubbleText: '#f2e6d8', bubbleBorder: '#5a3a42' },
    baseSize: { width: 216, height: 300 },
    live2d: { model: 'pet.model3.json' },
  })
}

function bootPayloadOf(code: string): Record<string, unknown> {
  const match = /__dshPet\.boot\((.*)\);/u.exec(code)
  expect(match).not.toBeNull()
  return JSON.parse(match![1]!) as Record<string, unknown>
}

let fixtureDir: string

function controller(overrides: {
  electron?: PetElectron
  statePath?: string
  live2dDir?: () => string | undefined
  log?: (message: string) => void
  onCommand?: (command: string) => void
} = {}): PetWindowController {
  return new PetWindowController({
    character: character(),
    htmlPath: 'C:\\pets\\pet.html',
    statePath: overrides.statePath ?? join(tmpdir(), 'unused-pet-state.json'),
    electron: overrides.electron ?? fakeElectron(),
    locale: () => 'zh',
    idleChatter: () => true,
    live2dDir: overrides.live2dDir ?? (() => fixtureDir),
    ...(overrides.log === undefined ? {} : { log: overrides.log }),
    onCommand: overrides.onCommand ?? (() => {}),
  })
}

async function awaitBoot(wc: FakeWebContents): Promise<void> {
  await vi.waitFor(() => {
    expect(wc.executed.some(code => code.includes('__dshPet.boot('))).toBe(true)
  })
}

beforeEach(() => {
  FakeWindow.created = []
  fixtureDir = makeLive2DFixture()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PetWindowController', () => {
  it('creates a transparent frameless always-on-top window', () => {
    const windowController = controller()
    windowController.open()
    const window = FakeWindow.created[0] as unknown as {
      options: Record<string, unknown>
      alwaysOnTop: { flag: boolean, level?: string }
    }
    expect(window.options.transparent).toBe(true)
    expect(window.options.frame).toBe(false)
    expect(window.options.skipTaskbar).toBe(true)
    expect(window.options.focusable).toBe(false)
    expect(window.options.acceptFirstMouse).toBe(true)
    expect(window.options.height).toBe(300 + PET_SPEECH_SLOT_PX)
    expect((window.options.webPreferences as Record<string, unknown>).sandbox).toBe(true)
    expect(window.alwaysOnTop).toEqual({ flag: true, level: 'screen-saver' })
  })

  it('refuses to open a window when Live2D assets are missing', () => {
    const logs: string[] = []
    const emptyDir = makeEmptyDir()
    const windowController = controller({
      live2dDir: () => emptyDir,
      log: message => { logs.push(message) },
    })
    windowController.open()
    expect(FakeWindow.created).toHaveLength(0)
    expect(windowController.isOpen()).toBe(false)
    expect(logs.some(message => message.includes('live2d assets missing'))).toBe(true)
  })

  it('also refuses when no asset directory is provided at all', () => {
    const logs: string[] = []
    const windowController = controller({
      live2dDir: () => undefined,
      log: message => { logs.push(message) },
    })
    windowController.open()
    expect(FakeWindow.created).toHaveLength(0)
    expect(logs.some(message => message.includes('live2d assets missing'))).toBe(true)
  })

  it('loads the shared page with the locale and pushes boot after load', async () => {
    const windowController = controller()
    windowController.open()
    const window = FakeWindow.created[0]!
    expect(window.webContents.loadedFile?.path).toBe('C:\\pets\\pet.html')
    expect(window.webContents.loadedFile?.options?.query?.locale).toBe('zh')
    window.emit('ready-to-show')
    expect(window.isVisible()).toBe(true)
    window.webContents.emit('did-finish-load')
    await awaitBoot(window.webContents)
    const boot = window.webContents.executed.find(code => code.includes('.boot('))
    expect(boot).toContain('"kind":"boot"')
    expect(boot).toContain('"live2d"')
    expect(boot).toContain('pet.model3.json')
  })

  it('injects the Cubism Core and runtime glue before delivering boot', async () => {
    const windowController = controller()
    windowController.open()
    const wc = FakeWindow.created[0]!.webContents
    expect(wc.executed).toHaveLength(0)
    wc.emit('did-finish-load')
    await awaitBoot(wc)
    const coreIdx = wc.executed.findIndex(code => code.includes('DSH pet Cubism Core'))
    const glueIdx = wc.executed.findIndex(code => code.includes('__dshPetLive2DRuntime'))
    const bootIdx = wc.executed.findIndex(code => code.includes('__dshPet.boot('))
    expect(coreIdx).toBeGreaterThanOrEqual(0)
    expect(wc.executed[coreIdx]!.includes('// cubism core fixture')).toBe(true)
    // The re-export must ride inside the SAME evaluation as the core script:
    // each executeJavaScript call scopes top-level `var` declarations away.
    expect(wc.executed[coreIdx]!.includes('window.Live2DCubismCore=')).toBe(true)
    expect(glueIdx).toBeGreaterThan(coreIdx)
    expect(bootIdx).toBeGreaterThan(glueIdx)
  })

  it('logs injection failures and keeps the boot gated', async () => {
    const logs: string[] = []
    const windowController = controller({ log: message => { logs.push(message) } })
    windowController.open()
    const wc = FakeWindow.created[0]!.webContents
    wc.executeJavaScript = () => Promise.reject(new Error('evaluate boom'))
    wc.emit('did-finish-load')
    await vi.waitFor(() => {
      expect(logs.some(message => message.includes('live2d injection failed (evaluate boom)'))).toBe(true)
    })
    expect(wc.executed.some(code => code.includes('__dshPet.boot('))).toBe(false)
  })

  it('resolves the declared model into the boot payload', async () => {
    const windowController = controller()
    windowController.open()
    const wc = FakeWindow.created[0]!.webContents
    wc.emit('did-finish-load')
    await awaitBoot(wc)
    const payload = bootPayloadOf(wc.executed.find(code => code.includes('.boot('))!)
    const live2d = payload.live2d as { model: string, core?: string }
    expect(live2d).toEqual({ model: 'pet.model3.json' })
    // The asset table is streamed after the glue and before boot.
    const glueIdx = wc.executed.findIndex(code => code.includes('__dshPetLive2DRuntime'))
    const finalizeIdx = wc.executed.findIndex(code => code.includes('delete window.__DSH_PET_LIVE2D_PARTS'))
    const bootIdx = wc.executed.findIndex(code => code.includes('__dshPet.boot('))
    expect(glueIdx).toBeGreaterThanOrEqual(0)
    expect(finalizeIdx).toBeGreaterThan(glueIdx)
    expect(bootIdx).toBeGreaterThan(finalizeIdx)
  })

  it('forwards hideParameters and hideParts into the boot live2d spec', async () => {
    const windowController = new PetWindowController({
      character: parsePetCharacterDocument({
        id: 'hutao',
        copy: {
          zh: {
            label: '胡桃',
            lines: {
              greet: ['嗨！'], idle: ['无'], work: ['工'], cheer: ['棒'], sad: ['呜'], pat: ['拍'], special: ['特'],
            },
          },
          en: {
            label: 'Hu Tao',
            lines: {
              greet: ['Hi!'], idle: ['id'], work: ['wk'], cheer: ['yay'], sad: ['aw'], pat: ['pat'], special: ['sp'],
            },
          },
        },
        palette: { accent: '#e05252', bubbleBg: '#2e2027', bubbleText: '#f2e6d8', bubbleBorder: '#5a3a42' },
        baseSize: { width: 216, height: 300 },
        live2d: {
          model: 'pet.model3.json',
          hideParameters: ['Param15'],
          hideParts: ['Part187'],
          outfit: { parameter: 'Param4', lowParts: ['Part92'], highParts: ['Part91'] },
        },
      }),
      htmlPath: 'C:\\pets\\pet.html',
      statePath: join(tmpdir(), 'unused-pet-state.json'),
      electron: fakeElectron(),
      locale: () => 'zh',
      idleChatter: () => true,
      live2dDir: () => fixtureDir,
      onCommand: () => {},
    })
    windowController.open()
    const wc = FakeWindow.created[0]!.webContents
    wc.emit('did-finish-load')
    await awaitBoot(wc)
    const payload = bootPayloadOf(wc.executed.find(code => code.includes('.boot('))!)
    expect(payload.live2d).toEqual({
      model: 'pet.model3.json',
      hideParameters: ['Param15'],
      hideParts: ['Part187'],
      outfit: { parameter: 'Param4', lowParts: ['Part92'], highParts: ['Part91'] },
    })
  })

  it('queues boot until the page finishes loading', async () => {
    const windowController = controller()
    windowController.open()
    const window = FakeWindow.created[0]!
    expect(window.webContents.executed).toHaveLength(0)
    window.webContents.emit('did-finish-load')
    await awaitBoot(window.webContents)
  })

  it('dispatches states and returns to idle afterwards', () => {
    const windowController = controller()
    windowController.open()
    const window = FakeWindow.created[0]!
    window.webContents.emit('did-finish-load')
    windowController.emit('cheer', '好耶！')
    const dispatch = window.webContents.executed.find(code => code.includes('.dispatch('))
    expect(dispatch).toContain('"state":"cheer"')
    expect(dispatch).toContain('好耶！')
    vi.advanceTimersByTime(4000)
    expect(window.webContents.executed.some(code => code.includes('"state":"idle"'))).toBe(true)
  })

  it('forwards the hide command from the private scheme navigation', () => {
    const commands: string[] = []
    const windowController = controller({ onCommand: command => { commands.push(command) } })
    windowController.open()
    const window = FakeWindow.created[0]!
    let prevented = false
    window.webContents.emit('will-navigate', { preventDefault: () => { prevented = true } }, 'dsh-pet-hutao://hide')
    expect(prevented).toBe(true)
    expect(commands).toEqual(['hide'])
  })

  it('moves the window for renderer drag deltas and clamps per-message jumps', () => {
    const windowController = controller()
    windowController.open()
    const window = FakeWindow.created[0]!
    const before = window.getBounds()
    // The default spot sits at the bottom-right corner; these deltas have
    // headroom inside the work-area clamp.
    window.webContents.emit('will-navigate', { preventDefault: () => {} }, 'dsh-pet-hutao://move?dx=10&dy=-4')
    expect(window.getBounds().x).toBe(before.x + 10)
    expect(window.getBounds().y).toBe(before.y - 4)
    // Per-message deltas beyond the cap are rejected outright...
    window.webContents.emit('will-navigate', { preventDefault: () => {} }, 'dsh-pet-hutao://move?dx=999&dy=0')
    expect(window.getBounds().x).toBe(before.x + 10)
    // ...as are malformed or missing values.
    window.webContents.emit('will-navigate', { preventDefault: () => {} }, 'dsh-pet-hutao://move?dx=abc&dy=zz')
    window.webContents.emit('will-navigate', { preventDefault: () => {} }, 'dsh-pet-hutao://move')
    expect(window.getBounds()).toEqual({ x: before.x + 10, y: before.y - 4, width: before.width, height: before.height })
    // A stale larger getBounds (Windows DPI drift) must not stick: the next
    // drag tick re-pins the designed layout size.
    window.setBounds({ x: before.x + 10, y: before.y - 4, width: 480, height: 640 })
    window.webContents.emit('will-navigate', { preventDefault: () => {} }, 'dsh-pet-hutao://move?dx=2&dy=0')
    expect(window.getBounds().width).toBe(before.width)
    expect(window.getBounds().height).toBe(before.height)
  })

  it('surfaces renderer Live2D failures through the plugin log', () => {
    const logs: string[] = []
    const windowController = controller({ log: message => { logs.push(message) } })
    windowController.open()
    const window = FakeWindow.created[0]!
    const href = 'dsh-pet-hutao://live2dfailed?r=' + encodeURIComponent('xhr failed: file:///model.json')
    window.webContents.emit('will-navigate', { preventDefault: () => {} }, href)
    expect(logs.some(message => message.includes('live2d attach failed in renderer: xhr failed'))).toBe(true)
  })

  it('ignores foreign scheme navigations', () => {
    const commands: string[] = []
    const windowController = controller({ onCommand: command => { commands.push(command) } })
    windowController.open()
    const window = FakeWindow.created[0]!
    window.webContents.emit('will-navigate', { preventDefault: () => {} }, 'https://example.test/')
    window.webContents.emit('will-navigate', { preventDefault: () => {} }, 'dsh-pet-furina://hide')
    window.webContents.emit('will-navigate', { preventDefault: () => {} }, 'dsh-pet-hutao://hide?extra=1')
    expect(commands).toEqual([])
  })

  it('persists the position after the window moves', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-window-'))
    const statePath = petStatePath(dir, 'hutao')
    const windowController = controller({ statePath })
    windowController.open()
    const window = FakeWindow.created[0]!
    window.setPosition(321, 222)
    vi.advanceTimersByTime(700)
    const saved = JSON.parse(readFileSync(statePath, 'utf8')) as { x: number, y: number }
    expect(saved).toEqual({ version: 1, x: 321, y: 222 })
  })

  it('restores a persisted position clamped to the work area', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-window-'))
    const statePath = petStatePath(dir, 'hutao')
    mkdirSync(dirname(statePath), { recursive: true })
    writeFileSync(statePath, JSON.stringify({ version: 1, x: 5000, y: -40 }))
    const windowController = controller({ statePath })
    windowController.open()
    const window = FakeWindow.created[0] as unknown as { options: Record<string, number> }
    expect(window.options.x).toBeLessThanOrEqual(1920 - 216 - 8)
    expect(window.options.x).toBeGreaterThanOrEqual(0)
    expect(window.options.y).toBe(0)
  })

  it('strolls sideways as a timed crawl and emits walk up front', () => {
    vi.useFakeTimers()
    try {
      const windowController = controller()
      windowController.open()
      const window = FakeWindow.created[0]!
      window.emit('ready-to-show')
      const before = window.getBounds().x
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9)
      windowController.stroll()
      randomSpy.mockRestore()
      // The walk state rides ahead of the movement so the accessory shows.
      expect(window.webContents.executed.some(code => code.includes('"state":"walk"'))).toBe(true)
      // One step has landed synchronously; the crawl needs its timer chain.
      expect(window.getBounds().x).not.toBe(before)
      const afterFirstStep = window.getBounds().x
      expect(afterFirstStep).toBeGreaterThan(before - 48)
      vi.advanceTimersByTime(16 * 60 + 100)
      // The default resting spot is 24px from the right edge; a 48px stroll to
      // the right clamps back to the 8px work-area margin.
      expect(window.getBounds().x).toBe(1920 - 216 - 8)
      expect(window.getBounds().y).toBe(FakeWindow.created[0]!.getBounds().y)
      // A closed window stops walking instead of stepping on stale bounds.
      window.close()
      vi.advanceTimersByTime(2000)
      expect(window.getBounds().x).toBe(1920 - 216 - 8)
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies scale changes while keeping position', () => {
    const windowController = controller()
    windowController.open()
    const window = FakeWindow.created[0]!
    windowController.applyScale(1.5)
    expect(window.getBounds()).toMatchObject({ width: 324, height: 450 + PET_SPEECH_SLOT_PX })
  })

  it('close destroys the window and open is idempotent', () => {
    const windowController = controller()
    windowController.open()
    windowController.open()
    expect(FakeWindow.created).toHaveLength(1)
    windowController.close()
    expect((FakeWindow.created[0] as unknown as { isDestroyed(): boolean }).isDestroyed()).toBe(true)
    expect(windowController.isOpen()).toBe(false)
  })

  it('dispose closes permanently', () => {
    const windowController = controller()
    windowController.open()
    windowController.dispose()
    windowController.open()
    expect(FakeWindow.created).toHaveLength(1)
  })
})
