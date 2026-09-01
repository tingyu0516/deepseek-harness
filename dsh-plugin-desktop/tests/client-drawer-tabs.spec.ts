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
  it('starts with one unclosable terminal and one file manager tab', () => {
    expect(BASE_DRAWER_TABS).toHaveLength(2)
    expect(BASE_DRAWER_TABS.every(tab => !tab.closable)).toBe(true)
    expect(drawerTabKey(BASE_DRAWER_TABS[0]!)).toBe(INITIAL_DRAWER_TAB_KEY)
  })

  it('appends closable tabs and computes the next id above existing ones', () => {
    let tabs: readonly DrawerTab[] = addDrawerTab(BASE_DRAWER_TABS, 'terminal', 2)
    tabs = addDrawerTab(tabs, 'files', 3)
    expect(tabs).toHaveLength(4)
    expect(tabs[2]).toMatchObject({ id: 2, kind: 'terminal', closable: true })
    expect(tabs[3]).toMatchObject({ id: 3, kind: 'files', closable: true })
    expect(nextDrawerTabId(tabs)).toBe(4)
    tabs = removeDrawerTab(tabs, 3)
    expect(tabs).toHaveLength(3)
    expect(nextDrawerTabId(tabs)).toBe(3)
    expect(removeDrawerTab(tabs, 99)).toEqual(tabs)
  })

  it('numbers tabs per kind and keeps each first label plain', () => {
    const tabs = addDrawerTab(addDrawerTab(BASE_DRAWER_TABS, 'terminal', 2), 'files', 3)
    expect(drawerTabLabel(BASE_DRAWER_TABS[0]!, drawerTabOrdinal(BASE_DRAWER_TABS, BASE_DRAWER_TABS[0]!))).toBe('Terminal')
    expect(drawerTabLabel(BASE_DRAWER_TABS[1]!, drawerTabOrdinal(BASE_DRAWER_TABS, BASE_DRAWER_TABS[1]!))).toBe('File Manager')
    const secondTerminal = tabs[2]!
    expect(drawerTabLabel(secondTerminal, drawerTabOrdinal(tabs, secondTerminal))).toBe('Terminal 2')
    const secondFiles = tabs[3]!
    expect(drawerTabLabel(secondFiles, drawerTabOrdinal(tabs, secondFiles))).toBe('File Manager 2')
  })

  it('falls back to the terminal tab only when the active tab closes', () => {
    expect(resolveDrawerTabAfterClose('files:1', 'terminal:2')).toBe('files:1')
    expect(resolveDrawerTabAfterClose('terminal:2', 'terminal:2')).toBe(INITIAL_DRAWER_TAB_KEY)
  })
})
