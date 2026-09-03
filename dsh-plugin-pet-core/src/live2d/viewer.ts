/** Official Cubism pet viewer. `fetch` is hooked to the injected asset table first. */

import { CubismFramework, LogLevel, Option } from '@framework/live2dcubismframework'
import { CubismMatrix44 } from '@framework/math/cubismmatrix44'
import { CubismWebGLOffscreenManager } from '@framework/rendering/cubismoffscreenmanager'
import * as LAppDefine from '../../vendor/cubism-sample/lappdefine'
import { LAppModel } from '../../vendor/cubism-sample/lappmodel'
import { LAppPal } from '../../vendor/cubism-sample/lapppal'
import { LAppSubdelegate } from '../../vendor/cubism-sample/lappsubdelegate'
import { installPetAssetFetchHook } from './asset-fetch.ts'
import { PetCubismView } from './view.ts'

const STATE_GROUPS: Record<string, readonly string[]> = {
  idle: ['Idle'], greet: ['Start', 'Idle'], cheer: ['Idle'], sad: ['Sad'],
  pat: ['Pat', 'TapBody'], special: ['Special'], walk: ['Idle'], work: ['Idle'], boot: ['Idle'],
}

const SKIP_EXPRESSIONS: Record<string, true> = {
  signBoard: true, walkSwitch: true, hat: true, genius: true,
}
const TAP_EXPRESSIONS: Record<string, readonly string[]> = {
  face: ['cry', 'blush', 'angry', 'sweat', 'coverMouth', 'chinRest', 'catMouth'],
  hat: ['hat'], ahoge: ['ahogeFan'], leftHand: ['cake', 'spoon', 'drink'], rightHand: ['cake', 'spoon', 'drink'],
  body: ['fish'],
  thigh: ['blush'], calf: ['walkSwitch'], foot: ['star', 'coverMouth', 'sweat'], hair: ['genius'],
}
const PART_REGION: Record<string, string> = {
  Part61: 'face', Part20: 'hat', Part119: 'ahoge', ArtMesh156_Skinning: 'ahoge', ArtMesh156: 'ahoge',
  Part55: 'leftHand', Part11: 'leftHand', Part120: 'rightHand', Part122: 'hand', Part123: 'hand', Part16: 'hand', Part19: 'hair', Part31: 'hair',
  Part104: 'foot', Part107: 'foot', Part162: 'foot', Part106: 'foot', Part97: 'foot', Part100: 'foot', Part105: 'foot', Part98: 'foot', Part99: 'foot',
  Part63: 'body', Part64: 'body', Part83: 'body', Part86: 'body', Part93: 'body', Part109: 'body', Part113: 'body',
  Part110: 'body', Part164: 'body', Part111: 'body', Part112: 'body', Part114: 'body', Part165: 'body', Part115: 'body', Part116: 'body', Part166: 'body',
  ArtMesh196_Skinning: 'body', ArtMesh225_Skinning: 'body', ArtMesh306_Skinning: 'body', ArtMesh472_Skinning: 'body',
  ArtMesh473_Skinning: 'body', ArtMesh474_Skinning: 'body', ArtMesh475_Skinning: 'body', ArtMesh476_Skinning: 'body',
  ArtMesh196: 'body', ArtMesh225: 'body', ArtMesh306: 'body', ArtMesh472: 'body', ArtMesh473: 'body', ArtMesh474: 'body', ArtMesh475: 'body', ArtMesh476: 'body',
  Part173: 'body', Part174: 'body', Part167: 'body', Part169: 'body', Part175: 'body', Part176: 'body', Part168: 'body', Part170: 'body',
  Part94: 'leg', Part101: 'leg', Part89: 'leg', Part102: 'leg', Part95: 'leg', Part103: 'leg', Part96: 'leg',
}
const KNEE_Y = -0.38, ANKLE_Y = -0.58
const TAP_RANK: Record<string, number> = { face: 8, hat: 7, ahoge: 6, leftHand: 5, rightHand: 5, foot: 4, body: 2, thigh: 2, calf: 2, hair: 1 }
interface Live2DSpec {
  model?: string, hideParameters?: readonly string[], hideParts?: readonly string[]
  expressionParameters?: Readonly<Record<string, string>>
  tapFallbackGroups?: readonly string[]
  motionEndReset?: Readonly<Record<string, number>>
  expressionCycles?: Readonly<
    Record<string, {
      param: string, from: number, to: number, period: number
    }>
  >
  lookOriginY?: number
  expressionHoldMs?: number
  idleVariants?: {
    expressions?: readonly string[]
    everyMs?: number
    holdMs?: number
  }
  expressionRevealParts?: Readonly<Record<string, readonly string[]>>, outfit?: { parameter: string }
}

