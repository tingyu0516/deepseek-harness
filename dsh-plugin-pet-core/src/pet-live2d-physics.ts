/**
 * Page-side physics3.json evaluator. Cubism Core has no physics; official
 * viewers run this pendulum pass after motion and before `model.update()`.
 * The source is a glue fragment evaluated inside the pet page IIFE.
 */

const AIR = 5
const MAX_WEIGHT = 100
const MOVE_EPS = 0.001
const MAX_REMAIN = 5
const STEP_FPS = 30

/**
 * Function declarations installed into the renderer glue. Must stay free of
 * backticks so it can be interpolated into `PET_LIVE2D_RUNTIME_GLUE`.
 */
export const PET_LIVE2D_PHYSICS_SOURCE = `
function physSign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
function physRange(a, b) { return Math.abs(Math.max(a, b) - Math.min(a, b)); }
function physMid(a, b) { return Math.min(a, b) + physRange(a, b) / 2; }
function physDirRad(ax, ay, bx, by) {
  var d = Math.atan2(by, bx) - Math.atan2(ay, ax);
  while (d < -Math.PI) d += Math.PI * 2;
  while (d > Math.PI) d -= Math.PI * 2;
  return d;
}
function physNorm(value, pMin, pMax, pDef, nMin, nMax, nDef, inverted) {
  var lo = Math.min(pMin, pMax);
  var hi = Math.max(pMin, pMax);
  if (value > hi) value = hi;
  if (value < lo) value = lo;
  var nLo = Math.min(nMin, nMax);
  var nHi = Math.max(nMin, nMax);
  var mid = physMid(lo, hi);
  var delta = value - mid;
  var result = nDef;
  if (physSign(delta) > 0) {
    var pLen = hi - mid;
    if (pLen !== 0) result = delta * ((nHi - nDef) / pLen) + nDef;
  } else if (physSign(delta) < 0) {
    var nLen = lo - mid;
    if (nLen !== 0) result = delta * ((nLo - nDef) / nLen) + nDef;
  }
  return inverted ? result : -result;
}
function physWriteOut(values, idx, mins, maxs, raw, scale, weight) {
  if (idx < 0) return;
  var v = raw * scale;
  var lo = mins[idx];
  var hi = maxs[idx];
  if (v < lo) v = lo;
  else if (v > hi) v = hi;
  var w = weight / ${MAX_WEIGHT};
  if (w >= 1) values[idx] = v;
  else values[idx] = values[idx] * (1 - w) + v * w;
}
function parsePhysics(json, paramIndex) {
  if (!json || !json.PhysicsSettings) return null;
  var meta = json.Meta || {};
  var forces = meta.EffectiveForces || {};
  var g = forces.Gravity || {};
  var w = forces.Wind || {};
  var settings = json.PhysicsSettings;
  var rig = {
    fps: typeof meta.Fps === 'number' ? meta.Fps : 0,
    gravityX: typeof g.X === 'number' ? g.X : 0,
    gravityY: typeof g.Y === 'number' ? g.Y : -1,
    windX: typeof w.X === 'number' ? w.X : 0,
    windY: typeof w.Y === 'number' ? w.Y : 0,
    remain: 0,
    cache: null,
    inCache: null,
    settings: []
  };
  for (var si = 0; si < settings.length; si += 1) {
    var src = settings[si] || {};
    var norm = src.Normalization || {};
    var np = norm.Position || {};
    var na = norm.Angle || {};
    var setting = {
      posMin: np.Minimum || 0, posMax: np.Maximum || 0, posDef: np.Default || 0,
      angMin: na.Minimum || 0, angMax: na.Maximum || 0, angDef: na.Default || 0,
      inputs: [], outputs: [], particles: [], prev: [], curr: []
    };
    var ins = src.Input || [];
    for (var ii = 0; ii < ins.length; ii += 1) {
      var inn = ins[ii] || {};
      var sid = inn.Source && inn.Source.Id;
      setting.inputs.push({
        idx: sid && paramIndex[sid] !== undefined ? paramIndex[sid] : -1,
        weight: inn.Weight || 0,
        type: inn.Type || 'X',
        reflect: !!inn.Reflect
      });
    }
    var outs = src.Output || [];
    for (var oi = 0; oi < outs.length; oi += 1) {
      var out = outs[oi] || {};
      var did = out.Destination && out.Destination.Id;
      setting.outputs.push({
        idx: did && paramIndex[did] !== undefined ? paramIndex[did] : -1,
        vertex: out.VertexIndex | 0,
        scale: typeof out.Scale === 'number' ? out.Scale : 0,
        weight: out.Weight || 0,
        type: out.Type || 'Angle',
        reflect: !!out.Reflect
      });
      setting.prev.push(0);
      setting.curr.push(0);
    }
    var verts = src.Vertices || [];
    for (var vi = 0; vi < verts.length; vi += 1) {
      var vt = verts[vi] || {};
      var radius = typeof vt.Radius === 'number' ? vt.Radius : 0;
      setting.particles.push({
        x: 0, y: vi === 0 ? 0 : setting.particles[vi - 1].y + radius,
        lx: 0, ly: vi === 0 ? 0 : setting.particles[vi - 1].y + radius,
        vx: 0, vy: 0, gx: 0, gy: 1,
        mobility: typeof vt.Mobility === 'number' ? vt.Mobility : 1,
        delay: typeof vt.Delay === 'number' ? vt.Delay : 1,
        acc: typeof vt.Acceleration === 'number' ? vt.Acceleration : 1,
        radius: radius
      });
    }
    rig.settings.push(setting);
  }
  return rig;
}
function physOutputValue(setting, out, gx, gy) {
  var v = out.vertex;
  if (v < 1 || v >= setting.particles.length) return 0;
  var cur = setting.particles[v];
  var prev = setting.particles[v - 1];
  var tx = cur.x - prev.x;
  var ty = cur.y - prev.y;
  var val;
  if (out.type === 'X') val = tx;
  else if (out.type === 'Y') val = ty;
  else {
    var px; var py;
    if (v >= 2) {
      px = prev.x - setting.particles[v - 2].x;
      py = prev.y - setting.particles[v - 2].y;
    } else {
      px = -gx; py = -gy;
    }
    val = physDirRad(px, py, tx, ty);
  }
  return out.reflect ? -val : val;
}
function physStepParticles(setting, tx, ty, angle, windX, windY, threshold, dt) {
  var rad = angle * Math.PI / 180;
  var gx = Math.sin(rad);
  var gy = Math.cos(rad);
  var glen = Math.hypot(gx, gy) || 1;
  gx /= glen; gy /= glen;
  var ps = setting.particles;
  if (!ps.length) return;
  ps[0].x = tx; ps[0].y = ty;
  for (var i = 1; i < ps.length; i += 1) {
    var p = ps[i];
    var parent = ps[i - 1];
    p.lx = p.x; p.ly = p.y;
    var delay = p.delay * dt * ${STEP_FPS};
    var dx = p.x - parent.x;
    var dy = p.y - parent.y;
    var turn = physDirRad(p.gx, p.gy, gx, gy) / ${AIR};
    var c = Math.cos(turn);
    var s = Math.sin(turn);
    var rx = c * dx - dy * s;
    dy = s * rx + dy * c;
    dx = rx;
    p.x = parent.x + dx;
    p.y = parent.y + dy;
    p.x += p.vx * delay + (gx * p.acc + windX) * delay * delay;
    p.y += p.vy * delay + (gy * p.acc + windY) * delay * delay;
    var ndx = p.x - parent.x;
    var ndy = p.y - parent.y;
    var nlen = Math.hypot(ndx, ndy) || 1;
    p.x = parent.x + ndx / nlen * p.radius;
    p.y = parent.y + ndy / nlen * p.radius;
    if (Math.abs(p.x) < threshold) p.x = 0;
    if (delay !== 0) {
      p.vx = (p.x - p.lx) / delay * p.mobility;
      p.vy = (p.y - p.ly) / delay * p.mobility;
    }
    p.gx = gx; p.gy = gy;
  }
}
function physStabilizeParticles(setting, tx, ty, angle, windX, windY, threshold) {
  var rad = angle * Math.PI / 180;
  var gx = Math.sin(rad);
  var gy = Math.cos(rad);
  var glen = Math.hypot(gx, gy) || 1;
  gx /= glen; gy /= glen;
  var ps = setting.particles;
  if (!ps.length) return;
  ps[0].x = tx; ps[0].y = ty;
  for (var i = 1; i < ps.length; i += 1) {
    var p = ps[i];
    var parent = ps[i - 1];
    p.lx = p.x; p.ly = p.y;
    p.vx = 0; p.vy = 0;
    var fx = gx * p.acc + windX;
    var fy = gy * p.acc + windY;
    var fl = Math.hypot(fx, fy) || 1;
    p.x = parent.x + fx / fl * p.radius;
    p.y = parent.y + fy / fl * p.radius;
    if (Math.abs(p.x) < threshold) p.x = 0;
    p.gx = gx; p.gy = gy;
  }
}
function physCollectInput(setting, values, mins, maxs, defs) {
  var tx = 0;
  var ty = 0;
  var angle = 0;
  for (var i = 0; i < setting.inputs.length; i += 1) {
    var inn = setting.inputs[i];
    if (inn.idx < 0) continue;
    var w = inn.weight / ${MAX_WEIGHT};
    var n;
    if (inn.type === 'Angle') {
      n = physNorm(values[inn.idx], mins[inn.idx], maxs[inn.idx], defs[inn.idx],
        setting.angMin, setting.angMax, setting.angDef, inn.reflect);
      angle += n * w;
    } else {
      n = physNorm(values[inn.idx], mins[inn.idx], maxs[inn.idx], defs[inn.idx],
        setting.posMin, setting.posMax, setting.posDef, inn.reflect);
      if (inn.type === 'Y') ty += n * w;
      else tx += n * w;
    }
  }
  var rad = -angle * Math.PI / 180;
  var c = Math.cos(rad);
  var s = Math.sin(rad);
  var rx = tx * c - ty * s;
  ty = rx * s + ty * c;
  tx = rx;
  return { tx: tx, ty: ty, angle: angle };
}
function physApplyOutputs(setting, values, mins, maxs, gx, gy, useCurr) {
  for (var i = 0; i < setting.outputs.length; i += 1) {
    var out = setting.outputs[i];
    var raw = useCurr ? setting.curr[i] : physOutputValue(setting, out, gx, gy);
    setting.curr[i] = raw;
    physWriteOut(values, out.idx, mins, maxs, raw, out.scale, out.weight);
  }
}
function stabilizePhysics(rig, model) {
  if (!rig || !model) return;
  var values = model.parameters.values;
  var mins = model.parameters.minimumValues;
  var maxs = model.parameters.maximumValues;
  var defs = model.parameters.defaultValues;
  var n = values.length;
  rig.cache = new Float32Array(n);
  rig.inCache = new Float32Array(n);
  for (var j = 0; j < n; j += 1) rig.cache[j] = rig.inCache[j] = values[j];
  for (var s = 0; s < rig.settings.length; s += 1) {
    var setting = rig.settings[s];
    var inp = physCollectInput(setting, values, mins, maxs, defs);
    var thr = ${MOVE_EPS} * setting.posMax;
    physStabilizeParticles(setting, inp.tx, inp.ty, inp.angle, 0, 0, thr);
    for (var o = 0; o < setting.outputs.length; o += 1) {
      var raw = physOutputValue(setting, setting.outputs[o], 0, -1);
      setting.prev[o] = setting.curr[o] = raw;
      physWriteOut(values, setting.outputs[o].idx, mins, maxs, raw,
        setting.outputs[o].scale, setting.outputs[o].weight);
      if (setting.outputs[o].idx >= 0) {
        rig.cache[setting.outputs[o].idx] = values[setting.outputs[o].idx];
      }
    }
  }
}
function evaluatePhysics(rig, model, dt) {
  if (!rig || !model || !(dt > 0)) return;
  var values = model.parameters.values;
  var mins = model.parameters.minimumValues;
  var maxs = model.parameters.maximumValues;
  var defs = model.parameters.defaultValues;
  var n = values.length;
  if (!rig.cache || rig.cache.length < n) {
    rig.cache = new Float32Array(n);
    rig.inCache = new Float32Array(n);
    for (var j = 0; j < n; j += 1) rig.inCache[j] = values[j];
  }
  rig.remain += dt;
  if (rig.remain > ${MAX_REMAIN}) rig.remain = 0;
  var step = rig.fps > 0 ? 1 / rig.fps : dt;
  while (rig.remain >= step) {
    var wIn = step / rig.remain;
    for (var p = 0; p < n; p += 1) {
      rig.cache[p] = rig.inCache[p] * (1 - wIn) + values[p] * wIn;
      rig.inCache[p] = rig.cache[p];
    }
    for (var s = 0; s < rig.settings.length; s += 1) {
      var setting = rig.settings[s];
      for (var o = 0; o < setting.outputs.length; o += 1) setting.prev[o] = setting.curr[o];
      var inp = physCollectInput(setting, rig.cache, mins, maxs, defs);
      physStepParticles(setting, inp.tx, inp.ty, inp.angle, 0, 0,
        ${MOVE_EPS} * setting.posMax, step);
      for (var k = 0; k < setting.outputs.length; k += 1) {
        var out = setting.outputs[k];
        var raw = physOutputValue(setting, out, 0, -1);
        setting.curr[k] = raw;
        physWriteOut(rig.cache, out.idx, mins, maxs, raw, out.scale, out.weight);
      }
    }
    rig.remain -= step;
  }
  var alpha = step > 0 ? rig.remain / step : 0;
  for (var t = 0; t < rig.settings.length; t += 1) {
    var st = rig.settings[t];
    for (var u = 0; u < st.outputs.length; u += 1) {
      var blended = st.prev[u] * (1 - alpha) + st.curr[u] * alpha;
      physWriteOut(values, st.outputs[u].idx, mins, maxs, blended,
        st.outputs[u].scale, st.outputs[u].weight);
    }
  }
}
`

/**
 * Instantiate the glue physics functions in-process for unit tests.
 * @returns parse / stabilize / evaluate against a Core-like parameter table.
 */
export function createPetPhysicsRuntime(): {
  parsePhysics: (json: unknown, paramIndex: Record<string, number>) => unknown
  stabilizePhysics: (rig: unknown, model: unknown) => void
  evaluatePhysics: (rig: unknown, model: unknown, dt: number) => void
} {
  return new Function(
    `${PET_LIVE2D_PHYSICS_SOURCE}; return { parsePhysics, stabilizePhysics, evaluatePhysics };`,
  )() as ReturnType<typeof createPetPhysicsRuntime>
}
