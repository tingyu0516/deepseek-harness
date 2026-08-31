import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DesktopDeveloperMenuItems,
  DesktopNativeActions,
  DesktopRestartMenuItems,
} from '../src/client/DesktopNativeActions.tsx'
import {
  DesktopModeControl,
  DesktopVersionControl,
  selectDesktopFrameMode,
} from '../src/client/ExtendedTitlebar.tsx'
import { DesktopSettingsSection } from '../src/client/DesktopSettingsSection.tsx'
import { DesktopTerminalSettingsAction } from '../src/client/DesktopTerminalSettingsAction.tsx'
import {
  createDesktopSettingsApi,
  desktopSettingsPaths,
  parseCharacterWallpaperCatalog,
  parseDesktopActionAcceptance,
  parseDesktopRestartAcceptance,
  parseDesktopSettingsView,
  type DesktopSettingsView,
} from '../src/client/desktop-settings-api.ts'
import {
  applyDesktopSettings,
  DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
  DESKTOP_SETTINGS_LOCALE_NAMESPACE,
  DESKTOP_SHELL_SETTINGS_NAMESPACE,
} from '../src/client/desktop-settings.ts'
import { en, zh, type DesktopSettingsLocaleKey } from '../src/client/desktop-settings-locales.ts'
import { installDesktopSettingsStyles } from '../src/client/desktop-settings-styles.ts'

