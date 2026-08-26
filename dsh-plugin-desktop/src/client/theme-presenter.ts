import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import {
  readDesktopCharacterThemePreference,
  snapshotWithCharacterTheme,
  type DesktopCharacterThemePreference,
} from './character-theme-sync.ts'
import { DESKTOP_SHELL_SETTINGS_NAMESPACE } from './desktop-settings.ts'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Projects the resolved theme service snapshot onto the desktop document. */
export class DesktopThemePresenter {
  private appliedTokens: string[] = []
  private readonly themeColorMeta = document.createElement('meta')

  constructor() {
    this.themeColorMeta.name = 'theme-color'
  }

  /** @param snapshot - current resolved palette and token overrides. */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    if (scheme === 'dark') document.body.setAttribute(DARK_ATTRIBUTE, '')
    else document.body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.appliedTokens) document.body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      document.body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.appendChild(this.themeColorMeta)
  }

  /** Remove only DOM state owned by this presenter. */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    document.body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.appliedTokens) document.body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
  }
}

/**
 * Project the live theme snapshot, overlaying Hu Tao / Furina from Desktop
 * settings so enhanced and extended shells do not depend on `setTheme`.
 * @param ctx - browser Cordis context.
 */
export function installDesktopThemePresenter(ctx: ClientContext): () => void {
  const presenter = new DesktopThemePresenter()
  const desktopSettings = ctx.settingsScope.bind<{ characterTheme?: DesktopCharacterThemePreference }>({
    namespace: DESKTOP_SHELL_SETTINGS_NAMESPACE,
  })
  const applySnapshot = (snapshot: ThemeSnapshot): void => {
    presenter.apply(snapshotWithCharacterTheme(
      snapshot,
      readDesktopCharacterThemePreference(desktopSettings.getSnapshot()),
    ))
  }
  applySnapshot(ctx.theme.getTheme())
  const offTheme = ctx.on('theme/change', applySnapshot)
  const offSettings = desktopSettings.subscribe(() => applySnapshot(ctx.theme.getTheme()))
  return () => {
    offTheme()
    offSettings()
    presenter.dispose()
  }
}