const FORM_EFFECT_PARAMETERS = ['Param174', 'Param175', 'Param176', 'Param177', 'Param178', 'Param179', 'Param180']

interface PetLive2DRuntime {
  ready: boolean
  attach(wrap: HTMLElement, spec: Live2DSpec): Promise<boolean>
  setState(state: string): number, setExpression(name: string | null): void, expressionNames(): string[]
  playMotionGroup(group: string): number, hitTest(nx: number, ny: number): string
  tap(clientX: number, clientY: number): string, setPointer(clientX?: number, clientY?: number): void
  /** True when the cursor is over the model or a short pad around thin meshes. */
  coversPoint(clientX: number, clientY: number): boolean
}

declare global {
  interface Window {
    Live2DCubismCore?: { Moc?: unknown, Model?: unknown, Drawables?: unknown }
    __dshPetLive2DRuntime?: PetLive2DRuntime, __DSH_PET_LIVE2D_STATUS?: string
    __DSH_PET_LIVE2D_ASSETS?: Record<string, string>
  }
}

installPetAssetFetchHook()

let frameworkStarted = false
let raf = 0
let model: LAppModel | undefined
let subdelegate: LAppSubdelegate | undefined
let view = new PetCubismView()
let wrapEl: HTMLElement | undefined
let canvasEl: HTMLCanvasElement | undefined
let hitMotionByName: Record<string, string> = {}
let expressionList: string[] = []
let attachedSpec: Live2DSpec = {}
let ready = false
let formLatch = 1
let formPlaying = false
let formPinTimer = 0
let activeExpression = ''
let expressionWeight = 0
/** Raw 0..1 progress of the expression fade; weight = smootherstep(progress). */
let expressionProgress = 0
let expressionHoldTimer = 0
/**
 * How long a tapped expression stays on before fading back to neutral. The
 * official SDK defines no hold time (expressions last until replaced) and
 * fades over its DefaultFadeTime of 1s; the pet keeps the auto-release but
 * gives the expression a longer moment.
 */
let EXPRESSION_HOLD_MS = 9000
/**
 * Rest-pose snapshot for rigs without an Idle motion. The official sample
 * relies on the looping Idle motion to rewrite the base pose after every
 * interaction; a rig without one would otherwise freeze on the interaction
 * motion's final frame, so the boot parameters are restored when the motion
 * queue empties instead.
 */
let restParameters: number[] | undefined
let restPartOpacities: number[] | undefined
let motionWasPlaying = false
function status(value: string): void {
  window.__DSH_PET_LIVE2D_STATUS = value
}
function startFramework(): void {
  if (frameworkStarted) return
  const core = window.Live2DCubismCore
  if (core === undefined || core.Moc === undefined || core.Model === undefined) {
    throw new Error('cubism core missing')
  }
  const option = new Option()
  option.logFunction = (message: string): void => { console.log(message) }
  option.loggingLevel = LogLevel.LogLevel_Warning
  CubismFramework.startUp(option)
  CubismFramework.initialize()
  frameworkStarted = true
}

function readModelMeta(modelKey: string): void {
  hitMotionByName = {}
  expressionList = []
  const table = window.__DSH_PET_LIVE2D_ASSETS
  const b64 = table?.[modelKey]
  if (b64 === undefined) return
  try {
    const json = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)),
    )) as {
      HitAreas?: Array<{ Name?: string, Motion?: string }>
      FileReferences?: { Expressions?: Array<{ Name?: string }> }
    }
    for (const area of json.HitAreas ?? []) {
      if (area.Name && area.Motion) hitMotionByName[area.Name] = area.Motion
    }
    for (const exp of json.FileReferences?.Expressions ?? []) {
      if (exp.Name && !SKIP_EXPRESSIONS[exp.Name]) expressionList.push(exp.Name)
    }
  } catch {
    hitMotionByName = {}
    expressionList = []
  }
}

function sizeCanvas(canvas: HTMLCanvasElement, wrap: HTMLElement): void {
  const cssW = wrap.clientWidth > 1 ? wrap.clientWidth : window.innerWidth
  const cssH = wrap.clientHeight > 1 ? wrap.clientHeight : window.innerHeight
  if (cssW < 2 || cssH < 2) return
  const dpr = window.devicePixelRatio || 1
  const width = Math.round(cssW * dpr)
  const height = Math.round(cssH * dpr)
  if (canvas.width === width && canvas.height === height) return
  canvas.width = width
  canvas.height = height
}

