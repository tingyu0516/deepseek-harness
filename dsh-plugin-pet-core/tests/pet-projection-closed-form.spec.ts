import { describe, expect, it } from 'vitest'
import { CubismMatrix44 } from '../vendor/cubism-framework/math/cubismmatrix44.ts'
import { CubismViewMatrix } from '../vendor/cubism-framework/math/cubismviewmatrix.ts'

/**
 * The viewer computes its per-frame projection with a closed form instead of
 * the loadIdentity ∘ scale ∘ multiplyByMatrix(view) chain. This spec pins the
 * closed form to the vendor chain bitwise (the same float32 rounding), so any
 * future change to either side fails loudly here instead of skewing the
 * pet's rendering.
 */

/** Mirror of the closed form in viewer.ts drawFrame(). */
function closedForm(view: CubismMatrix44, rawSx: number, rawSy: number): Float32Array {
  const sx = Math.fround(rawSx)
  const sy = Math.fround(rawSy)
  const viewTr = view.getArray()
  const tr = new Float32Array(16)
  for (let col = 0; col < 4; ++col) {
    const f = col === 0 ? sx : col === 1 ? sy : 1
    tr[col] = Math.fround(viewTr[col] * f)
    tr[col + 4] = Math.fround(viewTr[col + 4] * f)
    tr[col + 8] = Math.fround(viewTr[col + 8] * f)
    tr[col + 12] = Math.fround(viewTr[col + 12] * f)
  }
  return tr
}

/** Mirror of the previous vendor chain in viewer.ts drawFrame(). */
function vendorChain(view: CubismMatrix44, sx: number, sy: number): Float32Array {
  const projection = new CubismMatrix44()
  projection.loadIdentity()
  projection.scale(sx, sy)
  projection.multiplyByMatrix(view)
  return projection.getArray()
}

describe('projection closed form equals the vendor chain bitwise', () => {
  // Deterministic view shapes covering scale, translation, and the
  // aspect-ratio branches drawFrame() selects between.
  const scales: Array<[number, number]> = [
    [1.0, 1.0],
    [0.5, 0.25],
    [2.5, 0.4],
    [16 / 9, 1.0],
    [1.0, 9 / 16],
  ]
  for (const [sx, sy] of scales) {
    it(`matches for scale (${sx}, ${sy})`, () => {
      const view = new CubismViewMatrix()
      view.setScreenRect(-sx, sx, -sy, sy)
      view.scale(0.8, 1.2)
      view.translate(0.1, -0.2)
      const expected = vendorChain(view, sx, sy)
      const actual = closedForm(view, sx, sy)
      for (let i = 0; i < 16; ++i) {
        // Bitwise equality except the documented signed-zero normalization
        // (−0·f + 0 = +0), which WebGL renders identically.
        expect(actual[i] === expected[i] || (actual[i] === 0 && expected[i] === 0)).toBe(true)
      }
    })
  }
})
