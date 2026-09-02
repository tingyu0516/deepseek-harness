/** Desktop-owned settings section registered into the official Settings shell. */

import {
  useCallback, useEffect, useId, useState, useSyncExternalStore, type FormEvent, type ReactNode,
} from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DesktopMarketProvider, DesktopProfileView, DesktopSettingsApi, DesktopSettingsView,
} from './desktop-settings-api.ts'
import { DesktopWallpaperApiError } from './desktop-settings-api.ts'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'
import type { DesktopClientPlatform } from './environment.ts'
import type { CharacterWallpaperCatalog, CharacterWallpaperThemeId } from '../character-wallpaper-contract.ts'

/** Browser view of the Host `dsh-desktop` settings namespace. */
export interface DesktopShellSettings {
  readonly mode: 'compatibility' | 'extended' | 'advanced'
  readonly macosMaterial: 'off' | 'transparent'
  readonly windowsMaterial: 'off' | 'acrylic' | 'mica'
  readonly port: number
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error'
  readonly characterTheme: 'off' | 'hutao' | 'furina'
  readonly hutaoWallpaper: string
  readonly furinaWallpaper: string
}

/** Browser view of the Host `dsh-desktop-notifications` settings namespace. */
export interface DesktopNotificationSettings {
  readonly enabled: boolean
  readonly notifyOnTurnCompletion: boolean
  readonly notifyOnTurnFailure: boolean
  readonly notifyOnJobCompletion: boolean
  readonly notifyOnJobFailure: boolean
}

/** Proportional window scales owned by each character pet plugin. */
export const DESKTOP_PET_SCALES = [0.75, 1, 1.25, 1.5] as const
/** One allowed pet scale multiplier. */
export type DesktopPetScale = (typeof DESKTOP_PET_SCALES)[number]

/** Browser view of one character pet plugin's live settings. */
export interface DesktopPetSettings {
  readonly enabled: boolean
  readonly scale: DesktopPetScale
}

/** Registration-side business face for the Desktop settings section. */
export interface DesktopSettingsSectionInjected {
  readonly api: DesktopSettingsApi
  readonly platform: DesktopClientPlatform
  readonly initialMode: DesktopShellSettings['mode']
  readonly micaSupported: boolean
  readonly desktopSettings: SettingsScope<DesktopShellSettings>
  readonly notificationSettings: SettingsScope<DesktopNotificationSettings>
  readonly hutaoPetSettings: SettingsScope<DesktopPetSettings>
  readonly furinaPetSettings: SettingsScope<DesktopPetSettings>
}

/** Renderer-composed props for the official settings section entry. */
export type DesktopSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopSettingsSectionInjected>

type Translate = DesktopSettingsSectionProps['t']
type BusyOperation = 'load' | 'create-profile' | 'select-profile' | 'delete-profile' | 'select-market' | 'mode' | 'material' | 'character-theme' | 'wallpaper-select' | 'wallpaper-import' | 'wallpaper-delete' | 'notification' | 'pet'
type RestartState = 'none' | 'restarting' | 'required'

function useScope<T>(scope: SettingsScope<T>) {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useCallback(() => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, snapshot)
}

function Choice({
  title,
  body,
  aside,
  selected,
  reselectable,
  disabled,
  action,
  status,
}: {
  title: ReactNode
  body: ReactNode
  aside?: ReactNode
  selected: boolean
  reselectable?: boolean
  disabled?: boolean
  action: () => void
  status?: ReactNode
}) {
  const actionable = disabled !== true && (!selected || reselectable === true)
  const choose = (): void => {
    if (actionable) action()
  }
  return (
    <div
      role="radio"
      className="dshDesktopSettingsChoice"
      data-selected={selected ? 'true' : undefined}
      data-actionable={actionable ? 'true' : undefined}
      aria-checked={selected}
      aria-disabled={disabled === true ? 'true' : undefined}
      tabIndex={disabled === true ? -1 : 0}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        choose()
      }}
    >
      <span className="dshDesktopSettingsChoiceCopy">
        <span className="dshDesktopSettingsChoiceTitle">
          {title}
          {status !== undefined && <span className="dshDesktopSettingsBadge">{status}</span>}
        </span>
        <span className="dshDesktopSettingsChoiceBody">{body}</span>
      </span>
      {aside}
    </div>
  )
}

function RepositoryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="dshDesktopSettingsChoiceLink"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={event => { event.stopPropagation() }}
    >
      {children}
    </a>
  )
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  const labelId = useId()
  return (
    <div className="dshDesktopSettingsToggleRow">
      <span id={labelId}>{label}</span>
      <button
        type="button"
        role="switch"
        className="dshDesktopSettingsToggle"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => { onChange(!checked) }}
      >
        <span className="dshDesktopSettingsToggleKnob" aria-hidden="true" />
      </button>
    </div>
  )
}

function resolvePetScale(value: number | undefined): DesktopPetScale {
  return DESKTOP_PET_SCALES.find(scale => scale === value) ?? 1
}

function petScaleLabel(scale: DesktopPetScale): string {
  return `${String(Math.round(scale * 100))}%`
}

function PetScaleField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: DesktopPetScale
  disabled: boolean
  onChange: (scale: DesktopPetScale) => void
}) {
  const labelId = useId()
  return (
    <label className="dshDesktopSettingsMaterialField">
      <span id={labelId} className="dshDesktopSettingsChoiceTitle">{label}</span>
      <select
        className="dshDesktopSettingsSelect"
        aria-labelledby={labelId}
        value={String(value)}
        disabled={disabled}
        onChange={event => {
          const next = Number(event.currentTarget.value)
          const scale = DESKTOP_PET_SCALES.find(candidate => candidate === next)
          if (scale !== undefined) onChange(scale)
        }}
      >
        {DESKTOP_PET_SCALES.map(scale => (
          <option key={String(scale)} value={String(scale)}>{petScaleLabel(scale)}</option>
        ))}
      </select>
    </label>
  )
}

function profileState(profile: DesktopProfileView, t: Translate): string {
  if (!profile.webCapable || !profile.selectable) return t('profileUnavailable')
  return profile.exists ? t('profileReady') : t('profileMissing')
}

const MARKET_OPTIONS: readonly {
  id: DesktopMarketProvider
  title: DesktopSettingsLocaleKey
  body: DesktopSettingsLocaleKey
}[] = [
  { id: 'disabled', title: 'marketDisabled', body: 'marketDisabledBody' },
  { id: 'community-market', title: 'communityMarket', body: 'communityMarketBody' },
  { id: 'dsh-market', title: 'dshMarket', body: 'dshMarketBody' },
]

const COMMUNITY_MARKET_URL = 'https://github.com/anywhere-labs/deepseek-harness-desktop/tree/master/dsh-community-market'
const DSH_MARKET_URL = 'https://github.com/dsh-market/dsh-market'
const AWESOME_DSH_PLUGIN_URL = 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin'

function marketTitle(option: (typeof MARKET_OPTIONS)[number], t: Translate): ReactNode {
  if (option.id === 'community-market') {
    return <RepositoryLink href={COMMUNITY_MARKET_URL}>{t(option.title)}</RepositoryLink>
  }
  if (option.id === 'dsh-market') {
    return <RepositoryLink href={DSH_MARKET_URL}>{t(option.title)}</RepositoryLink>
  }
  return t(option.title)
}

function marketBody(option: (typeof MARKET_OPTIONS)[number], t: Translate): ReactNode {
  if (option.id !== 'dsh-market') return t(option.body)
  return (
    <>
      {t(option.body)}{' '}
      <RepositoryLink href={AWESOME_DSH_PLUGIN_URL}>awesome-dsh-plugin</RepositoryLink>
    </>
  )
}

