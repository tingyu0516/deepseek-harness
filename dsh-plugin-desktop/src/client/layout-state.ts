import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Advanced-shell panel state shared by the root slot and layout-service adapter. */
export interface DesktopLayoutSnapshot {
  /** Preferred sidebar width; zero means the compact rail. */
  sidebar: number
  /** Preferred details width; zero means closed. */
  details: number
  /** Saved right panel width, or null before the first opening. */
  rightbar: number | null
  /** Whether the right panel is drawn at all. */
  rightbarShown: boolean
  /** Whether the normal right panel width reserves a grid track. */
  rightbarTrack: boolean
  /** Whether the right panel covers the frame and hides its outer handle. */
  rightbarFullscreen: boolean
  /** Whether the current viewport is below the automatic-collapse breakpoint. */
  narrow: boolean
  /** Manual narrow-screen override that temporarily expands the rail. */
  narrowExpanded: boolean
}

/** Column geometry after preserving the center surface. */
export interface DesktopColumns {
  /** Rendered sidebar width. */
  sidebar: number
  /** Rendered center width. */
  center: number
  /** Rendered details width. */
  details: number
  /** Rendered rightbar track width. */
  rightbar: number
}

/** Default compact rail used by the upstream sidebar. */
export const SIDEBAR_COLLAPSED = 56
/** Wider compact rail reserved only for the enhanced macOS presentation. */
export const MACOS_SIDEBAR_COLLAPSED = 90
export const SIDEBAR_DEFAULT = 280
export const SIDEBAR_MIN = 264
export const SIDEBAR_MAX = 420
export const SIDEBAR_AUTO_COLLAPSE = 1024
export const DETAILS_DEFAULT = 360
export const DETAILS_MIN = 300
export const DETAILS_MAX = 520
export const CENTER_MIN = 640
/** Right column drag clamp floor, matching the official AppFrame. */
export const RIGHTBAR_MIN = 300
/** Maximum normal right panel width as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7
/** First-open right panel preference as a fraction of the frame. */
export const RIGHTBAR_DEFAULT_RATIO = 0.45

/** Keep the wider macOS rail private to enhanced mode; extended uses upstream geometry. */
export function collapsedSidebarWidth(
  mode: 'extended' | 'advanced',
  platform: 'darwin' | 'win32' | 'linux',
): number {
  return mode === 'advanced' && platform === 'darwin'
    ? MACOS_SIDEBAR_COLLAPSED
    : SIDEBAR_COLLAPSED
}

/**
 * Resolve desktop columns without allowing details or the rightbar to squeeze the conversation below its floor.
 * The rightbar concedes first, then details; the sidebar never concedes here.
 * @param viewport - available frame width.
 * @param sidebar - sidebar preference, where zero selects the compact rail.
 * @param details - details preference, where zero closes the panel.
 * @param collapsedWidth - compact rail width for a closed sidebar.
 * @param rightbar - requested right panel width, where zero closes the track.
 * @returns rendered column widths.
 */
