import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  collectPetLive2DAssetChunks,
  collectPetLive2DShaderChunks,
  CUBISM_SHADER_PREFIX,
  petLive2DFinalizeStatement,
  petLive2DChunkStatement,
  readPetLive2DCoreText,
  readPetLive2DViewerText,
} from '../src/pet-live2d-host.ts'
import { makeLive2DFixture } from './live2d-fixture.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('pet live2d host', () => {
  it('injects a viewer that exposes the pet runtime hook', () => {
    const viewer = readPetLive2DViewerText()
    expect(() => new Function(viewer)).not.toThrow()
    expect(viewer).toContain('__dshPetLive2DRuntime')
    expect(viewer).toContain('attach')
  })

  it('bundles the official Cubism Framework viewer after build', () => {
    const root = packageRoot
    const built = ['pet-live2d-viewer.js', 'pet-live2d-viewer.iife.js']
      .map(name => join(root, 'lib', name))
      .find(path => existsSync(path))
    if (built === undefined) return
    const viewer = readPetLive2DViewerText()
    expect(viewer).toContain('CubismFramework')
    expect(viewer).toContain('startRandomMotion')
    expect(viewer).toContain('setRandomExpression')
    expect(viewer).toContain('installPetAssetFetchHook')
  })

  it('collects official WebGL shaders under the Framework fetch prefix', () => {
    const chunks = collectPetLive2DShaderChunks()
    const keys = [...new Set(chunks.map(chunk => chunk.key))]
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(key.startsWith(CUBISM_SHADER_PREFIX)).toBe(true)
    expect(keys.some(key => key.endsWith('.vert'))).toBe(true)
    expect(keys.some(key => key.endsWith('.frag'))).toBe(true)
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

  it('does not rebuild the Cubism renderer on window resize', () => {
    const src = readFileSync(join(packageRoot, 'src/live2d/viewer.ts'), 'utf8')
    const start = src.indexOf("addEventListener('resize'")
    expect(start).toBeGreaterThanOrEqual(0)
    expect(src.slice(start)).not.toContain('reloadRenderer')
  })

  it('pins tap expression parameters so the single core update bakes them', () => {
    const src = readFileSync(join(packageRoot, 'src/live2d/viewer.ts'), 'utf8')
    // Expression parameter ids are character data: they must come from the
    // spec (`expressionParameters`), never from a shared hardcoded table —
    // the same ids mean different things on other models.
    expect(src).toContain('expressionParameters')
    expect(src).not.toContain('EXP_PARAM')
    // The viewer's overrides (expressions, form latch, hidden parts) are
    // folded into the model's single per-frame core update through the
    // preCoreUpdateHook; a second core update would double the cost.
    expect(src).toContain('preCoreUpdateHook')
    expect(src).not.toContain('cubismModel?.update()')
    expect(src).toContain('pickTapExpression')
    expect(src).toContain('applyTapExpression')
    // Tapped expressions must auto-release instead of sticking forever.
    expect(src).toContain('EXPRESSION_HOLD_MS')
    expect(src).toContain('releaseTapExpression')
    expect(src).not.toContain('setRandomExpression')
    expect(src).not.toContain("region === 'rightHand'")
  })
})
