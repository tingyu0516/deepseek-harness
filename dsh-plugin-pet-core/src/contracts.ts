/** Strict contract for one character pet document shipped by a pet plugin. */

/** Pet identities owned by the shipped character plugins. */
export type PetCharacterId = 'hutao' | 'furina'

/** Locales shared with the desktop runtime tray. */
export type PetLocale = 'zh' | 'en'

/** Renderer states driven by the engine page. */
export type PetState = 'greet' | 'idle' | 'work' | 'cheer' | 'sad' | 'pat' | 'special' | 'walk'

/** Line categories a character document must provide per locale. */
export type PetLineCategory = 'greet' | 'idle' | 'work' | 'cheer' | 'sad' | 'pat' | 'special'

/** All line categories in canonical order. */
export const PET_LINE_CATEGORIES: readonly PetLineCategory[] = Object.freeze([
  'greet', 'idle', 'work', 'cheer', 'sad', 'pat', 'special',
])

/** One locale's spoken lines grouped by category. */
export type PetLines = Readonly<Record<PetLineCategory, readonly string[]>>

/** Accent colors consumed by the renderer page. */
export interface PetPalette {
  /** Primary character accent used for highlights and focus rings. */
  readonly accent: string
  /** Speech-bubble fill. */
  readonly bubbleBg: string
  /** Speech-bubble label color. */
  readonly bubbleText: string
  /** Speech-bubble border color. */
  readonly bubbleBorder: string
}

/** Localized names and one locale's lines for one character. */
export interface PetCopy {
  /** Native character name shown in the tray and window title. */
  readonly label: string
  readonly lines: PetLines
}

/** Optional Live2D assets referenced by one character document. */
export interface PetLive2DDocument {
  /** `.model3.json` file name resolved relative to the plugin's `assets/live2d/` directory. */
  readonly model: string
  /**
   * Cubism Core script file name resolved relative to the same directory.
   * Defaults to `vendor/live2dcubismcore.min.js`; this repository never ships
   * the Core binary itself — deployments that want Live2D rendering procure
   * it under the Live2D Cubism SDK license agreement.
   */
  readonly core?: string
  /**
   * Parameter ids forced to `0` every frame before drawing, hiding optional
   * built-in props (e.g. a fan-made watermark sign board). Motion curves are
   * expected never to drive these ids; the clamp runs after motion sampling.
   */
  readonly hideParameters?: readonly string[]
  /**
   * Named expression overlays mapped to their Cubism parameter ids
   * (`{ "blush": "Param7" }`). The renderer eases the bound parameter to 1
   * while the expression is active and to 0 otherwise, so tapping a region
   * can pin a face. Character data: ids are model-specific, so characters
   * without this table never get any expression writes.
   */
  readonly expressionParameters?: Readonly<Record<string, string>>
  /**
   * Motion groups the renderer may pick at random when a tap lands on the
   * model but outside every declared HitArea. Without this table only the
   * declared HitAreas respond to taps.
   */
  readonly tapFallbackGroups?: readonly string[]
  /**
   * Hit-area names mapped to motion groups, overriding or supplementing the
   * `Motion` bindings declared in the model's `HitAreas` (for entries the
   * model author left unbound).
   */
  readonly hitAreaMotions?: Readonly<Record<string, string>>
  /**
   * Parameter ids written back to the declared value when an interaction
   * motion finishes (`{ "Param83": 0 }` = fade the backlight fully off).
   * Use this for params an interaction motion drives that neither the Idle
   * motion nor physics reset afterwards — otherwise a motion interrupted
   * mid-curve freezes them at a partial value.
   */
  readonly motionEndReset?: Readonly<Record<string, number>>
  /**
   * Parameters cycled continuously while a named expression is active
   * (`{ "ahogeFan": { "param": "Param128", "from": 0, "to": 30,
   * "period": 1 } }` sweeps the fan rotation once per second). An authored
   * expression may turn a prop on but rely on the app to animate it; the
   * curve is a sawtooth from `from` to `to` over `period` seconds.
   */
  readonly expressionCycles?: Readonly<
    Record<string, {
      readonly param: string
      readonly from: number
      readonly to: number
      readonly period: number
    }>
  >
  /**
   * Vertical look origin as a fraction of the window height (0..1). The
   * drag vector that drives ParamAngleY is measured from this line instead
   * of the window center, so a character whose face sits above center
   * tracks the cursor without a downward bias. Defaults to 0.5.
   */
  readonly lookOriginY?: number
  /**
   * How long a tapped expression holds before easing back to neutral, in
   * milliseconds. The official SDK has no hold concept (expressions last
   * until replaced, fading over its 1s DefaultFadeTime); the pet defaults
   * to 9000.
   */
  readonly expressionHoldMs?: number
  /**
   * Idle-state variations: while the pet is idle, activate one of the named
   * expressions for `holdMs` every `everyMs` milliseconds (e.g. Furina's
   * `walkSwitch` walking legs as a second idle stance). Taps override a
   * running variant.
   */
  readonly idleVariants?: {
    readonly expressions?: readonly string[]
    readonly everyMs?: number
    readonly holdMs?: number
  }
  /**
   * Cubism Part ids whose opacity is forced to `0` after `model.update()`.
   * Use this when a prop stays visible at parameter value 0 because it is a
   * separate Part (Furina's "牌子" is `Part187`).
   */
  readonly hideParts?: readonly string[]
  /**
   * Parts to stop pinning while a named expression is active. Furina's
   * `walkSwitch` reveals `Part148` (走路2) for the walking overlay.
   */
  readonly expressionRevealParts?: Readonly<Record<string, readonly string[]>>
  /**
   * Form switch keyed by one Cubism parameter (Furina's `Param4` 变色).
   * The renderer latches the parameter to 1 at boot (pneuma / white).
   * Optional `lowParts` / `highParts` hide the opposite duplicate outfit;
   * omit them when the parameter already recolors the visible meshes.
   */
  readonly outfit?: {
    readonly parameter: string
    readonly lowParts?: readonly string[]
    readonly highParts?: readonly string[]
  }
}

