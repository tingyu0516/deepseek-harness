import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from './contracts.ts'
import type { DesktopClientEnvironment } from './environment.ts'
import type { DesktopShellSettings } from './DesktopSettingsSection.tsx'
import { AdvancedFrame } from './AdvancedFrame.tsx'
import { DesktopFrameTitlebar } from './ExtendedTitlebar.tsx'
import { createDesktopSettingsApi } from './desktop-settings-api.ts'
import { DesktopLayoutState } from './layout-state.ts'
import { provideDesktopLayout } from './layout-service.ts'
import { installDesktopOwnedStyles } from './styles.ts'
import { installExtendedStyles } from './extended-styles.ts'
import { installDesktopThemePresenter } from './theme-presenter.ts'

/** Own the enhanced layout and root slot without installing an independent frame. */
export function applyAdvancedShell(ctx: ClientContext, environment: DesktopClientEnvironment): void {
  if (environment.mode !== 'advanced') {
    throw new Error(`dsh-plugin-desktop: advanced shell received mode ${JSON.stringify(environment.mode)}`)
  }

  const desktopLayout = new DesktopLayoutState()
  ctx.effect(
    () => provideDesktopLayout(ctx, desktopLayout),
    'desktop: layout service',
  )

  ctx.effect(() => {
    document.body.dataset.dshDesktopMode = 'advanced'
    document.body.dataset.dshDesktopPlatform = environment.platform
    document.body.dataset.dshDesktopMaterial = environment.material
    const removeStyles = installDesktopOwnedStyles()
    return () => {
      removeStyles()
      delete document.body.dataset.dshDesktopMode
      delete document.body.dataset.dshDesktopPlatform
      delete document.body.dataset.dshDesktopMaterial
    }
  }, 'desktop: advanced shell styles')

  ctx.effect(() => installExtendedStyles(), 'desktop: advanced titlebar styles')

  const api = createDesktopSettingsApi()
  const setMode = async (mode: DesktopShellSettings['mode']): Promise<void> => {
    const settings = ctx.settingsScope.bind<DesktopShellSettings>({ namespace: 'dsh-desktop' })
    await settings.set('mode', mode)
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-advanced-titlebar',
    order: -1000,
    locale: 'desktop.settings',
    inject: () => ({ api, environment, setMode }),
  }, DesktopFrameTitlebar))

  ctx.effect(
    () => installDesktopThemePresenter(ctx),
    'desktop: theme presenter',
  )

  ctx.effect(() => ctx.slots.register({
    name: 'root',
    children: {
      'sidebar': { kind: 'single', scope: 'root' },
      'conversation': { kind: 'single', scope: 'session-maybe' },
      'details': { kind: 'single', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ layout: desktopLayout, platform: environment.platform }),
  }, AdvancedFrame), 'desktop: advanced root slot')
}
