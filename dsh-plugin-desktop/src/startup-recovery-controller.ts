/** Pre-Host recovery-window authority over one immutable Desktop generation. */

import { randomBytes } from 'node:crypto'
import { isAbsolute } from 'node:path'
import {
  DesktopPluginsError,
  disableDesktopProfileBundle,
  readDesktopProfileBundleInventory,
  type DesktopPluginStateBootstrap,
  type DesktopProfileManifestBundle,
} from './desktop-plugins.ts'
import type {
  DesktopProfileCheckpointSlotId,
  ProfileCheckpointSlot,
  RestoreResult,
} from './profile-checkpoint.ts'
import { assertDesktopProfileName } from './profile-manager.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const PREVIEW_TTL_MS = 5 * 60 * 1000
const MAX_PREVIEWS = 256
const MAX_MANAGED_PACKAGES = 1024
const BUNDLE_ID_PATTERN = /^bundle_[A-Za-z0-9_-]{32}$/u
const DISABLE_PREVIEW_ID_PATTERN = /^disable_[A-Za-z0-9_-]{43}$/u
const RESTORE_PREVIEW_ID_PATTERN = /^restore_[A-Za-z0-9_-]{43}$/u
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/u
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

export interface DesktopStartupRecoveryGeneration {
  readonly profileName: string
  readonly generationId: string
}

export interface DesktopStartupRecoveryCheckpointStore {
  listSlots(): readonly ProfileCheckpointSlot[]
  restoreSlot(slotId: DesktopProfileCheckpointSlotId): RestoreResult
}

export interface DesktopStartupRecoveryBundle {
  readonly bundleId: string
  readonly packageName: string
  readonly status: 'active' | 'disabled'
  readonly owner: 'core' | 'managed' | 'external'
  readonly action: 'disable' | null
}

/** Renderer-safe metadata for one fixed checkpoint slot. Paths stay private. */
export interface DesktopStartupRecoveryCheckpoint {
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly status: 'available' | 'empty'
  readonly capturedAt?: string
  readonly appVersion?: string
  readonly provider?: string
  readonly fileCount?: number
  readonly pluginCount?: number
  readonly totalBytes?: number
}

export interface DesktopStartupRecoverySnapshot {
  readonly profileName: string
  readonly bundles: readonly DesktopStartupRecoveryBundle[]
  readonly checkpoints: readonly DesktopStartupRecoveryCheckpoint[]
}

export interface DesktopStartupRecoveryDisablePreview {
  readonly previewId: string
  readonly packageName: string
  readonly expiresAt: string
}

export interface DesktopStartupRecoveryDisableResult {
  readonly action: 'disable'
  readonly packageName: string
}

export interface DesktopStartupRecoveryCheckpointPreview {
  readonly previewId: string
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly capturedAt: string
  readonly expiresAt: string
}

export interface DesktopStartupRecoveryCheckpointResult {
  readonly action: 'restore-checkpoint'
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly changedFiles: readonly string[]
}

export type DesktopStartupRecoveryControllerErrorCode =
  | 'already-disabled'
  | 'generation-changed'
  | 'immutable-target'
  | 'invalid-target'
  | 'operation-failed'
  | 'operation-in-progress'
  | 'preview-expired'
  | 'state-unavailable'

export class DesktopStartupRecoveryControllerError extends Error {
  constructor(readonly code: DesktopStartupRecoveryControllerErrorCode, message: string) {
    super(message)
    this.name = 'DesktopStartupRecoveryControllerError'
  }
}

export interface DesktopStartupRecoveryControllerOptions {
  readonly pluginState: DesktopPluginStateBootstrap
  readonly generationId: string
  readonly currentGeneration: () => DesktopStartupRecoveryGeneration
  readonly managedPackageNames?: () => readonly string[] | Promise<readonly string[]>
  readonly checkpoints: DesktopStartupRecoveryCheckpointStore
  /** Synchronize dependency metadata after an explicit checkpoint restore. */
  readonly afterCheckpointRestore?: (result: RestoreResult) => void | Promise<void>
  /** Main-process-only browser action, normally Electron shell.openPath. */
  readonly openCheckpointDirectory: (path: string) => void | Promise<void>
  readonly now?: () => number
}

interface DisablePreviewRecord {
  readonly previewId: string
  readonly bundleId: string
  readonly packageName: string
  readonly profileName: string
  readonly generationId: string
  readonly expiresAt: number
}

interface RestorePreviewRecord {
  readonly previewId: string
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly snapshotId: string
  readonly capturedAt: string
  readonly profileName: string
  readonly generationId: string
  readonly expiresAt: number
}

