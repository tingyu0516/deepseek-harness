import { describe, expect, it } from 'vitest'
import { CubismTargetPoint } from '../vendor/cubism-framework/math/cubismtargetpoint.ts'

/** Drive one CubismTargetPoint at a fixed frame cadence and read the sweep. */
function sweep(fps: number, seconds: number): number {
  const point = new CubismTargetPoint()
  point.set(1, 0)
  const dt = 1 / fps
  // The first call only anchors the time reference (upstream contract).
  point.update(dt)
  const steps = Math.round(fps * seconds)
  for (let i = 0; i < steps; i += 1) point.update(dt)
  return point.getX()
}

describe('CubismTargetPoint look-at easing (frame-rate fix)', () => {
  it('sweeps the same distance per real second at 15fps, 30fps, and 60fps', () => {
    const at30 = sweep(30, 0.6)
    const at15 = sweep(15, 0.6)
    const at60 = sweep(60, 0.6)
    // The upstream bug integrated position per frame, so the real sweep speed
    // scaled with fps: 15fps covered half of 30fps (the "half a beat late"
    // look-at on heavy rigs). The fix weights integration by elapsed time, so
    // every cadence converges on the target within quantization noise.
    expect(at15).toBeGreaterThan(0.6)
    expect(at15).toBeGreaterThan(at30 * 0.8)
    expect(at15).toBeLessThan(at30 * 1.2)
    expect(Math.abs(at60 - at30)).toBeLessThan(0.05)
  })

  it('snaps to the target across a suspension-length frame gap', () => {
    const point = new CubismTargetPoint()
    point.set(1, 0)
    point.update(1 / 30)
    // 0.25s = 7.5 design frames ≥ SNAP_FRAME_WEIGHT: the drag-suspension or
    // throttled-frame case must land on the target, not integrate one
    // oversized step.
    point.update(0.25)
    expect(point.getX()).toBeCloseTo(1, 5)
    expect(point.getY()).toBeCloseTo(0, 5)
  })
})
