import { createRequire } from "node:module";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/contracts.ts
/** All line categories in canonical order. */
const PET_LINE_CATEGORIES = Object.freeze([
	"greet",
	"idle",
	"work",
	"cheer",
	"sad",
	"pat",
	"special"
]);
/** Error thrown for any character document that fails strict validation. */
var PetCharacterError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "PetCharacterError";
	}
};
const MAX_LINE_CHARS = 160;
const MIN_LINES = 1;
const MAX_LINES = 16;
const MIN_WINDOW_PX = 120;
const MAX_WINDOW_PX = 720;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const LOCALES = Object.freeze(["zh", "en"]);
const LIVE2D_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.model3\.json$/u;
const LIVE2D_CORE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.js$/u;
const DEFAULT_LIVE2D_CORE = "vendor/live2dcubismcore.min.js";
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringArray(value, path) {
	if (!Array.isArray(value) || value.length < MIN_LINES || value.length > MAX_LINES) throw new PetCharacterError(`${path} must hold ${MIN_LINES}..${MAX_LINES} lines`);
	return value.map((line, index) => {
		if (typeof line !== "string" || line.length === 0 || line.length > MAX_LINE_CHARS) throw new PetCharacterError(`${path}[${String(index)}] must be a non-empty string of at most ${String(MAX_LINE_CHARS)} characters`);
		return line;
	});
}
function hexColor(value, path) {
	if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) throw new PetCharacterError(`${path} must be a #rrggbb color`);
	return value;
}
function parseCopy(value, path) {
	if (!isObject(value)) throw new PetCharacterError(`${path} must be an object`);
	const label = value.label;
	if (typeof label !== "string" || label.length === 0 || label.length > 32) throw new PetCharacterError(`${path}.label must be a short non-empty string`);
	const lines = value.lines;
	if (!isObject(lines)) throw new PetCharacterError(`${path}.lines must be an object`);
	const parsed = {};
	for (const category of PET_LINE_CATEGORIES) parsed[category] = stringArray(lines[category], `${path}.lines.${category}`);
	return {
		label,
		lines: parsed
	};
}
/**
* Validate the Live2D block. Asset names stay relative and rooted so a
* character document can never point outside its plugin's `assets/live2d/` dir.
*/
function parseLive2D(value, path) {
	if (!isObject(value)) throw new PetCharacterError(`${path} must be an object`);
	const model = value.model;
	if (typeof model !== "string" || !LIVE2D_MODEL_PATTERN.test(model) || model.includes("..")) throw new PetCharacterError(`${path}.model must be a relative *.model3.json asset name`);
	const core = value.core ?? DEFAULT_LIVE2D_CORE;
	if (typeof core !== "string" || !LIVE2D_CORE_PATTERN.test(core) || core.includes("..")) throw new PetCharacterError(`${path}.core must be a relative *.js asset name`);
	let hideParameters;
	const rawHide = value.hideParameters;
	if (rawHide !== void 0 && rawHide !== null) {
		if (!Array.isArray(rawHide) || rawHide.some((id) => typeof id !== "string" || id.length === 0)) throw new PetCharacterError(`${path}.hideParameters must be an array of parameter ids`);
		hideParameters = Object.freeze([...rawHide]);
	}
	let hideParts;
	const rawParts = value.hideParts;
	if (rawParts !== void 0 && rawParts !== null) {
		if (!Array.isArray(rawParts) || rawParts.some((id) => typeof id !== "string" || id.length === 0)) throw new PetCharacterError(`${path}.hideParts must be an array of part ids`);
		hideParts = Object.freeze([...rawParts]);
	}
	let expressionRevealParts;
	const rawReveal = value.expressionRevealParts;
	if (rawReveal !== void 0 && rawReveal !== null) {
		if (!isObject(rawReveal)) throw new PetCharacterError(`${path}.expressionRevealParts must be an object`);
		const mapped = {};
		for (const [name, ids] of Object.entries(rawReveal)) {
			if (name.length === 0 || !Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.length === 0)) throw new PetCharacterError(`${path}.expressionRevealParts.${name} must be an array of part ids`);
			mapped[name] = Object.freeze([...ids]);
		}
		expressionRevealParts = Object.freeze(mapped);
	}
	let outfit;
	const rawOutfit = value.outfit;
	if (rawOutfit !== void 0 && rawOutfit !== null) {
		if (!isObject(rawOutfit) || typeof rawOutfit.parameter !== "string" || rawOutfit.parameter.length === 0) throw new PetCharacterError(`${path}.outfit.parameter must be a non-empty parameter id`);
		let lowParts;
		if (rawOutfit.lowParts !== void 0 && rawOutfit.lowParts !== null) {
			if (!Array.isArray(rawOutfit.lowParts) || rawOutfit.lowParts.some((id) => typeof id !== "string" || id.length === 0)) throw new PetCharacterError(`${path}.outfit.lowParts must be an array of part ids`);
			lowParts = Object.freeze([...rawOutfit.lowParts]);
		}
		let highParts;
		if (rawOutfit.highParts !== void 0 && rawOutfit.highParts !== null) {
			if (!Array.isArray(rawOutfit.highParts) || rawOutfit.highParts.some((id) => typeof id !== "string" || id.length === 0)) throw new PetCharacterError(`${path}.outfit.highParts must be an array of part ids`);
			highParts = Object.freeze([...rawOutfit.highParts]);
		}
		outfit = Object.freeze({
			parameter: rawOutfit.parameter,
			...lowParts === void 0 ? {} : { lowParts },
			...highParts === void 0 ? {} : { highParts }
		});
	}
	return Object.freeze({
		model,
		core,
		...hideParameters === void 0 ? {} : { hideParameters },
		...hideParts === void 0 ? {} : { hideParts },
		...expressionRevealParts === void 0 ? {} : { expressionRevealParts },
		...outfit === void 0 ? {} : { outfit }
	});
}
/**
* Validate one untrusted character document.
* @param value - parsed JSON from a pet plugin's character.json asset.
* @returns a frozen, strictly typed character document.
* @throws {@link PetCharacterError} when any field is missing or malformed.
*/
function parsePetCharacterDocument(value) {
	if (!isObject(value)) throw new PetCharacterError("character document must be an object");
	const id = value.id;
	if (id !== "hutao" && id !== "furina") throw new PetCharacterError("character document id must be \"hutao\" or \"furina\"");
	const copyValue = value.copy;
	if (!isObject(copyValue)) throw new PetCharacterError("character document copy must be an object");
	const copy = {};
	for (const locale of LOCALES) copy[locale] = parseCopy(copyValue[locale], `copy.${locale}`);
	const paletteValue = value.palette;
	if (!isObject(paletteValue)) throw new PetCharacterError("character document palette must be an object");
	const palette = {
		accent: hexColor(paletteValue.accent, "palette.accent"),
		bubbleBg: hexColor(paletteValue.bubbleBg, "palette.bubbleBg"),
		bubbleText: hexColor(paletteValue.bubbleText, "palette.bubbleText"),
		bubbleBorder: hexColor(paletteValue.bubbleBorder, "palette.bubbleBorder")
	};
	const baseSizeValue = value.baseSize;
	if (!isObject(baseSizeValue)) throw new PetCharacterError("character document baseSize must be an object");
	const width = baseSizeValue.width;
	const height = baseSizeValue.height;
	if (typeof width !== "number" || !Number.isInteger(width) || width < MIN_WINDOW_PX || width > MAX_WINDOW_PX) throw new PetCharacterError(`baseSize.width must be an integer from ${String(MIN_WINDOW_PX)} through ${String(MAX_WINDOW_PX)}`);
	if (typeof height !== "number" || !Number.isInteger(height) || height < MIN_WINDOW_PX || height > MAX_WINDOW_PX) throw new PetCharacterError(`baseSize.height must be an integer from ${String(MIN_WINDOW_PX)} through ${String(MAX_WINDOW_PX)}`);
	if (value.live2d === void 0) throw new PetCharacterError("character document live2d is required now that the SVG renderer is gone");
	const live2d = parseLive2D(value.live2d, "live2d");
	return Object.freeze({
		id,
		copy: Object.freeze(copy),
		palette: Object.freeze(palette),
		baseSize: Object.freeze({
			width,
			height
		}),
		live2d
	});
}
/** Pick one line deterministically-ish from a category for a locale. */
function pickPetLine(character, locale, category, random = Math.random) {
	const lines = character.copy[locale].lines[category];
	const index = lines.length === 1 ? 0 : Math.floor(random() * lines.length);
	return lines[Math.min(index, lines.length - 1)] ?? character.copy[locale].lines[category][0];
}
//#endregion
//#region src/pet-events.ts
function eventFields(event) {
	return event.data ?? {};
}
/**
* Track open turns per session and decide which pet state each event requests.
* Mirrors the desktop notifications row: only direct, user-initiated turns
* attract attention; subagent sessions never do.
*/
var PetActivityTracker = class {
	openTurns = /* @__PURE__ */ new Map();
	/** Observe one session lifecycle event. */
	noteSessionEvent(session, event) {
		if (session.header.origin === "subagent") return void 0;
		const sessionId = String(session.header.id);
		const fields = eventFields(event);
		if (event.type === "turn/start") {
			const turn = fields.turn;
			if (typeof turn !== "number") return void 0;
			this.openTurns.set(sessionId, {
				turn,
				userInitiated: false
			});
			return;
		}
		if (event.type === "user/message") {
			const open = this.openTurns.get(sessionId);
			const source = fields.source;
			if (open !== void 0 && source?.kind === "user") open.userInitiated = true;
			return;
		}
		if (event.type === "turn/end") {
			const open = this.openTurns.get(sessionId);
			if (open === void 0 || open.turn !== fields.turn) return void 0;
			this.openTurns.delete(sessionId);
			if (!open.userInitiated) return void 0;
			const kind = fields.reason?.kind;
			if (kind === "completed") return "cheer";
			if (kind === "error" || kind === "max-tokens") return "sad";
			return "idle";
		}
	}
	/** Forget one disposed session's pending turn. */
	noteSessionDisposed(session) {
		this.openTurns.delete(String(session.header.id));
	}
	/** Map one background-job outcome onto a pet state. */
	noteJobStatus(status) {
		if (status === "completed") return "cheer";
		if (status === "failed") return "sad";
	}
};
//#endregion
//#region src/pet-live2d-physics.ts
/**
* Page-side physics3.json evaluator. Cubism Core has no physics; official
* viewers run this pendulum pass after motion and before `model.update()`.
* The source is a glue fragment evaluated inside the pet page IIFE.
*/
const AIR = 5;
const MAX_WEIGHT = 100;
const MOVE_EPS = .001;
/**
* Function declarations installed into the renderer glue. Must stay free of
* backticks so it can be interpolated into `PET_LIVE2D_RUNTIME_GLUE`.
*/
const PET_LIVE2D_PHYSICS_SOURCE = `
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
    var delay = p.delay * dt * 30;
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
  if (rig.remain > 5) rig.remain = 0;
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
`;
//#endregion
//#region src/pet-live2d-host.ts
/** Host-side Live2D runtime: inject Cubism Core plus the renderer glue page-side. */
const ASSET_EXTENSIONS = /* @__PURE__ */ new Set([
	".model3.json",
	".moc3",
	".physics3.json",
	".cdi3.json",
	".exp3.json",
	".motion3.json",
	".png",
	".jpg",
	".jpeg"
]);
/** Files irrelevant to rendering. */
const SKIPPED_NAMES = /* @__PURE__ */ new Set(["LICENSE-MODEL.md"]);
const SKIPPED_DIRS = /* @__PURE__ */ new Set(["vendor"]);
/** Split base64 payloads across several evaluations to stay far below the
* message-size range where Electron IPC gets fragile. */
const CHUNK_CHARS = 4 * 1024 * 1024;
function* walkAssets(dir) {
	for (const entry of readdirSync(dir)) {
		const full = `${dir}${sep}${entry}`;
		if (statSync(full).isDirectory()) {
			if (!SKIPPED_DIRS.has(entry)) yield* walkAssets(full);
			continue;
		}
		if (SKIPPED_NAMES.has(entry)) continue;
		const lower = entry.toLowerCase();
		let matched = false;
		for (const ext of ASSET_EXTENSIONS) if (lower.endsWith(ext)) {
			matched = true;
			break;
		}
		if (matched) yield full;
	}
}
/**
* Read every whitelisted Live2D asset under `dir` and cut them into
* base64 chunks for in-page delivery. Ordered deterministically so repeated
* boots behave identically.
*/
function collectPetLive2DAssetChunks(dir) {
	const root = fileURLToPath(dir.startsWith("file:") ? dir : `file:///${dir.replace(/\\/gu, "/")}`);
	const chunks = [];
	const keys = [];
	const contents = [];
	for (const full of walkAssets(root)) {
		keys.push(posix.join(...full.slice(root.length).split(sep)));
		contents.push(readFileSync(full).toString("base64"));
	}
	const order = keys.map((key, index) => ({
		key,
		index
	})).sort((a, b) => a.key.localeCompare(b.key));
	for (const { key, index } of order) {
		const b64 = contents[index];
		const parts = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS));
		for (let part = 0; part < parts; part += 1) chunks.push({
			key,
			part,
			parts,
			data: b64.slice(part * CHUNK_CHARS, (part + 1) * CHUNK_CHARS)
		});
	}
	return chunks;
}
/** Evaluate-ready JS statement appending one chunk into the page-side stash.
*  Ends with `void 0` so executeJavaScript has no multi-megabyte completion
*  value to structured-clone back over IPC. */
function petLive2DChunkStatement(chunk) {
	const key = JSON.stringify(chunk.key);
	return `(window.__DSH_PET_LIVE2D_PARTS ??= {})[${key}] ??= [];window.__DSH_PET_LIVE2D_PARTS[${key}][${String(chunk.part)}]=${JSON.stringify(chunk.data)};void 0;`;
}
/** Finalize statement folding the part stash into the resolved asset table. */
function petLive2DFinalizeStatement() {
	return "(window.__DSH_PET_LIVE2D_ASSETS = Object.fromEntries(Object.entries(window.__DSH_PET_LIVE2D_PARTS ?? {}).map(([k, v]) => [k, v.join(\"\")])));delete window.__DSH_PET_LIVE2D_PARTS;";
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
const PET_LIVE2D_RUNTIME_GLUE = `(function () {
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
})();`;
/**
* Read the operator-procured Cubism Core script from a file URL or plain path.
* @throws when unreadable; callers treat any failure as "keep the pet window
* closed".
*/
function readPetLive2DCoreText(coreFileUrlOrPath) {
	return readFileSync(coreFileUrlOrPath.startsWith("file:") ? fileURLToPath(coreFileUrlOrPath) : coreFileUrlOrPath, "utf8");
}
//#endregion
//#region src/pet-window.ts
/** Lifecycle for one transparent always-on-top pet window. */
/**
* Resolve the Live2D selection from one asset directory and the character's
* declared metadata. Returns `undefined` when files are absent; callers then
* refuse to open the pet window at all.
*/
function resolvePetLive2DUrls(character, assetsDir) {
	const live2d = character.live2d;
	if (live2d === void 0) return void 0;
	const modelPath = join(assetsDir, live2d.model);
	const corePath = join(assetsDir, live2d.core ?? "vendor/live2dcubismcore.min.js");
	if (!existsSync(modelPath) || !existsSync(corePath)) return void 0;
	return {
		model: live2d.model,
		...live2d.hideParameters === void 0 ? {} : { hideParameters: live2d.hideParameters },
		...live2d.hideParts === void 0 ? {} : { hideParts: live2d.hideParts },
		...live2d.expressionRevealParts === void 0 ? {} : { expressionRevealParts: live2d.expressionRevealParts },
		...live2d.outfit === void 0 ? {} : { outfit: live2d.outfit }
	};
}
const PET_STATE_DURATIONS = Object.freeze({
	greet: 4200,
	idle: 0,
	work: 0,
	cheer: 3200,
	sad: 4200,
	pat: 2200,
	special: 3600,
	walk: 2600
});
/** Every non-idle state returns to idle after this many milliseconds. */
function petStateDuration(state) {
	return PET_STATE_DURATIONS[state] ?? 0;
}
const POSITION_FILE_VERSION = 1;
const STROLL_DISTANCE_PX = 48;
const WORK_AREA_MARGIN_PX = 8;
/** Window pixels reserved above the character so speech never covers the model.
*  Keep in sync with `--pet-speech-slot` in `pet.html`. */
const PET_SPEECH_SLOT_PX = 80;
/** Per-message cap for renderer-driven drag deltas. */
const MANUAL_MOVE_MAX_PX = 64;
/** Crawl pacing for one stroll hop: 16 steps × 60ms ≈ 1s of visible walking. */
const STROLL_STEP_MS = 60;
const POSITION_SAVE_DEBOUNCE_MS = 600;
function sanitizeElectronShape(loaded) {
	if (typeof loaded !== "object" || loaded === null) return void 0;
	const candidate = loaded;
	if (typeof candidate.BrowserWindow !== "function") return void 0;
	return candidate.screen === void 0 ? { BrowserWindow: candidate.BrowserWindow } : {
		BrowserWindow: candidate.BrowserWindow,
		screen: candidate.screen
	};
}
/**
* Load the Electron main-process module from a plugin module URL.
* Returns `undefined` outside Electron so the pet stays inactive in an
* ordinary DSH boot.
*/
function loadPetElectron(moduleUrl) {
	try {
		return sanitizeElectronShape(createRequire(moduleUrl)("electron"));
	} catch {
		return;
	}
}
function clamp(value, min, max) {
	return value < min ? min : value > max ? max : value;
}
function petLayoutSize(character, scale) {
	return {
		width: Math.round(character.baseSize.width * scale),
		height: Math.round(character.baseSize.height * scale) + 80
	};
}
function defaultBounds(character, workArea) {
	const { width, height } = petLayoutSize(character, 1);
	if (workArea === void 0) return {
		x: 0,
		y: 0,
		width,
		height
	};
	return {
		x: workArea.x + workArea.width - width - WORK_AREA_MARGIN_PX * 3,
		y: workArea.y + workArea.height - height - WORK_AREA_MARGIN_PX,
		width,
		height
	};
}
function readPosition(path) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const file = parsed;
	if (file.version !== POSITION_FILE_VERSION || typeof file.x !== "number" || typeof file.y !== "number") return void 0;
	return {
		x: file.x,
		y: file.y
	};
}
/** Own one pet window: creation, pushes, strolls, persistence, disposal. */
var PetWindowController = class {
	options;
	window;
	disposed = false;
	pageReady = false;
	pendingBoot;
	/** Live2D spec kept beside the boot payload so injection can precede boot. */
	live2dSpec;
	/** Resolves once the optional Core+glue injection finished (or failed). */
	bootGate;
	saveTimer;
	strollStepTimer;
	/** Designed content size; never re-read from getBounds during drag (DPI drift). */
	layoutWidth = 0;
	layoutHeight = 0;
	constructor(options) {
		this.options = options;
	}
	/** Whether the window currently exists and is not destroyed. */
	isOpen() {
		return this.window !== void 0 && !this.window.isDestroyed();
	}
	/** Whether the window is currently visible. */
	isVisible() {
		return this.isOpen() && this.window.isVisible();
	}
	/** Create (or re-show) the pet window. Repeated calls are idempotent. */
	open() {
		if (this.disposed) return;
		const existing = this.window;
		if (existing !== void 0 && !existing.isDestroyed()) {
			if (!existing.isVisible()) existing.show();
			return;
		}
		const live2dDir = this.options.live2dDir?.();
		const spec = live2dDir === void 0 ? void 0 : resolvePetLive2DUrls(this.options.character, live2dDir);
		if (spec === void 0) {
			this.options.log?.(`live2d assets missing under ${live2dDir ?? "(no asset dir)"}; pet window will not open`);
			return;
		}
		this.live2dSpec = spec;
		const { BrowserWindow, screen } = this.options.electron;
		const locale = this.options.locale();
		const primary = screen?.getDisplayMatching({
			x: 0,
			y: 0,
			width: 0,
			height: 0
		}).workArea;
		const restored = readPosition(this.options.statePath);
		const fallback = defaultBounds(this.options.character, primary);
		const bounds = restored === void 0 ? fallback : this.clampToWorkArea(restored.x, restored.y, fallback.width, fallback.height, screen);
		this.layoutWidth = bounds.width;
		this.layoutHeight = bounds.height;
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
			backgroundColor: "#00000000",
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
				spellcheck: false
			}
		});
		this.window = window;
		this.pageReady = false;
		window.setAlwaysOnTop(true, "screen-saver");
		const lockZoom = window.webContents.setVisualZoomLevelLimits;
		if (typeof lockZoom === "function") lockZoom.call(window.webContents, 1, 1);
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("did-finish-load", () => {
			this.handlePageReady();
		});
		window.webContents.on("will-navigate", (...args) => {
			this.handleNavigate(args[0], args[1]);
		});
		window.once("ready-to-show", () => {
			if (!this.disposed && this.window === window && !window.isDestroyed()) window.show();
		});
		window.on("closed", () => {
			if (this.window === window) this.window = void 0;
			this.pageReady = false;
		});
		window.on("moved", () => {
			this.schedulePositionSave();
		});
		this.queueBoot();
		window.webContents.loadFile(this.options.htmlPath, { query: { locale } }).catch(() => {
			if (!this.disposed && this.window === window && !window.isDestroyed()) window.close();
		});
	}
	/** Close the current window, if any. */
	close() {
		this.flushPositionSave();
		const window = this.window;
		this.window = void 0;
		this.pageReady = false;
		this.pendingBoot = void 0;
		this.live2dSpec = void 0;
		this.bootGate = void 0;
		if (window !== void 0 && !window.isDestroyed()) window.close();
	}
	/** Dispose permanently; the controller cannot be reopened afterwards. */
	dispose() {
		this.disposed = true;
		if (this.strollStepTimer !== void 0) {
			clearTimeout(this.strollStepTimer);
			this.strollStepTimer = void 0;
		}
		this.close();
	}
	/** Push one state (and optional spoken line) into the page. */
	emit(state, line) {
		if (!this.isOpen()) return;
		const payload = {
			kind: "dispatch",
			state,
			...line === void 0 ? {} : { line }
		};
		this.run(`window.__dshPet && window.__dshPet.dispatch(${JSON.stringify(payload)});`);
		const duration = petStateDuration(state);
		if (duration > 0 && state !== "idle") {
			const revert = JSON.stringify({
				kind: "dispatch",
				state: "idle"
			});
			this.run(`if (window.__dshPet && window.__dshPet.state() === ${JSON.stringify(state)}) { window.__dshPet.dispatch(${revert}); }`, duration);
		}
	}
	/** Apply a new window scale while keeping the current position. */
	applyScale(scale) {
		if (!this.isOpen()) return;
		const window = this.window;
		const bounds = window.getBounds();
		const size = petLayoutSize(this.options.character, scale);
		this.layoutWidth = size.width;
		this.layoutHeight = size.height;
		window.setBounds({
			x: bounds.x,
			y: bounds.y,
			width: size.width,
			height: size.height
		});
	}
	/**
	* Walk one short hop sideways inside the work area as a smooth crawl, not
	* an instant teleport — the renderer only holds the walk pose for a few
	* seconds, and the walk-only accessory needs those frames to be visible.
	*/
	stroll() {
		if (!this.isOpen() || !this.isVisible()) return;
		if (this.strollStepTimer !== void 0) {
			clearTimeout(this.strollStepTimer);
			this.strollStepTimer = void 0;
		}
		const bounds = this.window.getBounds();
		const width = this.layoutWidth || bounds.width;
		const height = this.layoutHeight || bounds.height;
		const workArea = this.options.electron.screen?.getDisplayMatching(bounds).workArea;
		this.emit("walk");
		if (workArea === void 0) return;
		const direction = Math.random() < .5 ? -1 : 1;
		const target = clamp(bounds.x + direction * STROLL_DISTANCE_PX, workArea.x + WORK_AREA_MARGIN_PX, workArea.x + workArea.width - width - WORK_AREA_MARGIN_PX);
		const steps = 16;
		const startX = bounds.x;
		const stepTo = (index) => {
			const current = this.window;
			if (current === void 0 || current.isDestroyed() || !this.isOpen()) return;
			current.setBounds({
				x: clamp(Math.round(startX + (target - startX) * index / steps), workArea.x + WORK_AREA_MARGIN_PX, Math.max(workArea.x + WORK_AREA_MARGIN_PX, workArea.x + workArea.width - width - WORK_AREA_MARGIN_PX)),
				y: bounds.y,
				width,
				height
			});
			if (index < steps) this.strollStepTimer = setTimeout(() => {
				this.strollStepTimer = void 0;
				stepTo(index + 1);
			}, STROLL_STEP_MS);
		};
		stepTo(1);
	}
	/** Re-send the boot payload (for example after preference changes). */
	reboot() {
		this.queueBoot();
		this.flushBoot();
	}
	queueBoot() {
		const live2dDir = this.options.live2dDir?.();
		const live2d = live2dDir === void 0 ? void 0 : resolvePetLive2DUrls(this.options.character, live2dDir);
		if (live2d === void 0) {
			this.options.log?.("live2d assets became unreadable; boot skipped");
			this.pendingBoot = void 0;
			this.flushBoot();
			return;
		}
		this.live2dSpec = live2d;
		this.pendingBoot = {
			kind: "boot",
			character: this.options.character,
			locale: this.options.locale(),
			idleChatter: this.options.idleChatter(),
			live2d
		};
		this.flushBoot();
	}
	flushBoot() {
		const payload = this.pendingBoot;
		const gate = this.bootGate;
		if (payload === void 0 || !this.isOpen() || !this.pageReady || gate === void 0) return;
		const deliver = () => {
			if (!this.isOpen() || !this.pageReady || this.pendingBoot !== payload) return;
			this.pendingBoot = void 0;
			this.run(`window.__dshPet && window.__dshPet.boot(${JSON.stringify(payload)});`);
		};
		gate.then(deliver);
	}
	/**
	* Evaluate the operator-procured Cubism Core, the renderer glue, and the
	* full in-memory asset table before boot delivery. Bounded by a timeout so
	* a wedged page can never hold the pet hostage; on failure the log says so
	* and the window stays blank.
	*/
	async injectLive2D() {
		const evaluate = async (code) => {
			const current = this.window;
			if (current === void 0 || current.isDestroyed()) throw new Error("pet window closed");
			return current.webContents.executeJavaScript(code, true);
		};
		const live2dDir = this.options.live2dDir?.();
		if (live2dDir === void 0) throw new Error("live2d asset dir vanished");
		const coreText = readPetLive2DCoreText(join(live2dDir, this.options.character.live2d.core ?? "vendor/live2dcubismcore.min.js"));
		let timer;
		try {
			await Promise.race([(async () => {
				await evaluate(`/* DSH pet Cubism Core */\n${coreText}\nwindow.Live2DCubismCore=(typeof Live2DCubismCore!=='undefined')?Live2DCubismCore:window.Live2DCubismCore;\nvoid 0;\n`);
				if (String(await evaluate("(function(){var ns=window.Live2DCubismCore;if(!ns||!ns.Moc||!ns.Model||!ns.Drawables)return'';return'ok';})()")) !== "ok") throw new Error("cubism core did not define its wrapper classes after injection");
				await evaluate(PET_LIVE2D_RUNTIME_GLUE);
				for (const chunk of collectPetLive2DAssetChunks(live2dDir)) await evaluate(petLive2DChunkStatement(chunk));
				await evaluate(petLive2DFinalizeStatement());
			})(), new Promise((_, reject) => {
				timer = setTimeout(() => reject(/* @__PURE__ */ new Error("live2d injection timed out")), 6e4);
			})]);
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
	}
	handlePageReady() {
		if (this.disposed || !this.isOpen()) return;
		this.pageReady = true;
		if (this.live2dSpec === void 0) {
			this.bootGate = void 0;
			this.options.log?.("live2d spec lost before page load; boot skipped");
		} else this.bootGate = this.injectLive2D().then(() => {
			let bounds = "?";
			try {
				const b = this.window?.getBounds();
				if (b) bounds = `[${b.x},${b.y} ${b.width}x${b.height}]`;
			} catch {}
			this.options.log?.(`live2d runtime attached pid=${process.pid} bounds=${bounds}`);
		}).catch((cause) => {
			this.options.log?.(`live2d injection failed (${cause instanceof Error ? cause.message : String(cause)})`);
		});
		this.flushBoot();
	}
	handleNavigate(event, href) {
		event?.preventDefault();
		if (typeof href !== "string" || href.length === 0 || href.length > 512) return;
		let url;
		try {
			url = new URL(href);
		} catch {
			return;
		}
		if (url.protocol !== `dsh-pet-${this.options.character.id}:` || url.username !== "" || url.password !== "" || url.pathname !== "") return;
		const command = url.hostname;
		if (command === "hide" && url.search === "") {
			this.options.onCommand("hide");
			return;
		}
		if (command === "move") {
			this.handleManualMove(url.searchParams.get("dx"), url.searchParams.get("dy"));
			return;
		}
		if (command === "live2dfailed") {
			const reason = url.searchParams.get("r") ?? "";
			if (reason !== "") this.options.log?.(`live2d attach failed in renderer: ${reason}`);
		}
	}
	/**
	* Renderer-driven drag: apply one incremental integer offset. The constant
	* per-message cap keeps a rogue page from teleporting the window, and the
	* work-area clamp keeps it reachable. The `moved` listener already debounce-
	* persists the resulting position.
	*/
	handleManualMove(rawDx, rawDy) {
		const dx = Number.parseInt(rawDx ?? "", 10);
		const dy = Number.parseInt(rawDy ?? "", 10);
		if (Number.isNaN(dx) || Number.isNaN(dy)) return;
		if (Math.abs(dx) > MANUAL_MOVE_MAX_PX || Math.abs(dy) > MANUAL_MOVE_MAX_PX) return;
		const window = this.window;
		if (window === void 0 || window.isDestroyed()) return;
		const bounds = window.getBounds();
		const width = this.layoutWidth || bounds.width;
		const height = this.layoutHeight || bounds.height;
		const next = this.clampToWorkArea(bounds.x + dx, bounds.y + dy, width, height, this.options.electron.screen);
		window.setBounds({
			x: next.x,
			y: next.y,
			width,
			height
		});
	}
	run(code, delayMs) {
		const window = this.window;
		if (window === void 0 || window.isDestroyed()) return;
		const dispatch = () => {
			if (window.isDestroyed()) return;
			window.webContents.executeJavaScript(code, true).catch(() => {});
		};
		if (delayMs === void 0) dispatch();
		else setTimeout(dispatch, delayMs);
	}
	clampToWorkArea(x, y, width, height, screen) {
		const workArea = screen?.getDisplayMatching({
			x,
			y,
			width,
			height
		}).workArea;
		if (workArea === void 0) return {
			x,
			y,
			width,
			height
		};
		return {
			x: clamp(x, workArea.x, Math.max(workArea.x, workArea.x + workArea.width - width - WORK_AREA_MARGIN_PX)),
			y: clamp(y, workArea.y, Math.max(workArea.y, workArea.y + workArea.height - height - WORK_AREA_MARGIN_PX)),
			width,
			height
		};
	}
	schedulePositionSave() {
		if (this.saveTimer !== void 0) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = void 0;
			this.flushPositionSave();
		}, POSITION_SAVE_DEBOUNCE_MS);
	}
	flushPositionSave() {
		if (this.saveTimer !== void 0) {
			clearTimeout(this.saveTimer);
			this.saveTimer = void 0;
		}
		const window = this.window;
		if (window === void 0 || window.isDestroyed()) return;
		try {
			const bounds = window.getBounds();
			const file = {
				version: POSITION_FILE_VERSION,
				x: bounds.x,
				y: bounds.y
			};
			mkdirSync(dirname(this.options.statePath), { recursive: true });
			writeFileSync(this.options.statePath, `${JSON.stringify(file, void 0, 2)}\n`);
		} catch {}
	}
};
/** Resolve the per-character state file path under one runtime userData dir. */
function petStatePath(userDataDir, characterId) {
	return join(userDataDir, "plugins", "dsh-plugin-pets", `${characterId}.json`);
}
//#endregion
//#region src/index.ts
const PET_SCALES = [
	.75,
	1,
	1.25,
	1.5
];
function petSettingsSchema() {
	return z.object({
		enabled: z.boolean().default(true),
		scale: z.union(PET_SCALES).default(1),
		eventReactions: z.boolean().default(true),
		idleChatter: z.boolean().default(true)
	});
}
const TRAY_COPY = Object.freeze({
	zh: Object.freeze({
		pet: "桌宠",
		show: "显示桌宠",
		wave: "打个招呼",
		eventReactions: "响应会话与任务",
		idleChatter: "闲聊台词"
	}),
	en: Object.freeze({
		pet: "Pet",
		show: "Show companion",
		wave: "Say hello",
		eventReactions: "React to sessions and jobs",
		idleChatter: "Idle chatter"
	})
});
const STROLL_MIN_MS = 120 * 1e3;
const STROLL_MAX_MS = 4.5 * 60 * 1e3;
const ACTIVITY_QUIET_MS = 90 * 1e3;
const REACTION_CATEGORIES = Object.freeze({
	work: "work",
	cheer: "cheer",
	sad: "sad"
});
/**
* Build one complete Cordis pet plugin around a character document.
* The plugin stays completely inert outside the DSH Desktop launcher.
*/
function createPetPlugin(options) {
	const namespace = settingsNamespace(`dsh-${options.pluginName}`);
	return {
		name: options.pluginName,
		inject: ["desktopRuntime"],
		apply(ctx) {
			const runtime = ctx.get("desktopRuntime");
			if (runtime === void 0) {
				ctx.logger.info(`${options.pluginName}: desktop runtime unavailable; pet stays inactive`);
				return;
			}
			let character;
			let htmlPath;
			try {
				character = options.loadCharacter();
				htmlPath = options.loadHtmlPath();
			} catch (cause) {
				ctx.logger.error(`${options.pluginName}: character resources failed validation: ${cause instanceof Error ? cause.message : String(cause)}`);
				return;
			}
			const electron = (options.loadElectron ?? loadPetElectron)(import.meta.url);
			if (electron === void 0) {
				ctx.logger.info(`${options.pluginName}: Electron main module unavailable; pet stays inactive`);
				return;
			}
			const locale = () => runtime.locale === "zh" ? "zh" : "en";
			const trayCopy = () => TRAY_COPY[locale()];
			const schema = petSettingsSchema();
			let settings = schema({});
			let settingsScope;
			const patchSettings = (values) => {
				const scope = settingsScope;
				if (scope === void 0) return;
				scope.update(values).catch(() => {});
			};
			let controller;
			let trayRegistration;
			const tracker = new PetActivityTracker();
			let lastActivityAt = 0;
			let strollTimer;
			const line = (category) => pickPetLine(character, locale(), category);
			const syncPetWindow = (previous, next) => {
				if (previous.enabled !== next.enabled) {
					if (next.enabled) {
						controller?.open();
						controller?.applyScale(next.scale);
					} else controller?.close();
					return;
				}
				if (!next.enabled) return;
				if (previous.scale !== next.scale) controller?.applyScale(next.scale);
				if (previous.scale !== next.scale || previous.idleChatter !== next.idleChatter) controller?.reboot();
			};
			const applySetting = (values) => {
				const previous = settings;
				settings = {
					...settings,
					...values
				};
				patchSettings(values);
				syncPetWindow(previous, settings);
				trayRegistration?.refresh();
			};
			const react = (state) => {
				if (!settings.eventReactions) return;
				if (state === "idle") {
					controller?.emit("idle");
					return;
				}
				lastActivityAt = Date.now();
				controller?.emit(state, line(REACTION_CATEGORIES[state]));
			};
			const scheduleStroll = () => {
				const delay = STROLL_MIN_MS + Math.random() * (STROLL_MAX_MS - STROLL_MIN_MS);
				strollTimer = setTimeout(() => {
					strollTimer = void 0;
					if (settings.enabled && controller !== void 0 && controller.isVisible() && Date.now() - lastActivityAt > ACTIVITY_QUIET_MS) controller.stroll();
					scheduleStroll();
				}, delay);
			};
			ctx.effect(() => {
				controller = new PetWindowController({
					character,
					htmlPath,
					statePath: petStatePath(runtime.userDataDir, character.id),
					electron,
					locale,
					idleChatter: () => settings.idleChatter,
					...options.loadLive2DDir === void 0 ? {} : { live2dDir: options.loadLive2DDir },
					log: (message) => {
						ctx.logger.info(`${options.pluginName}: ${message}`);
					},
					onCommand: (command) => {
						if (command === "hide") applySetting({ enabled: false });
					}
				});
				if (settings.enabled) controller.open();
				scheduleStroll();
				return () => {
					if (strollTimer !== void 0) clearTimeout(strollTimer);
					strollTimer = void 0;
					controller?.dispose();
					controller = void 0;
				};
			}, `${options.pluginName}: pet window lifetime`);
			ctx.inject(["settings"], (settingsCtx) => {
				settingsCtx.effect(() => {
					const scope = settingsCtx.settings.register(namespace, schema, { applies: "live" });
					settingsScope = scope;
					const previous = settings;
					settings = scope.get();
					syncPetWindow(previous, settings);
					trayRegistration?.refresh();
					const stopWatching = scope.watch((next) => {
						const watched = settings;
						settings = next;
						syncPetWindow(watched, next);
						trayRegistration?.refresh();
					});
					return () => {
						stopWatching();
						settingsScope = void 0;
					};
				}, `${options.pluginName}: pet settings`);
			});
			trayRegistration = runtime.registerTrayItem({
				group: "tools",
				order: options.trayOrder,
				label: () => `${trayCopy().pet} · ${character.copy[locale()].label}`,
				invoke: () => {},
				submenu: () => [
					{
						type: "checkbox",
						label: () => trayCopy().show,
						checked: () => settings.enabled,
						invoke: () => {
							applySetting({ enabled: !settings.enabled });
						}
					},
					{
						label: () => trayCopy().wave,
						enabled: () => settings.enabled,
						invoke: () => {
							lastActivityAt = Date.now();
							controller?.emit("special", line("special"));
						}
					},
					{
						type: "checkbox",
						label: () => trayCopy().eventReactions,
						checked: () => settings.eventReactions,
						invoke: () => {
							applySetting({ eventReactions: !settings.eventReactions });
						}
					},
					{
						type: "checkbox",
						label: () => trayCopy().idleChatter,
						checked: () => settings.idleChatter,
						invoke: () => {
							applySetting({ idleChatter: !settings.idleChatter });
						}
					}
				]
			});
			ctx.effect(() => () => {
				trayRegistration?.dispose();
			}, `${options.pluginName}: tray item`);
			ctx.inject(["sessions"], (sessionsCtx) => {
				sessionsCtx.effect(() => {
					const events = sessionsCtx;
					const stopEvents = events.on("session/event", (session, event) => {
						const state = tracker.noteSessionEvent(session, event);
						if (state !== void 0) react(state);
					});
					const stopDisposed = events.on("session/disposed", (session) => {
						tracker.noteSessionDisposed(session);
					});
					return () => {
						stopDisposed();
						stopEvents();
					};
				}, `${options.pluginName}: session reactions`);
			});
			ctx.inject(["jobs"], (jobsCtx) => {
				jobsCtx.effect(() => jobsCtx.jobs.onJobDone((snapshot) => {
					const state = tracker.noteJobStatus(snapshot.status);
					if (state !== void 0) react(state);
				}), `${options.pluginName}: job reactions`);
			});
		}
	};
}
//#endregion
export { PET_LINE_CATEGORIES, PET_LIVE2D_RUNTIME_GLUE, PET_SCALES, PET_SPEECH_SLOT_PX, PetCharacterError, PetWindowController, createPetPlugin, loadPetElectron, parsePetCharacterDocument, petSettingsSchema, petStateDuration, petStatePath, pickPetLine, readPetLive2DCoreText, resolvePetLive2DUrls };

//# sourceMappingURL=index.js.map