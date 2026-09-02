/** Lifecycle for one transparent always-on-top pet window. */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { PetCharacterDocument, PetLocale, PetState } from './contracts.ts'
import {
  collectPetLive2DAssetChunks,
  collectPetLive2DShaderChunks,
  petLive2DChunkStatement,
  petLive2DFinalizeStatement,
  readPetLive2DCoreText,
  readPetLive2DViewerText,
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
  /** macOS: show without becoming the key window of the current Space. */
  showInactive(): void
  hide(): void
  isVisible(): boolean
  getBounds(): PetRectangle
  setBounds(bounds: PetRectangle): void
  setPosition(x: number, y: number): void
  setAlwaysOnTop(flag: boolean, level?: string): void
  setVisibleOnAllWorkspaces(visible: boolean, options?: {
    visibleOnFullScreen?: boolean
    skipTransformProcessType?: boolean
  }): void
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
    /** Present in real Electron; lets the pet track the cursor screen-wide. */
    getCursorScreenPoint?(): { x: number, y: number }
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
  /** Named expression overlays mapped to their Cubism parameter ids. */
  readonly expressionParameters?: Readonly<Record<string, string>>
  /** Motion groups for taps that land outside every declared HitArea. */
  readonly tapFallbackGroups?: readonly string[]
  /** Hit-area names mapped to motion groups, overriding model bindings. */
  readonly hitAreaMotions?: Readonly<Record<string, string>>
  /** Parameter values written back when an interaction motion finishes. */
  readonly motionEndReset?: Readonly<Record<string, number>>
  /** Parameters cycled while a named expression is active. */
  readonly expressionCycles?: Readonly<
    Record<string, {
      readonly param: string
      readonly from: number
      readonly to: number
      readonly period: number
    }>
  >
  /** Vertical look origin as a fraction of the window height (0..1). */
  readonly lookOriginY?: number
  /** How long a tapped expression holds before easing back (ms). */
  readonly expressionHoldMs?: number
  /** Idle-state variations cycling while the pet is idle. */
  readonly idleVariants?: {
    readonly expressions?: readonly string[]
    readonly everyMs?: number
    readonly holdMs?: number
  }
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
    ...(live2d.expressionParameters === undefined ? {} : { expressionParameters: live2d.expressionParameters }),
    ...(live2d.tapFallbackGroups === undefined ? {} : { tapFallbackGroups: live2d.tapFallbackGroups }),
    ...(live2d.hitAreaMotions === undefined ? {} : { hitAreaMotions: live2d.hitAreaMotions }),
    ...(live2d.motionEndReset === undefined ? {} : { motionEndReset: live2d.motionEndReset }),
    ...(live2d.expressionCycles === undefined ? {} : { expressionCycles: live2d.expressionCycles }),
    ...(live2d.lookOriginY === undefined ? {} : { lookOriginY: live2d.lookOriginY }),
    ...(live2d.expressionHoldMs === undefined ? {} : { expressionHoldMs: live2d.expressionHoldMs }),
    ...(live2d.idleVariants === undefined ? {} : { idleVariants: live2d.idleVariants }),
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
const WORK_AREA_MARGIN_PX = 8
/** Window pixels reserved above the character so speech never covers the model.
 *  Keep in sync with `--pet-speech-slot` in `pet.html`. */
export const PET_SPEECH_SLOT_PX = 80
/** Per-message cap for renderer-driven drag deltas. */
const MANUAL_MOVE_MAX_PX = 64
/** Reject grab offsets outside the pet window (plus a small margin). */
const DRAG_GRAB_MAX_PX = 4096
const POSITION_SAVE_DEBOUNCE_MS = 600
/** OS cursor polling cadence for screen-wide look-at tracking and drag follow. */
const CURSOR_TRACK_MS = 16

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

/** Overlay flags that keep the pet on every Space, including fullscreen. */
const PET_ALL_WORKSPACES = Object.freeze({
  visibleOnFullScreen: true,
  skipTransformProcessType: true,
})

/** Pin the pet above other windows and onto every macOS Space / Linux workspace. */
function pinPetAcrossWorkspaces(window: PetBrowserWindow): void {
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, PET_ALL_WORKSPACES)
}

/**
 * Reveal the overlay and re-apply workspace pinning.
 * macOS assigns a Space at `show()`; `showInactive()` plus a post-show pin
 * keeps four-finger Space swipes from leaving the pet on the creation desktop.
 */