const VIEW: DesktopSettingsView = {
  current: 'desktop',
  profiles: [
    { name: 'desktop', exists: true, webCapable: true, selectable: true, deletable: false },
    { name: 'headless', exists: true, webCapable: false, selectable: false, deletable: false },
    { name: 'work', exists: true, webCapable: true, selectable: true, deletable: true },
  ],
  market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: true },
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Desktop settings API', () => {
  it('validates the bounded launcher projection', () => {
    expect(parseDesktopSettingsView(VIEW)).toEqual(VIEW)
    expect(() => parseDesktopSettingsView({ ...VIEW, profiles: [...VIEW.profiles, VIEW.profiles[0]] }))
      .toThrow('duplicate profile')
    expect(() => parseDesktopSettingsView({ ...VIEW, market: { ...VIEW.market, requested: 'unknown' } }))
      .toThrow('invalid Desktop settings response')
    expect(parseDesktopRestartAcceptance({ accepted: true, restartRequired: true }))
      .toEqual({ accepted: true, restartRequired: true })
    expect(parseDesktopRestartAcceptance({ accepted: true, restartRequired: false }))
      .toEqual({ accepted: true, restartRequired: false })
    expect(() => parseDesktopRestartAcceptance({ accepted: true })).toThrow('invalid Desktop restart response')
    expect(parseDesktopActionAcceptance({ accepted: true })).toBeUndefined()
    expect(() => parseDesktopActionAcceptance({ accepted: true, detail: 'extra' }))
      .toThrow('invalid Desktop action response')
  })

  it('validates wallpaper catalogs and talks to the wallpaper routes', async () => {
    const catalog = {
      hutao: [{
        id: 'default',
        theme: 'hutao' as const,
        url: '/themes/hutao.png',
        label: 'default',
        deletable: false,
      }],
      furina: [{
        id: 'default',
        theme: 'furina' as const,
        url: '/themes/furina.png',
        label: 'default',
        deletable: false,
      }, {
        id: 'wp_0123456789abcdef',
        theme: 'furina' as const,
        url: '/themes/custom/furina/wp_0123456789abcdef',
        label: 'stage.png',
        deletable: true,
      }],
    }
    expect(parseCharacterWallpaperCatalog(catalog)).toEqual(catalog)
    expect(() => parseCharacterWallpaperCatalog({
      ...catalog,
      hutao: [{ ...catalog.hutao[0], deletable: true }],
    })).toThrow('invalid wallpaper settings response')

    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === desktopSettingsPaths.wallpapers) return json(catalog)
      if (path === desktopSettingsPaths.wallpaperImport) {
        expect(init?.body).toBe(JSON.stringify({ theme: 'furina' }))
        return json({ cancelled: false, catalog })
      }
      if (path === desktopSettingsPaths.wallpaperDelete) {
        expect(init?.body).toBe(JSON.stringify({ theme: 'furina', id: 'wp_0123456789abcdef' }))
        return json({
          hutao: catalog.hutao,
          furina: catalog.hutao.map(item => ({ ...item, theme: 'furina', url: '/themes/furina.png' })),
        })
      }
      throw new Error(path)
    })
    const api = createDesktopSettingsApi(fetcher)
    await expect(api.listWallpapers()).resolves.toEqual(catalog)
    await expect(api.importWallpaper('furina')).resolves.toEqual({ cancelled: false, catalog })
    await expect(api.deleteWallpaper('furina', 'wp_0123456789abcdef')).resolves.toMatchObject({
      furina: [expect.objectContaining({ id: 'default', deletable: false })],
    })
  })

  it('uses the strict same-origin routes and request bodies', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input)
      if (path === desktopSettingsPaths.terminalOpen
        || path === desktopSettingsPaths.restart
        || path === desktopSettingsPaths.recoveryRestart
        || path === desktopSettingsPaths.rendererReload
        || path === desktopSettingsPaths.developerToolsToggle
        || path === desktopSettingsPaths.updateCheck
        || path === desktopSettingsPaths.diagnosticsExport) {
        return json({ accepted: true })
      }
      return path === desktopSettingsPaths.settings || path === desktopSettingsPaths.profileCreate || path === desktopSettingsPaths.profileDelete
        ? json(VIEW)
        : json({ accepted: true, restartRequired: true })
    })
    const api = createDesktopSettingsApi(fetcher)

    await expect(api.read()).resolves.toEqual(VIEW)
    await expect(api.createProfile('work')).resolves.toEqual(VIEW)
    await expect(api.selectProfile('work')).resolves.toEqual({ accepted: true, restartRequired: true })
    await expect(api.deleteProfile('work')).resolves.toEqual(VIEW)
    await expect(api.selectMarket('community-market')).resolves.toEqual({ accepted: true, restartRequired: true })
    await expect(api.openTerminal()).resolves.toBeUndefined()
    await expect(api.restart()).resolves.toBeUndefined()
    await expect(api.restartToRecovery()).resolves.toBeUndefined()
    await expect(api.reloadRenderer()).resolves.toBeUndefined()
    await expect(api.toggleDeveloperTools()).resolves.toBeUndefined()
    await expect(api.checkForUpdates()).resolves.toBeUndefined()
    await expect(api.exportDiagnostics()).resolves.toBeUndefined()

    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      desktopSettingsPaths.settings,
      desktopSettingsPaths.profileCreate,
      desktopSettingsPaths.profileSelect,
      desktopSettingsPaths.profileDelete,
      desktopSettingsPaths.marketSelect,
      desktopSettingsPaths.terminalOpen,
      desktopSettingsPaths.restart,
      desktopSettingsPaths.recoveryRestart,
      desktopSettingsPaths.rendererReload,
      desktopSettingsPaths.developerToolsToggle,
      desktopSettingsPaths.updateCheck,
      desktopSettingsPaths.diagnosticsExport,
    ])
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      body: JSON.stringify({ name: 'work' }),
    })
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify({ name: 'work' }),
    })
    expect(fetcher.mock.calls[4]?.[1]).toMatchObject({
      body: JSON.stringify({ provider: 'community-market' }),
    })
    expect(fetcher.mock.calls[5]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[6]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[7]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[8]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[9]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(fetcher.mock.calls[10]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({}),
    })
  })

  it('does not reflect an untrusted error body into its public error', async () => {
    const api = createDesktopSettingsApi(async () => json({ error: '/Users/private/profile failed' }, 400))
    await expect(api.read()).rejects.toThrow('Desktop settings request failed (400)')
    await expect(api.read()).rejects.not.toThrow('/Users/private')
  })
})