/** Render the Desktop settings page. */
export function DesktopSettingsSection({
  t,
  api,
  platform,
  initialMode,
  micaSupported,
  desktopSettings,
  notificationSettings,
  hutaoPetSettings,
  furinaPetSettings,
}: DesktopSettingsSectionProps) {
  const desktop = useScope(desktopSettings)
  const notifications = useScope(notificationSettings)
  const hutaoPet = useScope(hutaoPetSettings)
  const furinaPet = useScope(furinaPetSettings)
  const [view, setView] = useState<DesktopSettingsView>()
  const [profileName, setProfileName] = useState('')
  const [busy, setBusy] = useState<BusyOperation | undefined>('load')
  const [loadFailed, setLoadFailed] = useState(false)
  const [operationFailed, setOperationFailed] = useState(false)
  const [restart, setRestart] = useState<RestartState>('none')
  const [pendingProfileDelete, setPendingProfileDelete] = useState<string>()
  const [wallpapers, setWallpapers] = useState<CharacterWallpaperCatalog>()
  const [pendingWallpaperDelete, setPendingWallpaperDelete] = useState<string>()
  const [wallpaperError, setWallpaperError] = useState<DesktopSettingsLocaleKey>()

  const load = useCallback(async () => {
    setBusy('load')
    setLoadFailed(false)
    setOperationFailed(false)
    try {
      setView(await api.read())
    } catch {
      setLoadFailed(true)
    }
    try {
      setWallpapers(await api.listWallpapers())
    } catch {
      setWallpapers(undefined)
    } finally {
      setBusy(current => current === 'load' ? undefined : current)
    }
  }, [api])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (restart !== 'restarting') return
    const timer = setTimeout(() => { setRestart('required') }, 8_000)
    return () => { clearTimeout(timer) }
  }, [restart])

  const run = useCallback(async (operation: BusyOperation, invoke: () => Promise<void>) => {
    setBusy(operation)
    setOperationFailed(false)
    try {
      await invoke()
    } catch {
      setOperationFailed(true)
    } finally {
      setBusy(current => current === operation ? undefined : current)
    }
  }, [])

  const requestRestart = (): void => { setRestart('restarting') }
  const settingsWritable = desktop.status === 'ready' && desktop.writable
  const notificationsWritable = notifications.status === 'ready' && notifications.writable
  const hutaoPetWritable = hutaoPet.status === 'ready' && hutaoPet.writable
  const furinaPetWritable = furinaPet.status === 'ready' && furinaPet.writable
  const mode = desktop.value?.mode ?? initialMode
  const characterTheme = desktop.value?.characterTheme ?? 'off'
  const hutaoWallpaper = desktop.value?.hutaoWallpaper ?? 'default'
  const furinaWallpaper = desktop.value?.furinaWallpaper ?? 'default'
  const notificationValue = notifications.value ?? {
    enabled: true,
    notifyOnTurnCompletion: true,
    notifyOnTurnFailure: true,
    notifyOnJobCompletion: true,
    notifyOnJobFailure: true,
  }
  const hutaoPetEnabled = hutaoPet.value?.enabled ?? false
  const furinaPetEnabled = furinaPet.value?.enabled ?? false
  const hutaoPetScale = resolvePetScale(hutaoPet.value?.scale)
  const furinaPetScale = resolvePetScale(furinaPet.value?.scale)

  const createProfile = (event: FormEvent): void => {
    event.preventDefault()
    const name = profileName.trim()
    if (name.length === 0) return
    void run('create-profile', async () => {
      setView(await api.createProfile(name))
      setProfileName('')
    })
  }

  const selectProfile = (name: string): void => {
    void run('select-profile', async () => {
      const response = await api.selectProfile(name)
      if (response.restartRequired) requestRestart()
    })
  }

  const deleteProfile = (name: string): void => {
    void run('delete-profile', async () => {
      setView(await api.deleteProfile(name))
      setPendingProfileDelete(undefined)
    })
  }

  const selectMarket = (provider: DesktopMarketProvider): void => {
    void run('select-market', async () => {
      const response = await api.selectMarket(provider)
      setView(current => current === undefined ? current : {
        ...current,
        market: { requested: provider, effective: current.market.effective, legacyDefaulted: false },
      })
      if (response.restartRequired) requestRestart()
    })
  }

  const setMode = (next: DesktopShellSettings['mode']): void => {
    void run('mode', async () => {
      await desktopSettings.set('mode', next)
      requestRestart()
    })
  }

  const setMaterial = (next: string): void => {
    void run('material', async () => {
      if (platform === 'darwin') {
        if (next !== 'off' && next !== 'transparent') {
          throw new Error(`dsh-plugin-desktop: invalid macOS material ${JSON.stringify(next)}`)
        }
        await desktopSettings.set('macosMaterial', next)
      } else if (platform === 'win32') {
        if (next !== 'off' && next !== 'acrylic' && (next !== 'mica' || !micaSupported)) {
          throw new Error(`dsh-plugin-desktop: unavailable Windows material ${JSON.stringify(next)}`)
        }
        await desktopSettings.set('windowsMaterial', next)
      }
      requestRestart()
    })
  }

  const setCharacterTheme = (next: DesktopShellSettings['characterTheme']): void => {
    void run('character-theme', async () => {
      await desktopSettings.set('characterTheme', next)
    })
  }

  const wallpaperTheme: CharacterWallpaperThemeId | undefined = characterTheme === 'off' ? undefined : characterTheme
  const selectedWallpaperId = wallpaperTheme === 'hutao'
    ? hutaoWallpaper
    : wallpaperTheme === 'furina' ? furinaWallpaper : 'default'
  const wallpaperItems = wallpaperTheme === undefined ? [] : wallpapers?.[wallpaperTheme] ?? []

  const wallpaperFailure = (cause: unknown): DesktopSettingsLocaleKey => {
    if (cause instanceof DesktopWallpaperApiError) {
      if (cause.code === 'unsupported-image') return 'wallpaperUnsupported'
      if (cause.code === 'too-large') return 'wallpaperTooLarge'
      if (cause.code === 'limit-reached') return 'wallpaperLimit'
    }
    return 'operationFailed'
  }

  const wallpaperBusy = busy === 'wallpaper-select' || busy === 'wallpaper-import' || busy === 'wallpaper-delete'

  const setWallpaper = (theme: CharacterWallpaperThemeId, id: string): void => {
    void run('wallpaper-select', async () => {
      setWallpaperError(undefined)
      await desktopSettings.set(theme === 'hutao' ? 'hutaoWallpaper' : 'furinaWallpaper', id)
    })
  }

  const importWallpaper = (theme: CharacterWallpaperThemeId): void => {
    void run('wallpaper-import', async () => {
      setWallpaperError(undefined)
      try {
        const result = await api.importWallpaper(theme)
        setWallpapers(result.catalog)
      } catch (cause) {
        setWallpaperError(wallpaperFailure(cause))
      }
    })
  }

  const deleteWallpaper = (theme: CharacterWallpaperThemeId, id: string): void => {
    void run('wallpaper-delete', async () => {
      setWallpaperError(undefined)
      try {
        setWallpapers(await api.deleteWallpaper(theme, id))
        setPendingWallpaperDelete(undefined)
      } catch (cause) {
        setWallpaperError(wallpaperFailure(cause))
      }
    })
  }

  const setNotification = (field: keyof DesktopNotificationSettings, checked: boolean): void => {
    void run('notification', async () => { await notificationSettings.set(field, checked) })
  }

  const setHutaoPet = (checked: boolean): void => {
    void run('pet', async () => { await hutaoPetSettings.set('enabled', checked) })
  }

  const setFurinaPet = (checked: boolean): void => {
    void run('pet', async () => { await furinaPetSettings.set('enabled', checked) })
  }

  const setHutaoPetScale = (scale: DesktopPetScale): void => {
    void run('pet', async () => { await hutaoPetSettings.set('scale', scale) })
  }

  const setFurinaPetScale = (scale: DesktopPetScale): void => {
    void run('pet', async () => { await furinaPetSettings.set('scale', scale) })
  }

  return (
    <div className="dshDesktopSettings">
      <header className="dshDesktopSettingsHeader">
        <h2>{t('title')}</h2>
        <p>{t('intro')}</p>
      </header>

      {operationFailed && <p className="dshDesktopSettingsError" role="alert">{t('operationFailed')}</p>}
      {restart !== 'none' && (
        <p className="dshDesktopSettingsSuccess" role="status">
          {t(restart === 'restarting' ? 'restarting' : 'restartRequired')}
        </p>
      )}

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-profile-title">
        <div>
          <h3 id="dsh-desktop-profile-title">{t('profileTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('profileIntro')}</p>
        </div>
        {busy === 'load' && view === undefined && <p className="dshDesktopSettingsHint">{t('loading')}</p>}
        {loadFailed && view === undefined && (
          <div>
            <p className="dshDesktopSettingsError" role="alert">{t('unavailable')}</p>
            <button type="button" className="dshDesktopSettingsButton" onClick={() => { void load() }}>{t('retry')}</button>
          </div>
        )}
        {view !== undefined && (
          <>
            <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-profile-title">
              {view.profiles.map((profile) => {
                const current = profile.name === view.current
                const deleteAction = profile.deletable && !current && busy === undefined && restart === 'none'
                  ? (
                    <div className="dshDesktopSettingsChoiceAside" onClick={event => { event.stopPropagation() }}>
                      {pendingProfileDelete === profile.name ? (
                        <div className="dshDesktopSettingsDeleteConfirm" role="group" aria-label={t('confirmDeleteProfile')}>
                          <span className="dshDesktopSettingsDeleteWarning">{t('deleteProfileWarning')}</span>
                          <span className="dshDesktopSettingsDeleteActions">
                            <button
                              type="button"
                              className="dshDesktopSettingsButton dshDesktopSettingsButtonDanger"
                              disabled={busy !== undefined}
                              onClick={() => { deleteProfile(profile.name) }}
                            >
                              {busy === 'delete-profile' ? t('deletingProfile') : t('confirmDeleteProfile')}
                            </button>
                            <button
                              type="button"
                              className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
                              disabled={busy !== undefined}
                              onClick={() => { setPendingProfileDelete(undefined) }}
                            >
                              {t('cancelDeleteProfile')}
                            </button>
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
                          onClick={() => { setPendingProfileDelete(profile.name) }}
                        >
                          {t('deleteProfile')}
                        </button>
                      )}
                    </div>
                  ) : undefined
                return (
                  <Choice
                    key={profile.name}
                    title={profile.name}
                    body={profileState(profile, t)}
                    selected={current}
                    disabled={!profile.selectable || busy !== undefined || restart !== 'none'}
                    action={() => { selectProfile(profile.name) }}
                    status={current ? t('activeProfile') : undefined}
                    aside={deleteAction}
                  />
                )
              })}
            </div>
            <form className="dshDesktopSettingsForm" onSubmit={createProfile}>
              <label className="dshDesktopSettingsField">
                {t('profileName')}
                <input
                  className="dshDesktopSettingsInput"
                  value={profileName}
                  maxLength={128}
                  autoComplete="off"
                  placeholder={t('profileNamePlaceholder')}
                  disabled={busy !== undefined || restart !== 'none'}
                  onChange={event => { setProfileName(event.currentTarget.value) }}
                />
              </label>
              <button
                type="submit"
                className="dshDesktopSettingsButton"
                disabled={profileName.trim().length === 0 || busy !== undefined || restart !== 'none'}
              >
                {busy === 'create-profile' ? t('creatingProfile') : t('create')}
              </button>
            </form>
          </>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-market-title">
        <div>
          <h3 id="dsh-desktop-market-title">{t('marketTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('marketIntro')}</p>
        </div>
        {view?.market.legacyDefaulted === true && <p className="dshDesktopSettingsNotice">{t('legacyMarketNotice')}</p>}
        {view !== undefined && view.market.requested !== view.market.effective && restart === 'none' && (
          <p className="dshDesktopSettingsNotice" role="status">{t('marketLoadFailed')}</p>
        )}
        {view !== undefined && (
          <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-market-title">
            {MARKET_OPTIONS.map(option => (
              <Choice
                key={option.id}
                title={marketTitle(option, t)}
                body={marketBody(option, t)}
                selected={view.market.requested === option.id}
                reselectable={view.market.requested === option.id && view.market.requested !== view.market.effective}
                disabled={busy !== undefined || restart !== 'none'}
                action={() => { selectMarket(option.id) }}
                status={view.market.requested === option.id && view.market.requested !== view.market.effective
                    ? t('retryMarket')
                    : view.market.requested === option.id ? t('selected') : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-presentation-title">
        <div>
          <h3 id="dsh-desktop-presentation-title">{t('presentationTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('presentationIntro')}</p>
        </div>
        {desktop.status === 'unavailable' && <p className="dshDesktopSettingsNotice">{t('readOnly')}</p>}
        <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-presentation-title">
          <Choice
            title={t('compatibilityMode')}
            body={t('compatibilityModeBody')}
            selected={mode === 'compatibility'}
            disabled={!settingsWritable || busy !== undefined || restart !== 'none'}
            action={() => { setMode('compatibility') }}
            status={mode === 'compatibility' ? t('selected') : undefined}
          />
          <Choice
            title={t('extendedMode')}
            body={platform === 'linux' ? t('extendedUnavailableLinux') : t('extendedModeBody')}
            selected={mode === 'extended'}
            disabled={platform === 'linux' || !settingsWritable || busy !== undefined || restart !== 'none'}
            action={() => { setMode('extended') }}
            status={mode === 'extended' ? t('selected') : undefined}
          />
          <Choice
            title={t('advancedMode')}
            body={platform === 'linux' ? t('advancedUnavailableLinux') : t('advancedModeBody')}
            selected={mode === 'advanced'}
            disabled={platform === 'linux' || !settingsWritable || busy !== undefined || restart !== 'none'}
            action={() => { setMode('advanced') }}
            status={mode === 'advanced' ? t('selected') : undefined}
          />
        </div>
        {platform !== 'linux' && (
          <label className="dshDesktopSettingsMaterialField">
            <span className="dshDesktopSettingsMaterialCopy">
              <span className="dshDesktopSettingsChoiceTitle">{t('windowMaterial')}</span>
              <span className="dshDesktopSettingsChoiceBody">{t('windowMaterialBody')}</span>
            </span>
            <select
              className="dshDesktopSettingsSelect"
              value={platform === 'darwin'
                ? desktop.value?.macosMaterial ?? 'transparent'
                : !micaSupported && desktop.value?.windowsMaterial === 'mica'
                  ? 'acrylic'
                  : desktop.value?.windowsMaterial ?? 'acrylic'}
              disabled={!settingsWritable || busy !== undefined || restart !== 'none'}
              onChange={event => { setMaterial(event.currentTarget.value) }}
            >
              <option value="off">{t('windowMaterialOff')}</option>
              {platform === 'darwin'
                ? <option value="transparent">{t('windowMaterialTransparent')}</option>
                : (
                    <>
                      <option value="acrylic">{t('windowMaterialAcrylic')}</option>
                      {micaSupported && <option value="mica">{t('windowMaterialMica')}</option>}
                    </>
                  )}
            </select>
          </label>
        )}
        <div>
          <h3 id="dsh-desktop-character-theme-title">{t('characterThemeTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('characterThemeIntro')}</p>
        </div>
        <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-character-theme-title">
          <Choice
            title={t('characterThemeOff')}
            body={t('characterThemeOffBody')}
            selected={characterTheme === 'off'}
            disabled={!settingsWritable || busy !== undefined || restart !== 'none'}
            action={() => { setCharacterTheme('off') }}
            status={characterTheme === 'off' ? t('selected') : undefined}
          />
          <Choice
            title={t('characterThemeHutao')}
            body={t('characterThemeHutaoBody')}
            selected={characterTheme === 'hutao'}
            disabled={!settingsWritable || busy !== undefined || restart !== 'none'}
            action={() => { setCharacterTheme('hutao') }}
            status={characterTheme === 'hutao' ? t('selected') : undefined}
          />
          <Choice
            title={t('characterThemeFurina')}
            body={t('characterThemeFurinaBody')}
            selected={characterTheme === 'furina'}
            disabled={!settingsWritable || busy !== undefined || restart !== 'none'}
            action={() => { setCharacterTheme('furina') }}
            status={characterTheme === 'furina' ? t('selected') : undefined}
          />
        </div>
        {wallpaperTheme !== undefined && (
          <div className="dshDesktopWallpaper">
            <h3 id="dsh-desktop-wallpaper-title">{t('wallpaperTitle')}</h3>
            <p className="dshDesktopSettingsGroupIntro">{t('wallpaperIntro')}</p>
            {wallpapers === undefined && busy !== 'load' && (
              <p className="dshDesktopSettingsNotice">{t('wallpaperUnavailable')}</p>
            )}
            {wallpaperError !== undefined && (
              <p className="dshDesktopSettingsError" role="alert">{t(wallpaperError)}</p>
            )}
            {wallpaperItems.length > 0 && (
              <div className="dshDesktopWallpaperGrid" role="radiogroup" aria-labelledby="dsh-desktop-wallpaper-title">
                {wallpaperItems.map((item) => {
                  const selected = item.id === selectedWallpaperId
                  const confirmDelete = pendingWallpaperDelete === item.id
                  return (
                    <div
                      key={item.id}
                      role="radio"
                      className="dshDesktopWallpaperCard"
                      data-selected={selected ? 'true' : undefined}
                      data-actionable={!settingsWritable || wallpaperBusy ? undefined : 'true'}
                      aria-checked={selected}
                      aria-disabled={!settingsWritable || wallpaperBusy ? 'true' : undefined}
                      tabIndex={!settingsWritable || wallpaperBusy ? -1 : 0}
                      onClick={() => {
                        if (!settingsWritable || wallpaperBusy || selected) return
                        setWallpaper(wallpaperTheme, item.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                        event.preventDefault()
                        if (!settingsWritable || wallpaperBusy || selected) return
                        setWallpaper(wallpaperTheme, item.id)
                      }}
                    >
                      <span
                        className="dshDesktopWallpaperPreview"
                        style={{ backgroundImage: `url("${item.url}")` }}
                        aria-hidden="true"
                      />
                      <span className="dshDesktopWallpaperMeta">
                        <span className="dshDesktopWallpaperLabel">
                          {item.deletable ? item.label : t('wallpaperDefault')}
                        </span>
                        {selected && <span className="dshDesktopSettingsBadge">{t('selected')}</span>}
                      </span>
                      {item.deletable && settingsWritable && (busy === undefined || busy === 'wallpaper-delete') && (
                        <span className="dshDesktopWallpaperActions" onClick={event => { event.stopPropagation() }}>
                          {confirmDelete ? (
                            <span className="dshDesktopSettingsDeleteActions">
                              <button
                                type="button"
                                className="dshDesktopSettingsButton dshDesktopSettingsButtonDanger"
                                disabled={busy !== undefined}
                                onClick={() => { deleteWallpaper(wallpaperTheme, item.id) }}
                              >
                                {busy === 'wallpaper-delete' && pendingWallpaperDelete === item.id
                                  ? t('wallpaperDeleting')
                                  : t('wallpaperConfirmDelete')}
                              </button>
                              <button
                                type="button"
                                className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
                                disabled={busy !== undefined}
                                onClick={() => { setPendingWallpaperDelete(undefined) }}
                              >
                                {t('wallpaperCancelDelete')}
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
                              onClick={() => { setPendingWallpaperDelete(item.id) }}
                            >
                              {t('wallpaperDelete')}
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <button
              type="button"
              className="dshDesktopSettingsButton"
              disabled={!settingsWritable || busy !== undefined}
              onClick={() => { importWallpaper(wallpaperTheme) }}
            >
              {busy === 'wallpaper-import' ? t('wallpaperImporting') : t('wallpaperImport')}
            </button>
          </div>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-pet-title">
        <div>
          <h3 id="dsh-desktop-pet-title">{t('petTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('petIntro')}</p>
        </div>
        {(hutaoPet.status === 'unavailable' || furinaPet.status === 'unavailable') && (
          <p className="dshDesktopSettingsNotice">{t('readOnly')}</p>
        )}
        <ToggleRow
          label={t('petHutao')}
          checked={hutaoPetEnabled}
          disabled={!hutaoPetWritable || busy !== undefined}
          onChange={setHutaoPet}
        />
        <PetScaleField
          label={t('petScale')}
          value={hutaoPetScale}
          disabled={!hutaoPetEnabled || !hutaoPetWritable || busy !== undefined}
          onChange={setHutaoPetScale}
        />
        <ToggleRow
          label={t('petFurina')}
          checked={furinaPetEnabled}
          disabled={!furinaPetWritable || busy !== undefined}
          onChange={setFurinaPet}
        />
        <PetScaleField
          label={t('petScale')}
          value={furinaPetScale}
          disabled={!furinaPetEnabled || !furinaPetWritable || busy !== undefined}
          onChange={setFurinaPetScale}
        />
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-notifications-title">
        <div>
          <h3 id="dsh-desktop-notifications-title">{t('notificationsTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('notificationsIntro')}</p>
        </div>
        {notifications.status === 'unavailable' && <p className="dshDesktopSettingsNotice">{t('readOnly')}</p>}
        <ToggleRow
          label={t('notificationsEnabled')}
          checked={notificationValue.enabled}
          disabled={!notificationsWritable || busy !== undefined}
          onChange={checked => { setNotification('enabled', checked) }}
        />
        <div className="dshDesktopSettingsDetails">
          <ToggleRow
            label={t('turnCompletion')}
            checked={notificationValue.notifyOnTurnCompletion}
            disabled={!notificationValue.enabled || !notificationsWritable || busy !== undefined}
            onChange={checked => { setNotification('notifyOnTurnCompletion', checked) }}
          />
          <ToggleRow
            label={t('turnFailure')}
            checked={notificationValue.notifyOnTurnFailure}
            disabled={!notificationValue.enabled || !notificationsWritable || busy !== undefined}
            onChange={checked => { setNotification('notifyOnTurnFailure', checked) }}
          />
          <ToggleRow
            label={t('jobCompletion')}
            checked={notificationValue.notifyOnJobCompletion}
            disabled={!notificationValue.enabled || !notificationsWritable || busy !== undefined}
            onChange={checked => { setNotification('notifyOnJobCompletion', checked) }}
          />
          <ToggleRow
            label={t('jobFailure')}
            checked={notificationValue.notifyOnJobFailure}
            disabled={!notificationValue.enabled || !notificationsWritable || busy !== undefined}
            onChange={checked => { setNotification('notifyOnJobFailure', checked) }}
          />
        </div>
      </section>
    </div>
  )
}
