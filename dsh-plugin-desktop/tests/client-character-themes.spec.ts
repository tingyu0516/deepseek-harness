import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client'
import { CHARACTER_THEMES, FURINA_THEME, HUTAO_THEME } from '../src/client/character-themes.ts'
import {
  installCharacterThemeBackgroundStyles,
  registerDesktopCharacterThemes,
} from '../src/client/character-theme-registry.ts'
import {
  applyDesktopCharacterThemePreference,
  syncDesktopCharacterTheme,
  type DesktopCharacterThemePreference,
} from '../src/client/character-theme-sync.ts'

describe('desktop character themes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps Hu Tao and Furina as dark alias-token themes', () => {
    expect(CHARACTER_THEMES.map(theme => theme.id)).toEqual(['hutao', 'furina'])
    expect(HUTAO_THEME.colorScheme).toBe('dark')
    expect(FURINA_THEME.colorScheme).toBe('dark')
    expect(HUTAO_THEME.tokens['--dsw-character-bg-image']).toContain('url("/themes/hutao.png")')
    expect(FURINA_THEME.tokens['--dsw-character-bg-image']).toContain('url("/themes/furina.png")')
    expect(HUTAO_THEME.tokens['--dsw-alias-brand-primary']).toBe('#e05252')
    expect(FURINA_THEME.tokens['--dsw-alias-brand-primary']).toBe('#4cc9f0')
  })

  it('registers only missing ids and restores a local custom preference', () => {
    const registered: ThemeDefinition[] = [{ id: 'hutao', colorScheme: 'dark', tokens: {} }]
    const restoreLocalCustom = vi.fn()
    const theme = {
      getTheme: () => ({ themes: registered }),
      register: vi.fn((definition: ThemeDefinition) => {
        registered.push(definition)
        return () => {
          const index = registered.indexOf(definition)
          if (index >= 0) registered.splice(index, 1)
        }
      }),
      restoreLocalCustom,
    }

    const dispose = registerDesktopCharacterThemes(theme)

    expect(theme.register).toHaveBeenCalledOnce()
    expect(theme.register.mock.calls[0]?.[0]?.id).toBe('furina')
    expect(restoreLocalCustom).toHaveBeenCalledOnce()
    dispose()
    expect(registered.map(item => item.id)).toEqual(['hutao'])
  })

  it('installs the wallpaper CSS hook and removes it on dispose', () => {
    let css = ''
    const remove = vi.fn()
    const style = {
      dataset: {} as Record<string, string>,
      set textContent(value: string) { css = value },
      remove,
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => style,
      head: { appendChild },
    })

    const dispose = installCharacterThemeBackgroundStyles()
    expect(style.dataset.pluginCss).toBe('dsh-plugin-desktop/character-theme-background')
    expect(css).toContain('background-image: var(--dsw-character-bg-image, none)')
    expect(appendChild).toHaveBeenCalledWith(style)
    dispose()
    expect(remove).toHaveBeenCalledOnce()
  })
})

describe('desktop character theme preference', () => {
  it('applies Hu Tao and restores the official Appearance preference', () => {
    let preference = 'dark'
    const theme = {
      getTheme: () => ({ preference, active: { id: preference } }),
      setTheme: vi.fn((id: string) => { preference = id }),
    }

    applyDesktopCharacterThemePreference(theme, 'hutao')
    expect(theme.setTheme).toHaveBeenCalledWith('hutao')
    applyDesktopCharacterThemePreference(theme, 'hutao')
    expect(theme.setTheme).toHaveBeenCalledOnce()

    applyDesktopCharacterThemePreference(theme, 'off', 'light')
    expect(theme.setTheme).toHaveBeenLastCalledWith('light')
  })

  it('re-applies the Desktop character theme when the official runtime adopts a builtin', () => {
    const listeners = new Set<() => void>()
    let snapshot = {
      status: 'ready' as const,
      value: { characterTheme: 'furina' as DesktopCharacterThemePreference },
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }
    const desktopSettings = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
    }
    let preference = 'system'
    const theme = {
      getTheme: () => ({ preference, active: { id: preference } }),
      setTheme: vi.fn((id: string) => { preference = id }),
    }
    const themeListeners = new Set<(next: { preference?: string; active: { id: string } }) => void>()

    const dispose = syncDesktopCharacterTheme({
      theme,
      desktopSettings,
      officialTheme: {
        getSnapshot: () => ({ status: 'ready', value: { preference: 'dark' } }),
      },
      onThemeChange: listener => {
        themeListeners.add(listener)
        return () => { themeListeners.delete(listener) }
      },
    })

    expect(theme.setTheme).toHaveBeenCalledWith('furina')
    preference = 'dark'
    for (const listener of themeListeners) listener({ preference: 'dark', active: { id: 'dark' } })
    expect(theme.setTheme).toHaveBeenLastCalledWith('furina')

    snapshot = { ...snapshot, value: { characterTheme: 'off' } }
    for (const listener of listeners) listener()
    expect(theme.setTheme).toHaveBeenLastCalledWith('dark')
    dispose()
  })

  it('waits until Desktop settings are ready before touching the theme', () => {
    const theme = {
      getTheme: () => ({ preference: 'system', active: { id: 'system' } }),
      setTheme: vi.fn(),
    }
    syncDesktopCharacterTheme({
      theme,
      desktopSettings: {
        getSnapshot: () => ({
          status: 'loading',
          value: undefined,
          base: undefined,
          user: undefined,
          revision: undefined,
          writable: false,
          mode: 'host',
        }),
        subscribe: () => () => {},
        set: vi.fn(async () => {}),
        unset: vi.fn(async () => {}),
      },
      onThemeChange: () => () => {},
    })
    expect(theme.setTheme).not.toHaveBeenCalled()
  })
})
