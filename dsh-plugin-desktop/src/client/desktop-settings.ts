/** Official Settings Slot registration for Desktop-owned preferences. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DesktopSettingsSection,
  type DesktopNotificationSettings,
  type DesktopPetSettings,
  type DesktopShellSettings,
} from './DesktopSettingsSection.tsx'
import { DesktopTerminalSettingsAction } from './DesktopTerminalSettingsAction.tsx'
import { createDesktopSettingsApi } from './desktop-settings-api.ts'
import { en, zh, type DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'
import { installDesktopSettingsStyles } from './desktop-settings-styles.ts'
import type { DesktopClientEnvironment } from './environment.ts'

/** Locale namespace owned by the Desktop settings page. */
export const DESKTOP_SETTINGS_LOCALE_NAMESPACE = 'desktop.settings'

/** Host settings namespaces bound through the standard client settings service. */
export const DESKTOP_SHELL_SETTINGS_NAMESPACE = 'dsh-desktop'
export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = 'dsh-desktop-notifications'
/** Host settings namespace registered by `dsh-plugin-pet-hutao`. */
export const DESKTOP_PET_HUTAO_SETTINGS_NAMESPACE = 'dsh-desktop-pet-hutao'
/** Host settings namespace registered by `dsh-plugin-pet-furina`. */
export const DESKTOP_PET_FURINA_SETTINGS_NAMESPACE = 'dsh-desktop-pet-furina'

/** Shared client controls consumed by settings and Desktop-owned window chrome. */
export interface DesktopSettingsClientControl {
  readonly api: ReturnType<typeof createDesktopSettingsApi>
  setMode(mode: DesktopShellSettings['mode']): Promise<void>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop-only settings page copy. */
    'desktop.settings': DesktopSettingsLocaleKey
  }
}

/** Register the Desktop page in the settings.section list slot. */
export function applyDesktopSettings(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
): DesktopSettingsClientControl {
  const desktopSettings = ctx.settingsScope.bind<DesktopShellSettings>({
    namespace: DESKTOP_SHELL_SETTINGS_NAMESPACE,
  })
  const notificationSettings = ctx.settingsScope.bind<DesktopNotificationSettings>({
    namespace: DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
  })
  const hutaoPetSettings = ctx.settingsScope.bind<DesktopPetSettings>({
    namespace: DESKTOP_PET_HUTAO_SETTINGS_NAMESPACE,
  })
  const furinaPetSettings = ctx.settingsScope.bind<DesktopPetSettings>({
    namespace: DESKTOP_PET_FURINA_SETTINGS_NAMESPACE,
  })
  const api = createDesktopSettingsApi()
  const t = ctx.locale.bind(DESKTOP_SETTINGS_LOCALE_NAMESPACE)

  ctx.effect(
    () => ctx.locale.register(DESKTOP_SETTINGS_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: settings dictionaries',
  )
  ctx.effect(
    () => installDesktopSettingsStyles(),
    'dsh-plugin-desktop: settings styles',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'desktop',
    order: 100,
    label: () => t('nav'),
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    inject: () => ({
      api,
      platform: environment.platform,
      initialMode: environment.mode,
      micaSupported: environment.micaSupported,
      desktopSettings,
      notificationSettings,
      hutaoPetSettings,
      furinaPetSettings,
    }),
  }, DesktopSettingsSection))
  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action',
    id: 'open-desktop-terminal',
    order: 1,
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, DesktopTerminalSettingsAction))

  return Object.freeze({
    api,
    async setMode(mode: DesktopShellSettings['mode']) {
      await desktopSettings.set('mode', mode)
    },
  })
}