function clientToView(clientX: number, clientY: number): { x: number, y: number } | undefined {
  if (canvasEl === undefined) return undefined
  const box = canvasEl.getBoundingClientRect()
  if (box.width < 2 || box.height < 2) return undefined
  const deviceX = (clientX - box.left) * (canvasEl.width / box.width)
  const deviceY = (clientY - box.top) * (canvasEl.height / box.height)
  return { x: view.transformViewX(deviceX), y: view.transformViewY(deviceY) }
}

function hitAreaNames(): string[] {
  const setting = (model as unknown as {
    _modelSetting?: { getHitAreasCount(): number, getHitAreaName(i: number): string }
  } | undefined)?._modelSetting
  if (setting === undefined) return []
  const names: string[] = []
  const count = setting.getHitAreasCount()
  for (let i = 0; i < count; i += 1) names.push(setting.getHitAreaName(i))
  return names
}

/**
 * Screen-space bounding boxes of the declared hit areas, scanned on an 8px
 * grid. Cached at attach and refreshed while the model rests; the tap flow
 * expands small boxes by a larger margin so tiny regions stay clickable.
 */
const hitAreaBoxes = new Map<string, [number, number, number, number]>()
let hitAreaBoxesAt = 0

function scanHitAreaBoxes(): void {
  hitAreaBoxes.clear()
  hitAreaBoxesAt = Date.now()
  if (model === undefined || !ready || wrapEl === undefined) return
  const step = 8
  for (let y = 0; y <= wrapEl.clientHeight; y += step) {
    for (let x = 0; x <= wrapEl.clientWidth; x += step) {
      const point = clientToView(x, y)
      if (point === undefined) continue
      for (const name of hitAreaNames()) {
        if (!model.hitTest(name, point.x, point.y)) continue
        const box = hitAreaBoxes.get(name)
        if (box === undefined) hitAreaBoxes.set(name, [x, y, x, y])
        else {
          box[0] = Math.min(box[0], x)
          box[1] = Math.min(box[1], y)
          box[2] = Math.max(box[2], x)
          box[3] = Math.max(box[3], y)
        }
        break
      }
    }
  }
}

/**
 * Expansion margin: small regions grow proportionally more (6..16 px). Kept
 * small on purpose — oversized margins let a tiny area's box swallow its
 * neighbors' taps (the cheeks once stole the eyes).
 */
function hitBoxMargin(box: [number, number, number, number]): number {
  const area = Math.max((box[2] - box[0]) * (box[3] - box[1]), 1)
  return Math.min(16, Math.max(6, Math.round(240 / Math.sqrt(area))))
}

/** Screen-space pad so thin art (hands, hair, feet) still captures the cursor. */
const COVER_PAD_PX = 28
const COVER_PAD_SAMPLES: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [COVER_PAD_PX, 0], [-COVER_PAD_PX, 0],
  [0, COVER_PAD_PX], [0, -COVER_PAD_PX],
  [COVER_PAD_PX, COVER_PAD_PX], [COVER_PAD_PX, -COVER_PAD_PX],
  [-COVER_PAD_PX, COVER_PAD_PX], [-COVER_PAD_PX, -COVER_PAD_PX],
]

function isOnModel(viewX: number, viewY: number): boolean {
  if (model === undefined) return false
  const cubism = model.getModel()
  if (cubism === undefined) return false
  const matrix = model.getModelMatrix()
  const tx = matrix.invertTransformX(viewX)
  const ty = matrix.invertTransformY(viewY)
  const count = cubism.getDrawableCount()
  for (let i = 0; i < count; i++) {
    if (!cubism.getDrawableDynamicFlagIsVisible(i) || cubism.getDrawableOpacity(i) < 0.05) continue
    if (meshHit(cubism, i, tx, ty)) return true
    if (model.isHit(cubism.getDrawableId(i), viewX, viewY)) return true
  }
  return false
}

function coversExpandedHitAreas(clientX: number, clientY: number): boolean {
  if (Date.now() - hitAreaBoxesAt > 3000) scanHitAreaBoxes()
  const px = clientX + 12
  for (const box of hitAreaBoxes.values()) {
    const margin = hitBoxMargin(box) + COVER_PAD_PX
    if (px < box[0] - margin || px > box[2] + margin) continue
    if (clientY < box[1] - margin || clientY > box[3] + margin) continue
    return true
  }
  return false
}

function motionMap(): Map<string, { setLoop(value: boolean): void }> | undefined {
  return (model as unknown as { _motions?: Map<string, { setLoop(value: boolean): void }> })?._motions
}

function configureMotionLoops(): void {
  const motions = motionMap()
  if (motions === undefined) return
  for (const [name, motion] of motions) {
    motion.setLoop(name.startsWith('Idle'))
  }
}

function motionCount(group: string): number {
  const setting = (model as unknown as {
    _modelSetting?: { getMotionCount(group: string): number }
  } | undefined)?._modelSetting
  return setting?.getMotionCount(group) ?? 0
}