function presentPetWindow(window: PetBrowserWindow): void {
  if (process.platform === 'darwin') window.showInactive()
  else window.show()
  pinPetAcrossWorkspaces(window)
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

/** Own one pet window: creation, pushes, persistence, disposal. */
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
  private cursorTimer: ReturnType<typeof setInterval> | undefined
  private lastCursor: { x: number, y: number } | undefined
  /** Grab offset while the Host follows the OS cursor during a drag. */
  private dragGrab: { ox: number, oy: number } | undefined
  private dragTimer: ReturnType<typeof setInterval> | undefined
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
      if (!existing.isVisible()) presentPetWindow(existing)
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
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
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
    pinPetAcrossWorkspaces(window)
    const lockZoom = window.webContents.setVisualZoomLevelLimits
    if (typeof lockZoom === 'function') void lockZoom.call(window.webContents, 1, 1)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('did-finish-load', () => { this.handlePageReady() })
    window.webContents.on('will-navigate', (...args: never[]) => {
      this.handleNavigate(args[0] as { preventDefault(): void } | undefined, args[1] as string | undefined)
    })
    window.once('ready-to-show', () => {
      if (!this.disposed && this.window === window && !window.isDestroyed()) {
        presentPetWindow(window)
        this.startCursorTracking()
      }
    })
    window.on('closed', () => {
      if (this.window === window) this.window = undefined
      this.pageReady = false
      this.stopManualDrag(false)
      this.stopCursorTracking()
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
    this.stopManualDrag(false)
    this.flushPositionSave()
    this.stopCursorTracking()
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
    // Cubism Core and the official viewer before it receives a character.
    void gate.then(deliver)
  }

  /**
   * Evaluate the operator-procured Cubism Core, the official viewer, and the
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
          await evaluate(
            `/* DSH pet Cubism viewer */\n${readPetLive2DViewerText()}\nvoid 0;\n`,
          )
          for (const chunk of [
            ...collectPetLive2DShaderChunks(),
            ...collectPetLive2DAssetChunks(live2dDir),
          ]) {
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
    if (command === 'dragstart') {
      this.startManualDrag(url.searchParams.get('ox'), url.searchParams.get('oy'))
      return
    }
    if (command === 'dragend' && url.search === '') {
      this.stopManualDrag(true)
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
    const parsedDx = Number.parseInt(rawDx ?? '', 10)
    const parsedDy = Number.parseInt(rawDy ?? '', 10)
    if (Number.isNaN(parsedDx) || Number.isNaN(parsedDy)) return
    const dx = clamp(parsedDx, -MANUAL_MOVE_MAX_PX, MANUAL_MOVE_MAX_PX)
    const dy = clamp(parsedDy, -MANUAL_MOVE_MAX_PX, MANUAL_MOVE_MAX_PX)
    if (dx === 0 && dy === 0) return
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

  /** Follow the OS cursor until {@link stopManualDrag}, using the grab offset. */
  private startManualDrag(rawOx: string | null, rawOy: string | null): void {
    const ox = Number.parseInt(rawOx ?? '', 10)
    const oy = Number.parseInt(rawOy ?? '', 10)
    if (Number.isNaN(ox) || Number.isNaN(oy)) return
    if (Math.abs(ox) > DRAG_GRAB_MAX_PX || Math.abs(oy) > DRAG_GRAB_MAX_PX) return
    if (!this.isOpen()) return
    this.dragGrab = { ox, oy }
    this.stopCursorTracking()
    if (this.dragTimer === undefined) {
      this.dragTimer = setInterval(() => { this.tickManualDrag() }, CURSOR_TRACK_MS)
    }
    this.tickManualDrag()
  }

  /**
   * @param resumeLookAt - restore screen-wide look-at after a user drag ends.
   *   Closing the window passes false so a disposed controller does not restart
   *   the cursor poller.
   */
  private stopManualDrag(resumeLookAt: boolean): void {
    if (this.dragTimer !== undefined) {
      clearInterval(this.dragTimer)
      this.dragTimer = undefined
    }
    this.dragGrab = undefined
    if (resumeLookAt && this.isVisible()) this.startCursorTracking()
  }

  private tickManualDrag(): void {
    const grab = this.dragGrab
    const window = this.window
    if (grab === undefined || window === undefined || window.isDestroyed()) {
      this.stopManualDrag(false)
      return
    }
    const point = this.options.electron.screen?.getCursorScreenPoint?.()
    if (point === undefined) return
    const width = this.layoutWidth
    const height = this.layoutHeight
    const next = this.clampToWorkArea(
      point.x - grab.ox,
      point.y - grab.oy,
      width,
      height,
      this.options.electron.screen,
    )
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

  /**
   * Feed the model's look-at target from the OS cursor so the pet tracks the
   * mouse across the whole screen, not only while it hovers the window. The
   * poller is the off-window complement of the page's own mousemove feed:
   * while the cursor is over the pet both produce the same client point, and
   * once it leaves only this keeps updating.
   */
  private startCursorTracking(): void {
    if (this.cursorTimer !== undefined) return
    this.cursorTimer = setInterval(() => { this.pollCursor() }, CURSOR_TRACK_MS)
  }

  private stopCursorTracking(): void {
    if (this.cursorTimer !== undefined) clearInterval(this.cursorTimer)
    this.cursorTimer = undefined
    this.lastCursor = undefined
  }

  private pollCursor(): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || !this.isOpen() || !this.isVisible()) return
    const point = this.options.electron.screen?.getCursorScreenPoint?.()
    if (point === undefined) return
    const bounds = window.getBounds()
    const x = point.x - bounds.x
    const y = point.y - bounds.y
    if (this.lastCursor !== undefined && this.lastCursor.x === x && this.lastCursor.y === y) return
    this.lastCursor = { x, y }
    this.run(`var rt = window.__dshPetLive2DRuntime; rt && rt.setPointer(${x}, ${y});`)
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
