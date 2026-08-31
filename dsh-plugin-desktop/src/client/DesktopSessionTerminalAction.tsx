import { PanelRight } from 'lucide-react'
import { toggleDesktopTerminalDrawer, useDesktopTerminalDrawerOpen } from './TerminalDrawer.tsx'

/** cwd lookup injected by the session-header sidebar toggle. */
export interface DesktopSessionTerminalActionProps {
  readonly getCwd?: () => string | undefined
}

export function DesktopSessionTerminalAction({ getCwd }: DesktopSessionTerminalActionProps) {
  const open = useDesktopTerminalDrawerOpen()
  return (
    <button
      type="button"
      className="dshDesktopTitlebarIconButton"
      aria-label="Toggle right sidebar"
      aria-pressed={open}
      title="Toggle right sidebar"
      onClick={() => { toggleDesktopTerminalDrawer(getCwd?.()) }}
    >
      <PanelRight aria-hidden="true" />
    </button>
  )
}
