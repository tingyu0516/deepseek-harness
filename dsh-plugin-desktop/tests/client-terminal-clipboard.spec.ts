import { describe, expect, it, vi } from 'vitest'
import { applyTerminalCopy, shouldCopyTerminalSelection } from '../src/client/terminal-clipboard.ts'

function key(partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, 'key'>): Pick<
  KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
> {
  return {
    type: 'keydown',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  }
}

describe('terminal clipboard', () => {
  it('copies on Ctrl/Cmd+C only when the terminal has a selection', () => {
    expect(shouldCopyTerminalSelection(key({ key: 'c', ctrlKey: true }), true)).toBe(true)
    expect(shouldCopyTerminalSelection(key({ key: 'c', metaKey: true }), true)).toBe(true)
    expect(shouldCopyTerminalSelection(key({ key: 'c', ctrlKey: true }), false)).toBe(false)
    expect(shouldCopyTerminalSelection(key({ key: 'c' }), true)).toBe(false)
    expect(shouldCopyTerminalSelection(key({ key: 'c', ctrlKey: true, shiftKey: true }), true)).toBe(false)
    expect(shouldCopyTerminalSelection(key({ type: 'keyup', key: 'c', ctrlKey: true }), true)).toBe(false)
  })

  it('writes the selection onto a native copy event', () => {
    const data = { setData: vi.fn() }
    const event = { preventDefault: vi.fn(), clipboardData: data as unknown as DataTransfer }
    expect(applyTerminalCopy(event, 'ls -la')).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(data.setData).toHaveBeenCalledWith('text/plain', 'ls -la')
    expect(applyTerminalCopy(event, '')).toBe(false)
  })
})
