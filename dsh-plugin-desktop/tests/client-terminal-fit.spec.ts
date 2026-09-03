import { afterEach, describe, expect, it, vi } from 'vitest'
import { measureTerminalFit } from '../src/client/terminal-fit.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function viewport(options: {
  width: number
  height: number
  padding: number
  screenWidth: number
  screenHeight: number
}): HTMLElement {
  vi.stubGlobal('getComputedStyle', () => ({
    paddingLeft: `${String(options.padding)}px`,
    paddingRight: `${String(options.padding)}px`,
    paddingTop: `${String(options.padding)}px`,
    paddingBottom: `${String(options.padding)}px`,
  }))
  return {
    clientWidth: options.width,
    clientHeight: options.height,
    querySelector: (selector: string) => selector === '.xterm-screen'
      ? { clientWidth: options.screenWidth, clientHeight: options.screenHeight }
      : null,
  } as HTMLElement
}

describe('terminal viewport fit', () => {
  it('uses the rendered xterm cell size and subtracts padding', () => {
    const element = viewport({
      width: 640,
      height: 478,
      padding: 10,
      screenWidth: 640,
      screenHeight: 432,
    })
    expect(measureTerminalFit({ cols: 80, rows: 24 }, element)).toEqual({ cols: 77, rows: 25 })
  })

  it('returns undefined when the viewport is hidden', () => {
    const element = viewport({
      width: 0,
      height: 0,
      padding: 10,
      screenWidth: 640,
      screenHeight: 432,
    })
    expect(measureTerminalFit({ cols: 80, rows: 24 }, element)).toBeUndefined()
  })
})
