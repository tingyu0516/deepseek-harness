import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './contracts.ts'
import type { DesktopLayoutState } from './layout-state.ts'

/** Owned shells never select a global main panel; the Conversation stays active. */
const DESKTOP_PANEL_INFO: PanelInfo = Object.freeze({ activePanelId: null })

const DESKTOP_PANEL_INFO_SOURCE: HostObservable<PanelInfo> = {
  getSnapshot: () => DESKTOP_PANEL_INFO,
  subscribe: () => () => {},
}

/**
 * Provide the Desktop-owned layout service and conversation-only root panel info for one plugin-fiber lifetime.
 * @param ctx - active browser Cordis context.
 * @param layout - desktop-owned layout implementation.
 * @returns disposer for the service registration and the root panel-info source.
 */
export function provideDesktopLayout(ctx: ClientContext, layout: DesktopLayoutState): () => void {
  const disposeService = ctx.reflect.provide('layout', layout)
  const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: DESKTOP_PANEL_INFO_SOURCE } })
  return () => {
    disposePanelInfo()
    void disposeService()
  }
}
