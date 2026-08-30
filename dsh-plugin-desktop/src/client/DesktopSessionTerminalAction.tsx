import { SquareTerminal } from 'lucide-react'
import { openDesktopTerminalDrawer } from './TerminalDrawer.tsx'

/** cwd lookup injected by the Desktop shell or settings registration. */
export interface DesktopSessionTerminalActionProps {
  readonly getCwd?: () => string | undefined
}

export function DesktopSessionTerminalAction({ getCwd }: DesktopSessionTerminalActionProps) {
  return (
    <button type="button" className="dshDesktopSessionTerminalButton" aria-label="Open current terminal" title="Open current terminal" onClick={() => {
      openDesktopTerminalDrawer(getCwd?.())
    }}>
      <SquareTerminal aria-hidden="true" />
    </button>
  )
}
