/** Shared overlay inject for the terminal / file / Changes drawer. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DesktopComposerBranch } from './ComposerBranch.tsx'
import { DesktopSessionTerminalAction } from './DesktopSessionTerminalAction.tsx'
import { collectLastAgentTurnPaths, relativizeWorkspaceFile } from './last-agent-turn.ts'
import { resolveDesktopTerminalCwd, resolveDesktopWorkspaceRoot } from './desktop-terminal-cwd.ts'
import type { DesktopTerminalDrawerProps, DesktopWorkspaceListing } from './TerminalDrawer.tsx'

/** Build drawer props from the live session and workspace snapshots.
 * @param ctx - browser Cordis context with sessions and workspaces.
 * @param listDirectory - Host workspace-tree fetch already confined by the caller.
 * @returns inject values for {@link DesktopTerminalDrawer}.
 */
export function desktopDrawerInject(
  ctx: ClientContext,
  listDirectory: (path: string, signal?: AbortSignal) => Promise<DesktopWorkspaceListing>,
): DesktopTerminalDrawerProps {
  const cwd = (): string | undefined => resolveDesktopTerminalCwd(
    ctx.sessions.list.getSnapshot(),
    ctx.workspaces.list.getSnapshot(),
  )
  const workspaceRoot = (): string | undefined => resolveDesktopWorkspaceRoot(
    ctx.sessions.list.getSnapshot(),
    ctx.workspaces.list.getSnapshot(),
  )
  return {
    getCwd: cwd,
    workspaceRoot,
    lastAgentFiles: () => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return []
      const binding = ctx.sessions.binding(current)
      if (binding === undefined) return []
      const root = workspaceRoot()
      const paths = collectLastAgentTurnPaths(binding.session.getSnapshot())
      if (root === undefined) return paths
      const relative: string[] = []
      for (const path of paths) {
        const next = relativizeWorkspaceFile(root, path)
        if (next !== undefined) relative.push(next)
      }
      return relative
    },
    listDirectory: async (path?: string, signal?: AbortSignal) => {
      const directory = path ?? workspaceRoot()
      if (directory === undefined) throw new Error('No current workspace is selected')
      return listDirectory(directory, signal)
    },
  }
}

/** Place the right-sidebar toggle on the session header's right-aligned utilities row. */
export function injectDesktopRightSidebarToggle(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'desktop-right-sidebar',
    order: 100,
    inject: () => ({
      getCwd: () => resolveDesktopTerminalCwd(
        ctx.sessions.list.getSnapshot(),
        ctx.workspaces.list.getSnapshot(),
      ),
    }),
  }, DesktopSessionTerminalAction))
}

/** Place the current git branch in the input dock, immediately above the composer card. */
export function injectDesktopComposerBranch(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'desktop-composer-branch',
    order: 30,
  }, DesktopComposerBranch))
}
