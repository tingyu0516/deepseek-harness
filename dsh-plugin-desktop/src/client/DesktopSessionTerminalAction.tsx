import { SquareTerminal } from 'lucide-react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { openDesktopTerminalDrawer } from './TerminalDrawer.tsx'

/** Per-session action that opens the Desktop PTY in the current session cwd. */
export type DesktopSessionTerminalActionProps = PropsRuntime<'conversation.session.header.actions'>

export function DesktopSessionTerminalAction({ sessionId }: DesktopSessionTerminalActionProps) {
  return (
    <button
      type="button"
      className="dshDesktopSessionTerminalButton"
      aria-label="Open terminal for current session"
      title="Open terminal for current session"
      data-session-id={sessionId}
      onClick={openDesktopTerminalDrawer}
    >
      <SquareTerminal aria-hidden="true" />
    </button>
  )
}