/** Fully validated character document rendered by the shared pet page. */
export interface PetCharacterDocument {
  readonly id: PetCharacterId
  readonly copy: Readonly<Record<PetLocale, PetCopy>>
  readonly palette: PetPalette
  /** Window content size in CSS pixels at scale 1. */
  readonly baseSize: { readonly width: number, readonly height: number }
  /** Live2D asset metadata; the only renderer this engine supports. */
  readonly live2d: PetLive2DDocument
}

/** Error thrown for any character document that fails strict validation. */
export class PetCharacterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PetCharacterError'
  }
}

const MAX_LINE_CHARS = 160
const MIN_LINES = 1
const MAX_LINES = 16
const MIN_WINDOW_PX = 120
const MAX_WINDOW_PX = 720
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u
const LOCALES: readonly PetLocale[] = Object.freeze(['zh', 'en'])
const LIVE2D_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.model3\.json$/u
const LIVE2D_CORE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.js$/u
const DEFAULT_LIVE2D_CORE = 'vendor/live2dcubismcore.min.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length < MIN_LINES || value.length > MAX_LINES) {
    throw new PetCharacterError(`${path} must hold ${MIN_LINES}..${MAX_LINES} lines`)
  }
  return value.map((line, index) => {
    if (typeof line !== 'string' || line.length === 0 || line.length > MAX_LINE_CHARS) {
      throw new PetCharacterError(
        `${path}[${String(index)}] must be a non-empty string of at most ${String(MAX_LINE_CHARS)} characters`,
      )
    }
    return line
  })
}

function hexColor(value: unknown, path: string): string {
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
    throw new PetCharacterError(`${path} must be a #rrggbb color`)
  }
  return value
}

