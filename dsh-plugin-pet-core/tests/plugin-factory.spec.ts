import { beforeAll, describe, expect, it } from 'vitest'
import { createPetPlugin, petSettingsSchema, type PetSettings } from '../src/index.ts'
import { parsePetCharacterDocument, type PetCharacterDocument } from '../src/contracts.ts'
import type { PetElectron } from '../src/pet-window.ts'
import { makeLive2DFixture } from './live2d-fixture.ts'

let fixtureDir: string
const fixtureDirLoader = (): string => fixtureDir

function testCharacter(): PetCharacterDocument {
  return parsePetCharacterDocument({
    id: 'furina',
    copy: {
      zh: {
        label: '芙宁娜',
        lines: {
          greet: ['登场！'], idle: ['等等'], work: ['指挥'], cheer: ['谢幕'], sad: ['呜哇'], pat: ['失礼'], special: ['实力'],
        },
      },
      en: {
        label: 'Furina',
        lines: {
          greet: ['Stage!'], idle: ['wait'], work: ['conduct'], cheer: ['bravo'], sad: ['wah'], pat: ['rude'], special: ['power'],
        },
      },
    },
    palette: { accent: '#4cc9f0', bubbleBg: '#16263f', bubbleText: '#eaf6ff', bubbleBorder: '#2a4a6e' },
    baseSize: { width: 216, height: 300 },
    live2d: { model: 'pet.model3.json' },
  })
}

interface CapturedTraySubmenuItem {
  label(): string
  type?: string
  checked?(): boolean
  enabled?(): boolean
  invoke(): void | Promise<void>
}

interface CapturedTrayItem {
  group: string
  order: number
  label(): string
  submenu?(): CapturedTraySubmenuItem[]
}

const createdWindows: { destroyed: boolean }[] = []

// The Live2D fixture backs every factory test that expects a window; tests
// about missing assets live in pet-window.spec.ts.
beforeAll(() => { fixtureDir = makeLive2DFixture('dsh-plugin-factory-live2d-') })

function petElectron(): PetElectron {
  return {
    BrowserWindow: class {
      destroyed = false
      constructor() {
        createdWindows.push(this)
      }
      on(): void {}
      once(): void {}
      isDestroyed(): boolean { return this.destroyed }
      close(): void { this.destroyed = true }
      show(): void {}
      hide(): void {}
      isVisible(): boolean { return true }
      getBounds(): { x: number, y: number, width: number, height: number } {
        return { x: 0, y: 0, width: 216, height: 300 }
      }
      setBounds(): void {}
      setPosition(): void {}
      setAlwaysOnTop(): void {}
      setVisibleOnAllWorkspaces(): void {}
      webContents = {
        on(): void {},
        setWindowOpenHandler(): void {},
        executeJavaScript: () => Promise.resolve(undefined),
        loadFile: () => Promise.resolve(),
      }
    } as unknown as PetElectron['BrowserWindow'],
  }
}

interface FakeContext {
  logger: { info(message: string): void, error(message: string): void }
  get(name: string): unknown
  effect(register: () => () => void): void
  inject(deps: readonly string[], callback: (ctx: unknown) => void): void
  on(): () => void
}

function fakeContext(options: {
  electron?: PetElectron
  locale?: 'zh' | 'en'
  runtime?: boolean
  /** Persisted settings delivered by the fake settings service when it arrives. */
  settings?: Partial<PetSettings>
} = {}) {
  const logs: string[] = []
  const trayItems: CapturedTrayItem[] = []
  const trayRefresh = { count: 0 }
  const disposers: (() => void)[] = []
  const persisted: PetSettings = {
    enabled: true,
    scale: 1,
    eventReactions: true,
    idleChatter: true,
    ...options.settings,
  }
  const ctx: FakeContext = {
    logger: {
      info: message => { logs.push(message) },
      error: message => { logs.push(message) },
    },
    get: name => {
      if (name !== 'desktopRuntime' || options.runtime === false) return undefined
      return {
        platform: 'win32',
        locale: options.locale ?? 'zh',
        userDataDir: 'C:\\userData',
        registerTrayItem: (item: CapturedTrayItem) => {
          trayItems.push(item)
          return {
            refresh: () => { trayRefresh.count += 1 },
            dispose: () => {},
          }
        },
      }
    },
    effect: register => { disposers.push(register()) },
    // Sessions and jobs are optional services the factory must tolerate never
    // arriving; the settings service arrives and exposes the persisted state.
    inject: (deps, callback) => {
      if (deps.includes('settings')) {
        callback({
          effect: (register: () => () => void) => { disposers.push(register()) },
          settings: {
            register: () => ({
              get: () => ({ ...persisted }),
              watch: () => () => {},
              update: () => Promise.resolve(),
            }),
          },
        })
      }
    },
    on: () => () => {},
  }
  return { ctx, logs, trayItems, disposers, trayRefresh }
}

