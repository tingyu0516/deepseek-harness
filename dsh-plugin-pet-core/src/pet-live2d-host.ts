/** Host-side Live2D runtime: inject Cubism Core plus the renderer glue page-side. */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { posix, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PET_LIVE2D_PHYSICS_SOURCE } from './pet-live2d-physics.ts'

const ASSET_EXTENSIONS = new Set([
  '.model3.json', '.moc3', '.physics3.json', '.cdi3.json',
  '.exp3.json', '.motion3.json', '.png', '.jpg', '.jpeg',
])
/** Files irrelevant to rendering. */
const SKIPPED_NAMES = new Set(['LICENSE-MODEL.md'])
const SKIPPED_DIRS = new Set(['vendor'])
/** Split base64 payloads across several evaluations to stay far below the
 * message-size range where Electron IPC gets fragile. */
const CHUNK_CHARS = 4 * 1024 * 1024

export interface PetLive2DAssetChunk {
  /** Forward-slash path relative to the asset directory (matches model refs). */
  readonly key: string
  readonly part: number
  readonly parts: number
  readonly data: string
}

function* walkAssets(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}${sep}${entry}`
    const stats = statSync(full)
    if (stats.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry)) yield* walkAssets(full)
      continue
    }
    if (SKIPPED_NAMES.has(entry)) continue
    // Compound Cubism suffixes (.model3.json/.motion3.json/...) rule out a
    // naive "extension after the last dot" comparison.
    const lower = entry.toLowerCase()
    let matched = false
    for (const ext of ASSET_EXTENSIONS) {
      if (lower.endsWith(ext)) {
        matched = true
        break
      }
    }
    if (matched) yield full
  }
}

/**
 * Read every whitelisted Live2D asset under `dir` and cut them into
 * base64 chunks for in-page delivery. Ordered deterministically so repeated
 * boots behave identically.
 */
export function collectPetLive2DAssetChunks(dir: string): PetLive2DAssetChunk[] {
  const root = fileURLToPath(dir.startsWith('file:') ? dir : `file:///${dir.replace(/\\/gu, '/')}`)
  const chunks: PetLive2DAssetChunk[] = []
  const keys: string[] = []
  const contents: string[] = []
  for (const full of walkAssets(root)) {
    keys.push(posix.join(...full.slice(root.length).split(sep)))
    contents.push(readFileSync(full).toString('base64'))
  }
  const order = keys.map((key, index) => ({ key, index })).sort((a, b) => a.key.localeCompare(b.key))
  for (const { key, index } of order) {
    const b64 = contents[index]!
    const parts = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS))
    for (let part = 0; part < parts; part += 1) {
      chunks.push({ key, part, parts, data: b64.slice(part * CHUNK_CHARS, (part + 1) * CHUNK_CHARS) })
    }
  }
  return chunks
}

/** Evaluate-ready JS statement appending one chunk into the page-side stash.
 *  Ends with `void 0` so executeJavaScript has no multi-megabyte completion
 *  value to structured-clone back over IPC. */
export function petLive2DChunkStatement(chunk: PetLive2DAssetChunk): string {
  const key = JSON.stringify(chunk.key)
  return `(window.__DSH_PET_LIVE2D_PARTS ??= {})[${key}] ??= [];`
    + `window.__DSH_PET_LIVE2D_PARTS[${key}][${String(chunk.part)}]=${JSON.stringify(chunk.data)};void 0;`
}

/** Finalize statement folding the part stash into the resolved asset table. */
export function petLive2DFinalizeStatement(): string {
  return '(window.__DSH_PET_LIVE2D_ASSETS = Object.fromEntries('
    + 'Object.entries(window.__DSH_PET_LIVE2D_PARTS ?? {})'
    + '.map(([k, v]) => [k, v.join("")])));'
    + 'delete window.__DSH_PET_LIVE2D_PARTS;'
}

/**
 * Renderer glue evaluated inside the sandboxed pet page *after* the Cubism
 * Core script and the asset table. It installs `window.__dshPetLive2DRuntime`,
 * which renders the declared model onto a WebGL canvas from the in-memory
 * asset table — no network stack at all, so nothing can be blocked by the
 * sandboxed renderer's file:// restrictions.
 *
 * Vertices from Cubism Core are origin-relative units (pixel / PixelsPerUnit).
 * The glue maps that unit canvas onto NDC; it must not subtract CanvasOrigin
 * pixel values or the mesh collapses off-screen. UVs flip V like the official
 * WebGL renderer. Clipping masks render to an offscreen buffer, then gate the
 * clipped drawable. Idle motions loop; other states fall back to Idle.
 * physics3.json runs after motion and before `model.update()`.
 * `outfit.parameter` is latched (boot = 1) every frame unless a one-shot
 * form motion is driving that curve. Audio is not played.
 */

