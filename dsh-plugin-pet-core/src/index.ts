/** Shared factory for DSH Desktop character pet plugins. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { pickPetLine, type PetCharacterDocument, type PetLineCategory } from './contracts.ts'
import { PetActivityTracker, type PetSessionEventLike, type PetSessionLike } from './pet-events.ts'
import {
  loadPetElectron,
  petStatePath,
  PetWindowController,
  type PetElectron,
} from './pet-window.ts'

export {
  parsePetCharacterDocument,
  pickPetLine,
  PetCharacterError,
  PET_LINE_CATEGORIES,
} from './contracts.ts'
export type {
  PetCharacterDocument,
  PetCharacterId,
  PetLineCategory,
  PetLines,
  PetLocale,
  PetState,
} from './contracts.ts'
export type { PetActivityEvent } from './pet-events.ts'
export {
  loadPetElectron,
  petStatePath,
  petStateDuration,
  PetWindowController,
  resolvePetLive2DUrls,
  PET_SPEECH_SLOT_PX,
} from './pet-window.ts'
export { readPetLive2DCoreText, readPetLive2DViewerText } from './pet-live2d-host.ts'
export type {
  PetBootPayload,
  PetBrowserWindow,
  PetElectron,
  PetLive2DAssets,
  PetLive2DSelection,
  PetRectangle,
  PetRuntimeHost,
} from './pet-window.ts'

/** Settings presented by every character pet plugin. */
export interface PetSettings {
  /** Whether the pet window should exist at all. Defaults to hidden. */
  enabled: boolean
  /** Window scale multiplier applied live. */
  scale: number
  /** Whether agent turns and jobs drive pet reactions. */
  eventReactions: boolean
  /** Whether the pet speaks unprompted idle lines. */
  idleChatter: boolean
}

export const PET_SCALES = [0.75, 1, 1.25, 1.5] as const

export function petSettingsSchema() {
  return z.object({
    enabled: z.boolean().default(false),
    scale: z.union(PET_SCALES).default(1),
    eventReactions: z.boolean().default(true),
    idleChatter: z.boolean().default(true),
  })
}

/** Narrow view of one registered settings scope the factory needs. */
interface PetSettingsScope {
  get(): PetSettings
  watch(next: (value: PetSettings) => void): () => void
  update(values: Partial<PetSettings>): Promise<void>
}

/** Inputs one character pet plugin entry provides to the shared factory. */
export interface PetPluginOptions {
  /** Stable Cordis row/plugin name, e.g. `desktop-pet-hutao`. */
  readonly pluginName: string
  /** Lazily read and validate the shipped character document. */
  readonly loadCharacter: () => PetCharacterDocument
  /** Lazily resolve the shared renderer page inside this installation. */
  readonly loadHtmlPath: () => string
  /**
   * Lazily resolve the plugin's `assets/live2d/` directory. When the
   * directory or its model assets are missing, the pet window stays closed.
   */
  readonly loadLive2DDir?: () => string | undefined
  /** Tray order inside the `tools` group. */
  readonly trayOrder: number
  /** Test seam for the Electron main-process module. */
  readonly loadElectron?: (moduleUrl: string) => PetElectron | undefined
}

/** Tray labels for one pet, per desktop locale. */
interface PetTrayCopy {
  readonly pet: string
  readonly show: string
  readonly wave: string
  readonly eventReactions: string
  readonly idleChatter: string
}

const TRAY_COPY: Readonly<Record<'zh' | 'en', PetTrayCopy>> = Object.freeze({
  zh: Object.freeze({
    pet: '桌宠',
    show: '显示桌宠',
    wave: '打个招呼',
    eventReactions: '响应会话与任务',
    idleChatter: '闲聊台词',
  }),
  en: Object.freeze({
    pet: 'Pet',
    show: 'Show companion',
    wave: 'Say hello',
    eventReactions: 'React to sessions and jobs',
    idleChatter: 'Idle chatter',
  }),
})

type ReactionState = 'work' | 'cheer' | 'sad' | 'idle'
const REACTION_CATEGORIES: Readonly<Record<Exclude<ReactionState, 'idle'>, PetLineCategory>> = Object.freeze({
  work: 'work',
  cheer: 'cheer',
  sad: 'sad',
})

/**
 * Build one complete Cordis pet plugin around a character document.
 * The plugin stays completely inert outside the DSH Desktop launcher.
 */
