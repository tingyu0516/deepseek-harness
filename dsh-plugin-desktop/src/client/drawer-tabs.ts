/** Pure tab-list model behind the desktop terminal drawer's dynamic tabs. */

export type DrawerTabKind = 'terminal' | 'files' | 'browser'

/** One drawer tab. The base Terminal, File Manager, and Browser tabs are never closable. */
export interface DrawerTab {
  readonly id: number
  readonly kind: DrawerTabKind
  readonly closable: boolean
}

const TAB_NOUNS: Record<DrawerTabKind, string> = {
  terminal: 'Terminal',
  files: 'File Manager',
  browser: 'Browser',
}

/** The three tabs every drawer starts with: terminal, file manager, and browser. */
export const BASE_DRAWER_TABS: readonly DrawerTab[] = Object.freeze([
  { id: 0, kind: 'terminal', closable: false },
  { id: 1, kind: 'files', closable: false },
  { id: 2, kind: 'browser', closable: false },
])

/** Key of the base terminal tab — the drawer's default active tab. */
export const INITIAL_DRAWER_TAB_KEY = 'terminal:0'

/** Stable identity for one tab across renders. */
export function drawerTabKey(tab: DrawerTab): string {
  return `${tab.kind}:${tab.id}`
}

/** Next free id above every tab currently in the list. */
export function nextDrawerTabId(tabs: readonly DrawerTab[]): number {
  return tabs.reduce((max, tab) => Math.max(max, tab.id), BASE_DRAWER_TABS.length - 1) + 1
}

/** Append one closable tab of the given kind. */
export function addDrawerTab(tabs: readonly DrawerTab[], kind: DrawerTabKind, id: number): readonly DrawerTab[] {
  return [...tabs, { id, kind, closable: true }]
}

/** Drop the tab with the given id; unknown ids are ignored. */
export function removeDrawerTab(tabs: readonly DrawerTab[], id: number): readonly DrawerTab[] {
  return tabs.filter(tab => tab.id !== id)
}

/** 1-based position of the tab among tabs of its own kind (the base tab is 1). */
export function drawerTabOrdinal(tabs: readonly DrawerTab[], tab: DrawerTab): number {
  return tabs.filter(candidate => candidate.kind === tab.kind).findIndex(candidate => candidate.id === tab.id) + 1
}

/** Human tab label; the first tab of a kind keeps the plain noun. */
export function drawerTabLabel(tab: DrawerTab, ordinal: number): string {
  const noun = TAB_NOUNS[tab.kind]
  return ordinal === 1 ? noun : `${noun} ${ordinal}`
}

/**
 * Active key after closing a tab: closing the active tab falls back to the
 * base terminal tab; closing a background tab keeps the current selection.
 */
export function resolveDrawerTabAfterClose(activeKey: string, removedKey: string): string {
  return activeKey === removedKey ? INITIAL_DRAWER_TAB_KEY : activeKey
}
