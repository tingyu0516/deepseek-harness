import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectPetLive2DAssetChunks,
  PET_LIVE2D_RUNTIME_GLUE,
  petLive2DFinalizeStatement,
  petLive2DChunkStatement,
  readPetLive2DCoreText,
} from '../src/pet-live2d-host.ts'
import { makeLive2DFixture } from './live2d-fixture.ts'

describe('pet live2d host', () => {
  it('ships a syntactically valid renderer glue', () => {
    expect(() => new Function(PET_LIVE2D_RUNTIME_GLUE)).not.toThrow()
  })

  it('installs the runtime hook and drives the Cubism pipeline', () => {
    for (const marker of [
      '__dshPetLive2DRuntime',
      'window.Live2DCubismCore',
      'CORE.Moc.fromArrayBuffer',
      'new CORE.Model(',
      'CORE.Version.csmGetVersion',
      'dynamicFlags',
      'renderPlan',
      // Layer order must be rebuilt from live orders every frame: snapshotting
      // at attach makes the black-form coat paint over trousers/skirt.
      'rebuildRenderPlan(rt.model)',
      'plan.sort(',
      'sampleSegments',
      'attach: function',
      'setState: function',
      'playMotionGroup: function',
      'hitTest: function',
      'meshBounds',
      'pointInPaddedBox',
      "onBody ? 'body' : ''",
      'bestArea',
      'HitAreas',
      'pointInMesh',
      'Tap5',
      'setExpression: function',
      'expressionNames: function',
      // Expression parameters must re-derive from a captured baseline every
      // frame; accumulating Add blends would explode switch params over time.
      'setExpressionInternal',
      'expressionBaseline',
      'restoreExpressionBaseline',
      // One-shot motions return their driven params to the pre-motion values
      // instead of leaking the final frame; the outfit latch is exempt.
      'captureMotionBaseline',
      'restoreMotionBaseline',
      'motionGroups: function',
      'setPointer: function',
      'applyExpression',
      'refs.Expressions',
      'ParamAngleX',
      // Everything renders from the injected in-memory asset table; the
      // sandboxed renderer never touches file://, fetch, or XHR.
      '__DSH_PET_LIVE2D_ASSETS',
      'atob(',
      'petWrap.insertBefore(canvas',
      'gl.viewport(0, 0, canvas.width, canvas.height)',
      'PixelsPerUnit',
      'drawableVisible',
      'rt.originX = 0',
      'uniform vec2 uScale',
      '1.0-aUV.y',
      'createFramebuffer',
      'maskCounts',
      'uMode',
      'hasIsInvertedMaskBit',
      'ONE_MINUS_SRC_COLOR',
      'DST_COLOR',
      'idle: [\'Idle\']',
      'loopMotion',
      'u * u * u * nt',
      'uScr',
      'bindTexture(gl.TEXTURE_2D, null)',
      'hideParts',
      'expressionRevealParts',
      'outfitParamIndex',
      'outfitParamId',
      'outfitLatched',
      // Blend-owned form switching: the latch is the only authority, Param4
      // stays pinned to it, and rt.outfitBlend drives a continuous weighted
      // crossfade of both costume lists — no threshold race, no naked gap.
      'advanceOutfitBlend',
      'advanceOutfitBlend(dt * 1000);',
      'parts.opacities[lows[i]] = 1 - whiteW;',
      'parts.opacities[highs[j]] = whiteW;',
      // Drawable-layer authority: each moc build ships the OFF-theme side
      // with dead meshes, so the engine forces BOTH costume sides alive and
      // lets the forced flag bypass stale moc vis-bits in the draw gates.
      'enforceCostumeDrawables',
      'refreshCostumeForce()',
      'var alive = meshForced(i);',
      'pinOutfitParam',
      'toggleForm: function',
      'pinOutfitParts',
      'if (rt.loopMotion) return 0',
      'activeExpressionName',
      'combinedOpacity',
      'pinHiddenParts',
      'flushQueuedRuntime',
      'queuedExpression',
      'applyBlink(dt)',
      'ParamEyeLOpen',
      'resetDynamicFlags',
      'meshForced(i)',
      'parts.opacities[revealIdx[ri]] = 1',
      'parsePhysics',
      'applyPhysics(dt)',
      'refs.Physics',
    ]) {
      expect(PET_LIVE2D_RUNTIME_GLUE).toContain(marker)
    }
    expect(PET_LIVE2D_RUNTIME_GLUE).not.toContain('rt.originX = typeof info.CanvasOriginX')
    expect(PET_LIVE2D_RUNTIME_GLUE).not.toContain('XMLHttpRequest')
  })

  it('never references network origins in the glue or core loader', () => {
    expect(PET_LIVE2D_RUNTIME_GLUE).not.toMatch(/https?:\/\//u)
  })

  it('collects whitelisted assets into deterministic transfer chunks', () => {
    const dir = makeLive2DFixture()
    writeFileSync(join(dir, 'notes.txt'), 'not an asset')
    const chunks = collectPetLive2DAssetChunks(dir)
    const keys = [...new Set(chunks.map(chunk => chunk.key))].sort()
    expect(keys).toEqual(['pet.model3.json'])
    for (const chunk of chunks) expect(typeof chunk.data).toBe('string')
  })

  it('reports every chunk part and folds the stash once', () => {
    const dir = makeLive2DFixture()
    const chunks = collectPetLive2DAssetChunks(dir)
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) expect(petLive2DChunkStatement(chunk)).toContain('__DSH_PET_LIVE2D_PARTS')
    expect(petLive2DFinalizeStatement()).toContain('delete window.__DSH_PET_LIVE2D_PARTS')
  })

  it('rejects unreadable core URLs instead of injecting garbage', () => {
    expect(() => readPetLive2DCoreText('file:///Z:/definitely/not/here.js')).toThrow()
    expect(() => readPetLive2DCoreText('not-a-url')).toThrow()
  })
})
