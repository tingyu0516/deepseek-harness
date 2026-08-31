import { describe, expect, it } from 'vitest'
import { resolveDesktopTerminalCwd, resolveDesktopWorkspaceRoot } from '../src/client/desktop-terminal-cwd.ts'

describe('embedded terminal working directory', () => {
  it('prefers the current session directory, then the owning workspace', () => {
    expect(resolveDesktopTerminalCwd(
      { current: 's1', byId: { s1: { cwd: 'E:\\workspace\\app' } } },
      { recentWorkspaceId: 'w-other', items: [{ workspaceId: 'w-other', path: 'E:\\other' }] },
    )).toBe('E:\\workspace\\app')
    expect(resolveDesktopTerminalCwd(
      { current: 's1', byId: { s1: {} } },
      {
        recentWorkspaceId: 'w-other',
        items: [
          { workspaceId: 'w-app', path: 'E:\\workspace\\app', sessionIds: ['s1'] },
          { workspaceId: 'w-other', path: 'E:\\other' },
        ],
      },
    )).toBe('E:\\workspace\\app')
    expect(resolveDesktopTerminalCwd(
      { current: undefined, byId: {} },
      { recentWorkspaceId: 'w-other', items: [{ workspaceId: 'w-other', path: 'E:\\other' }] },
    )).toBe('E:\\other')
    expect(resolveDesktopTerminalCwd(
      { current: undefined, byId: {} },
      { recentWorkspaceId: undefined, items: [] },
    )).toBeUndefined()
  })

  it('lists the owning workspace instead of a session directory outside it', () => {
    expect(resolveDesktopWorkspaceRoot(
      { current: 's1', byId: { s1: { cwd: 'C:\\Users\\me\\profile' } } },
      {
        recentWorkspaceId: 'w-other',
        items: [
          { workspaceId: 'w-app', path: 'E:\\workspace\\app', sessionIds: ['s1'] },
          { workspaceId: 'w-other', path: 'E:\\other' },
        ],
      },
    )).toBe('E:\\workspace\\app')
    expect(resolveDesktopWorkspaceRoot(
      { current: 's1', byId: { s1: { cwd: 'C:\\Users\\me\\profile' } } },
      { recentWorkspaceId: 'w-other', items: [{ workspaceId: 'w-other', path: 'E:\\other' }] },
    )).toBe('E:\\other')
  })
})