function safePackageName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 214 && PACKAGE_NAME_PATTERN.test(value)
}

function safeCheckpoint(slot: ProfileCheckpointSlot): DesktopStartupRecoveryCheckpoint {
  if (!slot.snapshotExists || slot.manifest === undefined) return { slotId: slot.slotId, status: 'empty' }
  return {
    slotId: slot.slotId,
    status: 'available',
    capturedAt: slot.manifest.capturedAt,
    appVersion: slot.manifest.appVersion,
    provider: slot.manifest.provider,
    fileCount: slot.manifest.files.filter(file => file.present).length,
    ...(slot.pluginCount === undefined ? {} : { pluginCount: slot.pluginCount }),
    ...(slot.totalBytes === undefined ? {} : { totalBytes: slot.totalBytes }),
  }
}

export class DesktopStartupRecoveryController {
  private readonly profileName: string
  private readonly generationId: string
  private readonly now: () => number
  private readonly packageBundleIds = new Map<string, string>()
  private readonly bundlePackages = new Map<string, string>()
  private readonly disablePreviews = new Map<string, DisablePreviewRecord>()
  private readonly restorePreviews = new Map<string, RestorePreviewRecord>()
  private operationActive = false
  private disposed = false

  constructor(private readonly options: DesktopStartupRecoveryControllerOptions) {
    assertDesktopProfileName(options.pluginState.profileName)
    if (!OPAQUE_ID_PATTERN.test(options.generationId)) {
      throw new Error(`${BIN_NAME}: invalid startup recovery generation id`)
    }
    for (const [label, value] of [
      ['Harness home', options.pluginState.homeDir],
      ['plugin state path', options.pluginState.statePath],
    ] as const) {
      if (!isAbsolute(value) || value.includes('\0')) {
        throw new Error(`${BIN_NAME}: startup recovery ${label} must be an absolute path without NUL`)
      }
    }
    this.profileName = options.pluginState.profileName
    this.generationId = options.generationId
    this.now = options.now ?? Date.now
  }

  async snapshot(): Promise<DesktopStartupRecoverySnapshot> {
    this.assertCurrentGeneration()
    try {
      const inventory = readDesktopProfileBundleInventory(this.options.pluginState)
      const managed = await this.readManagedPackages()
      const checkpoints = this.options.checkpoints.listSlots().map(safeCheckpoint)
      this.assertCurrentGeneration()
      return {
        profileName: this.profileName,
        bundles: this.projectBundles(inventory, managed),
        checkpoints,
      }
    } catch (cause) {
      if (cause instanceof DesktopStartupRecoveryControllerError) throw cause
      throw new DesktopStartupRecoveryControllerError('state-unavailable', 'Desktop recovery state is unavailable.')
    }
  }

  async previewDisable(bundleId: string): Promise<DesktopStartupRecoveryDisablePreview> {
    this.assertCurrentGeneration()
    if (!BUNDLE_ID_PATTERN.test(bundleId)) throw this.invalidTarget()
    try {
      const packageName = this.bundlePackages.get(bundleId)
      if (packageName === undefined) throw this.invalidTarget()
      const inventory = readDesktopProfileBundleInventory(this.options.pluginState)
      this.assertCurrentGeneration()
      this.assertMutableActive(inventory, packageName)
      this.prunePreviews()
      this.trimPreviews(this.disablePreviews)
      const previewId = `disable_${randomBytes(32).toString('base64url')}`
      const expiresAt = this.now() + PREVIEW_TTL_MS
      this.disablePreviews.set(previewId, {
        previewId,
        bundleId,
        packageName,
        profileName: this.profileName,
        generationId: this.generationId,
        expiresAt,
      })
      return { previewId, packageName, expiresAt: new Date(expiresAt).toISOString() }
    } catch (cause) {
      throw this.safeReadError(cause)
    }
  }

  async executeDisable(previewId: string): Promise<DesktopStartupRecoveryDisableResult> {
    this.assertCurrentGeneration()
    if (!DISABLE_PREVIEW_ID_PATTERN.test(previewId)) throw this.expiredPreview()
    this.assertOperationAvailable()
    const preview = this.disablePreviews.get(previewId)
    this.disablePreviews.delete(previewId)
    if (preview === undefined || preview.expiresAt <= this.now()
      || preview.profileName !== this.profileName || preview.generationId !== this.generationId) {
      throw this.expiredPreview()
    }
    this.operationActive = true
    try {
      await this.authorizeDisable(preview.packageName)
      const result = await disableDesktopProfileBundle(
        this.options.pluginState,
        preview.packageName,
        async () => { await this.authorizeDisable(preview.packageName) },
      )
      if (result.packageName !== preview.packageName) {
        throw new DesktopStartupRecoveryControllerError('operation-failed', 'The Desktop plugin change returned an invalid result.')
      }
      return { action: 'disable', packageName: result.packageName }
    } catch (cause) {
      throw this.safeMutationError(cause)
    } finally {
      this.operationActive = false
    }
  }