function parseCopy(value: unknown, path: string): PetCopy {
  if (!isObject(value)) throw new PetCharacterError(`${path} must be an object`)
  const label = value.label
  if (typeof label !== 'string' || label.length === 0 || label.length > 32) {
    throw new PetCharacterError(`${path}.label must be a short non-empty string`)
  }
  const lines = value.lines
  if (!isObject(lines)) throw new PetCharacterError(`${path}.lines must be an object`)
  const parsed: Partial<Record<PetLineCategory, readonly string[]>> = {}
  for (const category of PET_LINE_CATEGORIES) {
    parsed[category] = stringArray(lines[category], `${path}.lines.${category}`)
  }
  return { label, lines: parsed as PetLines }
}

/**
 * Validate the Live2D block. Asset names stay relative and rooted so a
 * character document can never point outside its plugin's `assets/live2d/` dir.
 */
function parseLive2D(value: unknown, path: string): PetLive2DDocument {
  if (!isObject(value)) throw new PetCharacterError(`${path} must be an object`)
  const model = value.model
  if (typeof model !== 'string' || !LIVE2D_MODEL_PATTERN.test(model) || model.includes('..')) {
    throw new PetCharacterError(`${path}.model must be a relative *.model3.json asset name`)
  }
  const core = value.core ?? DEFAULT_LIVE2D_CORE
  if (typeof core !== 'string' || !LIVE2D_CORE_PATTERN.test(core) || core.includes('..')) {
    throw new PetCharacterError(`${path}.core must be a relative *.js asset name`)
  }
  let hideParameters: readonly string[] | undefined
  const rawHide = value.hideParameters
  if (rawHide !== undefined && rawHide !== null) {
    if (!Array.isArray(rawHide) || rawHide.some(id => typeof id !== 'string' || id.length === 0)) {
      throw new PetCharacterError(`${path}.hideParameters must be an array of parameter ids`)
    }
    hideParameters = Object.freeze([...rawHide])
  }
  let expressionParameters: Readonly<Record<string, string>> | undefined
  const rawExpressionParameters = value.expressionParameters
  if (rawExpressionParameters !== undefined && rawExpressionParameters !== null) {
    if (!isObject(rawExpressionParameters)) {
      throw new PetCharacterError(`${path}.expressionParameters must be an object`)
    }
    const mappedExpressionParameters: Record<string, string> = {}
    for (const [name, id] of Object.entries(rawExpressionParameters)) {
      if (name.length === 0 || typeof id !== 'string' || id.length === 0) {
        throw new PetCharacterError(`${path}.expressionParameters entries must map non-empty names to parameter ids`)
      }
      mappedExpressionParameters[name] = id
    }
    expressionParameters = Object.freeze(mappedExpressionParameters)
  }
  let tapFallbackGroups: readonly string[] | undefined
  const rawFallback = value.tapFallbackGroups
  if (rawFallback !== undefined && rawFallback !== null) {
    if (!Array.isArray(rawFallback) || rawFallback.some(id => typeof id !== 'string' || id.length === 0)) {
      throw new PetCharacterError(`${path}.tapFallbackGroups must be an array of motion group names`)
    }
    tapFallbackGroups = Object.freeze([...rawFallback])
  }
  let hitAreaMotions: Readonly<Record<string, string>> | undefined
  const rawHitAreaMotions = value.hitAreaMotions
  if (rawHitAreaMotions !== undefined && rawHitAreaMotions !== null) {
    if (!isObject(rawHitAreaMotions)) {
      throw new PetCharacterError(`${path}.hitAreaMotions must be an object`)
    }
    const mappedHitAreaMotions: Record<string, string> = {}
    for (const [name, group] of Object.entries(rawHitAreaMotions)) {
      if (name.length === 0 || typeof group !== 'string' || group.length === 0) {
        throw new PetCharacterError(`${path}.hitAreaMotions entries must map non-empty names to motion groups`)
      }
      mappedHitAreaMotions[name] = group
    }
    hitAreaMotions = Object.freeze(mappedHitAreaMotions)
  }
  let motionEndReset: Readonly<Record<string, number>> | undefined
  const rawEndReset = value.motionEndReset
  if (rawEndReset !== undefined && rawEndReset !== null) {
    if (!isObject(rawEndReset)) {
      throw new PetCharacterError(`${path}.motionEndReset must be an object`)
    }
    const mappedEndReset: Record<string, number> = {}
    for (const [id, num] of Object.entries(rawEndReset)) {
      if (id.length === 0 || typeof num !== 'number' || Number.isNaN(num)) {
        throw new PetCharacterError(`${path}.motionEndReset entries must map non-empty parameter ids to numbers`)
      }
      mappedEndReset[id] = num
    }
    motionEndReset = Object.freeze(mappedEndReset)
  }
  let expressionCycles: PetLive2DDocument['expressionCycles'] | undefined
  const rawCycles = value.expressionCycles
  if (rawCycles !== undefined && rawCycles !== null) {
    if (!isObject(rawCycles)) {
      throw new PetCharacterError(`${path}.expressionCycles must be an object`)
    }
    const mappedCycles: Record<string, {
      param: string, from: number, to: number, period: number
    }> = {}
    for (const [name, cycle] of Object.entries(rawCycles)) {
      if (
        name.length === 0
        || !isObject(cycle)
        || typeof cycle.param !== 'string'
        || cycle.param.length === 0
        || typeof cycle.from !== 'number'
        || typeof cycle.to !== 'number'
        || typeof cycle.period !== 'number'
        || !Number.isFinite(cycle.period)
        || cycle.period <= 0
      ) {
        throw new PetCharacterError(`${path}.expressionCycles.${name || '(empty)'} must map a name to { param, from, to, period > 0 }`)
      }
      mappedCycles[name] = Object.freeze({
        param: cycle.param,
        from: cycle.from,
        to: cycle.to,
        period: cycle.period,
      })
    }
    expressionCycles = Object.freeze(mappedCycles)
  }
  let lookOriginY: number | undefined
  const rawLookOriginY = value.lookOriginY
  if (rawLookOriginY !== undefined && rawLookOriginY !== null) {
    if (typeof rawLookOriginY !== 'number' || !Number.isFinite(rawLookOriginY) || rawLookOriginY < 0 || rawLookOriginY > 1) {
      throw new PetCharacterError(`${path}.lookOriginY must be a number between 0 and 1`)
    }
    lookOriginY = rawLookOriginY
  }
  let expressionHoldMs: number | undefined
  const rawHold = value.expressionHoldMs
  if (rawHold !== undefined && rawHold !== null) {
    if (typeof rawHold !== 'number' || !Number.isFinite(rawHold) || rawHold <= 0) {
      throw new PetCharacterError(`${path}.expressionHoldMs must be a positive number`)
    }
    expressionHoldMs = rawHold
  }
  let idleVariants: PetLive2DDocument['idleVariants'] | undefined
  const rawVariants = value.idleVariants
  if (rawVariants !== undefined && rawVariants !== null) {
    if (!isObject(rawVariants)) {
      throw new PetCharacterError(`${path}.idleVariants must be an object`)
    }
    let expressions: readonly string[] | undefined
    if (rawVariants.expressions !== undefined && rawVariants.expressions !== null) {
      if (!Array.isArray(rawVariants.expressions) || rawVariants.expressions.some(id => typeof id !== 'string' || id.length === 0)) {
        throw new PetCharacterError(`${path}.idleVariants.expressions must be an array of expression names`)
      }
      expressions = Object.freeze([...rawVariants.expressions])
    }
    let everyMs: number | undefined
    if (rawVariants.everyMs !== undefined && rawVariants.everyMs !== null) {
      if (typeof rawVariants.everyMs !== 'number' || !Number.isFinite(rawVariants.everyMs) || rawVariants.everyMs <= 0) {
        throw new PetCharacterError(`${path}.idleVariants.everyMs must be a positive number`)
      }
      everyMs = rawVariants.everyMs
    }
    let holdMs: number | undefined
    if (rawVariants.holdMs !== undefined && rawVariants.holdMs !== null) {
      if (typeof rawVariants.holdMs !== 'number' || !Number.isFinite(rawVariants.holdMs) || rawVariants.holdMs <= 0) {
        throw new PetCharacterError(`${path}.idleVariants.holdMs must be a positive number`)
      }
      holdMs = rawVariants.holdMs
    }
    idleVariants = Object.freeze({
      ...(expressions === undefined ? {} : { expressions }),
      ...(everyMs === undefined ? {} : { everyMs }),
      ...(holdMs === undefined ? {} : { holdMs }),
    })
  }
  let hideParts: readonly string[] | undefined
  const rawParts = value.hideParts
  if (rawParts !== undefined && rawParts !== null) {
    if (!Array.isArray(rawParts) || rawParts.some(id => typeof id !== 'string' || id.length === 0)) {
      throw new PetCharacterError(`${path}.hideParts must be an array of part ids`)
    }
    hideParts = Object.freeze([...rawParts])
  }
  let expressionRevealParts: Readonly<Record<string, readonly string[]>> | undefined
  const rawReveal = value.expressionRevealParts
  if (rawReveal !== undefined && rawReveal !== null) {
    if (!isObject(rawReveal)) {
      throw new PetCharacterError(`${path}.expressionRevealParts must be an object`)
    }
    const mapped: Record<string, readonly string[]> = {}
    for (const [name, ids] of Object.entries(rawReveal)) {
      if (name.length === 0 || !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || id.length === 0)) {
        throw new PetCharacterError(`${path}.expressionRevealParts.${name} must be an array of part ids`)
      }
      mapped[name] = Object.freeze([...ids])
    }
    expressionRevealParts = Object.freeze(mapped)
  }
  let outfit: PetLive2DDocument['outfit'] | undefined
  const rawOutfit = value.outfit
  if (rawOutfit !== undefined && rawOutfit !== null) {
    if (!isObject(rawOutfit) || typeof rawOutfit.parameter !== 'string' || rawOutfit.parameter.length === 0) {
      throw new PetCharacterError(`${path}.outfit.parameter must be a non-empty parameter id`)
    }
    let lowParts: readonly string[] | undefined
    if (rawOutfit.lowParts !== undefined && rawOutfit.lowParts !== null) {
      if (!Array.isArray(rawOutfit.lowParts) || rawOutfit.lowParts.some(id => typeof id !== 'string' || id.length === 0)) {
        throw new PetCharacterError(`${path}.outfit.lowParts must be an array of part ids`)
      }
      lowParts = Object.freeze([...rawOutfit.lowParts])
    }
    let highParts: readonly string[] | undefined
    if (rawOutfit.highParts !== undefined && rawOutfit.highParts !== null) {
      if (!Array.isArray(rawOutfit.highParts) || rawOutfit.highParts.some(id => typeof id !== 'string' || id.length === 0)) {
        throw new PetCharacterError(`${path}.outfit.highParts must be an array of part ids`)
      }
      highParts = Object.freeze([...rawOutfit.highParts])
    }
    outfit = Object.freeze({
      parameter: rawOutfit.parameter,
      ...(lowParts === undefined ? {} : { lowParts }),
      ...(highParts === undefined ? {} : { highParts }),
    })
  }
  return Object.freeze({
    model,
    core,
    ...(hideParameters === undefined ? {} : { hideParameters }),
    ...(expressionParameters === undefined ? {} : { expressionParameters }),
    ...(tapFallbackGroups === undefined ? {} : { tapFallbackGroups }),
    ...(hitAreaMotions === undefined ? {} : { hitAreaMotions }),
    ...(motionEndReset === undefined ? {} : { motionEndReset }),
    ...(expressionCycles === undefined ? {} : { expressionCycles }),
    ...(lookOriginY === undefined ? {} : { lookOriginY }),
    ...(expressionHoldMs === undefined ? {} : { expressionHoldMs }),
    ...(idleVariants === undefined ? {} : { idleVariants }),
    ...(hideParts === undefined ? {} : { hideParts }),
    ...(expressionRevealParts === undefined ? {} : { expressionRevealParts }),
    ...(outfit === undefined ? {} : { outfit }),
  })
}

