/** Session and workspace snapshots used to pick an embedded terminal working directory. */
export interface DesktopTerminalCwdSessionList {
  readonly current: string | undefined
  readonly byId: Record<string, { readonly cwd?: string } | undefined>
}

/** Workspace rows that can own the current session. */
export interface DesktopTerminalCwdWorkspaceList {
  readonly recentWorkspaceId: string | undefined
  readonly items: readonly {
    readonly workspaceId: string
    readonly path: string
    readonly sessionIds?: readonly string[]
  }[]
}

/**
 * Prefer the current session directory, then the workspace that accounts for it.
 * @param sessions - live session list snapshot.
 * @param workspaces - live workspace list snapshot.
 * @returns an absolute-looking directory string, or undefined when none is known.
 */
export function resolveDesktopTerminalCwd(
  sessions: DesktopTerminalCwdSessionList,
  workspaces: DesktopTerminalCwdWorkspaceList,
): string | undefined {
  const currentId = sessions.current
  const current = currentId === undefined ? undefined : sessions.byId[currentId]
  if (current?.cwd !== undefined && current.cwd !== '') return current.cwd
  if (currentId !== undefined) {
    const owning = workspaces.items.find(item => item.sessionIds?.includes(currentId))
    if (owning !== undefined) return owning.path
  }
  const recent = workspaces.recentWorkspaceId
  return recent === undefined ? undefined : workspaces.items.find(item => item.workspaceId === recent)?.path
}