  async previewCheckpointRestore(
    slotId: DesktopProfileCheckpointSlotId,
  ): Promise<DesktopStartupRecoveryCheckpointPreview> {
    this.assertCurrentGeneration()
    try {
      const slot = this.requireSlot(slotId)
      this.prunePreviews()
      this.trimPreviews(this.restorePreviews)
      const previewId = `restore_${randomBytes(32).toString('base64url')}`
      const expiresAt = this.now() + PREVIEW_TTL_MS
      this.restorePreviews.set(previewId, {
        previewId,
        slotId,
        snapshotId: slot.manifest!.snapshotId,
        capturedAt: slot.manifest!.capturedAt,
        profileName: this.profileName,
        generationId: this.generationId,
        expiresAt,
      })
      return { previewId, slotId, capturedAt: slot.manifest!.capturedAt, expiresAt: new Date(expiresAt).toISOString() }
    } catch (cause) {
      throw this.safeReadError(cause)
    }
  }

  async executeCheckpointRestore(previewId: string): Promise<DesktopStartupRecoveryCheckpointResult> {
    this.assertCurrentGeneration()
    if (!RESTORE_PREVIEW_ID_PATTERN.test(previewId)) throw this.expiredPreview()
    this.assertOperationAvailable()
    const preview = this.restorePreviews.get(previewId)
    this.restorePreviews.delete(previewId)
    if (preview === undefined || preview.expiresAt <= this.now()
      || preview.profileName !== this.profileName || preview.generationId !== this.generationId) {
      throw this.expiredPreview()
    }
    this.operationActive = true
    try {
      const slot = this.requireSlot(preview.slotId)
      if (slot.manifest!.snapshotId !== preview.snapshotId || slot.manifest!.capturedAt !== preview.capturedAt) {
        throw this.expiredPreview()
      }
      const result = this.options.checkpoints.restoreSlot(preview.slotId)
      await this.options.afterCheckpointRestore?.(result)
      return { action: 'restore-checkpoint', slotId: result.slotId, changedFiles: [...result.changedFiles] }
    } catch (cause) {
      throw this.safeMutationError(cause)
    } finally {
      this.operationActive = false
    }
  }

  /** Open one available slot for read-only browsing. */
  async openCheckpoint(slotId: DesktopProfileCheckpointSlotId): Promise<void> {
    this.assertCurrentGeneration()
    try {
      const slot = this.requireSlot(slotId)
      await this.options.openCheckpointDirectory(slot.snapshotDirectory)
      this.assertCurrentGeneration()
    } catch (cause) {
      throw this.safeReadError(cause)
    }
  }

  dispose(): void {
    this.disposed = true
    this.packageBundleIds.clear()
    this.bundlePackages.clear()
    this.disablePreviews.clear()
    this.restorePreviews.clear()
  }

  private requireSlot(slotId: DesktopProfileCheckpointSlotId): ProfileCheckpointSlot {
    this.assertCurrentGeneration()
    const slot = this.options.checkpoints.listSlots().find(candidate => candidate.slotId === slotId)
    this.assertCurrentGeneration()
    if (slot === undefined || !slot.snapshotExists || slot.manifest === undefined) throw this.invalidTarget()
    return slot
  }

  private projectBundles(
    inventory: readonly DesktopProfileManifestBundle[],
    managed: ReadonlySet<string>,
  ): readonly DesktopStartupRecoveryBundle[] {
    const activeNames = new Set(inventory.map(item => item.packageName))
    for (const [packageName, bundleId] of this.packageBundleIds) {
      if (activeNames.has(packageName)) continue
      this.packageBundleIds.delete(packageName)
      this.bundlePackages.delete(bundleId)
    }
    return inventory.map(item => {
      const bundleId = this.bundleId(item.packageName)
      const owner = !item.mutable ? 'core' : managed.has(item.packageName) ? 'managed' : 'external'
      return {
        bundleId,
        packageName: item.packageName,
        status: item.status,
        owner,
        action: item.mutable && item.status === 'active' ? 'disable' : null,
      }
    })
  }

