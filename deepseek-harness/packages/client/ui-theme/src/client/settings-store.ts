/**
 * Appearance row slot store: a mirror of the theme service snapshot. The
 * plugin's apply-world change listener is the only writer; the row component
 * reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Active preference or custom theme id (selection state reads this). */
  preference: string
  /** Registered theme ids, including built-ins and character themes. */
  themes: string[]
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (
    draft: AppearanceRowState,
    preference: string,
    revision: number,
    themes?: readonly string[],
  ) => void
}

/**
 * Declares the Appearance row state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({ preference: 'system', themes: [], revision: -1 }),
    actions: {
      sync: (d, preference: string, revision: number, themes: readonly string[] = []) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.themes = [...themes]
        d.revision = revision
      },
    },
  })
}
