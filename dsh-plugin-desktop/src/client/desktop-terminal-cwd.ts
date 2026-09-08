/** Session and workspace snapshots used to pick an embedded terminal working directory. */
export interface DesktopTerminalCwdSessionList {
  readonly current: string | undefined
  readonly byId: Record<string, { readonly cwd?: string; readonly updatedAt?: number } | undefined>
}

/** Workspace rows that can own the current session. */
export interface DesktopTerminalCwdWorkspaceList {
  readonly items: readonly {
    readonly workspaceId: string
    readonly path: string
    readonly sessionIds?: readonly string[]
    readonly createdAt?: string
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
  return resolveDesktopWorkspaceRoot(sessions, workspaces)
}

/**
 * File-manager root is the owning or most recently updated workspace, never a session cwd outside it.
 * @param sessions - live session list snapshot.
 * @param workspaces - live workspace list snapshot.
 * @returns the workspace directory, or undefined when none is known.
 */
export function resolveDesktopWorkspaceRoot(
  sessions: DesktopTerminalCwdSessionList,
  workspaces: DesktopTerminalCwdWorkspaceList,
): string | undefined {
  const currentId = sessions.current
  if (currentId !== undefined) {
    const owning = workspaces.items.find(item => item.sessionIds?.includes(currentId))
    if (owning !== undefined) return owning.path
  }
  return recentWorkspacePath(workspaces, sessions.byId)
}

/** Host Workspace order is the tie-break when session timestamps are equal. */
function recentWorkspacePath(
  workspaces: DesktopTerminalCwdWorkspaceList,
  sessions: DesktopTerminalCwdSessionList['byId'],
): string | undefined {
  let selected: string | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces.items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds ?? []) {
      const session = sessions[sessionId]
      if (session?.updatedAt !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY && workspace.createdAt !== undefined) {
      latest = Date.parse(workspace.createdAt)
    }
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.path
      selectedTime = latest
    }
  }
  return selected
}
