/** Lifecycle for one transparent always-on-top pet window. */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { PetCharacterDocument, PetLocale, PetState } from './contracts.ts'
import {
  collectPetLive2DAssetChunks,
  PET_LIVE2D_RUNTIME_GLUE,
  petLive2DChunkStatement,
  petLive2DFinalizeStatement,
  readPetLive2DCoreText,
} from './pet-live2d-host.ts'

/** Rectangle values shared with Electron's screen and window APIs. */
export interface PetRectangle {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Structural subset of Electron's BrowserWindow used by the pet engine. */
export interface PetBrowserWindow {
  on(event: string, listener: (...args: never[]) => void): void
  once(event: string, listener: (...args: never[]) => void): void
  isDestroyed(): boolean
  close(): void
  show(): void
  hide(): void
  isVisible(): boolean
  getBounds(): PetRectangle
  setBounds(bounds: PetRectangle): void
  setPosition(x: number, y: number): void
  setAlwaysOnTop(flag: boolean, level?: string): void
  webContents: {
    on(event: string, listener: (...args: never[]) => void): void
    setWindowOpenHandler(handler: () => { action: string }): void
    executeJavaScript(code: string, userGesture: boolean): Promise<unknown>
    loadFile(path: string, options?: { query?: Record<string, string> }): Promise<void>
    setVisualZoomLevelLimits?(minimumLevel: number, maximumLevel: number): Promise<void>
  }
}

/** Structural subset of Electron's module export and screen API. */
export interface PetElectron {
  readonly BrowserWindow: new (options: Record<string, unknown>) => PetBrowserWindow
  readonly screen?: {
    getDisplayMatching(bounds: PetRectangle): { readonly workArea: PetRectangle }
  }
}

/** Structural desktop-runtime capabilities the pet engine needs. */
export interface PetRuntimeHost {
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly locale: PetLocale
  readonly userDataDir: string
}

/** Payload pushed into the renderer page after it finishes loading. */
export interface PetBootPayload {
  readonly kind: 'boot'
  readonly character: PetCharacterDocument
  readonly locale: PetLocale
  readonly idleChatter: boolean
  /** Live2D asset selection; the only renderer this engine supports. */
  readonly live2d: PetLive2DSelection
}

/**
 * What the renderer needs to pick the model out of the injected in-memory
 * asset table. The Cubism Core and every asset byte are streamed over
 * `executeJavaScript` before boot, so no `file://` access ever happens inside
 * the sandboxed renderer.
 */
export interface PetLive2DSelection {
  /** Model entry key relative to the plugin's asset directory. */
  readonly model: string
  /** Parameter ids forced to `0` each frame (declared prop hiding). */
  readonly hideParameters?: readonly string[]
  /** Cubism Part ids forced to opacity `0` after model update. */
  readonly hideParts?: readonly string[]
  /** Expression name → part ids to stop hiding while that expression is on. */
  readonly expressionRevealParts?: Readonly<Record<string, readonly string[]>>
  /** Form-parameter latch forwarded to the renderer glue. */
  readonly outfit?: {
    readonly parameter: string
    readonly lowParts?: readonly string[]
    readonly highParts?: readonly string[]
  }
}

/** Live2D assets one pet plugin exposes to the shared window controller. */
export interface PetLive2DAssets {
  /** Plugin-owned directory holding the model, its textures, and the vendor Core script. */
  readonly dir: string
}

/**
 * Resolve the Live2D selection from one asset directory and the character's
 * declared metadata. Returns `undefined` when files are absent; callers then
 * refuse to open the pet window at all.
 */
export function resolvePetLive2DUrls(
  character: PetCharacterDocument,
  assetsDir: string,
): PetLive2DSelection | undefined {
  const live2d = character.live2d
  if (live2d === undefined) return undefined
  const modelPath = join(assetsDir, live2d.model)
  const corePath = join(assetsDir, live2d.core ?? 'vendor/live2dcubismcore.min.js')
  if (!existsSync(modelPath) || !existsSync(corePath)) return undefined
  return {
    model: live2d.model,
    ...(live2d.hideParameters === undefined ? {} : { hideParameters: live2d.hideParameters }),
    ...(live2d.hideParts === undefined ? {} : { hideParts: live2d.hideParts }),
    ...(live2d.expressionRevealParts === undefined ? {} : { expressionRevealParts: live2d.expressionRevealParts }),
    ...(live2d.outfit === undefined ? {} : { outfit: live2d.outfit }),
  }
}

/** One state request pushed into the renderer page. */
export interface PetDispatchPayload {
  readonly kind: 'dispatch'
  readonly state: PetState
  readonly line?: string
}

/** Commands the renderer page may request through its private scheme. */
export type PetWindowCommand = 'hide'

const PET_STATE_DURATIONS: Readonly<Record<PetState, number>> = Object.freeze({
  greet: 4200,
  idle: 0,
  work: 0,
  cheer: 3200,
  sad: 4200,
  pat: 2200,
  special: 3600,
  walk: 2600,
})

/** Every non-idle state returns to idle after this many milliseconds. */
export function petStateDuration(state: PetState): number {
  return PET_STATE_DURATIONS[state] ?? 0
}

const POSITION_FILE_VERSION = 1
const STROLL_DISTANCE_PX = 48
const WORK_AREA_MARGIN_PX = 8
/** Window pixels reserved above the character so speech never covers the model.
 *  Keep in sync with `--pet-speech-slot` in `pet.html`. */
export const PET_SPEECH_SLOT_PX = 80
/** Per-message cap for renderer-driven drag deltas. */
const MANUAL_MOVE_MAX_PX = 64
/** Crawl pacing for one stroll hop: 16 steps × 60ms ≈ 1s of visible walking. */
const STROLL_STEP_MS = 60
const POSITION_SAVE_DEBOUNCE_MS = 600

interface PetPositionFile {
  readonly version: 1
  readonly x: number
  readonly y: number
}

function sanitizeElectronShape(loaded: unknown): PetElectron | undefined {
  if (typeof loaded !== 'object' || loaded === null) return undefined
  const candidate = loaded as { BrowserWindow?: unknown, screen?: unknown }
  if (typeof candidate.BrowserWindow !== 'function') return undefined
  return candidate.screen === undefined
    ? { BrowserWindow: candidate.BrowserWindow as PetElectron['BrowserWindow'] }
    : {
      BrowserWindow: candidate.BrowserWindow as PetElectron['BrowserWindow'],
      screen: candidate.screen as NonNullable<PetElectron['screen']>,
    }
}

/**
 * Load the Electron main-process module from a plugin module URL.
 * Returns `undefined` outside Electron so the pet stays inactive in an
 * ordinary DSH boot.
 */
export function loadPetElectron(moduleUrl: string): PetElectron | undefined {
  try {
    const require = createRequire(moduleUrl)
    return sanitizeElectronShape(require('electron'))
  } catch {
    return undefined
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function petLayoutSize(character: PetCharacterDocument, scale: number): { width: number, height: number } {
  return {
    width: Math.round(character.baseSize.width * scale),
    height: Math.round(character.baseSize.height * scale) + PET_SPEECH_SLOT_PX,
  }
}

function defaultBounds(character: PetCharacterDocument, workArea: PetRectangle | undefined): PetRectangle {
  const { width, height } = petLayoutSize(character, 1)
  if (workArea === undefined) return { x: 0, y: 0, width, height }
  return {
    x: workArea.x + workArea.width - width - WORK_AREA_MARGIN_PX * 3,
    y: workArea.y + workArea.height - height - WORK_AREA_MARGIN_PX,
    width,
    height,
  }
}

function readPosition(path: string): { readonly x: number, readonly y: number } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const file = parsed as { version?: unknown, x?: unknown, y?: unknown }
  if (file.version !== POSITION_FILE_VERSION
    || typeof file.x !== 'number' || typeof file.y !== 'number') return undefined
  return { x: file.x, y: file.y }
}

/** Inputs owned by one pet window controller. */
export interface PetWindowOptions {
  readonly character: PetCharacterDocument
  readonly htmlPath: string
  readonly statePath: string
  readonly electron: PetElectron
  readonly locale: () => PetLocale
  readonly idleChatter: () => boolean
  /** Required plugin-owned Live2D asset directory. */
  readonly live2dDir?: () => string | undefined
  /** Diagnostic sink for Live2D attach outcomes; absent stays silent. */
  readonly log?: (message: string) => void
  readonly onCommand: (command: PetWindowCommand) => void
}

/** Own one pet window: creation, pushes, strolls, persistence, disposal. */
export class PetWindowController {
  private window: PetBrowserWindow | undefined
  private disposed = false
  private pageReady = false
  private pendingBoot: PetBootPayload | undefined
  /** Live2D spec kept beside the boot payload so injection can precede boot. */
  private live2dSpec: PetLive2DSelection | undefined
  /** Resolves once the optional Core+glue injection finished (or failed). */
  private bootGate: Promise<void> | undefined
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private strollStepTimer: ReturnType<typeof setTimeout> | undefined
  /** Designed content size; never re-read from getBounds during drag (DPI drift). */
  private layoutWidth = 0
  private layoutHeight = 0

  constructor(private readonly options: PetWindowOptions) {}

  /** Whether the window currently exists and is not destroyed. */
  isOpen(): boolean {
    return this.window !== undefined && !this.window.isDestroyed()
  }

  /** Whether the window is currently visible. */
  isVisible(): boolean {
    return this.isOpen() && this.window!.isVisible()
  }

  /** Create (or re-show) the pet window. Repeated calls are idempotent. */
  open(): void {
    if (this.disposed) return
    const existing = this.window
    if (existing !== undefined && !existing.isDestroyed()) {
      if (!existing.isVisible()) existing.show()
      return
    }
    const live2dDir = this.options.live2dDir?.()
    const spec = live2dDir === undefined
      ? undefined
      : resolvePetLive2DUrls(this.options.character, live2dDir)
    if (spec === undefined) {
      // Live2D is the only renderer; without resolvable assets there is
      // nothing to show, so the window never materializes.
      this.options.log?.(
        `live2d assets missing under ${live2dDir ?? '(no asset dir)'}; pet window will not open`,
      )
      return
    }
    this.live2dSpec = spec
    const { BrowserWindow, screen } = this.options.electron
    const locale = this.options.locale()
    const primary = screen?.getDisplayMatching({ x: 0, y: 0, width: 0, height: 0 }).workArea
    const restored = readPosition(this.options.statePath)
    const fallback = defaultBounds(this.options.character, primary)
    const bounds = restored === undefined
      ? fallback
      : this.clampToWorkArea(restored.x, restored.y, fallback.width, fallback.height, screen)
    this.layoutWidth = bounds.width
    this.layoutHeight = bounds.height
    const window = new BrowserWindow({
      title: `DSH Pet · ${this.options.character.copy[locale].label}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      roundedCorners: false,
      focusable: false,
      acceptFirstMouse: true,
      alwaysOnTop: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        spellcheck: false,
      },
    })
    this.window = window
    this.pageReady = false
    window.setAlwaysOnTop(true, 'screen-saver')
    const lockZoom = window.webContents.setVisualZoomLevelLimits
    if (typeof lockZoom === 'function') void lockZoom.call(window.webContents, 1, 1)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('did-finish-load', () => { this.handlePageReady() })
    window.webContents.on('will-navigate', (...args: never[]) => {
      this.handleNavigate(args[0] as { preventDefault(): void } | undefined, args[1] as string | undefined)
    })
    window.once('ready-to-show', () => {
      if (!this.disposed && this.window === window && !window.isDestroyed()) window.show()
    })
    window.on('closed', () => {
      if (this.window === window) this.window = undefined
      this.pageReady = false
    })
    window.on('moved', () => { this.schedulePositionSave() })
    this.queueBoot()
    void window.webContents.loadFile(this.options.htmlPath, {
      query: { locale },
    }).catch(() => {
      if (!this.disposed && this.window === window && !window.isDestroyed()) window.close()
    })
  }

  /** Close the current window, if any. */
  close(): void {
    this.flushPositionSave()
    const window = this.window
    this.window = undefined
    this.pageReady = false
    this.pendingBoot = undefined
    this.live2dSpec = undefined
    this.bootGate = undefined
    if (window !== undefined && !window.isDestroyed()) window.close()
  }

  /** Dispose permanently; the controller cannot be reopened afterwards. */
  dispose(): void {
    this.disposed = true
    if (this.strollStepTimer !== undefined) {
      clearTimeout(this.strollStepTimer)
      this.strollStepTimer = undefined
    }
    this.close()
  }

  /** Push one state (and optional spoken line) into the page. */
  emit(state: PetState, line?: string): void {
    if (!this.isOpen()) return
    const payload: PetDispatchPayload = {
      kind: 'dispatch',
      state,
      ...(line === undefined ? {} : { line }),
    }
    this.run(`window.__dshPet && window.__dshPet.dispatch(${JSON.stringify(payload)});`)
    const duration = petStateDuration(state)
    if (duration > 0 && state !== 'idle') {
      const revert = JSON.stringify({ kind: 'dispatch', state: 'idle' } satisfies PetDispatchPayload)
      this.run(
        `if (window.__dshPet && window.__dshPet.state() === ${JSON.stringify(state)})`
        + ` { window.__dshPet.dispatch(${revert}); }`,
        duration,
      )
    }
  }

  /** Apply a new window scale while keeping the current position. */
  applyScale(scale: number): void {
    if (!this.isOpen()) return
    const window = this.window!
    const bounds = window.getBounds()
    const size = petLayoutSize(this.options.character, scale)
    this.layoutWidth = size.width
    this.layoutHeight = size.height
    window.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: size.width,
      height: size.height,
    })
  }

  /**
   * Walk one short hop sideways inside the work area as a smooth crawl, not
   * an instant teleport — the renderer only holds the walk pose for a few
   * seconds, and the walk-only accessory needs those frames to be visible.
   */
  stroll(): void {
    if (!this.isOpen() || !this.isVisible()) return
    if (this.strollStepTimer !== undefined) {
      clearTimeout(this.strollStepTimer)
      this.strollStepTimer = undefined
    }
    const window = this.window!
    const bounds = window.getBounds()
    const width = this.layoutWidth || bounds.width
    const height = this.layoutHeight || bounds.height
    const workArea = this.options.electron.screen
      ?.getDisplayMatching(bounds).workArea
    this.emit('walk')
    if (workArea === undefined) return
    const direction = Math.random() < 0.5 ? -1 : 1
    const target = clamp(
      bounds.x + direction * STROLL_DISTANCE_PX,
      workArea.x + WORK_AREA_MARGIN_PX,
      workArea.x + workArea.width - width - WORK_AREA_MARGIN_PX,
    )
    // First step lands synchronously; the rest ride one timer chain that is
    // cleared on close/dispose so a dead window can never keep walking.
    const steps = 16
    const startX = bounds.x
    const stepTo = (index: number): void => {
      const current = this.window
      if (current === undefined || current.isDestroyed() || !this.isOpen()) return
      current.setBounds({
        x: clamp(
          Math.round(startX + ((target - startX) * index) / steps),
          workArea.x + WORK_AREA_MARGIN_PX,
          Math.max(workArea.x + WORK_AREA_MARGIN_PX, workArea.x + workArea.width - width - WORK_AREA_MARGIN_PX),
        ),
        y: bounds.y,
        width,
        height,
      })
      if (index < steps) {
        this.strollStepTimer = setTimeout(() => {
          this.strollStepTimer = undefined
          stepTo(index + 1)
        }, STROLL_STEP_MS)
      }
    }
    stepTo(1)
  }

  /** Re-send the boot payload (for example after preference changes). */
  reboot(): void {
    this.queueBoot()
    this.flushBoot()
  }

  private queueBoot(): void {
    const live2dDir = this.options.live2dDir?.()
    const live2d = live2dDir === undefined
      ? undefined
      : resolvePetLive2DUrls(this.options.character, live2dDir)
    if (live2d === undefined) {
      // open() refuses to create a window without assets, so this only fires
      // when files vanish between open and (re)boot.
      this.options.log?.('live2d assets became unreadable; boot skipped')
      this.pendingBoot = undefined
      this.flushBoot()
      return
    }
    this.live2dSpec = live2d
    this.pendingBoot = {
      kind: 'boot',
      character: this.options.character,
      locale: this.options.locale(),
      idleChatter: this.options.idleChatter(),
      live2d,
    }
    this.flushBoot()
  }

  private flushBoot(): void {
    const payload = this.pendingBoot
    const gate = this.bootGate
    if (payload === undefined || !this.isOpen() || !this.pageReady || gate === undefined) return
    const deliver = (): void => {
      if (!this.isOpen() || !this.pageReady || this.pendingBoot !== payload) return
      this.pendingBoot = undefined
      this.run(`window.__dshPet && window.__dshPet.boot(${JSON.stringify(payload)});`)
    }
    // Boot always rides behind the injection gate: the page must have the
    // Cubism Core and the renderer glue before it receives a character.
    void gate.then(deliver)
  }

  /**
   * Evaluate the operator-procured Cubism Core, the renderer glue, and the
   * full in-memory asset table before boot delivery. Bounded by a timeout so
   * a wedged page can never hold the pet hostage; on failure the log says so
   * and the window stays blank.
   */
  private async injectLive2D(): Promise<void> {
    const evaluate = async (code: string): Promise<unknown> => {
      const current = this.window
      if (current === undefined || current.isDestroyed()) throw new Error('pet window closed')
      return current.webContents.executeJavaScript(code, true)
    }
    const live2dDir = this.options.live2dDir?.()
    if (live2dDir === undefined) throw new Error('live2d asset dir vanished')
    const coreRel = this.options.character.live2d.core ?? 'vendor/live2dcubismcore.min.js'
    const coreText = readPetLive2DCoreText(join(live2dDir, coreRel))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        (async (): Promise<void> => {
          // Each executeJavaScript call gets its own scope wrapper in this
          // Electron build, so a top-level `var Live2DCubismCore` never
          // reaches later evaluations. Ship the core text and its re-export
          // onto `window` inside ONE evaluation, then verify cross-scope via
          // an explicit `window` property lookup (explicit properties do
          // survive between calls — the asset-table streaming relies on it).
          // The trailing `void 0` matters twice: it keeps the completion
          // value undefined (executeJavaScript structured-clones the value
          // back over IPC, and the namespace object is not cloneable), and
          // it cannot be evaluated until every emscripten statement above
          // has actually run.
          await evaluate(
            `/* DSH pet Cubism Core */\n${coreText}\n`
            + `window.Live2DCubismCore=(typeof Live2DCubismCore!=='undefined')?Live2DCubismCore:window.Live2DCubismCore;\nvoid 0;\n`,
          )
          const exposed = String(await evaluate(
            `(function(){var ns=window.Live2DCubismCore;`
            + `if(!ns||!ns.Moc||!ns.Model||!ns.Drawables)return'';return'ok';})()`,
          ))
          if (exposed !== 'ok') {
            throw new Error('cubism core did not define its wrapper classes after injection')
          }
          await evaluate(PET_LIVE2D_RUNTIME_GLUE)
          for (const chunk of collectPetLive2DAssetChunks(live2dDir)) {
            await evaluate(petLive2DChunkStatement(chunk))
          }
          await evaluate(petLive2DFinalizeStatement())
        })(),
        new Promise<never>((_, reject) => {
          // Asset streaming over IPC takes a while for large models.
          timer = setTimeout(() => reject(new Error('live2d injection timed out')), 60000)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private handlePageReady(): void {
    if (this.disposed || !this.isOpen()) return
    this.pageReady = true
    const spec = this.live2dSpec
    if (spec === undefined) {
      this.bootGate = undefined
      this.options.log?.('live2d spec lost before page load; boot skipped')
    } else {
      this.bootGate = this.injectLive2D()
        .then(() => {
          // Identity + geometry: duplicate/zombie pet windows (stale process
          // still drawing over the live one) show up instantly as two
          // different pids claiming overlapping bounds in this log.
          let bounds = '?'
          try {
            const b = this.window?.getBounds()
            if (b) bounds = `[${b.x},${b.y} ${b.width}x${b.height}]`
          } catch { /* destroyed */ }
          this.options.log?.(`live2d runtime attached pid=${process.pid} bounds=${bounds}`)
        })
        .catch((cause: unknown) => {
          this.options.log?.(`live2d injection failed (${cause instanceof Error ? cause.message : String(cause)})`)
        })
    }
    this.flushBoot()
  }

  private handleNavigate(event: { preventDefault(): void } | undefined, href: string | undefined): void {
    event?.preventDefault()
    if (typeof href !== 'string' || href.length === 0 || href.length > 512) return
    let url: URL
    try { url = new URL(href) } catch { return }
    if (url.protocol !== `dsh-pet-${this.options.character.id}:`
      || url.username !== '' || url.password !== '' || url.pathname !== '') return
    const command = url.hostname
    if (command === 'hide' && url.search === '') {
      this.options.onCommand('hide')
      return
    }
    if (command === 'move') {
      this.handleManualMove(url.searchParams.get('dx'), url.searchParams.get('dy'))
      return
    }
    if (command === 'live2dfailed') {
      const reason = url.searchParams.get('r') ?? ''
      if (reason !== '') this.options.log?.(`live2d attach failed in renderer: ${reason}`)
    }
  }

  /**
   * Renderer-driven drag: apply one incremental integer offset. The constant
   * per-message cap keeps a rogue page from teleporting the window, and the
   * work-area clamp keeps it reachable. The `moved` listener already debounce-
   * persists the resulting position.
   */
  private handleManualMove(rawDx: string | null, rawDy: string | null): void {
    const dx = Number.parseInt(rawDx ?? '', 10)
    const dy = Number.parseInt(rawDy ?? '', 10)
    if (Number.isNaN(dx) || Number.isNaN(dy)) return
    if (Math.abs(dx) > MANUAL_MOVE_MAX_PX || Math.abs(dy) > MANUAL_MOVE_MAX_PX) return
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const bounds = window.getBounds()
    const width = this.layoutWidth || bounds.width
    const height = this.layoutHeight || bounds.height
    const next = this.clampToWorkArea(
      bounds.x + dx,
      bounds.y + dy,
      width,
      height,
      this.options.electron.screen,
    )
    // Pin the designed size every tick. Reading getBounds().width on Windows
    // HiDPI and writing it back makes the frameless window grow, which the
    // 100%-wide canvas then paints as the pet zooming while you drag.
    window.setBounds({ x: next.x, y: next.y, width, height })
  }

  private run(code: string, delayMs?: number): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const dispatch = (): void => {
      if (window.isDestroyed()) return
      void window.webContents.executeJavaScript(code, true).catch(() => {})
    }
    if (delayMs === undefined) dispatch()
    else setTimeout(dispatch, delayMs)
  }

  private clampToWorkArea(
    x: number,
    y: number,
    width: number,
    height: number,
    screen: PetElectron['screen'],
  ): PetRectangle {
    const workArea = screen?.getDisplayMatching({ x, y, width, height }).workArea
    if (workArea === undefined) return { x, y, width, height }
    return {
      x: clamp(x, workArea.x, Math.max(workArea.x, workArea.x + workArea.width - width - WORK_AREA_MARGIN_PX)),
      y: clamp(y, workArea.y, Math.max(workArea.y, workArea.y + workArea.height - height - WORK_AREA_MARGIN_PX)),
      width,
      height,
    }
  }

  private schedulePositionSave(): void {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.flushPositionSave()
    }, POSITION_SAVE_DEBOUNCE_MS)
  }

  private flushPositionSave(): void {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    try {
      const bounds = window.getBounds()
      const file: PetPositionFile = { version: POSITION_FILE_VERSION, x: bounds.x, y: bounds.y }
      mkdirSync(dirname(this.options.statePath), { recursive: true })
      writeFileSync(this.options.statePath, `${JSON.stringify(file, undefined, 2)}\n`)
    } catch {
      // A lost position is cosmetic; never surface it beyond the plugin log.
    }
  }
}

/** Resolve the per-character state file path under one runtime userData dir. */
export function petStatePath(userDataDir: string, characterId: string): string {
  return join(userDataDir, 'plugins', 'dsh-plugin-pets', `${characterId}.json`)
}