  private bundleId(packageName: string): string {
    let bundleId = this.packageBundleIds.get(packageName)
    if (bundleId === undefined) {
      bundleId = `bundle_${randomBytes(24).toString('base64url')}`
      this.packageBundleIds.set(packageName, bundleId)
      this.bundlePackages.set(bundleId, packageName)
    }
    return bundleId
  }

  private async authorizeDisable(packageName: string): Promise<void> {
    this.assertCurrentGeneration()
    const inventory = readDesktopProfileBundleInventory(this.options.pluginState)
    this.assertCurrentGeneration()
    this.assertMutableActive(inventory, packageName)
  }

  private assertMutableActive(inventory: readonly DesktopProfileManifestBundle[], packageName: string): void {
    const target = inventory.find(item => item.packageName === packageName)
    if (target === undefined) throw this.invalidTarget()
    if (!target.mutable) {
      throw new DesktopStartupRecoveryControllerError('immutable-target', 'This Desktop bundle cannot be disabled.')
    }
    if (target.status === 'disabled') {
      throw new DesktopStartupRecoveryControllerError('already-disabled', 'This Desktop bundle is already disabled.')
    }
  }

  private async readManagedPackages(): Promise<ReadonlySet<string>> {
    if (this.options.managedPackageNames === undefined) return new Set()
    try {
      const names = await this.options.managedPackageNames()
      if (!Array.isArray(names) || names.length > MAX_MANAGED_PACKAGES
        || names.some(name => !safePackageName(name))) return new Set()
      return new Set(names)
    } catch {
      return new Set()
    }
  }

  private assertCurrentGeneration(): void {
    if (this.disposed) throw this.generationChanged()
    let current: DesktopStartupRecoveryGeneration
    try {
      current = this.options.currentGeneration()
      assertDesktopProfileName(current.profileName)
    } catch {
      throw this.generationChanged()
    }
    if (current.profileName !== this.profileName || current.generationId !== this.generationId
      || !OPAQUE_ID_PATTERN.test(current.generationId)) throw this.generationChanged()
  }

  private assertOperationAvailable(): void {
    if (this.operationActive) {
      throw new DesktopStartupRecoveryControllerError(
        'operation-in-progress',
        'Another Desktop recovery operation is already running.',
      )
    }
  }

  private prunePreviews(): void {
    const now = this.now()
    for (const [id, preview] of this.disablePreviews) if (preview.expiresAt <= now) this.disablePreviews.delete(id)
    for (const [id, preview] of this.restorePreviews) if (preview.expiresAt <= now) this.restorePreviews.delete(id)
  }

  private trimPreviews<T>(previews: Map<string, T>): void {
    if (previews.size < MAX_PREVIEWS) return
    const oldest = previews.keys().next().value as string | undefined
    if (oldest !== undefined) previews.delete(oldest)
  }

  private safeReadError(cause: unknown): DesktopStartupRecoveryControllerError {
    if (cause instanceof DesktopStartupRecoveryControllerError) return cause
    if (cause instanceof DesktopPluginsError) return this.mapDesktopPluginsError(cause)
    return new DesktopStartupRecoveryControllerError('state-unavailable', 'Desktop recovery state is unavailable.')
  }

  private safeMutationError(cause: unknown): DesktopStartupRecoveryControllerError {
    if (cause instanceof DesktopStartupRecoveryControllerError) return cause
    if (cause instanceof DesktopPluginsError) return this.mapDesktopPluginsError(cause)
    return new DesktopStartupRecoveryControllerError('operation-failed', 'Unable to apply the Desktop recovery operation.')
  }

  private mapDesktopPluginsError(cause: DesktopPluginsError): DesktopStartupRecoveryControllerError {
    if (cause.code === 'invalid-target' || cause.code === 'immutable-target' || cause.code === 'already-disabled') {
      return new DesktopStartupRecoveryControllerError(cause.code, cause.message)
    }
    return new DesktopStartupRecoveryControllerError('operation-failed', 'Unable to apply the Desktop recovery operation.')
  }

  private invalidTarget(): DesktopStartupRecoveryControllerError {
    return new DesktopStartupRecoveryControllerError('invalid-target', 'The Desktop recovery target is no longer available.')
  }

  private expiredPreview(): DesktopStartupRecoveryControllerError {
    return new DesktopStartupRecoveryControllerError('preview-expired', 'The Desktop recovery confirmation expired or was already used.')
  }

  private generationChanged(): DesktopStartupRecoveryControllerError {
    return new DesktopStartupRecoveryControllerError('generation-changed', 'This Desktop recovery generation is no longer active.')
  }
}