function hasFormToggle(): boolean {
  return motionCount('Sad') > 0 && motionCount('Special') > 0
}

function formParameter(): string | undefined {
  return attachedSpec.outfit?.parameter ?? (hasFormToggle() ? 'Param4' : undefined)
}

function restoreFormRestPose(): void {
  const cubism = model?.getModel()
  if (!cubism || !hasFormToggle()) return
  const ids = CubismFramework.getIdManager()
  for (const name of FORM_EFFECT_PARAMETERS) {
    const index = cubism.getParameterIndex(ids.getId(name))
    if (index < 0 || index >= cubism.getParameterCount()) continue
    cubism.setParameterValueByIndex(index, cubism.getParameterDefaultValue(index))
  }
  const parameter = formParameter()
  if (parameter !== undefined) {
    cubism.setParameterValueById(ids.getId(parameter), formLatch)
  }
  cubism.saveParameters()
}

function endFormMotion(): void {
  formPlaying = false
  if (formPinTimer !== 0) {
    clearTimeout(formPinTimer)
    formPinTimer = 0
  }
  restoreFormRestPose()
}

function beginFormMotion(group: string): void {
  formPlaying = true
  formLatch = group === 'Special' ? 1 : 0
  if (formPinTimer !== 0) clearTimeout(formPinTimer)
  formPinTimer = window.setTimeout(endFormMotion, 2500)
}

function playGroup(group: string, priority = LAppDefine.PriorityNormal): number {
  if (model === undefined || !ready) return 0
  const motions = motionMap()
  const key = `${group}_0`
  motions?.get(key)?.setLoop(group === 'Idle')
  const form = hasFormToggle() && (group === 'Sad' || group === 'Special')
  if (form) {
    beginFormMotion(group)
    model.startMotion(group, 0, priority, endFormMotion)
    return 2400
  }
  // Spec-declared parameters (e.g. an interaction motion's glow) are written
  // back when the motion finishes: neither the Idle motion nor physics drive
  // them, so a motion interrupted mid-curve would otherwise freeze them at a
  // partial value and leave a residual effect on screen.
  const endReset = attachedSpec.motionEndReset
  const onMotionFinished = endReset === undefined
    ? undefined
    : (): void => {
        const cubism = model?.getModel()
        if (cubism === undefined) return
        for (const [id, value] of Object.entries(endReset)) setParam(id, value)
        cubism.saveParameters()
      }
  model.startRandomMotion(group, priority, onMotionFinished)
  return group === 'Pat' ? 4300 : 1800
}

function playFirstGroup(groups: readonly string[], priority = LAppDefine.PriorityNormal): number {
  if (model === undefined || !ready) return 0
  const setting = (model as unknown as {
    _modelSetting?: { getMotionCount(group: string): number }
  })._modelSetting
  if (setting === undefined) return 0
  for (const group of groups) {
    if (setting.getMotionCount(group) > 0) return playGroup(group, priority)
  }
  return 0
}

function waitUntilReady(instance: LAppModel, timeoutMs: number): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (instance.isInitialized()) { resolve(); return }
      if (Date.now() - started > timeoutMs) { reject(new Error('model load timed out')); return }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

function setOpacity(partId: string, opacity: number): void {
  model?.getModel()?.setPartOpacityById(CubismFramework.getIdManager().getId(partId), opacity)
}
function setParam(parameterId: string, value: number): void {
  model?.getModel()?.setParameterValueById(CubismFramework.getIdManager().getId(parameterId), value)
}

/** Turn one tapped expression on with an auto-release; empty name clears now. */
function applyTapExpression(name: string): void {
  activeExpression = name
  // A user tap cancels any running idle variant.
  if (variantActive !== undefined) {
    variantActive = undefined
    variantEndAt = 0
    variantNextAt = Date.now() + (attachedSpec.idleVariants?.everyMs ?? 20000)
  }
  if (expressionHoldTimer !== 0) clearTimeout(expressionHoldTimer)
  expressionHoldTimer = 0
  if (name) expressionHoldTimer = window.setTimeout(releaseTapExpression, EXPRESSION_HOLD_MS)
}

function releaseTapExpression(): void {
  if (expressionHoldTimer !== 0) clearTimeout(expressionHoldTimer)
  expressionHoldTimer = 0
  activeExpression = ''
}

/**
 * Idle-state variants (e.g. Furina's walking legs): while the pet idles,
 * activate a spec-declared expression for a few seconds every so often.
 * A user tap cancels the running variant; the cycle restarts afterwards.
 */
let variantEndAt = 0
let variantNextAt = 0
/** The expression the idle variant activated (distinct from tap expressions). */
let variantActive: string | undefined

