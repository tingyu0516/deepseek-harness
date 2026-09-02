/** Current git branch chip for the composer input dock (above the input card). */
import { GitBranch } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { resolveDesktopWorkspaceRoot } from './desktop-terminal-cwd.ts'
import { requestDesktopWorkspaceBranch } from './workspace-changes-api.ts'

export type DesktopComposerBranchProps = PropsRuntime<'conversation.input.dock'>

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

/** Presentational branch chip used above the conversation input card. */
export function DesktopComposerBranchView({ branch }: { readonly branch: string }) {
  return (
    <div className="dshDesktopComposerBranch" title={branch}>
      <GitBranch size={14} aria-hidden="true" />
      <span>{branch}</span>
    </div>
  )
}

/** Resolve the workspace git branch and hide the chip when none is available. */
export function DesktopComposerBranch({ useSessions, useWorkspaces }: DesktopComposerBranchProps) {
  const current = useSessions(snapshot => snapshot.current)
  const recentWorkspaceId = useWorkspaces(snapshot => snapshot.recentWorkspaceId)
  const items = useWorkspaces(snapshot => snapshot.items)
  const root = resolveDesktopWorkspaceRoot(
    { current, byId: {} },
    { recentWorkspaceId, items },
  )
  const [branch, setBranch] = useState<string>()

  useEffect(() => {
    if (root === undefined) {
      setBranch(undefined)
      return
    }
    const controller = new AbortController()
    void requestDesktopWorkspaceBranch(root, controller.signal)
      .then(setBranch)
      .catch((cause: unknown) => {
        if (!isAbort(cause)) setBranch(undefined)
      })
    return () => controller.abort()
  }, [root])

  if (branch === undefined) return null
  return <DesktopComposerBranchView branch={branch} />
}
