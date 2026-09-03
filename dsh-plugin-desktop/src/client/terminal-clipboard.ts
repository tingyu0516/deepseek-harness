/** Copy helpers for the embedded xterm so Ctrl/Cmd+C is not sent to the PTY. */

/**
 * True when a copy chord should take the current xterm selection instead of SIGINT.
 *
 * @param event - a keydown from xterm's custom handler
 * @param hasSelection - whether the terminal currently has a selection
 * @returns whether the chord should copy instead of reaching the PTY
 */
export function shouldCopyTerminalSelection(
  event: Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  hasSelection: boolean,
): boolean {
  if (event.type !== 'keydown' || !hasSelection) return false
  if (event.altKey || event.shiftKey) return false
  if (event.key !== 'c' && event.key !== 'C') return false
  return event.ctrlKey || event.metaKey
}

/**
 * Put xterm's selection on a `copy` event so Edit → Copy also works.
 *
 * @param event - the document or viewport copy event
 * @param selection - `terminal.getSelection()`
 * @returns whether the event was handled
 */
export function applyTerminalCopy(
  event: { preventDefault(): void; clipboardData: DataTransfer | null },
  selection: string,
): boolean {
  if (selection === '') return false
  event.preventDefault()
  event.clipboardData?.setData('text/plain', selection)
  return true
}
