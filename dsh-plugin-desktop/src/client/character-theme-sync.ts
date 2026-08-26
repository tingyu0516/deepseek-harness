import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

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
 * Keep the registered Hu Tao / Furina themes aligned with Desktop settings.
 * Re-applies the character theme if the official runtime adopts a built-in preference.
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
}): () => void {
  const applyFromSettings = (): void => {
    const snapshot = input.desktopSettings.getSnapshot()
    if (snapshot.status !== 'ready') return
    applyDesktopCharacterThemePreference(
      input.theme,
      characterThemePreference(snapshot.value?.characterTheme),
      officialPreference(input.officialTheme),
    )
  }
  applyFromSettings()
  const stopSettings = input.desktopSettings.subscribe(applyFromSettings)
  const stopTheme = input.onThemeChange((snapshot) => {
    const desktop = input.desktopSettings.getSnapshot()
    if (desktop.status !== 'ready') return
    const selected = characterThemePreference(desktop.value?.characterTheme)
    if (selected === 'off') return
    const id = snapshot.preference ?? snapshot.active.id
    if (id !== selected) input.theme.setTheme(selected)
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