export const PET_LIVE2D_RUNTIME_GLUE = `(function () {
'use strict';
if (window.__dshPetLive2DRuntime) return;
var CORE = window.Live2DCubismCore;
if (!CORE || !CORE.Moc || !CORE.Model || !CORE.Drawables) { window.__DSH_PET_LIVE2D_STATUS = 'cubism core missing'; return; }
var rt = {
  ready: false,
  canvas: null,
  gl: null,
  moc: null,
  model: null,
  textures: [],
  program: null,
  loc: {},
  posBuffer: null,
  maskFbo: null,
  maskTex: null,
  spanPxX: 0,
  spanPxY: 0,
  originX: 0,
  originY: 0,
  drawables: [],
  renderPlan: [],
  paramIndex: {},
  hiddenIndexes: [],
  hiddenPartIndexes: [],
  motions: {},
  activeMotion: null,
  activeStart: 0,
  elapsed: 0,
  loopMotion: false,
  expressions: {},
  activeExpression: null,
  activeExpressionName: '',
  activeOps: [],
  expressionBaseline: null,
  motionBaseline: null,
  expressionRevealParts: {},
  hitById: {},
  lookX: 0,
  lookY: 0,
  lookTX: 0,
  lookTY: 0,
  angleXIndex: -1,
  angleYIndex: -1,
  eyeXIndex: -1,
  eyeYIndex: -1,
  breathIndex: -1,
  angleZIndex: -1,
  physics: null,
  outfitParamIndex: -1,
  outfitParamId: '',
  outfitLatched: 1,
  /* Smooth form crossfade: current white-form weight in [0,1], eased toward
     the latch every frame. Replaces the old live-value threshold whose two
     switching points left a naked stretch mid-transition. */
  outfitBlend: 1,
  outfitLowIndexes: [],
  outfitHighIndexes: [],
  outfitLowDrawables: [],
  outfitHighDrawables: [],
  costumeForced: null,
  themeForceLow: true,
  themeForceHigh: true,
  queuedState: '',
  queuedExpression: null,
  hasQueuedExpression: false,
  eyeLOpenIndex: -1,
  eyeROpenIndex: -1,
  blinkTimer: 2,
  blinkPhase: 0
};
var STATE_GROUPS = {
  greet: ['Start', 'Greet', 'Tap2', 'Hello'],
  idle: ['Idle'],
  work: ['Work'],
  cheer: ['Cheer', 'Tap3'],
  sad: ['Sad', 'Tap6'],
  pat: ['Pat', 'Tap1', 'Tap3', 'Tap5', 'Tap6'],
  special: ['Special', 'Tap4'],
  walk: ['Walk']
};

function setStatus(ok, info) {
  window.__DSH_PET_LIVE2D_STATUS = ok
    ? (info ? ('ready; ' + info) : 'ready')
    : String(info || 'failed');
}
function drawableVisible(flags) {
  try { if (CORE.Utils && CORE.Utils.hasIsVisibleBit) return CORE.Utils.hasIsVisibleBit(flags); }
  catch (e) { /* fall through to the documented bit 0 */ }
  return (flags & 1) === 1;
}
function fail(reason) {
  rt.ready = false;
  try { if (rt.canvas && rt.canvas.parentNode) rt.canvas.parentNode.removeChild(rt.canvas); } catch (e) { /* detached */ }
  setStatus(false, reason);
}
function asset(key) {
  var table = window.__DSH_PET_LIVE2D_ASSETS;
  var entry = table ? table[key] : undefined;
  if (typeof entry !== 'string') throw new Error('asset missing: ' + key);
  return entry;
}
function assetBytes(key) {
  var raw = atob(asset(key));
  var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
function assetJson(key) {
  try { return JSON.parse(new TextDecoder().decode(assetBytes(key))); }
  catch (e) { throw new Error('bad json: ' + key); }
}
/* Resolve refs relative to the directory holding the model entry. */
function resolveRel(modelKey, rel) {
  var parts = modelKey.split('/').slice(0, -1);
  var segs = String(rel).split('\\\\').join('/').split('/');
  for (var i = 0; i < segs.length; i += 1) {
    var seg = segs[i];
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function buildProgram(gl) {
  function shader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(String(gl.getShaderInfoLog(s)));
    return s;
  }
  var p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER,
    'attribute vec2 aPos; attribute vec2 aUV;' +
    'uniform vec2 uCenterPx; uniform vec2 uScale;' +
    'varying vec2 vUV; varying vec2 vPos;' +
    'void main(){ vUV=vec2(aUV.x,1.0-aUV.y); vec2 ndc=(aPos-uCenterPx)*uScale; vPos=ndc*0.5+0.5; gl_Position=vec4(ndc,0.0,1.0); }'));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER,
    'precision mediump float; varying vec2 vUV; varying vec2 vPos;' +
    'uniform sampler2D uTex; uniform sampler2D uMask;' +
    'uniform float uAlpha; uniform float uMode; uniform vec3 uMul; uniform vec3 uScr;' +
    'void main(){ vec4 c=texture2D(uTex,vUV); c.rgb=c.rgb*uMul+(uScr*c.a)-(c.rgb*uScr);' +
    'if(uMode>2.5){ float a=c.a*uAlpha; gl_FragColor=vec4(a,a,a,a); return; }' +
    'float m=1.0; if(uMode>0.5){ m=1.0-texture2D(uMask,vPos).r; if(uMode>1.5) m=1.0-m; }' +
    'float a=c.a*uAlpha*m; gl_FragColor=vec4(c.rgb*a,a); }'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(String(gl.getProgramInfoLog(p)));
  return p;
}

/* motion3.json curve sampling over the flat segment list:
   linear [0,t,v] step [2,t,v] bezier [1,x1,y1,x2,y2,t,v] inverse-step [3]. */
function sampleSegments(segs, t) {
  var lt = segs[0];
  var lv = segs[1];
  var i = 2;
  if (t <= lt || segs.length < 3) return lv;
  while (i < segs.length) {
    var type = segs[i];
    var nt = 0;
    var nv = 0;
    var adv = 3;
    if (type === 3) return lv;
    if (type === 1) {
      adv = 7;
      if (i + 6 >= segs.length) break;
      nt = segs[i + 5];
      nv = segs[i + 6];
    } else {
      if (i + 2 >= segs.length) break;
      nt = segs[i + 1];
      nv = segs[i + 2];
    }
    if (t >= nt) {
      lt = nt;
      lv = nv;
      i += adv;
      continue;
    }
    if (type === 2) return lv;
    if (type !== 1) return lv + (nv - lv) * ((t - lt) / (nt - lt));
    // Restricted Beziers (Cubism 3+): control points are in time/value space,
    // not the unit square. Sampling x as 0..1 against absolute t collapses
    // every curve toward the wrong keyform (disconnected coat, stuck legs).
    var x1 = segs[i + 1];
    var y1 = segs[i + 2];
    var x2 = segs[i + 3];
    var y2 = segs[i + 4];
    var lo = 0;
    var hi = 1;
    var u = 0.5;
    var k;
    for (k = 0; k < 20; k += 1) {
      u = (lo + hi) / 2;
      var omu = 1 - u;
      var xu = omu * omu * omu * lt + 3 * omu * omu * u * x1 + 3 * omu * u * u * x2 + u * u * u * nt;
      if (xu < t) lo = u; else hi = u;
    }
    var om = 1 - u;
    return om * om * om * lv + 3 * om * om * u * y1 + 3 * om * u * u * y2 + u * u * u * nv;
  }
  return lv;
}

function applyIdle(dt) {
  rt.elapsed += dt;
  var values = rt.model.parameters.values;
  if (rt.breathIndex >= 0) values[rt.breathIndex] = Math.sin(rt.elapsed * 2.4) * 0.5 + 0.5;
  if (rt.angleZIndex >= 0) values[rt.angleZIndex] = Math.sin(rt.elapsed * 0.9) * 3;
}
function applyBlink(dt) {
  if (rt.eyeLOpenIndex < 0 && rt.eyeROpenIndex < 0) return;
  rt.blinkTimer -= dt;
  var v = 1;
  if (rt.blinkPhase === 0) {
    if (rt.blinkTimer <= 0) { rt.blinkPhase = 1; rt.blinkTimer = 0.07; }
  } else if (rt.blinkPhase === 1) {
    v = Math.max(0, rt.blinkTimer / 0.07);
    if (rt.blinkTimer <= 0) { rt.blinkPhase = 2; rt.blinkTimer = 0.04; }
  } else if (rt.blinkPhase === 2) {
    v = 0;
    if (rt.blinkTimer <= 0) { rt.blinkPhase = 3; rt.blinkTimer = 0.09; }
  } else {
    v = 1 - Math.max(0, rt.blinkTimer / 0.09);
    if (rt.blinkTimer <= 0) {
      rt.blinkPhase = 0;
      rt.blinkTimer = 2.2 + Math.random() * 3.4;
    }
  }
  var values = rt.model.parameters.values;
  if (rt.eyeLOpenIndex >= 0) values[rt.eyeLOpenIndex] = v;
  if (rt.eyeROpenIndex >= 0) values[rt.eyeROpenIndex] = v;
}

function playGroup(names, loop) {
  var valid = [];
  for (var gi = 0; gi < names.length; gi += 1) {
    var defs = rt.motions[names[gi]];
    if (!defs) continue;
    for (var di = 0; di < defs.length; di += 1) {
      if (defs[di]) valid.push(defs[di]);
    }
  }
  if (!valid.length) return false;
  if (rt.activeMotion && !rt.loopMotion) restoreMotionBaseline(-1);
  rt.activeMotion = valid[Math.floor(Math.random() * valid.length)];
  rt.activeStart = rt.elapsed;
  rt.loopMotion = !!loop;
  rt.motionBaseline = (!loop && rt.activeMotion) ? captureMotionBaseline(rt.activeMotion) : null;
  return true;
}
/* One-shot motions must not leak their final frame: capture the pre-motion
   values and put every driven parameter back when it ends (the outfit param
   is exempted so the 芒↔荒 form latch survives). */
function captureMotionBaseline(motion) {
  var baseline = {};
  if (!motion) return baseline;
  var curves = motion.Curves || [];
  var values = rt.model.parameters.values;
  for (var i = 0; i < curves.length; i += 1) {
    var c = curves[i];
    if (!c || c.Target !== 'Parameter') continue;
    var idx = rt.paramIndex[c.Id];
    if (idx === undefined || idx < 0) continue;
    if (!(idx in baseline)) baseline[idx] = values[idx];
  }
  return baseline;
}
function restoreMotionBaseline(skipIndex) {
  var baseline = rt.motionBaseline;
  if (!baseline) return;
  var values = rt.model.parameters.values;
  for (var k in baseline) {
    if (Number(k) === skipIndex) continue;
    values[k] = baseline[k];
  }
  rt.motionBaseline = null;
}
function motionDurationMs() {
  if (rt.loopMotion) return 0;
  var meta = rt.activeMotion && rt.activeMotion.Meta;
  var sec = meta && meta.Duration ? meta.Duration : 0;
  return sec > 0 ? Math.round(sec * 1000) + 250 : 0;
}
function applyMotionAt(motion, t) {
  var curves = motion.Curves || [];
  for (var i = 0; i < curves.length; i += 1) {
    var curve = curves[i];
    if (curve.Target !== 'Parameter') continue;
    var idx = rt.paramIndex[curve.Id];
    if (idx === undefined || idx < 0) continue;
    rt.model.parameters.values[idx] = sampleSegments(curve.Segments, t);
  }
}
/* Form switching follows the author's own design (archive readme: 「2 个形态，
   通过动画按键切换」, VTS hotkeys = plain motions that persist their last
   frame). Form visuals are OWNED BY THE ENGINE LAYER: Param4 stays pinned to
   the latch, and rt.outfitBlend eases the white-form weight so both costume
   lists crossfade continuously (the old live-value threshold left a naked
   stretch between the sides' different switching points). */
function outfitDrivenByMotion(motion) {
  if (!motion || !rt.outfitParamId) return false;
  var curves = motion.Curves || [];
  for (var i = 0; i < curves.length; i += 1) {
    if (curves[i].Target === 'Parameter' && curves[i].Id === rt.outfitParamId) return true;
  }
  return false;
}
/* Ease the white-form weight toward the latch. Exponential smoothing keeps
   the fade frame-rate independent; a ~160ms tau lands near 450ms visually. */
function advanceOutfitBlend(dtMs) {
  if (rt.outfitParamIndex < 0) return;
  var target = rt.outfitLatched >= 0.5 ? 1 : 0;
  var k = Math.min(1, Math.max(0.001, dtMs / 160));
  var next = rt.outfitBlend + (target - rt.outfitBlend) * k;
  if (Math.abs(target - next) < 0.002) next = target;
  rt.outfitBlend = next;
}
/* Kill any running outfit-driven one-shot before flipping forms: otherwise
   its tail frames keep re-writing Param4 after the flip and its end-of-motion
   snapshot silently reverts the latch (a second quick double-click used to
   vanish exactly this way). */
function abandonOutfitMotion() {
  if (!rt.activeMotion || rt.loopMotion || !outfitDrivenByMotion(rt.activeMotion)) return;
  restoreMotionBaseline(rt.outfitParamIndex >= 0 ? rt.outfitParamIndex : -1);
  rt.activeMotion = null;
}
function pinOutfitParam() {
  if (rt.outfitParamIndex < 0) return;
  // No yielding: the motion's own Param4 curve would fight the blend layer,
  // so every frame pins the switch parameter to the latched form instead.
  rt.model.parameters.values[rt.outfitParamIndex] = rt.outfitLatched;
}
function startIdleMotion() {
  playGroup(['Idle'], true);
}
function applyState(name) {
  if (name === 'idle') {
    startIdleMotion();
    return motionDurationMs();
  }
  var groups = STATE_GROUPS[name] || [];
  if (!playGroup(groups, false)) startIdleMotion();
  return motionDurationMs();
}
function flushQueuedRuntime() {
  if (rt.hasQueuedExpression) {
    setExpressionInternal(rt.queuedExpression || '');
    rt.hasQueuedExpression = false;
    rt.queuedExpression = null;
  }
  if (rt.queuedState) {
    applyState(rt.queuedState);
    rt.queuedState = '';
  }
}
function advanceMotion() {
  if (!rt.activeMotion) return;
  var meta = rt.activeMotion.Meta || {};
  var duration = meta.Duration || 0;
  var t = rt.elapsed - rt.activeStart;
  if (duration > 0 && t > duration) {
    if (rt.loopMotion) {
      rt.activeStart += duration * Math.floor(t / duration);
      t = rt.elapsed - rt.activeStart;
    } else {
      applyMotionAt(rt.activeMotion, duration);
      restoreMotionBaseline(rt.outfitParamIndex >= 0 ? rt.outfitParamIndex : -1);
      rt.activeMotion = null;
      startIdleMotion();
      return;
    }
  }
  applyMotionAt(rt.activeMotion, t);
}

function applyLookAt() {
  rt.lookX += (rt.lookTX - rt.lookX) * 0.14;
  rt.lookY += (rt.lookTY - rt.lookY) * 0.14;
  var values = rt.model.parameters.values;
  if (rt.angleXIndex >= 0) values[rt.angleXIndex] = rt.lookX * 16;
  if (rt.angleYIndex >= 0) values[rt.angleYIndex] = rt.lookY * 12;
  if (rt.eyeXIndex >= 0) values[rt.eyeXIndex] = rt.lookX;
  if (rt.eyeYIndex >= 0) values[rt.eyeYIndex] = rt.lookY;
}
/* Expressions re-derive from a captured baseline every frame. Accumulating
   Add blends in place would push switch parameters to thousands within a
   minute of idling; restoring the baseline on switch/clear also guarantees
   no residue leaks into the next pose or expression. */
function restoreExpressionBaseline() {
  var b = rt.expressionBaseline;
  if (!b) return;
  var values = rt.model.parameters.values;
  for (var k in b) values[k] = b[k];
  rt.expressionBaseline = null;
  rt.activeOps = [];
}
function setExpressionInternal(name) {
  restoreExpressionBaseline();
  rt.activeExpression = null;
  rt.activeExpressionName = '';
  if (!name || !rt.expressions[name]) return;
  var exp = rt.expressions[name];
  var params = exp.Parameters || [];
  var baseline = {};
  var values = rt.model.parameters.values;
  for (var i = 0; i < params.length; i += 1) {
    var p = params[i];
    if (!p || !p.Id) continue;
    var idx = rt.paramIndex[p.Id];
    if (idx === undefined || idx < 0) continue;
    if (!(idx in baseline)) baseline[idx] = values[idx];
  }
  rt.expressionBaseline = baseline;
  rt.activeOps = params.filter(function (p) {
    return p && p.Id && rt.paramIndex[p.Id] !== undefined && typeof p.Value === 'number';
  });
  rt.activeExpression = exp;
  rt.activeExpressionName = name;
}
function applyExpression() {
  var base = rt.expressionBaseline;
  if (!base) return;
  var values = rt.model.parameters.values;
  for (var i = 0; i < rt.activeOps.length; i += 1) {
    var p = rt.activeOps[i];
    var idx = rt.paramIndex[p.Id];
    var v = p.Value;
    var blend = p.Blend;
    if (blend === 'Multiply') values[idx] = base[idx] * v;
    else values[idx] = v;
  }
}

${PET_LIVE2D_PHYSICS_SOURCE}

function applyPhysics(dt) {
  if (!rt.physics) return;
  try { evaluatePhysics(rt.physics, rt.model, dt); }
  catch (e) { rt.physics = null; }
}

function startLoop() {
  var last = performance.now();
  function frame(now) {
    if (!rt.ready) return;
    var dt = Math.min((now - last) / 1000, 0.06);
    last = now;
    applyIdle(dt);
    advanceMotion();
    advanceOutfitBlend(dt * 1000);
    applyLookAt();
    applyPhysics(dt);
    pinOutfitParam();
    applyExpression();
    applyBlink(dt);
    try { drawFrame(); } catch (e) {
      fail('draw failed: ' + e);
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function combinedOpacity(i) {
  var dr = rt.model.drawables;
  var a = dr.opacities[i];
  var parts = rt.model.parts;
  if (!parts || !parts.opacities) return a;
  var p = dr.parentPartIndices ? dr.parentPartIndices[i] : -1;
  var parents = parts.parentIndices;
  var guard = 0;
  while (p >= 0 && guard < 24) {
    a *= parts.opacities[p];
    p = parents ? parents[p] : -1;
    guard += 1;
  }
  return a;
}

function pinHiddenParams() {
  var values = rt.model.parameters.values;
  var hidden = rt.hiddenIndexes;
  for (var h = 0; h < hidden.length; h += 1) values[hidden[h]] = 0;
}
function pinHiddenParts() {
  var parts = rt.model.parts;
  var hp = rt.hiddenPartIndexes;
  if (!parts || !parts.opacities) return;
  var reveal = {};
  var name = rt.activeExpressionName;
  var listed = name && rt.expressionRevealParts ? rt.expressionRevealParts[name] : undefined;
  if (listed) {
    for (var r = 0; r < listed.length; r += 1) reveal[listed[r]] = true;
  }
  var partIds = parts.ids;
  for (var p = 0; p < hp.length; p += 1) {
    var idx = hp[p];
    if (partIds && reveal[partIds[idx]]) continue;
    parts.opacities[idx] = 0;
  }
  // walkSwitch has no drawable keyforms (Param12 is a no-op); revealing the
  // hideParts entry means writing opacity 1 after update, every frame.
  if (listed) {
    var revealIdx = indexesOfParts(listed);
    for (var ri = 0; ri < revealIdx.length; ri += 1) parts.opacities[revealIdx[ri]] = 1;
  }
  pinOutfitParts();
}
function pinOutfitParts() {
  if (rt.outfitParamIndex < 0) return;
  var parts = rt.model.parts;
  if (!parts || !parts.opacities) return;
  // Twin-diagnostic proof: this asset ships NO parameter keyforms for the
  // costume part opacities, so anything we write sticks forever. Both sides
  // are therefore written EVERY frame as continuous weights from
  // rt.outfitBlend (white weight): a real crossfade with no naked stretch.
  var whiteW = rt.outfitBlend >= 1 ? 1 : (rt.outfitBlend <= 0 ? 0 : rt.outfitBlend);
  var lows = rt.outfitLowIndexes;
  var highs = rt.outfitHighIndexes;
  for (var i = 0; i < lows.length; i += 1) {
    if (whiteW < 1 && rt.hiddenPartIndexes.indexOf(lows[i]) >= 0) continue;
    parts.opacities[lows[i]] = 1 - whiteW;
  }
  for (var j = 0; j < highs.length; j += 1) {
    if (rt.hiddenPartIndexes.indexOf(highs[j]) >= 0) continue;
    parts.opacities[highs[j]] = whiteW;
  }
}
function indexesOfParts(ids) {
  var out = [];
  var partIds = rt.model.parts && rt.model.parts.ids;
  if (!partIds || !ids) return out;
  for (var i = 0; i < ids.length; i += 1) {
    for (var j = 0; j < partIds.length; j += 1) {
      if (partIds[j] === ids[i]) out.push(j);
    }
  }
  return out;
}
/* Drawable children of the given parts, via the core's per-drawable single
   parent link (field name verified at runtime: parentPartIndices). */
function drawablesOfParts(partIdxList) {
  var out = [];
  var drs = rt.model.drawables;
  if (!drs || !drs.count || !drs.parentPartIndices) return out;
  for (var d = 0; d < drs.count; d += 1) {
    if (partIdxList.indexOf(drs.parentPartIndices[d]) >= 0) out.push(d);
  }
  return out;
}
/* Rebuild the forced-alive table after a latch flip. Only sides classified
   as natively DEAD by detectThemeManagement get forced; a managed side must
   keep moc-owned per-pose opacity orchestration or authored layer-avoidance
   (skirt vs legs) gets flattened into z-fights. */
function refreshCostumeForce() {
  var count = rt.model && rt.model.drawables && rt.model.drawables.count;
  if (!count) { rt.costumeForced = null; return; }
  var forced = new Uint8Array(count);
  if (rt.themeForceHigh !== false) {
    var hi = rt.outfitHighDrawables;
    for (var i = 0; i < hi.length; i += 1) forced[hi[i]] = 1;
  }
  if (rt.themeForceLow !== false) {
    var lo = rt.outfitLowDrawables;
    for (var j = 0; j < lo.length; j += 1) forced[lo[j]] = 1;
  }
  rt.costumeForced = forced;
}
function enforceCostumeDrawables() {
  var drs = rt.model.drawables;
  if (!rt.costumeForced || !drs || !drs.opacities) return;
  // The moc leaves these values unmanaged in this asset, so whatever it
  // wrote during update is garbage ONLY for the dead-theme side; managed
  // sides keep their evaluated values untouched.
  if (rt.themeForceLow !== false) {
    var lo = rt.outfitLowDrawables;
    for (var j = 0; j < lo.length; j += 1) drs.opacities[lo[j]] = 1;
  }
  if (rt.themeForceHigh !== false) {
    var hi = rt.outfitHighDrawables;
    for (var i = 0; i < hi.length; i += 1) drs.opacities[hi[i]] = 1;
  }
}
function meshForced(i) {
  return rt.costumeForced && rt.costumeForced[i] === 1;
}
/* One-shot classification: clone this moc with default parameters and
   measure whether each costume side's drawables come out alive on their own
   form's parameter value. Dead sides need engine forcing forever; alive
   sides must stay moc-managed to preserve pose-dependent ordering. */
function detectThemeManagement() {
  try {
    var CORE = window.Live2DCubismCore;
    var b64 = window.__DSH_PET_LIVE2D_ASSETS && window.__DSH_PET_LIVE2D_ASSETS['芙宁娜.moc3'];
    if (!CORE || !b64 || !rt.model) return;
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var bi = 0; bi < bin.length; bi += 1) bytes[bi] = bin.charCodeAt(bi);
    var probe = new CORE.Model(CORE.Moc.fromArrayBuffer(bytes.buffer));
    function sideAlive(drawableIdxList, p4Value) {
      var p4Idx = rt.paramIndex.Param4;
      if (p4Idx !== undefined && p4Idx >= 0) probe.parameters.values[p4Idx] = p4Value;
      probe.update();
      var aliveCount = 0;
      var total = drawableIdxList.length;
      for (var di = 0; di < total; di += 1) {
        var idx = drawableIdxList[di];
        var op = probe.drawables.opacities[idx];
        var vis = drawableVisible(probe.drawables.dynamicFlags ? probe.drawables.dynamicFlags[idx] : 0);
        // Majority vote, not max: stray keyed strays (glove variants at the
        // opposite form value) must not resurrect a theme-dead side.
        if ((op > 0.35 && vis) || op > 0.7) aliveCount += 1;
      }
      return { aliveCount: aliveCount, total: total,
        fraction: total > 0 ? Math.round((aliveCount / total) * 100) / 100 : 0 };
    }
    var lowState = sideAlive(rt.outfitLowDrawables, 0);
    var highState = sideAlive(rt.outfitHighDrawables, 1);
    // Alive => moc manages that side; leave it alone. Any doubt => force.
    var aliveThreshold = 0.6;
    rt.themeForceLow = lowState.fraction < aliveThreshold;
    rt.themeForceHigh = highState.fraction < aliveThreshold;
    window.__DSH_PET_THEME_DIAG = 'black alive=' + lowState.fraction
      + ' (' + lowState.aliveCount + '/' + lowState.total + ') force=' + rt.themeForceLow
      + ' | white alive=' + highState.fraction
      + ' (' + highState.aliveCount + '/' + highState.total + ') force=' + rt.themeForceHigh;
    if (typeof setStatus === 'function') setStatus(true, 'theme ' + window.__DSH_PET_THEME_DIAG);
    refreshCostumeForce();
  } catch (errTheme) {
    // Keep the safe blanket-forcing defaults on any surprise.
    rt.themeForceLow = true;
    rt.themeForceHigh = true;
  }
}

function emitMesh(i) {
  var gl = rt.gl;
  var dr = rt.model.drawables;
  var d = rt.drawables[i];
  if (!d || d.indexCount <= 0) return;
  var tex = rt.textures[d.texture];
  if (!tex) return;
  var mc = dr.multiplyColors;
  var sc = dr.screenColors;
  if (mc) gl.uniform3f(rt.loc.mul, mc[i * 4], mc[i * 4 + 1], mc[i * 4 + 2]);
  else gl.uniform3f(rt.loc.mul, 1, 1, 1);
  if (sc) gl.uniform3f(rt.loc.scr, sc[i * 4], sc[i * 4 + 1], sc[i * 4 + 2]);
  else gl.uniform3f(rt.loc.scr, 0, 0, 0);
  gl.uniform1f(rt.loc.alpha, combinedOpacity(i));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindBuffer(gl.ARRAY_BUFFER, rt.posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, dr.vertexPositions[i], gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(rt.loc.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, d.uvBuffer);
  gl.vertexAttribPointer(rt.loc.aUV, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, d.indexBuffer);
  gl.drawElements(gl.TRIANGLES, d.indexCount, gl.UNSIGNED_SHORT, 0);
}

function fillMask(dr, maskIdxs, n) {
  var gl = rt.gl;
  // Unbind the mask texture before rendering into it; sampling a bound
  // color attachment is undefined and produces torn clip silhouettes.
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.maskFbo);
  gl.viewport(0, 0, rt.canvas.width, rt.canvas.height);
  // Official encoding: 1 = outside (do not draw), 0 = inside the mask.
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1f(rt.loc.mode, 3);
  for (var k = 0; k < n; k += 1) {
    var mi = maskIdxs[k];
    if (mi < 0 || mi >= dr.count) continue;
    // Mask meshes are often hidden from the color pass; they still clip.
    emitMesh(mi);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, rt.canvas.width, rt.canvas.height);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, rt.maskTex);
  gl.activeTexture(gl.TEXTURE0);
}

function setupMaskFbo(gl) {
  rt.maskTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, rt.maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rt.canvas.width, rt.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  rt.maskFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.maskFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt.maskTex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('mask fbo incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function drawFrame() {
  var gl = rt.gl;
  var dr = rt.model.drawables;
  pinHiddenParams();
  rt.model.update();
  pinHiddenParts();
  enforceCostumeDrawables();
  // Render order is pose-dependent in Cubism: the transformed (black) form
  // blows up coat meshes that must slip BEHIND trousers/skirt. An order
  // snapshot from attach paints them over the clothes — rebuild every frame.
  rebuildRenderPlan(rt.model);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, rt.canvas.width, rt.canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(rt.program);
  gl.uniform2f(rt.loc.center, rt.originX, rt.originY);
  gl.uniform2f(rt.loc.scale, 2 / Math.max(1, rt.spanPxX), 2 / Math.max(1, rt.spanPxY));
  gl.uniform1i(rt.loc.tex, 0);
  gl.uniform1i(rt.loc.mask, 1);
  var lastKey = null;
  for (var p = 0; p < rt.renderPlan.length; p += 1) {
    var i = rt.renderPlan[p];
    if (!(combinedOpacity(i) > 0.01)) continue;
    // Engine-forced costume meshes trust the engine write over a stale
    // moc vis-bit (some builds ship the off-theme side with bit=0).
    var alive = meshForced(i);
    if (!alive && !drawableVisible(dr.dynamicFlags[i])) continue;
    var d = rt.drawables[i];
    if (!d || d.indexCount <= 0) continue;
    var n = dr.maskCounts[i] | 0;
    var key = '';
    if (n > 0 && dr.masks[i]) {
      for (var k = 0; k < n; k += 1) key += dr.masks[i][k] + ',';
    }
    if (key) {
      if (key !== lastKey) { fillMask(dr, dr.masks[i], n); lastKey = key; }
      gl.uniform1f(rt.loc.mode, d.invertMask ? 2 : 1);
    } else {
      lastKey = '';
      gl.uniform1f(rt.loc.mode, 0);
    }
    // Official Cubism WebGL factors (premultiplied). ZERO/SRC_COLOR multiply
    // paints any black shadow mesh as a solid black rectangle over the legs.
    if (d.blend === 'add') gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    else if (d.blend === 'mul') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    emitMesh(i);
  }
  try { if (dr.resetDynamicFlags) dr.resetDynamicFlags(); } catch (e) { /* optional on older cores */ }
}

window.__dshPetLive2DRuntime = {
  attach: function (petWrap, spec) {
    if (!spec || !spec.model || rt.moc) return Promise.resolve(false);
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1368;
      petWrap.insertBefore(canvas, petWrap.firstChild);
      rt.canvas = canvas;
      var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
      if (!gl) throw new Error('webgl unavailable');
      rt.gl = gl;
      rt.program = buildProgram(gl);
      rt.loc.aPos = gl.getAttribLocation(rt.program, 'aPos');
      rt.loc.aUV = gl.getAttribLocation(rt.program, 'aUV');
      rt.loc.center = gl.getUniformLocation(rt.program, 'uCenterPx');
      rt.loc.scale = gl.getUniformLocation(rt.program, 'uScale');
      rt.loc.alpha = gl.getUniformLocation(rt.program, 'uAlpha');
      rt.loc.mode = gl.getUniformLocation(rt.program, 'uMode');
      rt.loc.mask = gl.getUniformLocation(rt.program, 'uMask');
      rt.loc.mul = gl.getUniformLocation(rt.program, 'uMul');
      rt.loc.scr = gl.getUniformLocation(rt.program, 'uScr');
      rt.loc.tex = gl.getUniformLocation(rt.program, 'uTex');
      gl.enableVertexAttribArray(rt.loc.aPos);
      gl.enableVertexAttribArray(rt.loc.aUV);
      rt.posBuffer = gl.createBuffer();

      var modelKey = spec.model;
      return waitCoreRuntime().then(function () {
        var json = assetJson(modelKey);
        var refs = json.FileReferences || {};
        rt.motions = {};
        var groups = refs.Motions || {};
        for (var gname in groups) {
          if (Object.prototype.hasOwnProperty.call(groups, gname)) {
            rt.motions[gname] = (groups[gname] || []).map(function (def) {
              return def && def.File ? assetJson(resolveRel(modelKey, def.File)) : null;
            });
          }
        }
        rt.expressions = {};
        var expList = refs.Expressions || [];
        for (var ei = 0; ei < expList.length; ei += 1) {
          var ed = expList[ei];
          if (!ed || !ed.File || !ed.Name) continue;
          try { rt.expressions[ed.Name] = assetJson(resolveRel(modelKey, ed.File)); }
          catch (e) { /* one missing expression must not block the model */ }
        }

        var mocBytes = assetBytes(resolveRel(modelKey, refs.Moc));
        var mocBuffer = mocBytes.buffer.byteLength === mocBytes.byteLength
          ? mocBytes.buffer
          : mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength);
        rt.moc = CORE.Moc.fromArrayBuffer(mocBuffer);
        if (!rt.moc || !rt.moc._ptr) throw new Error('moc load failed');
        rt.model = new CORE.Model(rt.moc);
        if (!rt.model || !rt.model._ptr) throw new Error('model init failed');
        var info = rt.model.canvasinfo;
        // Core vertex positions are origin-relative *units* (pixel / PixelsPerUnit),
        // not canvas pixels. Subtracting CanvasOriginX/Y (pixels) collapses the
        // mesh onto one NDC edge — the window stays ready but looks empty.
        var ppu = info.PixelsPerUnit > 0 ? info.PixelsPerUnit : 1;
        rt.spanPxX = info.CanvasWidth / ppu;
        rt.spanPxY = info.CanvasHeight / ppu;
        rt.originX = 0;
        rt.originY = 0;
        canvas.height = Math.max(64, Math.round(canvas.width * rt.spanPxY / Math.max(1, rt.spanPxX)));
        gl.viewport(0, 0, canvas.width, canvas.height);
        setupMaskFbo(gl);
        var paramIds = rt.model.parameters.ids;
        for (var pi = 0; pi < paramIds.length; pi += 1) {
          rt.paramIndex[paramIds[pi]] = pi;
        }
        if (refs.Physics) {
          try { rt.physics = parsePhysics(assetJson(resolveRel(modelKey, refs.Physics)), rt.paramIndex); }
          catch (e) { rt.physics = null; }
        }
        rt.breathIndex = rt.paramIndex.ParamBreath !== undefined ? rt.paramIndex.ParamBreath : -1;
        rt.eyeLOpenIndex = rt.paramIndex.ParamEyeLOpen !== undefined ? rt.paramIndex.ParamEyeLOpen : -1;
        rt.eyeROpenIndex = rt.paramIndex.ParamEyeROpen !== undefined ? rt.paramIndex.ParamEyeROpen : -1;
        rt.angleZIndex = rt.paramIndex.ParamAngleZ !== undefined ? rt.paramIndex.ParamAngleZ : -1;
        rt.angleXIndex = rt.paramIndex.ParamAngleX !== undefined ? rt.paramIndex.ParamAngleX : -1;
        rt.angleYIndex = rt.paramIndex.ParamAngleY !== undefined ? rt.paramIndex.ParamAngleY : -1;
        rt.eyeXIndex = rt.paramIndex.ParamEyeBallX !== undefined ? rt.paramIndex.ParamEyeBallX : -1;
        rt.eyeYIndex = rt.paramIndex.ParamEyeBallY !== undefined ? rt.paramIndex.ParamEyeBallY : -1;
        rt.hiddenIndexes = (spec.hideParameters || [])
          .map(function (id) { return rt.paramIndex[id]; })
          .filter(function (idx) { return idx !== undefined; });
        rt.expressionRevealParts = spec.expressionRevealParts || {};
        rt.hiddenPartIndexes = indexesOfParts(spec.hideParts || []);
        rt.outfitParamIndex = -1;
        rt.outfitParamId = '';
        rt.outfitLatched = 1;
        rt.outfitLowIndexes = [];
        rt.outfitHighIndexes = [];
        var outfit = spec.outfit;
        if (outfit && outfit.parameter) {
          var oi = rt.paramIndex[outfit.parameter];
          if (oi !== undefined) {
            rt.outfitParamIndex = oi;
            rt.outfitParamId = outfit.parameter;
            rt.outfitLatched = 1;
            rt.model.parameters.values[oi] = 1;
          }
          rt.outfitLowIndexes = indexesOfParts(outfit.lowParts || []);
          rt.outfitHighIndexes = indexesOfParts(outfit.highParts || []);
          rt.outfitLowDrawables = drawablesOfParts(rt.outfitLowIndexes);
          rt.outfitHighDrawables = drawablesOfParts(rt.outfitHighIndexes);
          rt.themeForceLow = true;
          rt.themeForceHigh = true;
          refreshCostumeForce();
        }

        rt.hitById = {};
        var areas = json.HitAreas || [];
        for (var ha = 0; ha < areas.length; ha += 1) {
          var area = areas[ha];
          if (area && area.Id && area.Motion) rt.hitById[area.Id] = area.Motion;
        }
        planDrawables(rt.model, gl);

        var texKeys = (refs.Textures || []).map(function (rel) { return resolveRel(modelKey, rel); });
        return loadTextures(texKeys).then(function () {
          if (rt.physics) {
            try { stabilizePhysics(rt.physics, rt.model); }
            catch (e) { rt.physics = null; }
          }
          rt.ready = true;
          flushQueuedRuntime();
          startLoop();
          // Classify theme management AFTER first paint: the probe clone
          // costs seconds for a 95MB moc and must not delay attach; until
          // it lands, the safe blanket-forcing defaults stay in effect.
          setTimeout(detectThemeManagement, 250);
          setStatus(true, 'ppu=' + ppu + ' canvas=' + info.CanvasWidth + 'x' + info.CanvasHeight
            + ' span=' + rt.spanPxX + 'x' + rt.spanPxY);
          return true;
        }, function (err) {
          fail(err && err.message ? err.message : String(err));
          throw err;
        });
      }).catch(function (err) {
        fail(String((err && err.message) || err));
        throw err;
      });
    } catch (err) {
      fail(err && err.message ? err.message : String(err));
      return Promise.reject(err);
    }
  },
  setState: function (name) {
    if (!rt.ready) { rt.queuedState = name; return 0; }
    return applyState(name);
  },
  playMotionGroup: function (name) {
    if (!rt.ready || !name) return 0;
    if (!playGroup([name], false)) startIdleMotion();
    return motionDurationMs();
  },
  toggleForm: function () {
    if (!rt.ready || rt.outfitParamIndex < 0) return undefined;
    abandonOutfitMotion();
    var toBlack = rt.outfitLatched >= 0.5;
    rt.outfitLatched = toBlack ? 0 : 1;
    refreshCostumeForce();
    if (!playGroup(toBlack ? ['Sad'] : ['Special'], false)) startIdleMotion();
    return motionDurationMs();
  },
  hitTest: function (ndcX, ndcY) {
    if (!rt.ready || typeof ndcX !== 'number' || typeof ndcY !== 'number') return '';
    var mx = ndcX * rt.spanPxX / 2;
    var my = ndcY * rt.spanPxY / 2;
    var dr = rt.model.drawables;
    var pad = Math.max(rt.spanPxX, rt.spanPxY) * 0.02;
    var bestMotion = '';
    var bestArea = 1e30;
    var onBody = false;
    for (var p = rt.renderPlan.length - 1; p >= 0; p -= 1) {
      var i = rt.renderPlan[p];
      var d = rt.drawables[i];
      if (!d || d.indexCount <= 0) continue;
      if (!(combinedOpacity(i) > 0.01)) continue;
      if (!drawableVisible(dr.dynamicFlags[i]) && !meshForced(i)) continue;
      var bounds = meshBounds(dr.vertexPositions[i], dr.indices[i]);
      if (!bounds) continue;
      if (!pointInMesh(mx, my, dr.vertexPositions[i], dr.indices[i])
        && !pointInPaddedBox(mx, my, bounds, pad)) continue;
      onBody = true;
      if (!d.hitMotion) continue;
      if (bounds.area < bestArea) {
        bestArea = bounds.area;
        bestMotion = d.hitMotion;
      }
    }
    if (bestMotion) return bestMotion;
    return onBody ? 'body' : '';
  },
  setExpression: function (name) {
    var n = typeof name === 'string' ? name : '';
    if (!rt.ready) { rt.queuedExpression = n; rt.hasQueuedExpression = true; return; }
    setExpressionInternal(n);
  },
  expressionNames: function () {
    return Object.keys(rt.expressions);
  },
  motionGroups: function () {
    return Object.keys(rt.motions);
  },
  setPointer: function (nx, ny) {
    if (typeof nx !== 'number' || typeof ny !== 'number') {
      rt.lookTX = 0;
      rt.lookTY = 0;
      return;
    }
    rt.lookTX = Math.max(-1, Math.min(1, (nx - 0.5) * 2));
    rt.lookTY = Math.max(-1, Math.min(1, (0.5 - ny) * 2));
  }
};

/* Emscripten instantiates the wasm module asynchronously and this core build
   publishes no ready hook; poll a no-argument ccall until the runtime answers. */
function waitCoreRuntime() {
  return new Promise(function (resolve, reject) {
    var startedAt = Date.now();
    (function tick() {
      var ok = false;
      try { ok = typeof CORE.Version.csmGetVersion() === 'number'; } catch (e) { /* not yet */ }
      if (ok) { resolve(); return; }
      if (Date.now() - startedAt > 20000) { reject(new Error('cubism wasm runtime did not become ready')); return; }
      setTimeout(tick, 50);
    })();
  });
}

function pointInMesh(px, py, pos, idx) {
  if (!pos || !idx || idx.length < 3) return false;
  var t;
  for (t = 0; t + 2 < idx.length; t += 3) {
    var ia = idx[t] * 2;
    var ib = idx[t + 1] * 2;
    var ic = idx[t + 2] * 2;
    var ax = pos[ia]; var ay = pos[ia + 1];
    var bx = pos[ib]; var by = pos[ib + 1];
    var cx = pos[ic]; var cy = pos[ic + 1];
    var s1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    var s2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    var s3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    var hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
    var hasPos = s1 > 0 || s2 > 0 || s3 > 0;
    if (!(hasNeg && hasPos)) return true;
  }
  return false;
}
function meshBounds(pos, idx) {
  if (!pos || !idx || idx.length < 3) return null;
  var minX = 1e9;
  var minY = 1e9;
  var maxX = -1e9;
  var maxY = -1e9;
  var found = false;
  var t;
  for (t = 0; t + 2 < idx.length; t += 3) {
    var k;
    for (k = 0; k < 3; k += 1) {
      var vi = idx[t + k] * 2;
      var x = pos[vi];
      var y = pos[vi + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      found = true;
    }
  }
  if (!found) return null;
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, area: (maxX - minX) * (maxY - minY) };
}
function pointInPaddedBox(px, py, b, pad) {
  return px >= b.minX - pad && px <= b.maxX + pad && py >= b.minY - pad && py <= b.maxY + pad;
}

function blendModeOf(flags) {
  try { if (CORE.Utils.hasBlendAdditiveBit(flags)) return 'add'; } catch (e) { /* fall through */ }
  try { if (CORE.Utils.hasBlendMultiplicativeBit(flags)) return 'mul'; } catch (e) { /* fall through */ }
  return 'normal';
}
function flagBit(fn, flags, mask) {
  try { if (CORE.Utils && CORE.Utils[fn]) return CORE.Utils[fn](flags); } catch (e) { /* fall through */ }
  return (flags & mask) === mask;
}

/* The official renderer sorts drawables by the CURRENT render orders every
   update; sorting (not slot-filling) also survives duplicated order values. */
function rebuildRenderPlan(m) {
  var dr = m.drawables;
  var count = dr.count | 0;
  var orders = null;
  try { orders = typeof m.getRenderOrders === 'function' ? m.getRenderOrders() : null; } catch (e) { orders = null; }
  if (!orders || orders.length !== count) orders = dr.drawOrders;
  var plan = [];
  for (var i = 0; i < count; i += 1) plan.push(i);
  plan.sort(function (a, b) { return (orders[a] | 0) - (orders[b] | 0); });
  rt.renderPlan = plan;
}

function planDrawables(m, gl) {
  var dr = m.drawables;
  var count = dr.count | 0;
  // vertexUvs/indices are per-drawable subarray views; upload the static ones
  // once. Positions stay live in wasm memory and are streamed every frame.
  // Layer order itself is rebuilt per frame in rebuildRenderPlan.
  rt.renderPlan = [];
  for (var i = 0; i < count; i += 1) rt.renderPlan.push(i);
  for (i = 0; i < count; i += 1) {
    var indices = dr.indices[i];
    var uvb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvb);
    gl.bufferData(gl.ARRAY_BUFFER, dr.vertexUvs[i], gl.STATIC_DRAW);
    var ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    var flags = dr.constantFlags[i];
    var meshId = dr.ids && dr.ids[i];
    rt.drawables.push({
      texture: dr.textureIndices[i],
      indexCount: indices.length,
      uvBuffer: uvb,
      indexBuffer: ib,
      blend: blendModeOf(flags),
      invertMask: flagBit('hasIsInvertedMaskBit', flags, 8),
      doubleSided: flagBit('hasIsDoubleSidedBit', flags, 4),
      hitMotion: (meshId && rt.hitById && rt.hitById[meshId]) || ''
    });
  }
}

function loadTextures(keys) {
  var gl = rt.gl;
  var pending = keys.map(function (key, ti) {
    var bytes = assetBytes(key);
    var blob = new Blob([bytes], { type: 'image/png' });
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.generateMipmap(gl.TEXTURE_2D);
        // Sharp oblique minification keeps atlas neighbours from bleeding
        // into each other (the visible "parts glued wrong" fringing).
        var ext = gl.getExtension('EXT_texture_filter_anisotropic')
          || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
        if (ext) {
          var maxAniso = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
          gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
        }
        rt.textures[ti] = tex;
        resolve(tex);
      };
      img.onerror = function () { reject(new Error('texture failed: ' + key)); };
      img.src = URL.createObjectURL(blob);
    });
  });
  return Promise.all(pending);
}
})();`

/**
 * Read the operator-procured Cubism Core script from a file URL or plain path.
 * @throws when unreadable; callers treat any failure as "keep the pet window
 * closed".
 */
export function readPetLive2DCoreText(coreFileUrlOrPath: string): string {
  const path = coreFileUrlOrPath.startsWith('file:')
    ? fileURLToPath(coreFileUrlOrPath)
    : coreFileUrlOrPath
  return readFileSync(path, 'utf8')
}
