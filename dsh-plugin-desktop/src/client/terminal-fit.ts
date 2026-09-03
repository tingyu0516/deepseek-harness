/** Measure xterm cell size from the rendered screen so the PTY matches the viewport. */

export interface TerminalFitSize {
  readonly cols: number
  readonly rows: number
}

export interface TerminalFitTerminal {
  readonly cols: number
  readonly rows: number
}

function isSizedNode(value: unknown): value is { clientWidth: number; clientHeight: number } {
  return typeof value === 'object' && value !== null
    && 'clientWidth' in value && 'clientHeight' in value
    && typeof value.clientWidth === 'number'
    && typeof value.clientHeight === 'number'
}

/**
 * Derive PTY columns and rows from the viewport, subtracting padding and using
 * the live `.xterm-screen` cell size when xterm has already rendered.
 *
 * @param terminal - an opened xterm instance
 * @param element - the viewport that contains `.xterm-screen`
 * @returns integer dimensions, or undefined when the viewport is not measurable
 */
export function measureTerminalFit(terminal: TerminalFitTerminal, element: HTMLElement): TerminalFitSize | undefined {
  if (element.clientWidth < 1 || element.clientHeight < 1) return undefined
  const screen = element.querySelector('.xterm-screen')
  const cellWidth = isSizedNode(screen) && screen.clientWidth > 0 && terminal.cols > 0
    ? screen.clientWidth / terminal.cols
    : 8
  const cellHeight = isSizedNode(screen) && screen.clientHeight > 0 && terminal.rows > 0
    ? screen.clientHeight / terminal.rows
    : 18
  if (cellWidth < 1 || cellHeight < 1) return undefined
  const style = getComputedStyle(element)
  const padX = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  const padY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
  const cols = Math.max(2, Math.floor(Math.max(0, element.clientWidth - padX) / cellWidth))
  const rows = Math.max(2, Math.floor(Math.max(0, element.clientHeight - padY) / cellHeight))
  return { cols, rows }
}
