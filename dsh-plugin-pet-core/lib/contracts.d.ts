/** Strict contract for one character pet document shipped by a pet plugin. */
/** Pet identities owned by the shipped character plugins. */
export type PetCharacterId = 'hutao' | 'furina';
/** Locales shared with the desktop runtime tray. */
export type PetLocale = 'zh' | 'en';
/** Renderer states driven by the engine page. */
export type PetState = 'greet' | 'idle' | 'work' | 'cheer' | 'sad' | 'pat' | 'special' | 'walk';
/** Line categories a character document must provide per locale. */
export type PetLineCategory = 'greet' | 'idle' | 'work' | 'cheer' | 'sad' | 'pat' | 'special';
/** All line categories in canonical order. */
export declare const PET_LINE_CATEGORIES: readonly PetLineCategory[];
/** One locale's spoken lines grouped by category. */
export type PetLines = Readonly<Record<PetLineCategory, readonly string[]>>;
/** Accent colors consumed by the renderer page. */
export interface PetPalette {
    /** Primary character accent used for highlights and focus rings. */
    readonly accent: string;
    /** Speech-bubble fill. */
    readonly bubbleBg: string;
    /** Speech-bubble label color. */
    readonly bubbleText: string;
    /** Speech-bubble border color. */
    readonly bubbleBorder: string;
}
/** Localized names and one locale's lines for one character. */
export interface PetCopy {
    /** Native character name shown in the tray and window title. */
    readonly label: string;
    readonly lines: PetLines;
}
/** Optional Live2D assets referenced by one character document. */
export interface PetLive2DDocument {
    /** `.model3.json` file name resolved relative to the plugin's `assets/live2d/` directory. */
    readonly model: string;
    /**
     * Cubism Core script file name resolved relative to the same directory.
     * Defaults to `vendor/live2dcubismcore.min.js`; this repository never ships
     * the Core binary itself — deployments that want Live2D rendering procure
     * it under the Live2D Cubism SDK license agreement.
     */
    readonly core?: string;
    /**
     * Parameter ids forced to `0` every frame before drawing, hiding optional
     * built-in props (e.g. a fan-made watermark sign board). Motion curves are
     * expected never to drive these ids; the clamp runs after motion sampling.
     */
    readonly hideParameters?: readonly string[];
    /**
     * Cubism Part ids whose opacity is forced to `0` after `model.update()`.
     * Use this when a prop stays visible at parameter value 0 because it is a
     * separate Part (Furina's "牌子" is `Part187`).
     */
    readonly hideParts?: readonly string[];
    /**
     * Parts to stop pinning while a named expression is active. Furina's
     * `walkSwitch` reveals `Part148` (走路2) for the walking overlay.
     */
    readonly expressionRevealParts?: Readonly<Record<string, readonly string[]>>;
    /**
     * Form switch keyed by one Cubism parameter (Furina's `Param4` 变色).
     * The renderer latches the parameter to 1 at boot (pneuma / white).
     * Optional `lowParts` / `highParts` hide the opposite duplicate outfit;
     * omit them when the parameter already recolors the visible meshes.
     */
    readonly outfit?: {
        readonly parameter: string;
        readonly lowParts?: readonly string[];
        readonly highParts?: readonly string[];
    };
}
/** Fully validated character document rendered by the shared pet page. */
export interface PetCharacterDocument {
    readonly id: PetCharacterId;
    readonly copy: Readonly<Record<PetLocale, PetCopy>>;
    readonly palette: PetPalette;
    /** Window content size in CSS pixels at scale 1. */
    readonly baseSize: {
        readonly width: number;
        readonly height: number;
    };
    /** Live2D asset metadata; the only renderer this engine supports. */
    readonly live2d: PetLive2DDocument;
}
/** Error thrown for any character document that fails strict validation. */
export declare class PetCharacterError extends Error {
    constructor(message: string);
}
/**
 * Validate one untrusted character document.
 * @param value - parsed JSON from a pet plugin's character.json asset.
 * @returns a frozen, strictly typed character document.
 * @throws {@link PetCharacterError} when any field is missing or malformed.
 */
export declare function parsePetCharacterDocument(value: unknown): PetCharacterDocument;
/** Pick one line deterministically-ish from a category for a locale. */
export declare function pickPetLine(character: PetCharacterDocument, locale: PetLocale, category: PetLineCategory, random?: () => number): string;
