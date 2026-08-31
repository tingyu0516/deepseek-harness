/** Shared factory for DSH Desktop character pet plugins. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type PetCharacterDocument } from './contracts.ts';
import { type PetElectron } from './pet-window.ts';
export { parsePetCharacterDocument, pickPetLine, PetCharacterError, PET_LINE_CATEGORIES, } from './contracts.ts';
export type { PetCharacterDocument, PetCharacterId, PetLineCategory, PetLines, PetLocale, PetState, } from './contracts.ts';
export type { PetActivityEvent } from './pet-events.ts';
export { loadPetElectron, petStatePath, petStateDuration, PetWindowController, resolvePetLive2DUrls, PET_SPEECH_SLOT_PX, } from './pet-window.ts';
export { readPetLive2DCoreText, readPetLive2DViewerText } from './pet-live2d-host.ts';
export type { PetBootPayload, PetBrowserWindow, PetElectron, PetLive2DAssets, PetLive2DSelection, PetRectangle, PetRuntimeHost, } from './pet-window.ts';
/** Settings presented by every character pet plugin. */
export interface PetSettings {
    /** Whether the pet window should exist at all. */
    enabled: boolean;
    /** Window scale multiplier applied live. */
    scale: number;
    /** Whether agent turns and jobs drive pet reactions. */
    eventReactions: boolean;
    /** Whether the pet speaks unprompted idle lines. */
    idleChatter: boolean;
}
export declare const PET_SCALES: readonly [0.75, 1, 1.25, 1.5];
export declare function petSettingsSchema(): z<Schemastery.ObjectS<{
    enabled: z<boolean, boolean>;
    scale: z<1 | 0.75 | 1.25 | 1.5, 1 | 0.75 | 1.25 | 1.5>;
    eventReactions: z<boolean, boolean>;
    idleChatter: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    enabled: z<boolean, boolean>;
    scale: z<1 | 0.75 | 1.25 | 1.5, 1 | 0.75 | 1.25 | 1.5>;
    eventReactions: z<boolean, boolean>;
    idleChatter: z<boolean, boolean>;
}>>;
/** Inputs one character pet plugin entry provides to the shared factory. */
export interface PetPluginOptions {
    /** Stable Cordis row/plugin name, e.g. `desktop-pet-hutao`. */
    readonly pluginName: string;
    /** Lazily read and validate the shipped character document. */
    readonly loadCharacter: () => PetCharacterDocument;
    /** Lazily resolve the shared renderer page inside this installation. */
    readonly loadHtmlPath: () => string;
    /**
     * Lazily resolve the plugin's `assets/live2d/` directory. When the
     * directory or its model assets are missing, the pet window stays closed.
     */
    readonly loadLive2DDir?: () => string | undefined;
    /** Tray order inside the `tools` group. */
    readonly trayOrder: number;
    /** Test seam for the Electron main-process module. */
    readonly loadElectron?: (moduleUrl: string) => PetElectron | undefined;
}
/**
 * Build one complete Cordis pet plugin around a character document.
 * The plugin stays completely inert outside the DSH Desktop launcher.
 */
export declare function createPetPlugin(options: PetPluginOptions): {
    readonly name: string;
    readonly inject: readonly string[];
    readonly apply: (ctx: Context) => void;
};
