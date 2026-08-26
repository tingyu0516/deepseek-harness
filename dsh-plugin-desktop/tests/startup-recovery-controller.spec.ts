import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProfileCheckpointSlot, RestoreResult } from '../src/profile-checkpoint.ts'
import {
  DesktopStartupRecoveryController,
  DesktopStartupRecoveryControllerError,
  type DesktopStartupRecoveryControllerOptions,
} from '../src/startup-recovery-controller.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-startup-recovery-'))
  roots.push(root)
  return root
}

function writeManifest(root: string): string {
  const path = join(root, 'dsh-home', 'profiles', 'desktop', 'package.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({
    name: 'dsh-profile-desktop',
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-plugin-desktop', 'managed-plugin', 'external-plugin'] } },
  }, undefined, 2)}\n`)
  return path
}

function slots(root: string): readonly ProfileCheckpointSlot[] {
  return [1, 2, 3].map(index => index === 3
    ? { slotId: 'slot-3', snapshotExists: false, snapshotDirectory: join(root, 'private', 'slot-3') }
    : {
        slotId: `slot-${index}` as 'slot-1' | 'slot-2',
        snapshotExists: true,
        snapshotDirectory: join(root, 'private', `slot-${index}`),
        manifest: {
          version: 2,
          snapshotId: `snapshot-${index}`,
          capturedAt: `2026-08-2${index}T00:00:00.000Z`,
          profileIdentity: 'private-profile-identity',
          profileName: 'desktop',
          provider: 'desktop-profile',
          slotId: `slot-${index}` as 'slot-1' | 'slot-2',
          reason: 'healthy-startup',
          appVersion: '2.0.3',
          files: [{ name: 'package.json', present: true, sha256: 'a'.repeat(64), size: 20, mode: 0o600 }],
        },
        pluginCount: index + 2,
        totalBytes: 20,
      })
}

function createHarness(root: string, options: {
  now?: () => number
  afterCheckpointRestore?: DesktopStartupRecoveryControllerOptions['afterCheckpointRestore']
} = {}) {
  const manifestPath = writeManifest(root)
  const generation = { profileName: 'desktop', generationId: 'current-generation-0001' }
  const restoreSlot = vi.fn((slotId: 'slot-1' | 'slot-2' | 'slot-3'): RestoreResult => ({
    status: 'restored',
    slotId,
    changedFiles: ['package.json'],
    snapshotDirectory: join(root, 'private', slotId),
  }))
  const openCheckpointDirectory = vi.fn(async () => {})
  const controller = new DesktopStartupRecoveryController({
    pluginState: {
      profileName: 'desktop',
      homeDir: join(root, 'dsh-home'),
      statePath: join(root, 'user-data', 'plugin-management', 'state.json'),
    },
    generationId: generation.generationId,
    currentGeneration: () => generation,
    managedPackageNames: () => ['managed-plugin'],
    checkpoints: { listSlots: () => slots(root), restoreSlot },
    openCheckpointDirectory,
    ...(options.afterCheckpointRestore === undefined ? {} : { afterCheckpointRestore: options.afterCheckpointRestore }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  return { controller, generation, manifestPath, restoreSlot, openCheckpointDirectory }
}

function errorCode(cause: unknown): string | undefined {
  return cause instanceof DesktopStartupRecoveryControllerError ? cause.code : undefined
}

describe('pre-Host Desktop startup recovery controller', () => {
  it('projects plugin ownership and browseable checkpoint metadata without paths or hashes', async () => {
    const root = temporaryRoot()
    const target = createHarness(root)
    const snapshot = await target.controller.snapshot()
    expect(snapshot.bundles.find(item => item.packageName === 'managed-plugin')).toMatchObject({ owner: 'managed', action: 'disable' })
    expect(snapshot.bundles.find(item => item.packageName === 'external-plugin')).toMatchObject({ owner: 'external', action: 'disable' })
    expect(snapshot.checkpoints).toEqual([
      { slotId: 'slot-1', status: 'available', capturedAt: '2026-08-21T00:00:00.000Z', appVersion: '2.0.3', provider: 'desktop-profile', fileCount: 1, pluginCount: 3, totalBytes: 20 },
      { slotId: 'slot-2', status: 'available', capturedAt: '2026-08-22T00:00:00.000Z', appVersion: '2.0.3', provider: 'desktop-profile', fileCount: 1, pluginCount: 4, totalBytes: 20 },
      { slotId: 'slot-3', status: 'empty' },
    ])
    const exported = JSON.stringify(snapshot)
    expect(exported).not.toContain(root)
    expect(exported).not.toContain('private-profile-identity')
    expect(exported).not.toContain('a'.repeat(64))
  })

  it('disables a mutable bundle with a one-shot preview', async () => {
    const root = temporaryRoot()
    const target = createHarness(root)
    const bundle = (await target.controller.snapshot()).bundles.find(item => item.packageName === 'external-plugin')!
    const preview = await target.controller.previewDisable(bundle.bundleId)
    await expect(target.controller.executeDisable(preview.previewId)).resolves.toEqual({ action: 'disable', packageName: 'external-plugin' })
    await expect(target.controller.executeDisable(preview.previewId)).rejects.toSatisfy(cause => errorCode(cause) === 'preview-expired')
    expect(readFileSync(target.manifestPath, 'utf8')).toContain('external-plugin')
    expect((await target.controller.snapshot()).bundles.find(item => item.packageName === 'external-plugin')).toMatchObject({ status: 'disabled', action: null })
  })

  it('restores one exact slot, synchronizes it, and consumes the preview once', async () => {
    const root = temporaryRoot()
    const synchronize = vi.fn(async () => {})
    const target = createHarness(root, { afterCheckpointRestore: synchronize })
    const preview = await target.controller.previewCheckpointRestore('slot-2')
    await expect(target.controller.executeCheckpointRestore(preview.previewId)).resolves.toEqual({
      action: 'restore-checkpoint',
      slotId: 'slot-2',
      changedFiles: ['package.json'],
    })
    expect(target.restoreSlot).toHaveBeenCalledWith('slot-2')
    expect(synchronize).toHaveBeenCalledOnce()
    await expect(target.controller.executeCheckpointRestore(preview.previewId)).rejects.toSatisfy(
      cause => errorCode(cause) === 'preview-expired',
    )
    await expect(target.controller.previewCheckpointRestore('slot-3')).rejects.toSatisfy(
      cause => errorCode(cause) === 'invalid-target',
    )
  })

  it('opens only the exact available checkpoint directory', async () => {
    const root = temporaryRoot()
    const target = createHarness(root)
    await target.controller.openCheckpoint('slot-1')
    expect(target.openCheckpointDirectory).toHaveBeenCalledWith(join(root, 'private', 'slot-1'))
    await expect(target.controller.openCheckpoint('slot-3')).rejects.toSatisfy(
      cause => errorCode(cause) === 'invalid-target',
    )
  })

  it('invalidates actions when the active generation changes', async () => {
    const root = temporaryRoot()
    const target = createHarness(root)
    const preview = await target.controller.previewCheckpointRestore('slot-1')
    target.generation.profileName = 'other'
    await expect(target.controller.executeCheckpointRestore(preview.previewId)).rejects.toSatisfy(
      cause => errorCode(cause) === 'generation-changed',
    )
  })
})