/**
 * Validate one untrusted character document.
 * @param value - parsed JSON from a pet plugin's character.json asset.
 * @returns a frozen, strictly typed character document.
 * @throws {@link PetCharacterError} when any field is missing or malformed.
 */
export function parsePetCharacterDocument(value: unknown): PetCharacterDocument {
  if (!isObject(value)) throw new PetCharacterError('character document must be an object')
  const id = value.id
  if (id !== 'hutao' && id !== 'furina') {
    throw new PetCharacterError('character document id must be "hutao" or "furina"')
  }
  const copyValue = value.copy
  if (!isObject(copyValue)) throw new PetCharacterError('character document copy must be an object')
  const copy: Partial<Record<PetLocale, PetCopy>> = {}
  for (const locale of LOCALES) {
    copy[locale] = parseCopy(copyValue[locale], `copy.${locale}`)
  }
  const paletteValue = value.palette
  if (!isObject(paletteValue)) throw new PetCharacterError('character document palette must be an object')
  const palette: PetPalette = {
    accent: hexColor(paletteValue.accent, 'palette.accent'),
    bubbleBg: hexColor(paletteValue.bubbleBg, 'palette.bubbleBg'),
    bubbleText: hexColor(paletteValue.bubbleText, 'palette.bubbleText'),
    bubbleBorder: hexColor(paletteValue.bubbleBorder, 'palette.bubbleBorder'),
  }
  const baseSizeValue = value.baseSize
  if (!isObject(baseSizeValue)) throw new PetCharacterError('character document baseSize must be an object')
  const width = baseSizeValue.width
  const height = baseSizeValue.height
  if (typeof width !== 'number' || !Number.isInteger(width) || width < MIN_WINDOW_PX || width > MAX_WINDOW_PX) {
    throw new PetCharacterError(`baseSize.width must be an integer from ${String(MIN_WINDOW_PX)} through ${String(MAX_WINDOW_PX)}`)
  }
  if (typeof height !== 'number' || !Number.isInteger(height) || height < MIN_WINDOW_PX || height > MAX_WINDOW_PX) {
    throw new PetCharacterError(`baseSize.height must be an integer from ${String(MIN_WINDOW_PX)} through ${String(MAX_WINDOW_PX)}`)
  }
  if (value.live2d === undefined) {
    throw new PetCharacterError('character document live2d is required now that the SVG renderer is gone')
  }
  const live2d = parseLive2D(value.live2d, 'live2d')
  return Object.freeze({
    id,
    copy: Object.freeze(copy as Readonly<Record<PetLocale, PetCopy>>),
    palette: Object.freeze(palette),
    baseSize: Object.freeze({ width, height }),
    live2d,
  })
}

/** Pick one line deterministically-ish from a category for a locale. */
export function pickPetLine(
  character: PetCharacterDocument,
  locale: PetLocale,
  category: PetLineCategory,
  random: () => number = Math.random,
): string {
  const lines = character.copy[locale].lines[category]
  const index = lines.length === 1 ? 0 : Math.floor(random() * lines.length)
  const line = lines[Math.min(index, lines.length - 1)]
  return line ?? character.copy[locale].lines[category][0]!
}
