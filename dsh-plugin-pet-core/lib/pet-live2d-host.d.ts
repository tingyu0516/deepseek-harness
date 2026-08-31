/** Host-side Live2D runtime: inject Cubism Core, the official viewer, and assets. */
/** Prefix matching `LAppDefine.ShaderPath` in the official sample. */
export declare const CUBISM_SHADER_PREFIX = "dsh-cubism-shaders/";
export interface PetLive2DAssetChunk {
    /** Forward-slash path relative to the asset directory (matches model refs). */
    readonly key: string;
    readonly part: number;
    readonly parts: number;
    readonly data: string;
}
/**
 * Read every whitelisted Live2D asset under `dir` and cut them into
 * base64 chunks for in-page delivery. Ordered deterministically so repeated
 * boots behave identically.
 */
export declare function collectPetLive2DAssetChunks(dir: string): PetLive2DAssetChunk[];
/**
 * Official Cubism WebGL shaders, keyed so the Framework `fetch` of
 * `ShaderPath + filename` hits the injected table.
 */
export declare function collectPetLive2DShaderChunks(): PetLive2DAssetChunk[];
/** Evaluate-ready JS statement appending one chunk into the page-side stash.
 *  Ends with `void 0` so executeJavaScript has no multi-megabyte completion
 *  value to structured-clone back over IPC. */
export declare function petLive2DChunkStatement(chunk: PetLive2DAssetChunk): string;
/** Finalize statement folding the part stash into the resolved asset table. */
export declare function petLive2DFinalizeStatement(): string;
/**
 * Official Cubism Framework viewer IIFE. Production reads the built
 * `lib/pet-live2d-viewer.js` (or tsdown's `.iife.js` name); tests fall
 * back to a tiny stub so injection coverage does not require a prior bundle.
 */
export declare function readPetLive2DViewerText(): string;
/**
 * Read the operator-procured Cubism Core script from a file URL or plain path.
 * @throws when unreadable; callers treat any failure as "keep the pet window
 * closed".
 */
export declare function readPetLive2DCoreText(coreFileUrlOrPath: string): string;
