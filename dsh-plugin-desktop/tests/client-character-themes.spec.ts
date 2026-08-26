import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client'
import { CHARACTER_THEMES, FURINA_THEME, HUTAO_THEME } from '../src/client/character-themes.ts'
import {
  installCharacterThemeBackgroundStyles,
  registerDesktopCharacterThemes,
} from '../src/client/character-theme-registry.ts'
import {
  applyCharacterThemeToDocument,
  applyDesktopCharacterThemePreference,
  createCharacterThemeProjector,
  snapshotWithCharacterTheme,
  syncDesktopCharacterTheme,
  watchCharacterThemeDarkAttribute,
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
    expect(css).toContain('body[data-dsh-character-theme]')
    expect(css).toContain('background-image: var(--dsw-character-bg-image, none)')
    expect(css).toContain('#root')
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

  it('re-projects character tokens when the official runtime adopts a builtin', () => {
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
    const project = vi.fn()
    const scheduled: Array<() => void> = []

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
      project,
      schedule: task => { scheduled.push(task) },
    })

    expect(theme.setTheme).toHaveBeenCalledOnce()
    expect(theme.setTheme).toHaveBeenCalledWith('furina')
    expect(project).toHaveBeenCalledWith('furina')

    preference = 'dark'
    project.mockClear()
    for (const listener of themeListeners) listener({ preference: 'dark', active: { id: 'dark' } })
    expect(theme.setTheme).toHaveBeenCalledOnce()
    expect(project).not.toHaveBeenCalled()
    for (const task of scheduled) task()
    expect(project).toHaveBeenCalledWith('furina')
    expect(theme.setTheme).toHaveBeenCalledOnce()

    snapshot = { ...snapshot, value: { characterTheme: 'off' } }
    for (const listener of listeners) listener()
    expect(theme.setTheme).toHaveBeenCalledOnce()
    expect(project).toHaveBeenLastCalledWith('off')

    preference = 'furina'
    snapshot = { ...snapshot, value: { characterTheme: 'hutao' } }
    for (const listener of listeners) listener()
    expect(theme.setTheme).toHaveBeenLastCalledWith('hutao')
    snapshot = { ...snapshot, value: { characterTheme: 'off' } }
    for (const listener of listeners) listener()
    expect(theme.setTheme).toHaveBeenLastCalledWith('dark')
    dispose()
  })

  it('overlays Hu Tao tokens onto a builtin snapshot', () => {
    const snapshot = {
      preference: 'dark' as const,
      active: { id: 'dark', colorScheme: 'dark' as const, tokens: { '--dsw-alias-bg-base': '#000' } },
      themes: [],
      revision: 1,
    }
    expect(snapshotWithCharacterTheme(snapshot, 'off')).toBe(snapshot)
    const overlaid = snapshotWithCharacterTheme(snapshot, 'hutao')
    expect(overlaid.active.id).toBe('hutao')
    expect(overlaid.active.tokens['--dsw-character-bg-image']).toContain('url("/themes/hutao.png")')
    expect(overlaid.active.tokens['--dsw-alias-bg-base']).toBe('rgba(23, 16, 20, 0.45)')
  })

  it('projects character tokens onto the style target and clears them when off', () => {
    const style = {
      setProperty: vi.fn(),
      removeProperty: vi.fn(),
    }
    const target = {
      style,
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    }
    const projector = createCharacterThemeProjector(target)

    projector.apply('hutao')
    expect(style.setProperty).toHaveBeenCalledWith(
      '--dsw-character-bg-image',
      HUTAO_THEME.tokens['--dsw-character-bg-image'],
    )
    expect(target.setAttribute).toHaveBeenCalledWith('data-ds-dark-theme', '')

    projector.apply('off')
    expect(style.removeProperty).toHaveBeenCalledWith('--dsw-character-bg-image')
    projector.dispose()
  })

  it('writes an !important token sheet and wallpaper marker onto the document', () => {
    let css = ''
    const remove = vi.fn()
    let attached: { id: string; textContent: string; remove: ReturnType<typeof vi.fn> } | null = null
    const style = {
      id: '',
      get textContent() { return css },
      set textContent(value: string) { css = value },
      remove,
    }
    const body = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      hasAttribute: vi.fn(() => false),
    }
    const appendChild = vi.fn((node: typeof style) => { attached = node })
    vi.stubGlobal('document', {
      getElementById: (id: string) => id === 'dsh-desktop-character-theme-tokens' ? attached : null,
      createElement: () => style,
      head: { appendChild },
      body,
    })

    applyCharacterThemeToDocument('hutao')
    expect(style.id).toBe('dsh-desktop-character-theme-tokens')
    expect(css).toContain('--dsw-character-bg-image:')
    expect(css).toContain('!important')
    expect(body.setAttribute).toHaveBeenCalledWith('data-dsh-character-theme', 'hutao')
    expect(body.setAttribute).toHaveBeenCalledWith('data-ds-dark-theme', '')
    expect(appendChild).toHaveBeenCalledWith(style)

    applyCharacterThemeToDocument('off')
    expect(remove).toHaveBeenCalledOnce()
    expect(body.removeAttribute).toHaveBeenCalledWith('data-dsh-character-theme')
  })

  it('does not retrigger the dark-attribute observer after restoring it', () => {
    let observerCallback: MutationCallback | undefined
    let dark = false
    const setAttribute = vi.fn((name: string) => {
      if (name === 'data-ds-dark-theme') dark = true
    })
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: MutationCallback) { observerCallback = callback }
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('document', {
      body: {
        setAttribute,
        hasAttribute: (name: string) => name === 'data-ds-dark-theme' && dark,
        removeAttribute: vi.fn(),
      },
    })

    const dispose = watchCharacterThemeDarkAttribute(() => 'hutao')
    expect(setAttribute).toHaveBeenCalledOnce()
    expect(setAttribute).toHaveBeenCalledWith('data-ds-dark-theme', '')
    observerCallback?.([], {} as MutationObserver)
    observerCallback?.([], {} as MutationObserver)
    expect(setAttribute).toHaveBeenCalledOnce()
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