describe('createPetPlugin', () => {
  it('defaults the companion to hidden until settings or the tray enable it', () => {
    expect(petSettingsSchema()({}).enabled).toBe(false)
  })

  it('shapes a complete Cordis plugin', () => {
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadElectron: () => petElectron(),
    })
    expect(plugin.name).toBe('desktop-pet-furina')
    expect(plugin.inject).toEqual(['desktopRuntime'])
    expect(typeof plugin.apply).toBe('function')
  })

  it('stays inert when the desktop runtime is absent', () => {
    const { ctx, logs } = fakeContext({ runtime: false })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
    })
    plugin.apply(ctx as never)
    expect(logs.some(log => log.includes('inactive'))).toBe(true)
  })

  it('stays inert when Electron is unavailable', () => {
    const { ctx, logs } = fakeContext({ electron: petElectron() })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadElectron: () => undefined,
    })
    plugin.apply(ctx as never)
    expect(logs.some(log => log.includes('inactive'))).toBe(true)
  })

  it('reports invalid character resources without throwing', () => {
    const { ctx, logs } = fakeContext({ electron: petElectron() })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: () => { throw new Error('bad json') },
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadElectron: () => petElectron(),
    })
    expect(() => plugin.apply(ctx as never)).not.toThrow()
    expect(logs.some(log => log.includes('failed validation'))).toBe(true)
  })

  it('opens the window and registers the tray on the desktop runtime', () => {
    createdWindows.length = 0
    const { ctx, trayItems } = fakeContext({ electron: petElectron() })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadLive2DDir: fixtureDirLoader,
      loadElectron: () => petElectron(),
    })
    plugin.apply(ctx as never)
    expect(createdWindows).toHaveLength(1)
    expect(trayItems).toHaveLength(1)
    expect(trayItems[0]!.label()).toBe('桌宠 · 芙宁娜')
    const submenu = trayItems[0]!.submenu!()
    expect(submenu).toHaveLength(4)
    expect(submenu[0]!.type).toBe('checkbox')
    expect(submenu[0]!.label()).toBe('显示桌宠')
    expect(submenu[0]!.checked!()).toBe(true)
    expect(submenu[1]!.label()).toBe('打个招呼')
    expect(submenu[1]!.enabled!()).toBe(true)
  })

  it('shows the companion checkbox unchecked for a persisted disabled pet', () => {
    createdWindows.length = 0
    const { ctx, trayItems } = fakeContext({ electron: petElectron(), settings: { enabled: false } })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadLive2DDir: fixtureDirLoader,
      loadElectron: () => petElectron(),
    })
    plugin.apply(ctx as never)
    const submenu = trayItems[0]!.submenu!()
    expect(submenu[0]!.label()).toBe('显示桌宠')
    expect(submenu[0]!.checked!()).toBe(false)
    expect(submenu[1]!.enabled!()).toBe(false)
  })

  it('localizes the tray label for English locales', () => {
    createdWindows.length = 0
    const { ctx, trayItems } = fakeContext({ electron: petElectron(), locale: 'en' })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadLive2DDir: fixtureDirLoader,
      loadElectron: () => petElectron(),
    })
    plugin.apply(ctx as never)
    expect(trayItems[0]!.label()).toBe('Pet · Furina')
    const submenu = trayItems[0]!.submenu!()
    expect(submenu[0]!.label()).toBe('Show companion')
    expect(submenu[1]!.label()).toBe('Say hello')
  })

  it('does not open the window when persisted settings disable the pet', () => {
    createdWindows.length = 0
    const { ctx } = fakeContext({ electron: petElectron(), settings: { enabled: false } })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadLive2DDir: fixtureDirLoader,
      loadElectron: () => petElectron(),
    })
    plugin.apply(ctx as never)
    expect(createdWindows).toHaveLength(0)
  })

  it('closes the window when the effect scope disposes', () => {
    createdWindows.length = 0
    const { ctx, disposers } = fakeContext({ electron: petElectron() })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadLive2DDir: fixtureDirLoader,
      loadElectron: () => petElectron(),
    })
    plugin.apply(ctx as never)
    expect(createdWindows[0]!.destroyed).toBe(false)
    for (const disposer of disposers) disposer()
    expect(createdWindows[0]!.destroyed).toBe(true)
  })

  it('toggles the companion checkbox immediately and refreshes the tray', () => {
    createdWindows.length = 0
    const { ctx, trayItems, trayRefresh } = fakeContext({ electron: petElectron() })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadLive2DDir: fixtureDirLoader,
      loadElectron: () => petElectron(),
    })
    plugin.apply(ctx as never)
    expect(createdWindows[0]!.destroyed).toBe(false)
    expect(trayRefresh.count).toBe(0)
    trayItems[0]!.submenu!()[0]!.invoke()
    expect(trayItems[0]!.submenu!()[0]!.checked!()).toBe(false)
    expect(trayItems[0]!.submenu!()[1]!.enabled!()).toBe(false)
    expect(createdWindows[0]!.destroyed).toBe(true)
    expect(trayRefresh.count).toBe(1)
    trayItems[0]!.submenu!()[0]!.invoke()
    expect(trayItems[0]!.submenu!()[0]!.checked!()).toBe(true)
    expect(createdWindows).toHaveLength(2)
    expect(createdWindows[1]!.destroyed).toBe(false)
    expect(trayRefresh.count).toBe(2)
  })

  it('flips checkbox settings without waiting for the settings watch', () => {
    createdWindows.length = 0
    const { ctx, trayItems, trayRefresh } = fakeContext({ electron: petElectron() })
    const plugin = createPetPlugin({
      pluginName: 'desktop-pet-furina',
      trayOrder: 31,
      loadCharacter: testCharacter,
      loadHtmlPath: () => 'C:\\pets\\pet.html',
      loadLive2DDir: fixtureDirLoader,
      loadElectron: () => petElectron(),
    })
    plugin.apply(ctx as never)
    const reactions = trayItems[0]!.submenu!()[2]!
    expect(reactions.type).toBe('checkbox')
    expect(reactions.checked!()).toBe(true)
    reactions.invoke()
    expect(trayItems[0]!.submenu!()[2]!.checked!()).toBe(false)
    expect(trayRefresh.count).toBe(1)
  })
})