function pickIdleVariant(): string | undefined {
  const variants = attachedSpec.idleVariants
  const pool = variants?.expressions?.filter(name => name !== activeExpression) ?? []
  if (pool.length === 0) return undefined
  return pool[Math.floor(Math.random() * pool.length)]
}

function variantTick(): void {
  const now = Date.now()
  if (model === undefined || !ready) return
  const variants = attachedSpec.idleVariants
  if (variants === undefined) return
  // A holding variant releases (and eases its expression off) once the hold
  // ends. This branch is time-based only, so the cycle can never deadlock.
  if (variantEndAt !== 0) {
    if (now >= variantEndAt) {
      variantEndAt = 0
      activeExpression = ''
      variantActive = undefined
      variantNextAt = now + (variants.everyMs ?? 20000)
    }
    return
  }
  // A user tap expression owns the face while it lasts.
  if (activeExpression !== '') {
    // Self-heal: a leftover expression with no hold and no variant claim
    // (an interrupted cycle) is released once its activation window passed.
    if (now >= variantNextAt && now >= variantEndAt) activeExpression = ''
    return
  }
  if (now < variantNextAt) return
  const pick = pickIdleVariant()
  if (pick === undefined) return
  variantActive = pick
  variantEndAt = now + (variants.holdMs ?? 8000)
  activeExpression = pick
}

function startVariantTicker(): void {
  variantActive = undefined
  variantNextAt = Date.now() + (attachedSpec.idleVariants?.everyMs ?? 20000)
  variantEndAt = 0
}

function stopVariantTicker(): void {
  variantEndAt = 0
  variantNextAt = 0
  variantActive = undefined
}

/** Ease expressionWeight toward its target each frame so expressions fade. */
function advanceExpressionFade(): void {
  const target = activeExpression === '' ? 0 : 1
  // Ease-in-out over the official DefaultFadeTime (1s each way): hand-to-
  // face expressions (cake/spoon/drink) are two-state deformers in this
  // rig, so the parameter is the only transition there is — a smootherstep
  // curve (zero velocity at both ends) makes the hand glide instead of
  // snapping.
  const duration = target > expressionProgress ? 1.0 : 1.0
  const dt = Math.min(LAppPal.getDeltaTime(), 0.1)
  if (expressionProgress !== target) {
    expressionProgress += Math.sign(target - expressionProgress) * dt / duration
    if (expressionProgress < 0) expressionProgress = 0
    if (expressionProgress > 1) expressionProgress = 1
  }
  const t = expressionProgress
  expressionWeight = t * t * t * (t * (t * 6 - 15) + 10)
}

/** Sawtooth-cycle params declared for the active expression (fan spins etc.). */
function applyExpressionCycles(): void {
  const cycles = attachedSpec.expressionCycles
  if (cycles === undefined) return
  const seconds = performance.now() / 1000
  for (const [name, cycle] of Object.entries(cycles)) {
    if (activeExpression !== name) {
      setParam(cycle.param, cycle.from)
      continue
    }
    const phase = (seconds % cycle.period) / cycle.period
    setParam(cycle.param, cycle.from + (cycle.to - cycle.from) * phase)
  }
}

function applyOverrides(): void {
  for (const name of attachedSpec.hideParameters ?? []) setParam(name, 0)
  // Character-declared expression overlays only: parameter ids are
  // model-specific, so nothing is written without an explicit spec table.
  for (const [name, id] of Object.entries(attachedSpec.expressionParameters ?? {})) {
    setParam(id, name === activeExpression ? expressionWeight : 0)
  }
  applyExpressionCycles()
  const parameter = formParameter()
  if (parameter !== undefined && !formPlaying) setParam(parameter, formLatch)
}
function applyHiddenParts(): void {
  const revealed = attachedSpec.expressionRevealParts?.[activeExpression] ?? []
  for (const name of attachedSpec.hideParts ?? []) {
    if (!revealed.includes(name)) setOpacity(name, 0)
  }
}

