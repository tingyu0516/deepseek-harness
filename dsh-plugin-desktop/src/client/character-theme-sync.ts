import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { FURINA_THEME, HUTAO_THEME } from './character-themes.ts'

/** Desktop-owned character-theme preference stored in `dsh-desktop`. */
export type DesktopCharacterThemePreference = 'off' | 'hutao' | 'furina'

const CHARACTER_THEME_IDS = new Set<string>(['hutao', 'furina'])
const OFFICIAL_THEME_PREFERENCES = new Set<string>(['light', 'dark', 'system'])

/** Theme service methods used to apply or restore a character theme. */
export interface DesktopCharacterThemeRuntime {
  /** Read the current preference id, falling back to the active theme id. */
  getTheme(): { readonly preference?: string; readonly active: { readonly id: string } }
  /** Switch to a registered theme id or a built-in appearance preference. */
  setTheme(id: string): void
}

/** Browser mirror of the official `ui-theme` preference section. */
export interface OfficialThemePreferenceScope {
  getSnapshot(): { readonly status: string; readonly value: { readonly preference?: string } | undefined }
}

/** DOM target used to project character-theme tokens independently of `setTheme`. */
export interface CharacterThemeStyleTarget {
  readonly style: {
    setProperty(name: string, value: string): void
    removeProperty(name: string): void
  }
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/**
 * @param id - current theme preference or active theme id.
 * @returns whether the id is a Desktop-owned character theme.
 */
export function isDesktopCharacterThemeId(id: string): id is Exclude<DesktopCharacterThemePreference, 'off'> {
  return CHARACTER_THEME_IDS.has(id)
}

/**
 * @param theme - live Client theme runtime.
 * @returns the preference id when present, otherwise the active theme id.
 */
export function currentThemeId(theme: DesktopCharacterThemeRuntime): string {
  return theme.getTheme().preference ?? theme.getTheme().active.id
}

/**
 * @param preference - Desktop-owned character-theme selection.
 * @returns the matching theme definition, or `undefined` when the selection is off.
 */
export function characterThemeDefinition(preference: DesktopCharacterThemePreference) {
  if (preference === 'hutao') return HUTAO_THEME
  if (preference === 'furina') return FURINA_THEME
  return undefined
}

/**
 * Replace the active palette with Hu Tao / Furina when Desktop settings ask for it.
 * Visuals must not depend on `setTheme` surviving the official npm `adopt()` path.
 * @param snapshot - current theme-service snapshot.
 * @param preference - Desktop-owned character-theme selection.
 */
export function snapshotWithCharacterTheme(
  snapshot: ThemeSnapshot,
  preference: DesktopCharacterThemePreference,
): ThemeSnapshot {
  const active = characterThemeDefinition(preference)
  return active ? { ...snapshot, active } : snapshot
}

/**
 * @param snapshot - Desktop settings scope snapshot.
 * @returns a concrete character-theme id only after settings are ready.
 */
export function readDesktopCharacterThemePreference(
  snapshot: {
    readonly status: string
    readonly value?: { readonly characterTheme?: unknown } | undefined
  },
): DesktopCharacterThemePreference {
  if (snapshot.status !== 'ready') return 'off'
  return characterThemePreference(snapshot.value?.characterTheme)
}

/**
 * Apply or clear a Desktop character theme without writing `ui-theme.preference`.
 * @param theme - live Client theme runtime.
 * @param characterTheme - Desktop-owned selection.
 * @param officialPreference - built-in Appearance value to restore when turning off.
 */
export function applyDesktopCharacterThemePreference(
  theme: DesktopCharacterThemeRuntime,
  characterTheme: DesktopCharacterThemePreference,
  officialPreference = 'system',
): void {
  if (characterTheme === 'off') {
    if (isDesktopCharacterThemeId(currentThemeId(theme))) {
      theme.setTheme(officialThemePreference(officialPreference))
    }
    return
  }
  if (currentThemeId(theme) !== characterTheme) {
    theme.setTheme(characterTheme)
  }
}

/**
 * Write character-theme tokens onto a style target as a last-writer overlay.
 * @param target - usually `document.body`.
 */
export function createCharacterThemeProjector(target: CharacterThemeStyleTarget = document.body) {
  let applied: string[] = []
  const apply = (preference: DesktopCharacterThemePreference): void => {
    const def = characterThemeDefinition(preference)
    for (const name of applied) {
      if (!def?.tokens[name]) target.style.removeProperty(name)
    }
    applied = []
    if (!def) return
    for (const [name, value] of Object.entries(def.tokens)) {
      target.style.setProperty(name, value)
      applied.push(name)
    }
    if (def.colorScheme === 'dark') target.setAttribute('data-ds-dark-theme', '')
    else target.removeAttribute('data-ds-dark-theme')
  }
  return {
    apply,
    dispose(): void {
      for (const name of applied) target.style.removeProperty(name)
      applied = []
    },
  }
}

/**
 * Keep Hu Tao / Furina aligned with Desktop settings.
 * `setTheme` is best-effort: the official npm runtime may adopt a built-in
 * preference afterwards. Token projection is the source of truth for visuals.
 * @returns disposer that stops settings and theme subscriptions.
 */
export function syncDesktopCharacterTheme(input: {
  theme: DesktopCharacterThemeRuntime
  desktopSettings: SettingsScope<{ characterTheme?: DesktopCharacterThemePreference }>
  officialTheme?: OfficialThemePreferenceScope
  onThemeChange: (listener: (snapshot: {
    readonly preference?: string
    readonly active: { readonly id: string }
  }) => void) => () => void
  project?: (preference: DesktopCharacterThemePreference) => void
  schedule?: (task: () => void) => void
}): () => void {
  const schedule = input.schedule ?? queueMicrotask
  const applyFromSettings = (): void => {
    const snapshot = input.desktopSettings.getSnapshot()
    if (snapshot.status !== 'ready') return
    const selected = characterThemePreference(snapshot.value?.characterTheme)
    applyDesktopCharacterThemePreference(
      input.theme,
      selected,
      officialPreference(input.officialTheme),
    )
    input.project?.(selected)
  }
  applyFromSettings()
  const stopSettings = input.desktopSettings.subscribe(applyFromSettings)
  const stopTheme = input.onThemeChange(() => {
    const selected = readDesktopCharacterThemePreference(input.desktopSettings.getSnapshot())
    if (selected === 'off') return
    // Official presenters and npm adopt() write in this turn. Re-assert after they finish.
    schedule(() => {
      if (readDesktopCharacterThemePreference(input.desktopSettings.getSnapshot()) !== selected) return
      input.project?.(selected)
    })
  })
  return () => {
    stopSettings()
    stopTheme()
  }
}

function characterThemePreference(value: unknown): DesktopCharacterThemePreference {
  return value === 'hutao' || value === 'furina' ? value : 'off'
}

function officialPreference(scope: OfficialThemePreferenceScope | undefined): string {
  return officialThemePreference(scope?.getSnapshot().value?.preference)
}

function officialThemePreference(value: unknown): 'light' | 'dark' | 'system' {
  return typeof value === 'string' && OFFICIAL_THEME_PREFERENCES.has(value)
    ? value as 'light' | 'dark' | 'system'
    : 'system'
}
