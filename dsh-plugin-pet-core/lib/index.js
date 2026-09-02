import { createRequire } from "node:module";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, sep } from "node:path";
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
	let expressionParameters;
	const rawExpressionParameters = value.expressionParameters;
	if (rawExpressionParameters !== void 0 && rawExpressionParameters !== null) {
		if (!isObject(rawExpressionParameters)) throw new PetCharacterError(`${path}.expressionParameters must be an object`);
		const mappedExpressionParameters = {};
		for (const [name, id] of Object.entries(rawExpressionParameters)) {
			if (name.length === 0 || typeof id !== "string" || id.length === 0) throw new PetCharacterError(`${path}.expressionParameters entries must map non-empty names to parameter ids`);
			mappedExpressionParameters[name] = id;
		}
		expressionParameters = Object.freeze(mappedExpressionParameters);
	}
	let tapFallbackGroups;
	const rawFallback = value.tapFallbackGroups;
	if (rawFallback !== void 0 && rawFallback !== null) {
		if (!Array.isArray(rawFallback) || rawFallback.some((id) => typeof id !== "string" || id.length === 0)) throw new PetCharacterError(`${path}.tapFallbackGroups must be an array of motion group names`);
		tapFallbackGroups = Object.freeze([...rawFallback]);
	}
	let hitAreaMotions;
	const rawHitAreaMotions = value.hitAreaMotions;
	if (rawHitAreaMotions !== void 0 && rawHitAreaMotions !== null) {
		if (!isObject(rawHitAreaMotions)) throw new PetCharacterError(`${path}.hitAreaMotions must be an object`);
		const mappedHitAreaMotions = {};
		for (const [name, group] of Object.entries(rawHitAreaMotions)) {
			if (name.length === 0 || typeof group !== "string" || group.length === 0) throw new PetCharacterError(`${path}.hitAreaMotions entries must map non-empty names to motion groups`);
			mappedHitAreaMotions[name] = group;
		}
		hitAreaMotions = Object.freeze(mappedHitAreaMotions);
	}
	let motionEndReset;
	const rawEndReset = value.motionEndReset;
	if (rawEndReset !== void 0 && rawEndReset !== null) {
		if (!isObject(rawEndReset)) throw new PetCharacterError(`${path}.motionEndReset must be an object`);
		const mappedEndReset = {};
		for (const [id, num] of Object.entries(rawEndReset)) {
			if (id.length === 0 || typeof num !== "number" || Number.isNaN(num)) throw new PetCharacterError(`${path}.motionEndReset entries must map non-empty parameter ids to numbers`);
			mappedEndReset[id] = num;
		}
		motionEndReset = Object.freeze(mappedEndReset);
	}
	let expressionCycles;
	const rawCycles = value.expressionCycles;
	if (rawCycles !== void 0 && rawCycles !== null) {
		if (!isObject(rawCycles)) throw new PetCharacterError(`${path}.expressionCycles must be an object`);
		const mappedCycles = {};
		for (const [name, cycle] of Object.entries(rawCycles)) {
			if (name.length === 0 || !isObject(cycle) || typeof cycle.param !== "string" || cycle.param.length === 0 || typeof cycle.from !== "number" || typeof cycle.to !== "number" || typeof cycle.period !== "number" || !Number.isFinite(cycle.period) || cycle.period <= 0) throw new PetCharacterError(`${path}.expressionCycles.${name || "(empty)"} must map a name to { param, from, to, period > 0 }`);
			mappedCycles[name] = Object.freeze({
				param: cycle.param,
				from: cycle.from,
				to: cycle.to,
				period: cycle.period
			});
		}
		expressionCycles = Object.freeze(mappedCycles);
	}
	let lookOriginY;
	const rawLookOriginY = value.lookOriginY;
	if (rawLookOriginY !== void 0 && rawLookOriginY !== null) {
		if (typeof rawLookOriginY !== "number" || !Number.isFinite(rawLookOriginY) || rawLookOriginY < 0 || rawLookOriginY > 1) throw new PetCharacterError(`${path}.lookOriginY must be a number between 0 and 1`);
		lookOriginY = rawLookOriginY;
	}
	let expressionHoldMs;
	const rawHold = value.expressionHoldMs;
	if (rawHold !== void 0 && rawHold !== null) {
		if (typeof rawHold !== "number" || !Number.isFinite(rawHold) || rawHold <= 0) throw new PetCharacterError(`${path}.expressionHoldMs must be a positive number`);
		expressionHoldMs = rawHold;
	}
	let idleVariants;
	const rawVariants = value.idleVariants;
	if (rawVariants !== void 0 && rawVariants !== null) {
		if (!isObject(rawVariants)) throw new PetCharacterError(`${path}.idleVariants must be an object`);
		let expressions;
		if (rawVariants.expressions !== void 0 && rawVariants.expressions !== null) {
			if (!Array.isArray(rawVariants.expressions) || rawVariants.expressions.some((id) => typeof id !== "string" || id.length === 0)) throw new PetCharacterError(`${path}.idleVariants.expressions must be an array of expression names`);
			expressions = Object.freeze([...rawVariants.expressions]);
		}
		let everyMs;
		if (rawVariants.everyMs !== void 0 && rawVariants.everyMs !== null) {
			if (typeof rawVariants.everyMs !== "number" || !Number.isFinite(rawVariants.everyMs) || rawVariants.everyMs <= 0) throw new PetCharacterError(`${path}.idleVariants.everyMs must be a positive number`);
			everyMs = rawVariants.everyMs;
		}
		let holdMs;
		if (rawVariants.holdMs !== void 0 && rawVariants.holdMs !== null) {
			if (typeof rawVariants.holdMs !== "number" || !Number.isFinite(rawVariants.holdMs) || rawVariants.holdMs <= 0) throw new PetCharacterError(`${path}.idleVariants.holdMs must be a positive number`);
			holdMs = rawVariants.holdMs;
		}
		idleVariants = Object.freeze({
			...expressions === void 0 ? {} : { expressions },
			...everyMs === void 0 ? {} : { everyMs },
			...holdMs === void 0 ? {} : { holdMs }
		});
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
		...expressionParameters === void 0 ? {} : { expressionParameters },
		...tapFallbackGroups === void 0 ? {} : { tapFallbackGroups },
		...hitAreaMotions === void 0 ? {} : { hitAreaMotions },
		...motionEndReset === void 0 ? {} : { motionEndReset },
		...expressionCycles === void 0 ? {} : { expressionCycles },
		...lookOriginY === void 0 ? {} : { lookOriginY },
		...expressionHoldMs === void 0 ? {} : { expressionHoldMs },
		...idleVariants === void 0 ? {} : { idleVariants },
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
//#region src/pet-live2d-host.ts
/** Host-side Live2D runtime: inject Cubism Core, the official viewer, and assets. */
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
/** Prefix matching `LAppDefine.ShaderPath` in the official sample. */
const CUBISM_SHADER_PREFIX = "dsh-cubism-shaders/";
function packageRoot() {
	const here = dirname(fileURLToPath(import.meta.url));
	const name = basename(here);
	return name === "src" || name === "lib" ? dirname(here) : here;
}
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
function chunksFromBase64(key, b64) {
	const parts = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS));
	const chunks = [];
	for (let part = 0; part < parts; part += 1) chunks.push({
		key,
		part,
		parts,
		data: b64.slice(part * CHUNK_CHARS, (part + 1) * CHUNK_CHARS)
	});
	return chunks;
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
	for (const { key, index } of order) chunks.push(...chunksFromBase64(key, contents[index]));
	return chunks;
}
/**
* Official Cubism WebGL shaders, keyed so the Framework `fetch` of
* `ShaderPath + filename` hits the injected table.
*/
function collectPetLive2DShaderChunks() {
	const dir = join(packageRoot(), "vendor", "cubism-shaders");
	if (!existsSync(dir)) return [];
	const chunks = [];
	for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
		if (!entry.endsWith(".vert") && !entry.endsWith(".frag")) continue;
		const b64 = readFileSync(join(dir, entry)).toString("base64");
		chunks.push(...chunksFromBase64(`${CUBISM_SHADER_PREFIX}${entry}`, b64));
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
* Official Cubism Framework viewer IIFE. Production reads the built
* `lib/pet-live2d-viewer.js` (or tsdown's `.iife.js` name); tests fall
* back to a tiny stub so injection coverage does not require a prior bundle.
*/
function readPetLive2DViewerText() {
	const root = packageRoot();
	for (const name of ["pet-live2d-viewer.js", "pet-live2d-viewer.iife.js"]) {
		const built = join(root, "lib", name);
		if (existsSync(built)) return readFileSync(built, "utf8");
	}
	const stub = join(root, "tests", "fixtures", "pet-live2d-viewer.stub.js");
	if (existsSync(stub)) return readFileSync(stub, "utf8");
	throw new Error("pet live2d viewer bundle missing; run the package build");
}
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
		...live2d.expressionParameters === void 0 ? {} : { expressionParameters: live2d.expressionParameters },
		...live2d.tapFallbackGroups === void 0 ? {} : { tapFallbackGroups: live2d.tapFallbackGroups },
		...live2d.hitAreaMotions === void 0 ? {} : { hitAreaMotions: live2d.hitAreaMotions },
		...live2d.motionEndReset === void 0 ? {} : { motionEndReset: live2d.motionEndReset },
		...live2d.expressionCycles === void 0 ? {} : { expressionCycles: live2d.expressionCycles },
		...live2d.lookOriginY === void 0 ? {} : { lookOriginY: live2d.lookOriginY },
		...live2d.expressionHoldMs === void 0 ? {} : { expressionHoldMs: live2d.expressionHoldMs },
		...live2d.idleVariants === void 0 ? {} : { idleVariants: live2d.idleVariants },
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
const WORK_AREA_MARGIN_PX = 8;
/** Window pixels reserved above the character so speech never covers the model.
*  Keep in sync with `--pet-speech-slot` in `pet.html`. */
const PET_SPEECH_SLOT_PX = 80;
/** Per-message cap for renderer-driven drag deltas. */
const MANUAL_MOVE_MAX_PX = 64;
/** Reject grab offsets outside the pet window (plus a small margin). */
const DRAG_GRAB_MAX_PX = 4096;
const POSITION_SAVE_DEBOUNCE_MS = 600;
/** OS cursor polling cadence for screen-wide look-at tracking and drag follow. */
const CURSOR_TRACK_MS = 16;
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
/** Overlay flags that keep the pet on every Space, including fullscreen. */
const PET_ALL_WORKSPACES = Object.freeze({
	visibleOnFullScreen: true,
	skipTransformProcessType: true
});
/** Pin the pet above other windows and onto every macOS Space / Linux workspace. */
function pinPetAcrossWorkspaces(window) {
	window.setAlwaysOnTop(true, "screen-saver");
	window.setVisibleOnAllWorkspaces(true, PET_ALL_WORKSPACES);
}
/**
* Reveal the overlay and re-apply workspace pinning.
* macOS assigns a Space at `show()`; `showInactive()` plus a post-show pin
* keeps four-finger Space swipes from leaving the pet on the creation desktop.
*/
function presentPetWindow(window) {
	if (process.platform === "darwin") window.showInactive();
	else window.show();
	pinPetAcrossWorkspaces(window);
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
/** Own one pet window: creation, pushes, persistence, disposal. */
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
	cursorTimer;
	lastCursor;
	/** Grab offset while the Host follows the OS cursor during a drag. */
	dragGrab;
	dragTimer;
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
			if (!existing.isVisible()) presentPetWindow(existing);
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
			...process.platform === "darwin" ? { type: "panel" } : {},
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
		pinPetAcrossWorkspaces(window);
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
			if (!this.disposed && this.window === window && !window.isDestroyed()) {
				presentPetWindow(window);
				this.startCursorTracking();
			}
		});
		window.on("closed", () => {
			if (this.window === window) this.window = void 0;
			this.pageReady = false;
			this.stopManualDrag(false);
			this.stopCursorTracking();
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
		this.stopManualDrag(false);
		this.flushPositionSave();
		this.stopCursorTracking();
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
	* Evaluate the operator-procured Cubism Core, the official viewer, and the
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
				await evaluate(`/* DSH pet Cubism viewer */\n${readPetLive2DViewerText()}\nvoid 0;\n`);
				for (const chunk of [...collectPetLive2DShaderChunks(), ...collectPetLive2DAssetChunks(live2dDir)]) await evaluate(petLive2DChunkStatement(chunk));
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
		if (command === "dragstart") {
			this.startManualDrag(url.searchParams.get("ox"), url.searchParams.get("oy"));
			return;
		}
		if (command === "dragend" && url.search === "") {
			this.stopManualDrag(true);
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
		const parsedDx = Number.parseInt(rawDx ?? "", 10);
		const parsedDy = Number.parseInt(rawDy ?? "", 10);
		if (Number.isNaN(parsedDx) || Number.isNaN(parsedDy)) return;
		const dx = clamp(parsedDx, -64, MANUAL_MOVE_MAX_PX);
		const dy = clamp(parsedDy, -64, MANUAL_MOVE_MAX_PX);
		if (dx === 0 && dy === 0) return;
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
	/** Follow the OS cursor until {@link stopManualDrag}, using the grab offset. */
	startManualDrag(rawOx, rawOy) {
		const ox = Number.parseInt(rawOx ?? "", 10);
		const oy = Number.parseInt(rawOy ?? "", 10);
		if (Number.isNaN(ox) || Number.isNaN(oy)) return;
		if (Math.abs(ox) > DRAG_GRAB_MAX_PX || Math.abs(oy) > DRAG_GRAB_MAX_PX) return;
		if (!this.isOpen()) return;
		this.dragGrab = {
			ox,
			oy
		};
		this.stopCursorTracking();
		if (this.dragTimer === void 0) this.dragTimer = setInterval(() => {
			this.tickManualDrag();
		}, CURSOR_TRACK_MS);
		this.tickManualDrag();
	}
	/**
	* @param resumeLookAt - restore screen-wide look-at after a user drag ends.
	*   Closing the window passes false so a disposed controller does not restart
	*   the cursor poller.
	*/
	stopManualDrag(resumeLookAt) {
		if (this.dragTimer !== void 0) {
			clearInterval(this.dragTimer);
			this.dragTimer = void 0;
		}
		this.dragGrab = void 0;
		if (resumeLookAt && this.isVisible()) this.startCursorTracking();
	}
	tickManualDrag() {
		const grab = this.dragGrab;
		const window = this.window;
		if (grab === void 0 || window === void 0 || window.isDestroyed()) {
			this.stopManualDrag(false);
			return;
		}
		const point = this.options.electron.screen?.getCursorScreenPoint?.();
		if (point === void 0) return;
		const width = this.layoutWidth;
		const height = this.layoutHeight;
		const next = this.clampToWorkArea(point.x - grab.ox, point.y - grab.oy, width, height, this.options.electron.screen);
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
	/**
	* Feed the model's look-at target from the OS cursor so the pet tracks the
	* mouse across the whole screen, not only while it hovers the window. The
	* poller is the off-window complement of the page's own mousemove feed:
	* while the cursor is over the pet both produce the same client point, and
	* once it leaves only this keeps updating.
	*/
	startCursorTracking() {
		if (this.cursorTimer !== void 0) return;
		this.cursorTimer = setInterval(() => {
			this.pollCursor();
		}, CURSOR_TRACK_MS);
	}
	stopCursorTracking() {
		if (this.cursorTimer !== void 0) clearInterval(this.cursorTimer);
		this.cursorTimer = void 0;
		this.lastCursor = void 0;
	}
	pollCursor() {
		const window = this.window;
		if (window === void 0 || window.isDestroyed() || !this.isOpen() || !this.isVisible()) return;
		const point = this.options.electron.screen?.getCursorScreenPoint?.();
		if (point === void 0) return;
		const bounds = window.getBounds();
		const x = point.x - bounds.x;
		const y = point.y - bounds.y;
		if (this.lastCursor !== void 0 && this.lastCursor.x === x && this.lastCursor.y === y) return;
		this.lastCursor = {
			x,
			y
		};
		this.run(`var rt = window.__dshPetLive2DRuntime; rt && rt.setPointer(${x}, ${y});`);
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
		enabled: z.boolean().default(false),
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
				controller?.emit(state, line(REACTION_CATEGORIES[state]));
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
				return () => {
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
export { PET_LINE_CATEGORIES, PET_SCALES, PET_SPEECH_SLOT_PX, PetCharacterError, PetWindowController, createPetPlugin, loadPetElectron, parsePetCharacterDocument, petSettingsSchema, petStateDuration, petStatePath, pickPetLine, readPetLive2DCoreText, readPetLive2DViewerText, resolvePetLive2DUrls };

//# sourceMappingURL=index.js.map