function regionOf(handle: { isEqual(name: string): boolean }): string {
  for (const name in PART_REGION) if (handle.isEqual(name)) return PART_REGION[name] ?? ''
  return ''
}
function meshHit(cubism: NonNullable<ReturnType<LAppModel['getModel']>>, index: number, tx: number, ty: number): boolean {
  const vertices = cubism.getDrawableVertices(index)
  const indices = cubism.getDrawableVertexIndices(index)
  const n = cubism.getDrawableVertexIndexCount(index)
  for (let k = 0; k + 2 < n; k += 3) {
    const ia = indices[k] * 2, ib = indices[k + 1] * 2, ic = indices[k + 2] * 2
    const ax = vertices[ia], ay = vertices[ia + 1], bx = vertices[ib], by = vertices[ib + 1], cx = vertices[ic], cy = vertices[ic + 1]
    const den = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (den === 0) continue
    const u = ((tx - ax) * (cy - ay) - (cx - ax) * (ty - ay)) / den
    const v = ((bx - ax) * (ty - ay) - (tx - ax) * (by - ay)) / den
    if (u >= 0 && v >= 0 && u + v <= 1) return true
  }
  return false
}
function classifyIndex(cubism: NonNullable<ReturnType<LAppModel['getModel']>>, index: number, x: number, y: number): string {
  const drawn = regionOf(cubism.getDrawableId(index) as { isEqual(name: string): boolean })
  if (drawn === 'leg') return y <= ANKLE_Y ? 'foot' : y > KNEE_Y ? 'thigh' : 'calf'
  if (drawn === 'hand') return x < 0 ? 'rightHand' : 'leftHand'
  if (drawn) return drawn
  const parents = cubism.getPartParentPartIndices()
  for (let part = cubism.getDrawableParentPartIndex(index), hop = 0; hop < 40 && part >= 0; hop += 1, part = parents[part]) {
    const region = regionOf(cubism.getPartId(part) as { isEqual(name: string): boolean })
    if (region === 'leg') return y <= ANKLE_Y ? 'foot' : y > KNEE_Y ? 'thigh' : 'calf'
    if (region === 'hand') return x < 0 ? 'rightHand' : 'leftHand'
    if (region) return region
  }
  return ''
}
function hitRegion(x: number, y: number): string {
  const cubism = model?.getModel()
  if (!cubism || model === undefined) return ''
  const matrix = model.getModelMatrix()
  const tx = matrix.invertTransformX(x), ty = matrix.invertTransformY(y)
  const n = cubism.getDrawableCount()
  const orders = cubism.getRenderOrders()
  let best = '', rank = -1, orderBest = -1
  for (let i = 0; i < n; i += 1) {
    if (!cubism.getDrawableDynamicFlagIsVisible(i) || cubism.getDrawableOpacity(i) < 0.05) continue
    const region = classifyIndex(cubism, i, x, y)
    if (!region) continue
    const box = (TAP_RANK[region] ?? 0) >= 5
    if (!meshHit(cubism, i, tx, ty) && !(box && model.isHit(cubism.getDrawableId(i), x, y))) continue
    const r = TAP_RANK[region] ?? 0
    const order = orders[i] ?? -1
    if (r > rank || (r === rank && order >= orderBest)) { rank = r; orderBest = order; best = region }
  }
  return best
}