export function createPetPlugin(options: PetPluginOptions): {
  readonly name: string
  readonly inject: readonly string[]
  readonly apply: (ctx: Context) => void
} {
  const namespace = settingsNamespace(`dsh-${options.pluginName}`)

  return {
    name: options.pluginName,
    inject: ['desktopRuntime'],

    apply(ctx: Context): void {
      const runtime = ctx.get('desktopRuntime')
      if (runtime === undefined) {
        ctx.logger.info(`${options.pluginName}: desktop runtime unavailable; pet stays inactive`)
        return
      }
      let character: PetCharacterDocument
      let htmlPath: string
      try {
        character = options.loadCharacter()
        htmlPath = options.loadHtmlPath()
      } catch (cause) {
        ctx.logger.error(
          `${options.pluginName}: character resources failed validation: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
        return
      }
      const electron = (options.loadElectron ?? loadPetElectron)(import.meta.url)
      if (electron === undefined) {
        ctx.logger.info(`${options.pluginName}: Electron main module unavailable; pet stays inactive`)
        return
      }

      const locale = (): 'zh' | 'en' => (runtime.locale === 'zh' ? 'zh' : 'en')
      const trayCopy = (): PetTrayCopy => TRAY_COPY[locale()]
      const schema = petSettingsSchema()
      let settings: PetSettings = schema({}) as PetSettings
      let settingsScope: PetSettingsScope | undefined

      const patchSettings = (values: Partial<PetSettings>): void => {
        const scope = settingsScope
        if (scope === undefined) return
        void scope.update(values).catch(() => {})
      }

      let controller: PetWindowController | undefined
      let trayRegistration: { refresh(): void, dispose(): void } | undefined
      const tracker = new PetActivityTracker()

      const line = (category: PetLineCategory): string => pickPetLine(character, locale(), category)

      const syncPetWindow = (previous: PetSettings, next: PetSettings): void => {
        if (previous.enabled !== next.enabled) {
          if (next.enabled) {
            controller?.open()
            controller?.applyScale(next.scale)
          } else {
            controller?.close()
          }
          return
        }
        if (!next.enabled) return
        if (previous.scale !== next.scale) controller?.applyScale(next.scale)
        if (previous.scale !== next.scale || previous.idleChatter !== next.idleChatter) {
          controller?.reboot()
        }
      }

      const applySetting = (values: Partial<PetSettings>): void => {
        const previous = settings
        settings = { ...settings, ...values }
        patchSettings(values)
        syncPetWindow(previous, settings)
        trayRegistration?.refresh()
      }

      const react = (state: ReactionState): void => {
        if (!settings.eventReactions) return
        if (state === 'idle') {
          controller?.emit('idle')
          return
        }
        controller?.emit(state, line(REACTION_CATEGORIES[state]))
      }

      ctx.effect(() => {
        controller = new PetWindowController({
          character,
          htmlPath,
          statePath: petStatePath(runtime.userDataDir, character.id),
          electron,
          locale,
          idleChatter: () => settings.idleChatter,
          ...(options.loadLive2DDir === undefined ? {} : { live2dDir: options.loadLive2DDir }),
          log: message => { ctx.logger.info(`${options.pluginName}: ${message}`) },
          onCommand: command => {
            if (command === 'hide') applySetting({ enabled: false })
          },
        })
        if (settings.enabled) controller.open()
        return () => {
          controller?.dispose()
          controller = undefined
        }
      }, `${options.pluginName}: pet window lifetime`)

      ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.effect(() => {
          const scope = settingsCtx.settings.register(namespace, schema, { applies: 'live' })
          settingsScope = scope as PetSettingsScope
          const previous = settings
          settings = scope.get()
          // The window effect above opened with the defaults before persisted
          // settings arrived; reconcile the existing controller now so an
          // initially disabled pet is closed and a scaled one is resized.
          syncPetWindow(previous, settings)
          trayRegistration?.refresh()
          const stopWatching = scope.watch((next) => {
            const watched = settings
            settings = next
            syncPetWindow(watched, next)
            trayRegistration?.refresh()
          })
          return () => {
            stopWatching()
            settingsScope = undefined
          }
        }, `${options.pluginName}: pet settings`)
      })

      trayRegistration = runtime.registerTrayItem({
        group: 'tools',
        order: options.trayOrder,
        label: () => `${trayCopy().pet} · ${character.copy[locale()].label}`,
        invoke: () => {},
        submenu: () => [
          {
            type: 'checkbox',
            label: () => trayCopy().show,
            checked: () => settings.enabled,
            invoke: () => { applySetting({ enabled: !settings.enabled }) },
          },
          {
            label: () => trayCopy().wave,
            enabled: () => settings.enabled,
            invoke: () => {
              controller?.emit('special', line('special'))
            },
          },
          {
            type: 'checkbox',
            label: () => trayCopy().eventReactions,
            checked: () => settings.eventReactions,
            invoke: () => { applySetting({ eventReactions: !settings.eventReactions }) },
          },
          {
            type: 'checkbox',
            label: () => trayCopy().idleChatter,
            checked: () => settings.idleChatter,
            invoke: () => { applySetting({ idleChatter: !settings.idleChatter }) },
          },
        ],
      })
      ctx.effect(() => () => { trayRegistration?.dispose() }, `${options.pluginName}: tray item`)

      // The sessions and jobs services are typed structurally so this engine
      // never depends on the DSH session type graph.
      ctx.inject(['sessions'], (sessionsCtx) => {
        sessionsCtx.effect(() => {
          const events = sessionsCtx as unknown as {
            on(event: 'session/event', handler: (session: PetSessionLike, event: PetSessionEventLike) => void): () => void
            on(event: 'session/disposed', handler: (session: PetSessionLike) => void): () => void
          }
          const stopEvents = events.on('session/event', (session, event) => {
            const state = tracker.noteSessionEvent(session, event)
            if (state !== undefined) react(state)
          })
          const stopDisposed = events.on('session/disposed', (session) => {
            tracker.noteSessionDisposed(session)
          })
          return () => {
            stopDisposed()
            stopEvents()
          }
        }, `${options.pluginName}: session reactions`)
      })

      ctx.inject(['jobs'], (jobsCtx) => {
        jobsCtx.effect(
          () => (jobsCtx as unknown as {
            jobs: { onJobDone(callback: (snapshot: { readonly status: string }) => void): () => void }
          }).jobs.onJobDone(snapshot => {
            const state = tracker.noteJobStatus(snapshot.status)
            if (state !== undefined) react(state)
          }),
          `${options.pluginName}: job reactions`,
        )
      })
    },
  }
}
