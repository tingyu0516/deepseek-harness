/** Lifecycle for one transparent always-on-top pet window. */
import type { PetCharacterDocument, PetLocale, PetState } from './contracts.ts';
/** Rectangle values shared with Electron's screen and window APIs. */
export interface PetRectangle {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
/** Structural subset of Electron's BrowserWindow used by the pet engine. */
export interface PetBrowserWindow {
    on(event: string, listener: (...args: never[]) => void): void;
    once(event: string, listener: (...args: never[]) => void): void;
    isDestroyed(): boolean;
    close(): void;
    show(): void;
    hide(): void;
    isVisible(): boolean;
    getBounds(): PetRectangle;
    setBounds(bounds: PetRectangle): void;
    setPosition(x: number, y: number): void;
    setAlwaysOnTop(flag: boolean, level?: string): void;
    setVisibleOnAllWorkspaces(visible: boolean, options?: {
        visibleOnFullScreen?: boolean;
    }): void;
    webContents: {
        on(event: string, listener: (...args: never[]) => void): void;
        setWindowOpenHandler(handler: () => {
            action: string;
        }): void;
        executeJavaScript(code: string, userGesture: boolean): Promise<unknown>;
        loadFile(path: string, options?: {
            query?: Record<string, string>;
        }): Promise<void>;
        setVisualZoomLevelLimits?(minimumLevel: number, maximumLevel: number): Promise<void>;
    };
}
/** Structural subset of Electron's module export and screen API. */
export interface PetElectron {
    readonly BrowserWindow: new (options: Record<string, unknown>) => PetBrowserWindow;
    readonly screen?: {
        getDisplayMatching(bounds: PetRectangle): {
            readonly workArea: PetRectangle;
        };
        /** Present in real Electron; lets the pet track the cursor screen-wide. */
        getCursorScreenPoint?(): {
            x: number;
            y: number;
        };
    };
}
/** Structural desktop-runtime capabilities the pet engine needs. */
export interface PetRuntimeHost {
    readonly platform: 'darwin' | 'win32' | 'linux';
    readonly locale: PetLocale;
    readonly userDataDir: string;
}
/** Payload pushed into the renderer page after it finishes loading. */
export interface PetBootPayload {
    readonly kind: 'boot';
    readonly character: PetCharacterDocument;
    readonly locale: PetLocale;
    readonly idleChatter: boolean;
    /** Live2D asset selection; the only renderer this engine supports. */
    readonly live2d: PetLive2DSelection;
}
/**
 * What the renderer needs to pick the model out of the injected in-memory
 * asset table. The Cubism Core and every asset byte are streamed over
 * `executeJavaScript` before boot, so no `file://` access ever happens inside
 * the sandboxed renderer.
 */
export interface PetLive2DSelection {
    /** Model entry key relative to the plugin's asset directory. */
    readonly model: string;
    /** Parameter ids forced to `0` each frame (declared prop hiding). */
    readonly hideParameters?: readonly string[];
    /** Named expression overlays mapped to their Cubism parameter ids. */
    readonly expressionParameters?: Readonly<Record<string, string>>;
    /** Motion groups for taps that land outside every declared HitArea. */
    readonly tapFallbackGroups?: readonly string[];
    /** Hit-area names mapped to motion groups, overriding model bindings. */
    readonly hitAreaMotions?: Readonly<Record<string, string>>;
    /** Parameter values written back when an interaction motion finishes. */
    readonly motionEndReset?: Readonly<Record<string, number>>;
    /** Parameters cycled while a named expression is active. */
    readonly expressionCycles?: Readonly<Record<string, {
        readonly param: string;
        readonly from: number;
        readonly to: number;
        readonly period: number;
    }>>;
    /** Vertical look origin as a fraction of the window height (0..1). */
    readonly lookOriginY?: number;
    /** How long a tapped expression holds before easing back (ms). */
    readonly expressionHoldMs?: number;
    /** Idle-state variations cycling while the pet is idle. */
    readonly idleVariants?: {
        readonly expressions?: readonly string[];
        readonly everyMs?: number;
        readonly holdMs?: number;
    };
    /** Cubism Part ids forced to opacity `0` after model update. */
    readonly hideParts?: readonly string[];
    /** Expression name → part ids to stop hiding while that expression is on. */
    readonly expressionRevealParts?: Readonly<Record<string, readonly string[]>>;
    /** Form-parameter latch forwarded to the renderer glue. */
    readonly outfit?: {
        readonly parameter: string;
        readonly lowParts?: readonly string[];
        readonly highParts?: readonly string[];
    };
}
/** Live2D assets one pet plugin exposes to the shared window controller. */
export interface PetLive2DAssets {
    /** Plugin-owned directory holding the model, its textures, and the vendor Core script. */
    readonly dir: string;
}
/**
 * Resolve the Live2D selection from one asset directory and the character's
 * declared metadata. Returns `undefined` when files are absent; callers then
 * refuse to open the pet window at all.
 */
export declare function resolvePetLive2DUrls(character: PetCharacterDocument, assetsDir: string): PetLive2DSelection | undefined;
/** One state request pushed into the renderer page. */
export interface PetDispatchPayload {
    readonly kind: 'dispatch';
    readonly state: PetState;
    readonly line?: string;
}
/** Commands the renderer page may request through its private scheme. */
export type PetWindowCommand = 'hide';
/** Every non-idle state returns to idle after this many milliseconds. */
export declare function petStateDuration(state: PetState): number;
/** Window pixels reserved above the character so speech never covers the model.
 *  Keep in sync with `--pet-speech-slot` in `pet.html`. */
export declare const PET_SPEECH_SLOT_PX = 80;
/**
 * Load the Electron main-process module from a plugin module URL.
 * Returns `undefined` outside Electron so the pet stays inactive in an
 * ordinary DSH boot.
 */
export declare function loadPetElectron(moduleUrl: string): PetElectron | undefined;
/** Inputs owned by one pet window controller. */
export interface PetWindowOptions {
    readonly character: PetCharacterDocument;
    readonly htmlPath: string;
    readonly statePath: string;
    readonly electron: PetElectron;
    readonly locale: () => PetLocale;
    readonly idleChatter: () => boolean;
    /** Required plugin-owned Live2D asset directory. */
    readonly live2dDir?: () => string | undefined;
    /** Diagnostic sink for Live2D attach outcomes; absent stays silent. */
    readonly log?: (message: string) => void;
    readonly onCommand: (command: PetWindowCommand) => void;
}
/** Own one pet window: creation, pushes, persistence, disposal. */
export declare class PetWindowController {
    private readonly options;
    private window;
    private disposed;
    private pageReady;
    private pendingBoot;
    /** Live2D spec kept beside the boot payload so injection can precede boot. */
    private live2dSpec;
    /** Resolves once the optional Core+glue injection finished (or failed). */
    private bootGate;
    private saveTimer;
    private cursorTimer;
    private lastCursor;
    /** Designed content size; never re-read from getBounds during drag (DPI drift). */
    private layoutWidth;
    private layoutHeight;
    constructor(options: PetWindowOptions);
    /** Whether the window currently exists and is not destroyed. */
    isOpen(): boolean;
    /** Whether the window is currently visible. */
    isVisible(): boolean;
    /** Create (or re-show) the pet window. Repeated calls are idempotent. */
    open(): void;
    /** Close the current window, if any. */
    close(): void;
    /** Dispose permanently; the controller cannot be reopened afterwards. */
    dispose(): void;
    /** Push one state (and optional spoken line) into the page. */
    emit(state: PetState, line?: string): void;
    /** Apply a new window scale while keeping the current position. */
    applyScale(scale: number): void;
    /** Re-send the boot payload (for example after preference changes). */
    reboot(): void;
    private queueBoot;
    private flushBoot;
    /**
     * Evaluate the operator-procured Cubism Core, the official viewer, and the
     * full in-memory asset table before boot delivery. Bounded by a timeout so
     * a wedged page can never hold the pet hostage; on failure the log says so
     * and the window stays blank.
     */
    private injectLive2D;
    private handlePageReady;
    private handleNavigate;
    /**
     * Renderer-driven drag: apply one incremental integer offset. The constant
     * per-message cap keeps a rogue page from teleporting the window, and the
     * work-area clamp keeps it reachable. The `moved` listener already debounce-
     * persists the resulting position.
     */
    private handleManualMove;
    private run;
    /**
     * Feed the model's look-at target from the OS cursor so the pet tracks the
     * mouse across the whole screen, not only while it hovers the window. The
     * poller is the off-window complement of the page's own mousemove feed:
     * while the cursor is over the pet both produce the same client point, and
     * once it leaves only this keeps updating.
     */
    private startCursorTracking;
    private stopCursorTracking;
    private pollCursor;
    private clampToWorkArea;
    private schedulePositionSave;
    private flushPositionSave;
}
/** Resolve the per-character state file path under one runtime userData dir. */
export declare function petStatePath(userDataDir: string, characterId: string): string;