export function computeDesktopColumns(
  viewport: number,
  sidebar: number,
  details: number,
  collapsedWidth: number = SIDEBAR_COLLAPSED,
  rightbar: number = 0,
): DesktopColumns {
  const sidebarWidth = sidebar === 0 ? collapsedWidth : clamp(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const preferredDetails = details === 0 ? 0 : clamp(details, DETAILS_MIN, DETAILS_MAX)
  const preferredRightbar = rightbar === 0 ? 0 : clamp(rightbar, RIGHTBAR_MIN, Math.round(viewport * RIGHTBAR_MAX_RATIO))
  const remaining = viewport - sidebarWidth
  const maxPanels = Math.max(0, remaining - CENTER_MIN)
  let detailsWidth = preferredDetails
  let rightbarWidth = preferredRightbar
  if (detailsWidth + rightbarWidth > maxPanels) {
    rightbarWidth = Math.min(rightbarWidth, Math.max(0, maxPanels - detailsWidth))
    if (rightbarWidth > 0 && rightbarWidth < RIGHTBAR_MIN) rightbarWidth = 0
    if (detailsWidth + rightbarWidth > maxPanels) {
      detailsWidth = Math.min(detailsWidth, maxPanels)
      if (detailsWidth > 0 && detailsWidth < DETAILS_MIN) detailsWidth = 0
    }
  }
  return {
    sidebar: sidebarWidth,
    center: Math.max(0, remaining - detailsWidth - rightbarWidth),
    details: detailsWidth,
    rightbar: rightbarWidth,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

const INITIAL_SNAPSHOT: DesktopLayoutSnapshot = Object.freeze({
  sidebar: SIDEBAR_DEFAULT,
  details: 0,
  rightbar: null,
  rightbarShown: false,
  rightbarTrack: false,
  rightbarFullscreen: false,
  narrow: false,
  narrowExpanded: false,
})

/** Small observable panel controller used by the advanced root registration. */
export class DesktopLayoutState implements ILayout {
  private snapshot: DesktopLayoutSnapshot = INITIAL_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  private navigation = new AbortController()

  /** @returns the immutable current panel snapshot. */
  getSnapshot(): DesktopLayoutSnapshot {
    return this.snapshot
  }

  /** @param listener - callback notified after a snapshot replacement. @returns its disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Desktop-owned frames have no global main panels.
   * @param panelId - registered main key, or null to show the Conversation.
   * @throws if a global panel is requested.
   */
  selectPanel(panelId: MainPanelId | null): void {
    this.navigation.abort()
    if (panelId !== null) {
      throw new Error('layout.selectPanel: main panel is not registered')
    }
  }

  /** @returns a signal aborted by the next navigation or layout disposal. */
  beginNavigation(): AbortSignal {
    this.navigation.abort()
    this.navigation = new AbortController()
    return this.navigation.signal
  }

  /** Toggle the wide sidebar and the platform-selected compact rail. */
  toggleSidebar(): void {
    if (this.snapshot.narrow) {
      this.publish({ ...this.snapshot, narrowExpanded: !this.snapshot.narrowExpanded })
      return
    }
    this.publish({ ...this.snapshot, sidebar: this.snapshot.sidebar === 0 ? SIDEBAR_DEFAULT : 0 })
  }

  /**
   * Report the right panel's track and fullscreen presentation.
   * @param track - whether the normal panel width reserves a grid track.
   * @param fullscreen - whether the panel covers the frame and hides its outer handle.
   */
  openRightbar(track: boolean, fullscreen: boolean): void {
    const next: DesktopLayoutSnapshot = {
      ...this.snapshot,
      rightbarShown: true,
      rightbarTrack: track,
      rightbarFullscreen: fullscreen,
    }
    if (!this.snapshot.rightbarShown && this.snapshot.narrow) next.narrowExpanded = false
    this.publish(next)
  }

  /** Report the right panel as hidden: no track, no handle. */
  closeRightbar(): void {
    if (!this.snapshot.rightbarShown) return
    this.publish({
      ...this.snapshot,
      rightbarShown: false,
      rightbarTrack: false,
      rightbarFullscreen: false,
    })
  }

  /** @param narrow - whether the frame is below the automatic-collapse breakpoint. */
  setNarrow(narrow: boolean): void {
    if (this.snapshot.narrow === narrow) return
    this.publish({ ...this.snapshot, narrow, narrowExpanded: false })
  }

  /** Open details at its default width. */
  openDetails(): void {
    if (this.snapshot.details === 0) this.publish({ ...this.snapshot, details: DETAILS_DEFAULT })
  }

  /** Close details while keeping its slot mounted. */
  closeDetails(): void {
    if (this.snapshot.details !== 0) this.publish({ ...this.snapshot, details: 0 })
  }

  /** @param width - requested sidebar width from a resize gesture. */
  setSidebar(width: number): void {
    this.publish({ ...this.snapshot, sidebar: clamp(width, SIDEBAR_MIN, SIDEBAR_MAX) })
  }

  /** @param width - requested details width from a resize gesture. */
  setDetails(width: number): void {
    this.publish({ ...this.snapshot, details: clamp(width, DETAILS_MIN, DETAILS_MAX) })
  }

  /**
   * @param width - requested right panel width from a resize gesture.
   * @param viewport - current frame width used to clamp the official 70% ceiling.
   */
  setRightbar(width: number, viewport: number): void {
    this.publish({
      ...this.snapshot,
      rightbar: clamp(width, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, Math.round(viewport * RIGHTBAR_MAX_RATIO))),
    })
  }

  private publish(next: DesktopLayoutSnapshot): void {
    this.snapshot = Object.freeze(next)
    for (const listener of this.listeners) listener()
  }
}
