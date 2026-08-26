import { describe, expect, it } from 'vitest'
import { desktopFrameIsVisible } from '../src/native-ui/shared/DesktopFrame.tsx'

describe('Desktop-owned native UI frame', () => {
  it('renders only when the BrowserWindow declares visible custom controls', () => {
    expect(desktopFrameIsVisible('?platform=darwin&frame=true')).toBe(true)
    expect(desktopFrameIsVisible('?platform=win32&frame=true')).toBe(true)
    expect(desktopFrameIsVisible('?platform=darwin&frame=false')).toBe(false)
    expect(desktopFrameIsVisible('?platform=linux')).toBe(false)
    expect(desktopFrameIsVisible('')).toBe(false)
  })
})
