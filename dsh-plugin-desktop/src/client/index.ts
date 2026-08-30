import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only service and SlotMap convergence for the Desktop settings section.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import {
  installCharacterThemeBackgroundStyles,
  registerDesktopCharacterThemes,
} from './character-theme-registry.ts'
import { startRendererBootReporter } from './boot-health.ts'
import {
  applyCharacterThemeToDocument,
  readDesktopCharacterThemePreference,
  readDesktopCharacterWallpaperId,
  syncDesktopCharacterTheme,
  watchCharacterThemeDarkAttribute,
} from './character-theme-sync.ts'
import { applyDesktopSettings, DESKTOP_SHELL_SETTINGS_NAMESPACE } from './desktop-settings.ts'
import type { DesktopShellSettings } from './DesktopSettingsSection.tsx'
import { installDesktopDirectoryPickerBridge, requestDesktopDirectoryValidation } from './directory-picker.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
import { installWorkspaceFolderDrop } from './workspace-folder-drop.ts'
import { desktopWindowService, provideDesktopWindow } from './window-service.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { applyDesktopSettings } from './desktop-settings.ts'
export { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
export {
  createDesktopSettingsApi,
  desktopSettingsPaths,
  DesktopWallpaperApiError,
  parseCharacterWallpaperCatalog,
  parseCharacterWallpaperImportResponse,
  parseDesktopActionAcceptance,
  parseDesktopRestartAcceptance,
  parseDesktopSettingsView,
} from './desktop-settings-api.ts'
export type {
  DesktopMarketProvider,
  DesktopMarketView,
  DesktopProfileView,
  DesktopRestartAcceptance,
  DesktopSettingsApi,
  DesktopSettingsView,
} from './desktop-settings-api.ts'
export { DesktopSettingsSection } from './DesktopSettingsSection.tsx'
export { DesktopTerminalSettingsAction } from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopTerminalSettingsActionInjected,
  DesktopTerminalSettingsActionProps,
} from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopNotificationSettings,
  DesktopSettingsSectionInjected,
  DesktopSettingsSectionProps,
  DesktopShellSettings,
} from './DesktopSettingsSection.tsx'
export {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from './boot-health.ts'
export type { RendererBootLoader, RendererBootReport } from './boot-health.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export type {
  DesktopClientEnvironment,
  DesktopClientMaterial,
  DesktopClientMode,
  DesktopClientPlatform,
} from './environment.ts'
export { DesktopTerminalDrawer, closeDesktopTerminalDrawer, createTerminalResizeMessage, openDesktopTerminalDrawer, readTerminalWebSocketConfig } from './TerminalDrawer.tsx'
export type { TerminalWebSocketConfig, TerminalWebSocketResizeMessage } from './TerminalDrawer.tsx'
export type {
  DesktopWindowDragRegion,
  DesktopWindowInsets,
  DesktopWindowService,
} from './contracts.ts'

/** Services required by Desktop settings and Desktop-owned presentations. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'remote',
  'settingsScope',
  'sessions',
  'theme',
  'workspaces',
  'uiRenderer',
]

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  if (!environment) return
  ctx.effect(
    () => installCharacterThemeBackgroundStyles(),
    'dsh-plugin-desktop: character theme background',
  )
  ctx.effect(
    () => registerDesktopCharacterThemes(ctx.theme),
    'dsh-plugin-desktop: character theme registry',
  )
  ctx.effect(
    () => provideDesktopWindow(ctx, desktopWindowService(environment)),
    'dsh-plugin-desktop: native window geometry service',
  )
  const desktopSettings = applyDesktopSettings(ctx, environment)
  ctx.effect(
    () => startRendererBootReporter(ctx.loader),
    'dsh-plugin-desktop: renderer boot health report',
  )
  ctx.effect(
    () => installWorkspaceFolderDrop({
      create: input => ctx.workspaces.create(input),
      startSession: workspaceId => { ctx.workspaces.startSession(workspaceId) },
      ...(environment.platform === 'win32'
        ? { validateDirectory: (path: string) => requestDesktopDirectoryValidation(path) }
        : {}),
    }),
    'dsh-plugin-desktop: workspace folder drop',
  )
  if (environment.platform === 'win32') {
    ctx.effect(
      () => installDesktopDirectoryPickerBridge(),
      'dsh-plugin-desktop: native directory picker bridge',
    )
  }
  if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)
  if (environment.mode === 'extended') applyExtendedShell(ctx, environment, desktopSettings)
  if (environment.platform !== 'linux' && environment.mode === 'compatibility') {
    applyFramedShell(ctx, environment, desktopSettings)
  }
  // Last writer: project character tokens after official and Desktop presenters.
  ctx.effect(
    () => {
      const shellSettings = ctx.settingsScope.bind<DesktopShellSettings>({
        namespace: DESKTOP_SHELL_SETTINGS_NAMESPACE,
      })
      const officialTheme = ctx.settingsScope.bind<{ preference: 'light' | 'dark' | 'system' }>({
        namespace: 'ui-theme',
      })
      const projector = {
        apply: applyCharacterThemeToDocument,
        dispose: () => applyCharacterThemeToDocument('off'),
      }
      const stopDark = watchCharacterThemeDarkAttribute(() =>
        readDesktopCharacterThemePreference(shellSettings.getSnapshot()),
      )
      const stop = syncDesktopCharacterTheme({
        theme: ctx.theme,
        desktopSettings: shellSettings,
        officialTheme,
        onThemeChange: listener => ctx.on('theme/change', listener),
        project: preference => projector.apply(
          preference,
          readDesktopCharacterWallpaperId(shellSettings.getSnapshot(), preference),
        ),
      })
      return () => {
        stop()
        stopDark()
        projector.dispose()
      }
    },
    'dsh-plugin-desktop: character theme preference',
  )
}
