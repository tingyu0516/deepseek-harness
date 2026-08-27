import { describe, expect, it } from 'vitest'
import { PET_LIVE2D_RUNTIME_GLUE } from '../src/pet-live2d-host.ts'
import { createPetPhysicsRuntime } from '../src/pet-live2d-physics.ts'

const HAIR_PHYSICS = {
  Version: 3,
  Meta: {
    Fps: 30,
    EffectiveForces: { Gravity: { X: 0, Y: -1 }, Wind: { X: 0, Y: 0 } },
  },
  PhysicsSettings: [
    {
      Input: [
        { Source: { Target: 'Parameter', Id: 'ParamAngleZ' }, Weight: 100, Type: 'Angle', Reflect: false },
      ],
      Output: [
        {
          Destination: { Target: 'Parameter', Id: 'ParamHair' },
          VertexIndex: 1,
          Scale: 20,
          Weight: 100,
          Type: 'Angle',
          Reflect: false,
        },
      ],
      Vertices: [
        { Position: { X: 0, Y: 0 }, Mobility: 1, Delay: 1, Acceleration: 1, Radius: 0 },
        { Position: { X: 0, Y: 10 }, Mobility: 1, Delay: 1, Acceleration: 1, Radius: 10 },
      ],
      Normalization: {
        Position: { Minimum: -10, Default: 0, Maximum: 10 },
        Angle: { Minimum: -10, Default: 0, Maximum: 10 },
      },
    },
  ],
}

function fakeModel(angleZ: number) {
  return {
    parameters: {
      values: new Float32Array([angleZ, 0]),
      minimumValues: new Float32Array([-30, -30]),
      maximumValues: new Float32Array([30, 30]),
      defaultValues: new Float32Array([0, 0]),
    },
  }
}

describe('pet live2d physics', () => {
  it('is installed into the renderer glue before draw', () => {
    expect(PET_LIVE2D_RUNTIME_GLUE).toContain('parsePhysics')
    expect(PET_LIVE2D_RUNTIME_GLUE).toContain('stabilizePhysics')
    expect(PET_LIVE2D_RUNTIME_GLUE).toContain('evaluatePhysics')
    expect(PET_LIVE2D_RUNTIME_GLUE).toContain('applyPhysics(dt)')
    expect(PET_LIVE2D_RUNTIME_GLUE).toContain('refs.Physics')
  })

  it('returns null for a document without physics settings', () => {
    const runtime = createPetPhysicsRuntime()
    expect(runtime.parsePhysics({}, {})).toBeNull()
  })

  it('moves an output parameter after the pendulum is driven', () => {
    const runtime = createPetPhysicsRuntime()
    const model = fakeModel(0)
    const rig = runtime.parsePhysics(HAIR_PHYSICS, { ParamAngleZ: 0, ParamHair: 1 })
    expect(rig).not.toBeNull()
    runtime.stabilizePhysics(rig, model)
    const rest = model.parameters.values[1] ?? 0
    model.parameters.values[0] = 24
    for (let i = 0; i < 24; i += 1) runtime.evaluatePhysics(rig, model, 1 / 30)
    expect(model.parameters.values[1]).not.toBe(rest)
  })

  it('keeps a stable rest pose when the input stays at default', () => {
    const runtime = createPetPhysicsRuntime()
    const model = fakeModel(0)
    const rig = runtime.parsePhysics(HAIR_PHYSICS, { ParamAngleZ: 0, ParamHair: 1 })
    runtime.stabilizePhysics(rig, model)
    const rest = model.parameters.values[1] ?? 0
    for (let i = 0; i < 12; i += 1) runtime.evaluatePhysics(rig, model, 1 / 30)
    expect(model.parameters.values[1]).toBeCloseTo(rest, 3)
  })
})
