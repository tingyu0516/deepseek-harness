import {
  ADVANCED_MACOS_CONTENT_INSET,
  ADVANCED_MACOS_DRAG_LAYER_Z_INDEX,
  ADVANCED_MACOS_DRAG_REGION_HEIGHT,
  ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
  MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
  WINDOWS_CAPTION_CONTROLS_WIDTH,
} from '../window-chrome.ts'
import { SIDEBAR_COLLAPSED } from './layout-state.ts'

/** Desktop-owned shell stylesheet kept as a plain string so the client bundle stays self-contained. */
const DESKTOP_OWNED_STYLES = `
html, body, #root { width: 100%; height: 100%; }
body:is([data-dsh-desktop-mode="extended"], [data-dsh-desktop-mode="advanced"]) { margin: 0; background-color: transparent !important; background-image: none; }
body:is([data-dsh-desktop-mode="extended"], [data-dsh-desktop-mode="advanced"]) #root { background-color: transparent !important; background-image: none; }
.dshDesktopFrame { position: relative; box-sizing: border-box; display: grid; grid-template-rows: 100%; width: 100%; height: 100%; overflow: hidden; background-color: transparent; }
.dshDesktopSidebarSurface { --dsw-specific-sidebar-fill: transparent; position: relative; grid-column: 1; grid-row: 1; min-width: 0; overflow: hidden; background: transparent; border-right: 1px solid var(--dsw-alias-border-l1); }
body:is([data-dsh-desktop-mode="extended"], [data-dsh-desktop-mode="advanced"])[data-dsh-desktop-material="off"] .dshDesktopSidebarSurface { --dsw-specific-sidebar-fill: var(--dsw-alias-bg-layer-1); background: var(--dsw-alias-bg-layer-1); }
.dshDesktopUpstreamSidebar { box-sizing: border-box; width: 100%; height: 100%; }
body:is([data-dsh-desktop-mode="extended"], [data-dsh-desktop-mode="advanced"]) [data-slot="sidebar.footer.action"] { display: flex !important; flex-direction: column; gap: 6px; min-width: 0; width: 100%; max-height: min(40vh, 240px); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
body:is([data-dsh-desktop-mode="extended"], [data-dsh-desktop-mode="advanced"]) [data-slot="sidebar.footer.action"] > * { flex: none; min-width: 0; }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="darwin"] .dshDesktopUpstreamSidebar { padding-top: ${ADVANCED_MACOS_CONTENT_INSET}px; }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="darwin"][data-sidebar-collapsed] .dshDesktopUpstreamSidebar { width: ${SIDEBAR_COLLAPSED}px; margin: 0 auto; }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="darwin"] { grid-template-rows: ${ADVANCED_MACOS_CONTENT_INSET}px minmax(0, 1fr); }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="darwin"] .dshDesktopSidebarSurface { grid-row: 1 / -1; }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="darwin"] .dshDesktopConversationSurface,
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="darwin"] .dshDesktopDetailsSurface,
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="darwin"] .dshDesktopTerminalSurface { grid-row: 2; }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="darwin"] .dshDesktopSidebarSurface::before { content: ""; position: absolute; z-index: ${ADVANCED_MACOS_DRAG_LAYER_Z_INDEX}; top: 0; right: 0; left: ${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH}px; height: ${ADVANCED_MACOS_DRAG_REGION_HEIGHT}px; user-select: none; -webkit-app-region: drag; }
.dshDesktopMacCaptionRow { position: absolute; z-index: ${ADVANCED_MACOS_DRAG_LAYER_Z_INDEX}; grid-column: 2 / -1; grid-row: 1; top: 0; right: 0; left: 0; height: ${ADVANCED_MACOS_DRAG_REGION_HEIGHT}px; background: var(--dsw-alias-bg-base); user-select: none; -webkit-app-region: drag; }
.dshDesktopConversationSurface { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--dsw-alias-bg-base); }
.dshDesktopDetailsSurface { grid-column: 3; grid-row: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); border-left: 1px solid var(--dsw-alias-border-l2); }
.dshDesktopTerminalSurface { grid-column: 4; grid-row: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); border-left: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopFrame[data-details-collapsed] .dshDesktopDetailsSurface { border-left: none; }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="win32"] { grid-template-rows: ${ADVANCED_WINDOWS_TITLEBAR_HEIGHT}px minmax(0, 1fr); }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="win32"] .dshDesktopSidebarSurface { grid-row: 1 / -1; }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="win32"] .dshDesktopConversationSurface,
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="win32"] .dshDesktopDetailsSurface,
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="win32"] .dshDesktopTerminalSurface { grid-row: 2; }
.dshDesktopWindowsCaptionRow { position: relative; grid-column: 2 / -1; grid-row: 1; min-width: 0; background: var(--dsw-alias-bg-base); }
.dshDesktopWindowsCaptionRow::before { content: ""; position: absolute; inset: 0 ${WINDOWS_CAPTION_CONTROLS_WIDTH}px 0 0; user-select: none; -webkit-app-region: drag; }
.dshDesktopFrame[data-dragging] { transition: none; }
.dshDesktopOverlay { position: absolute; z-index: 1000; grid-column: 1 / -1; grid-row: 1 / -1; inset: 0; pointer-events: none; }
.dshDesktopOverlay > * { pointer-events: auto; }
.dshDesktopTerminalDrawer { position: absolute; z-index: 20; top: 0; right: 0; left: auto; bottom: 0; display: flex; flex-direction: column; width: min(640px, 92vw); min-width: 280px; isolation: isolate; background: var(--dsw-alias-bg-base); border-left: 1px solid var(--dsw-alias-border-l1); -webkit-app-region: no-drag; }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="win32"] .dshDesktopTerminalDrawer { top: ${ADVANCED_WINDOWS_TITLEBAR_HEIGHT}px; }
.dshDesktopFrame[data-desktop-mode="advanced"][data-desktop-platform="darwin"] .dshDesktopTerminalDrawer { top: ${ADVANCED_MACOS_DRAG_REGION_HEIGHT}px; }
.dshDesktopTerminalDrawerHeader { display: flex; align-items: center; justify-content: space-between; min-height: 42px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopTerminalDrawerTabs { display: flex; align-items: stretch; gap: 2px; min-width: 0; }
.dshDesktopTerminalDrawerTabs [role="tab"] { display: inline-flex; align-items: center; gap: 6px; width: auto; padding: 0 10px; border: 0; border-bottom: 2px solid transparent; color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer; }
.dshDesktopTerminalDrawerTabs [role="tab"].is-active { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-label-primary); }
.dshDesktopDrawerTab { display: inline-flex; align-items: center; min-width: 0; }
.dshDesktopDrawerTabClose { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; height: 16px; margin-left: -4px; padding: 0; border: 0; border-radius: 3px; color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer; }
.dshDesktopDrawerTabClose:hover { color: var(--dsw-alias-label-primary); }
.dshDesktopTerminalDrawerAddWrap { position: relative; display: inline-flex; align-items: center; margin-left: 2px; }
.dshDesktopTerminalDrawerAdd { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer; }
.dshDesktopTerminalDrawerAdd:hover, .dshDesktopTerminalDrawerAdd[aria-expanded="true"] { color: var(--dsw-alias-label-primary); }
.dshDesktopTerminalDrawerAddMenu { position: absolute; z-index: 30; top: calc(100% + 4px); right: 0; display: flex; flex-direction: column; min-width: 160px; padding: 4px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; box-shadow: 0 8px 24px color-mix(in srgb, black 18%, transparent); }
.dshDesktopTerminalDrawerAddMenu button { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 8px; border: 0; border-radius: 4px; color: var(--dsw-alias-label-primary); background: transparent; text-align: left; cursor: pointer; }
.dshDesktopTerminalDrawerAddMenu button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopTerminalDrawerTabPane { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.dshDesktopTerminalDrawerTabPane[hidden] { display: none; }
.dshDesktopTerminalDrawerSession { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.dshDesktopFileManager { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 34%); flex: 1; min-height: 0; }
.dshDesktopFileManagerContent { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopFileManagerToolbar { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopFileManagerToolbar .dshDesktopFileManagerPath { flex: 1; min-width: 0; padding: 0; border: 0; }
.dshDesktopFileManagerPath { padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopFileManagerDirty { flex: none; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dshDesktopFileManagerSave { flex: none; min-height: 24px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; color: inherit; background: transparent; cursor: pointer; }
.dshDesktopFileManagerSave:disabled { opacity: 0.5; cursor: default; }
.dshDesktopFileManagerEditor { flex: 1; min-height: 0; width: 100%; margin: 0; padding: 12px; border: 0; resize: none; color: inherit; background: transparent; outline: none; white-space: pre; overflow: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.dshDesktopFileManagerTree { min-width: 0; overflow: auto; padding: 8px; }
.dshDesktopFileManagerTreeHeader { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 4px 6px 8px; font-size: 12px; }
.dshDesktopFileManagerTreeHeader strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopFileTreeNode { min-width: 0; }
.dshDesktopFileTreeEntry { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 28px; padding-top: 4px; padding-right: 6px; padding-bottom: 4px; border: 0; color: var(--dsw-alias-label-primary); background: transparent; text-align: left; cursor: pointer; }
.dshDesktopFileTreeEntry:hover, .dshDesktopFileTreeEntry[aria-current="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopFileTreeEntry[data-hidden] { color: var(--dsw-alias-label-secondary); }
.dshDesktopFileTreeEntry svg:first-child { flex: none; }
.dshDesktopFileTreeEntry svg.is-expanded { transform: rotate(90deg); }
.dshDesktopFileTreeEntry span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopFileTreeIndent { width: 14px; flex: none; }
.dshDesktopFileTreeStatus { padding: 4px 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; overflow-wrap: anywhere; }
.dshDesktopFileTreeStatus.is-error, .dshDesktopFileManagerError { color: var(--dsw-alias-danger, #d14343); }
.dshDesktopFileManagerStatus { padding: 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshDesktopTerminalDrawerHeader > button { flex: none; width: 28px; height: 28px; border: 0; background: transparent; color: inherit; cursor: pointer; }
.dshDesktopTerminalDrawerViewport { flex: 1; min-height: 0; padding: 10px; overflow: hidden; background: transparent; }
.dshDesktopTerminalDrawerViewport .xterm { height: 100%; background: transparent; }
.dshDesktopTerminalDrawerViewport .xterm .xterm-viewport { background: transparent; }
.dshDesktopTerminalDrawerError { flex: none; padding: 8px 12px; color: var(--dsw-alias-danger, #d14343); font-size: 12px; }
.dshDesktopChanges { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.dshDesktopChangesToolbar { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopChangesView { position: relative; min-width: 0; }
.dshDesktopChangesView > button, .dshDesktopChangesBranch { display: inline-flex; align-items: center; gap: 6px; min-width: 0; min-height: 28px; padding: 0 8px; border: 0; border-radius: 4px; color: var(--dsw-alias-label-primary); background: transparent; cursor: pointer; }
.dshDesktopChangesView > button:hover, .dshDesktopChangesRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopChangesStats { display: inline-flex; gap: 6px; font: 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace; }
.dshDesktopChangesPlus { color: var(--dsw-alias-success, #3f9a5a); }
.dshDesktopChangesMinus { color: var(--dsw-alias-danger, #d14343); }
.dshDesktopChangesBranch { margin-left: auto; color: var(--dsw-alias-label-secondary); cursor: default; }
.dshDesktopChangesBranch span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopChangesMenu { position: absolute; z-index: 2; top: 100%; left: 0; min-width: 220px; margin: 4px 0 0; padding: 4px; list-style: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); box-shadow: 0 8px 24px color-mix(in srgb, black 18%, transparent); }
.dshDesktopChangesMenu button { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 28px; padding: 0 8px; border: 0; border-radius: 4px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.dshDesktopChangesMenu button:hover, .dshDesktopChangesRow.is-selected { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopChangesSplit { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 40%); flex: 1; min-height: 0; }
.dshDesktopChangesDiff { min-width: 0; min-height: 0; overflow: auto; border-right: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopChangesDiff pre { margin: 0; padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.dshDesktopChangesList { min-width: 0; overflow: auto; padding: 4px; }
.dshDesktopChangesRow { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 28px; padding: 0 8px; border: 0; color: var(--dsw-alias-label-primary); background: transparent; text-align: left; cursor: pointer; }
.dshDesktopChangesRowName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopChangesRowMeta { margin-left: auto; flex: none; color: var(--dsw-alias-label-secondary); font: 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace; }
.dshDesktopComposerBranch { box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: calc(100% - var(--dsh-composer-side-clearance, 0px) * 2 - var(--dsh-composer-dock-inset, 0px) * 4); max-width: calc(var(--dsh-composer-card-max-width, 800px) - 4 * var(--dsh-composer-dock-inset, 0px)); min-height: 24px; margin: 0 auto; padding: 0 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.2; }
.dshDesktopComposerBranch span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.dshDesktopResizeHandle { position: absolute; z-index: 50; top: 0; bottom: 0; width: 8px; margin-left: -4px; cursor: col-resize; touch-action: none; -webkit-app-region: no-drag; }
.dshDesktopFrame[data-dragging] .dshDesktopResizeHandle { transition: none; }
.dshDesktopNoDrag, button, input, textarea, select, label, summary, a, [contenteditable="true"], [role="button"], [role="checkbox"], [role="dialog"], [role="menuitem"], [role="option"], [role="switch"], [role="tab"] { -webkit-app-region: no-drag !important; }
[role="dialog"], [aria-modal="true"] { -webkit-app-region: no-drag !important; }
html:has([aria-modal="true"]) .dshDesktopWindowsCaptionRow::before { -webkit-app-region: no-drag !important; }
@media (prefers-reduced-motion: reduce) {
  .dshDesktopFrame,
  .dshDesktopResizeHandle { transition: none !important; }
}
`

/** Install shared panel styles; mode selectors keep enhanced and extended chrome independent. */
export function installDesktopOwnedStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/desktop-owned-layout'
  style.textContent = DESKTOP_OWNED_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}
