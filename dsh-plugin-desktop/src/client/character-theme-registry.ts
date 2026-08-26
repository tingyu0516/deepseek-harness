import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client'
import { CHARACTER_THEMES } from './character-themes.ts'

const CHARACTER_THEME_BACKGROUND_STYLES = `
body,
#root {
  background-image: var(--dsw-character-bg-image, none);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
`

/** Theme service methods used to compose Desktop character themes. */
export interface DesktopCharacterThemeService {
  /** Read the current registry so Desktop can skip ids the official plugin already owns. */
  getTheme(): { readonly themes: readonly { readonly id: string }[] }
  /** Register one selectable theme; duplicate ids throw. */
  register(definition: ThemeDefinition): () => void
  /** Restore a previously selected non-builtin theme when the official runtime provides it. */
  restoreLocalCustom?: () => void
}

/**
 * Apply the character-theme wallpaper hook without replacing official token sheets.
 * @returns disposer that removes the injected stylesheet.
 */
export function installCharacterThemeBackgroundStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/character-theme-background'
  style.textContent = CHARACTER_THEME_BACKGROUND_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * Register Hu Tao and Furina through the official theme service.
 * @param theme - live Client theme runtime.
 * @returns disposer that unregisters only themes this call added.
 */
export function registerDesktopCharacterThemes(theme: DesktopCharacterThemeService): () => void {
  const existing = new Set(theme.getTheme().themes.map(item => item.id))
  const disposers: Array<() => void> = []
  for (const definition of CHARACTER_THEMES) {
    if (existing.has(definition.id)) continue
    disposers.push(theme.register(definition))
  }
  theme.restoreLocalCustom?.()
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
