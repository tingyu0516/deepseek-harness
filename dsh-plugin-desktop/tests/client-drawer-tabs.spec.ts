import { describe, expect, it } from 'vitest'

import {
  BASE_DRAWER_TABS,
  INITIAL_DRAWER_TAB_KEY,
  addDrawerTab,
  drawerTabKey,
  drawerTabLabel,
  drawerTabOrdinal,
  nextDrawerTabId,
  removeDrawerTab,
  resolveDrawerTabAfterClose,
  type DrawerTab,
} from '../src/client/drawer-tabs.ts'

describe('drawer tab model', () => {
  it('starts with unclosable terminal, file manager, and browser tabs', () => {
    expect(BASE_DRAWER_TABS).toHaveLength(3)
    expect(BASE_DRAWER_TABS.every(tab => !tab.closable)).toBe(true)
    expect(drawerTabKey(BASE_DRAWER_TABS[0]!)).toBe(INITIAL_DRAWER_TAB_KEY)
    expect(drawerTabKey(BASE_DRAWER_TABS[2]!)).toBe('browser:2')
  })

  it('appends closable tabs and computes the next id above existing ones', () => {
    let tabs: readonly DrawerTab[] = addDrawerTab(BASE_DRAWER_TABS, 'terminal', 3)
    tabs = addDrawerTab(tabs, 'files', 4)
    tabs = addDrawerTab(tabs, 'browser', 5)
    expect(tabs).toHaveLength(6)
    expect(tabs[3]).toMatchObject({ id: 3, kind: 'terminal', closable: true })
    expect(tabs[4]).toMatchObject({ id: 4, kind: 'files', closable: true })
    expect(tabs[5]).toMatchObject({ id: 5, kind: 'browser', closable: true })
    expect(nextDrawerTabId(tabs)).toBe(6)
    tabs = removeDrawerTab(tabs, 4)
    expect(tabs).toHaveLength(5)
    expect(nextDrawerTabId(tabs)).toBe(6)
    expect(removeDrawerTab(tabs, 99)).toEqual(tabs)
  })

  it('numbers tabs per kind and keeps each first label plain', () => {
    const tabs = addDrawerTab(addDrawerTab(addDrawerTab(BASE_DRAWER_TABS, 'terminal', 3), 'files', 4), 'browser', 5)
    expect(drawerTabLabel(BASE_DRAWER_TABS[0]!, drawerTabOrdinal(BASE_DRAWER_TABS, BASE_DRAWER_TABS[0]!))).toBe('Terminal')
    expect(drawerTabLabel(BASE_DRAWER_TABS[1]!, drawerTabOrdinal(BASE_DRAWER_TABS, BASE_DRAWER_TABS[1]!))).toBe('File Manager')
    expect(drawerTabLabel(BASE_DRAWER_TABS[2]!, drawerTabOrdinal(BASE_DRAWER_TABS, BASE_DRAWER_TABS[2]!))).toBe('Browser')
    const secondTerminal = tabs[3]!
    expect(drawerTabLabel(secondTerminal, drawerTabOrdinal(tabs, secondTerminal))).toBe('Terminal 2')
    const secondFiles = tabs[4]!
    expect(drawerTabLabel(secondFiles, drawerTabOrdinal(tabs, secondFiles))).toBe('File Manager 2')
    const secondBrowser = tabs[5]!
    expect(drawerTabLabel(secondBrowser, drawerTabOrdinal(tabs, secondBrowser))).toBe('Browser 2')
  })

  it('falls back to the terminal tab only when the active tab closes', () => {
    expect(resolveDrawerTabAfterClose('files:1', 'terminal:2')).toBe('files:1')
    expect(resolveDrawerTabAfterClose('terminal:2', 'terminal:2')).toBe(INITIAL_DRAWER_TAB_KEY)
  })
})