function drawFrame(): void {
  if (model === undefined || subdelegate === undefined || canvasEl === undefined) return
  LAppPal.updateTime()
  const gl = subdelegate.getGl()
  CubismWebGLOffscreenManager.getInstance().beginFrameProcess(gl)
  gl.viewport(0, 0, canvasEl.width, canvasEl.height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  const { width, height } = canvasEl
  const projection = new CubismMatrix44()
  const cubismModel = model.getModel()
  if (cubismModel) {
    if (cubismModel.getCanvasWidth() > 1.0 && width < height) {
      model.getModelMatrix().setWidth(2.0)
      projection.scale(1.0, width / height)
    } else {
      projection.scale(height / width, 1.0)
    }
    projection.multiplyByMatrix(view.getViewMatrix())
  }
  model.update()
  model.draw(projection)
  CubismWebGLOffscreenManager.getInstance().endFrameProcess(gl)
  CubismWebGLOffscreenManager.getInstance().releaseStaleRenderTextures(gl)
}

function loop(): void {
  // The idle-variant lifecycle rides the render loop: setInterval is
  // throttled for this window type, which once froze a variant on forever.
  variantTick()
  drawFrame()
  raf = requestAnimationFrame(loop)
}
function stopLoop(): void { if (raf !== 0) cancelAnimationFrame(raf); raf = 0 }

function releaseModel(): void {
  stopLoop()
  stopVariantTicker()
  endFormMotion()
  formLatch = 1
  releaseTapExpression()
  expressionWeight = 0
  expressionProgress = 0
  model?.release()
  model = undefined
  subdelegate?.release()
  subdelegate = undefined
  ready = false
}

async function attach(wrap: HTMLElement, spec: Live2DSpec): Promise<boolean> {
  if (!spec.model) {
    status('no model')
    return false
  }
  startFramework()
  attachedSpec = spec
  if (spec.expressionHoldMs !== undefined) EXPRESSION_HOLD_MS = spec.expressionHoldMs
  readModelMeta(spec.model)
  // Spec-declared hit-area bindings win over the model file's own table, so
  // entries the model author left unbound can still be wired to motions.
  for (const [name, group] of Object.entries(spec.hitAreaMotions ?? {})) {
    hitMotionByName[name] = group
  }
  releaseModel()
  wrap.querySelectorAll('canvas').forEach(node => node.remove())
  const canvas = document.createElement('canvas')
  sizeCanvas(canvas, wrap)
  wrap.insertBefore(canvas, wrap.firstChild)
  wrapEl = wrap
  canvasEl = canvas
  const next = new LAppSubdelegate()
  if (!next.initialize(canvas)) {
    throw new Error('webgl unavailable')
  }
  subdelegate = next
  view = new PetCubismView()
  view.initialize(canvas.width, canvas.height)
  LAppPal.updateTime()
  const instance = new LAppModel()
  instance.setSubdelegate(next)
  // Fold the viewer's parameter/parts overrides into the model's single
  // per-frame core update (see LAppModel.preCoreUpdateHook).
  instance.preCoreUpdateHook = () => {
    advanceExpressionFade()
    applyOverrides()
    applyHiddenParts()
    // No-Idle rigs: restore the boot rest pose once when the interaction
    // motion empties the queue (the official Idle motion normally does this).
    const manager = (model as unknown as {
      _motionManager?: { isFinished(): boolean }
    } | undefined)?._motionManager
    const motionFinished = manager?.isFinished() ?? true
    if (restParameters !== undefined && motionWasPlaying && motionFinished) {
      const cubism = model.getModel()
      if (cubism) {
        for (let i = 0; i < restParameters.length; i++) {
          cubism.setParameterValueByIndex(i, restParameters[i]!)
        }
        for (let i = 0; i < restPartOpacities!.length; i++) {
          cubism.setPartOpacityByIndex(i, restPartOpacities![i]!)
        }
        // Overwrite the update loop's save/load snapshot so the restored
        // pose survives the next loadParameters().
        cubism.saveParameters()
      }
    }
    motionWasPlaying = !motionFinished
  }
  instance.loadAssets('', spec.model)
  model = instance
  await waitUntilReady(instance, 30000)
  configureMotionLoops()
  // Snapshot the rest pose for rigs without an Idle motion (Hutao: the
  // boot parameters are the artist-authored neutral face and stance).
  {
    const setting = (model as unknown as {
      _modelSetting?: { getMotionCount(group: string): number }
    } | undefined)?._modelSetting
    const cubism = model.getModel()
    if (cubism && (setting?.getMotionCount('Idle') ?? 0) === 0) {
      restParameters = []
      restPartOpacities = []
      for (let i = 0; i < cubism.getParameterCount(); i++) {
        restParameters.push(cubism.getParameterValueByIndex(i))
      }
      for (let i = 0; i < cubism.getPartCount(); i++) {
        restPartOpacities.push(cubism.getPartOpacityByIndex(i))
      }
    } else {
      restParameters = undefined
      restPartOpacities = undefined
    }
    motionWasPlaying = false
  }
  ready = true
  status('ok')
  startVariantTicker()
  loop()
  return true
}

function pickTapExpression(region: string): string {
  const pool = TAP_EXPRESSIONS[region]
  if (!pool || pool.length === 0) return ''
  const others = pool.filter(name => name !== activeExpression)
  if (pool.length === 1 && others.length === 0) return ''
  const choices = others.length > 0 ? others : pool
  return choices[Math.floor(Math.random() * choices.length)] ?? ''
}

const runtime: PetLive2DRuntime = {
  get ready(): boolean { return ready },
  set ready(value: boolean) { ready = value },
  attach,
  setState(state: string): number {
    const groups = STATE_GROUPS[state] ?? ['Idle']
    const priority = state === 'idle' ? LAppDefine.PriorityIdle : LAppDefine.PriorityNormal
    return playFirstGroup(groups, priority)
  },
  setExpression(name: string | null): void {
    if (model === undefined || !ready) return
    applyTapExpression(name ?? '')
  },
  expressionNames(): string[] {
    return expressionList.slice()
  },
  playMotionGroup(group: string): number {
    if (group === 'Special' && hasFormToggle()) {
      return playGroup(formLatch >= 0.5 ? 'Sad' : 'Special', LAppDefine.PriorityForce)
    }
    return playGroup(group, LAppDefine.PriorityForce)
  },
  hitTest(_nx: number, _ny: number): string {
    return ''
  },
  coversPoint(clientX: number, clientY: number): boolean {
    if (model === undefined || !ready) return false
    if (coversExpandedHitAreas(clientX, clientY)) return true
    for (const [dx, dy] of COVER_PAD_SAMPLES) {
      const point = clientToView(clientX + dx, clientY + dy)
      if (point !== undefined && isOnModel(point.x, point.y)) return true
    }
    return false
  },
  tap(clientX: number, clientY: number): string {
    if (model === undefined || !ready) return ''
    const point = clientToView(clientX, clientY)
    if (point === undefined) return ''
    const areas = hitAreaNames()
    const setting = (model as unknown as {
      _modelSetting?: { getMotionCount(group: string): number }
    })._modelSetting
    const hasPlayableMotion = (group: string): boolean =>
      (setting?.getMotionCount(group) ?? 0) > 0
      || (setting?.getMotionCount('Pat') ?? 0) > 0
      || (setting?.getMotionCount('TapBody') ?? 0) > 0
    if (areas.length > 0) {
      for (const name of areas) {
        if (!model.hitTest(name, point.x, point.y)) continue
        const group = hitMotionByName[name] ?? name
        if (name === LAppDefine.HitAreaNameHead) {
          // Curated random face: never leak walkSwitch/signBoard/hat here.
          const pool = expressionList.filter(item => item !== activeExpression)
          const choices = pool.length > 0 ? pool : expressionList
          applyTapExpression(choices[Math.floor(Math.random() * choices.length)] ?? '')
        }
        playFirstGroup([group, 'Pat', 'TapBody'])
        return name
      }
    }
    // Expanded hit boxes: declared areas grow by a margin that scales
    // inversely with their size, so tiny regions stay reachable; when a
    // point lands in several expanded boxes the smallest area wins. Areas
    // without any playable motion are skipped (a dead area must not steal
    // taps from its live neighbors).
    if (Date.now() - hitAreaBoxesAt > 3000) scanHitAreaBoxes()
    let best: { name: string, area: number } | undefined
    for (const [name, box] of hitAreaBoxes) {
      const group = hitMotionByName[name] ?? name
      if (!hasPlayableMotion(group)) continue
      const margin = hitBoxMargin(box)
      // The expanded pass is calibrated 12px to the left: the model's hit
      // geometry sits slightly right of its rendered art in this rig.
      const px = clientX + 12
      if (px < box[0] - margin || px > box[2] + margin) continue
      if (clientY < box[1] - margin || clientY > box[3] + margin) continue
      const area = Math.max((box[2] - box[0]) * (box[3] - box[1]), 1)
      if (best === undefined || area < best.area) best = { name, area }
    }
    if (best !== undefined) {
      playFirstGroup([hitMotionByName[best.name] ?? best.name, 'Pat', 'TapBody'])
      return best.name
    }
    // Character-declared fallback: anywhere else on the model plays one of
    // the listed motion groups at random instead of ignoring the tap.
    if (attachedSpec.tapFallbackGroups?.length && isOnModel(point.x, point.y)) {
      const groups = attachedSpec.tapFallbackGroups.filter(
        group => (setting?.getMotionCount(group) ?? 0) > 0,
      )
      if (groups.length > 0) playGroup(groups[Math.floor(Math.random() * groups.length)]!)
      return 'fallback'
    }
    const region = hitRegion(point.x, point.y)
    const y = point.y.toFixed(2)
    if (!region) return `none::${y}`
    const name = pickTapExpression(region)
    applyTapExpression(name)
    // A region whose pool is exhausted still owes the tap physical feedback.
    if (!name) playFirstGroup(['Pat', 'TapBody'])
    return `${region}:${name || 'off'}:${y}`
  },
  setPointer(clientX?: number, clientY?: number): void {
    if (model === undefined || !ready) return
    if (clientX === undefined || clientY === undefined) {
      model.setDragging(0, 0)
      return
    }
    const point = clientToView(clientX, clientY)
    if (point === undefined) {
      model.setDragging(0, 0)
      return
    }
    // Measure the vertical look vector from the look origin (defaults to the
    // window center): a character whose face sits above center otherwise
    // always aims a little below the cursor.
    let lookY = point.y
    if (wrapEl !== undefined && attachedSpec.lookOriginY !== undefined) {
      const rect = wrapEl.getBoundingClientRect()
      if (rect.height > 2) {
        const originPx = rect.height * attachedSpec.lookOriginY
        lookY = (originPx - clientY) / (rect.height / 2)
      }
    }
    model.setDragging(point.x, lookY)
  },
}

if (window.__dshPetLive2DRuntime === undefined) {
  window.__dshPetLive2DRuntime = runtime
}
window.addEventListener('resize', () => {
  if (wrapEl === undefined || canvasEl === undefined) return
  const beforeW = canvasEl.width, beforeH = canvasEl.height
  sizeCanvas(canvasEl, wrapEl)
  if (canvasEl.width !== beforeW || canvasEl.height !== beforeH) view.initialize(canvasEl.width, canvasEl.height)
})
