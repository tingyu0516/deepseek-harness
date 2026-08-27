import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Create a minimal Live2D asset fixture: `pet.model3.json` plus the vendor
 * Cubism Core script the resolver requires. Returns the fixture directory.
 */
export function makeLive2DFixture(prefix = 'dsh-pet-live2d-fixture-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(dir, 'vendor'), { recursive: true })
  writeFileSync(join(dir, 'pet.model3.json'), '{}\n')
  writeFileSync(join(dir, 'vendor', 'live2dcubismcore.min.js'), '// cubism core fixture\n')
  return dir
}

/** An empty directory that resolves to no Live2D assets. */
export function makeEmptyDir(prefix = 'dsh-pet-live2d-empty-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}