describe('Desktop native action presentation', () => {
  const api = {
    exportDiagnostics: vi.fn(async () => {}),
    openTerminal: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    restartToRecovery: vi.fn(async () => {}),
    reloadRenderer: vi.fn(async () => {}),
    toggleDeveloperTools: vi.fn(async () => {}),
    checkForUpdates: vi.fn(async () => {}),
  }
  const t = (key: DesktopSettingsLocaleKey): string => en[key]

  it('uses accessible icon actions in the extended title bar', () => {
    const markup = renderToStaticMarkup(createElement(DesktopNativeActions, {
      api,
      t,
      placement: 'titlebar',
    }))

    expect(markup.match(/dshDesktopTitlebarIconButton/g)).toHaveLength(3)
    expect(markup).toContain('aria-label="Open DSH Terminal"')
    expect(markup).toContain('aria-label="Restart options"')
    expect(markup).toContain('aria-label="Developer options"')
  })

  it('renders the Host-supplied version through the shadcn hover-card trigger', () => {
    const markup = renderToStaticMarkup(createElement(DesktopVersionControl, {
      version: '2.0.3',
      checkForUpdates: api.checkForUpdates,
      t,
    }))

    expect(markup).toContain('v2.0.3')
    expect(markup).toContain('aria-label="Current version v2.0.3"')
    expect(markup).toContain('data-slot="hover-card-trigger"')
  })

  it('renders the active presentation pill through a shadcn hover-card trigger', () => {
    const markup = renderToStaticMarkup(createElement(DesktopModeControl, {
      mode: 'extended',
      setMode: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      t,
    }))

    expect(markup).toContain('Extended window')
    expect(markup).toContain('aria-label="Desktop appearance and behavior: Extended window"')
    expect(markup).toContain('data-slot="hover-card-trigger"')
  })

  it('persists a presentation change before requesting the confirmed restart', async () => {
    const order: string[] = []
    const setMode = vi.fn(async (mode: string) => { order.push(`mode:${mode}`) })
    const restart = vi.fn(async () => { order.push('restart') })

    await selectDesktopFrameMode('advanced', setMode, restart)

    expect(order).toEqual(['mode:advanced', 'restart'])
  })

  it('keeps explicit text labels in settings', () => {
    const markup = renderToStaticMarkup(createElement(DesktopNativeActions, {
      api,
      t,
      placement: 'settings',
    }))

    expect(markup).toContain('Open DSH Terminal')
    expect(markup).toContain('Export Diagnostics')
    expect(markup).toContain('Restart')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).not.toContain('Developer options')
  })

  it('groups reload with both restart actions and leaves only Developer Tools in its menu', () => {
    const restartMarkup = renderToStaticMarkup(createElement(DesktopRestartMenuItems, {
      busy: false,
      t,
      onReload: vi.fn(),
      onRestart: vi.fn(),
      onRestartToRecovery: vi.fn(),
    }))
    const developerMarkup = renderToStaticMarkup(createElement(DesktopDeveloperMenuItems, {
      busy: false,
      t,
      onToggleDeveloperTools: vi.fn(),
    }))

    expect(restartMarkup.match(/role="menuitem"/g)).toHaveLength(3)
    expect(restartMarkup.indexOf('Reload')).toBeLessThan(restartMarkup.indexOf('Restart'))
    expect(restartMarkup.indexOf('Restart')).toBeLessThan(restartMarkup.indexOf('Restart in Recovery Mode'))
    expect(restartMarkup).not.toContain('Toggle Developer Tools')
    expect(developerMarkup.match(/role="menuitem"/g)).toHaveLength(1)
    expect(developerMarkup).toContain('Toggle Developer Tools')
    expect(developerMarkup).not.toContain('Reload')
  })

  it('installs a self-contained vertical settings menu in every presentation mode', () => {
    let css = ''
    const remove = vi.fn()
    const style = {
      id: '',
      get textContent() { return css },
      set textContent(value: string) { css = value },
      remove,
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      getElementById: () => null,
      createElement: () => style,
      head: { appendChild },
    })

    try {
      const dispose = installDesktopSettingsStyles()
      expect(css).toMatch(/data-placement="settings"\] \.dshDesktopActionMenu \{[^}]*position: absolute;[^}]*display: grid;[^}]*grid-auto-flow: row;[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 220px;/)
      expect(css).toMatch(/data-placement="settings"\] \.dshDesktopActionMenuItem \{[^}]*display: flex;[^}]*width: 100%;[^}]*white-space: nowrap;/)
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(remove).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Desktop settings Slot registration', () => {
  it('registers the official Desktop section, native actions, and both settings scopes', async () => {
    const scope = {
      getSnapshot: () => ({
        status: 'loading' as const,
        value: undefined,
        base: undefined,
        user: undefined,
        revision: undefined,
        writable: false,
        mode: 'host' as const,
      }),
      subscribe: () => () => {},
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
    } satisfies SettingsScope<unknown>
    const bind = vi.fn(() => scope)
    const register = vi.fn(() => () => {})
    const inject = vi.fn((_name: string, mount: () => unknown) => mount())
    const localeRegister = vi.fn(() => () => {})
    const ctx = {
      settingsScope: { bind },
      locale: {
        bind: (namespace: string) => (key: string) => `${namespace}:${key}`,
        register: localeRegister,
      },
      effect: vi.fn(),
      slots: { inject, register },
    } as unknown as ClientContext

    const control = applyDesktopSettings(ctx, {
      version: '2.0.3',
      mode: 'compatibility',
      platform: 'darwin',
      material: 'off',
      micaSupported: false,
    })

    expect(bind).toHaveBeenNthCalledWith(1, { namespace: DESKTOP_SHELL_SETTINGS_NAMESPACE })
    expect(bind).toHaveBeenNthCalledWith(2, { namespace: DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE })
    expect(inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
    expect(inject).toHaveBeenCalledWith('settings.action', expect.any(Function))
    expect(inject).not.toHaveBeenCalledWith('conversation.session.header.actions', expect.any(Function))
    expect(inject).not.toHaveBeenCalledWith('conversation.session.header.utilities', expect.any(Function))
    const [options, component] = register.mock.calls[0] as unknown as [
      { id: string; order: number; locale: string; label: () => string; inject: () => Record<string, unknown> },
      unknown,
    ]
    expect(options).toMatchObject({
      name: 'settings.section',
      id: 'desktop',
      order: 100,
      locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    })
    expect(options.label()).toBe(`${DESKTOP_SETTINGS_LOCALE_NAMESPACE}:nav`)
    expect(options.inject()).toMatchObject({
      platform: 'darwin',
      initialMode: 'compatibility',
      micaSupported: false,
    })
    expect(component).toBe(DesktopSettingsSection)

    const [actionOptions, actionComponent] = register.mock.calls[1] as unknown as [
      { id: string; order: number; locale: string; inject: () => Record<string, unknown> },
      unknown,
    ]
    expect(actionOptions).toMatchObject({
      name: 'settings.action',
      id: 'open-desktop-terminal',
      order: 1,
      locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    })
    expect(actionOptions.inject()).toHaveProperty('api')
    expect(actionComponent).toBe(DesktopTerminalSettingsAction)
    expect(register.mock.calls).toHaveLength(2)
    await control.setMode('extended')
    expect(scope.set).toHaveBeenCalledWith('mode', 'extended')
  })

  it('offers Hu Tao and Furina in the Desktop appearance copy', () => {
    const source = readFileSync(new URL('../src/client/DesktopSettingsSection.tsx', import.meta.url), 'utf8')
    expect(zh.characterThemeHutao).toBe('胡桃')
    expect(zh.characterThemeFurina).toBe('芙宁娜')
    expect(en.characterThemeHutao).toBe('Hu Tao')
    expect(en.characterThemeFurina).toBe('Furina')
    expect(en.characterThemeTitle).toBe('Character theme')
    expect(source).toContain("set('characterTheme', next)")
    expect(source).toContain("setCharacterTheme('hutao')")
    expect(source).toContain("setCharacterTheme('furina')")
    expect(zh.wallpaperTitle).toBe('壁纸')
    expect(zh.wallpaperImport).toBe('导入壁纸')
    expect(zh.wallpaperDelete).toBe('删除')
    expect(en.wallpaperTitle).toBe('Wallpaper')
    expect(source).toContain("set(theme === 'hutao' ? 'hutaoWallpaper' : 'furinaWallpaper', id)")
    expect(source).toContain('importWallpaper')
    expect(source).toContain('deleteWallpaper')
  })
})
