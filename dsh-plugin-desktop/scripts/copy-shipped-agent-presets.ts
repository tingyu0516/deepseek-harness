/** Materialize the CLI configTrees agent-presets mount into the installed dsh package. */

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN_NAME = 'dsh-plugin-desktop'
const CLI_PACKAGE = '@deepseek-ai/dsh'
const PRESETS_PACKAGE = '@deepseek-ai/dsh-agent-presets'
const FILES_ENTRY = 'config'
const MOUNT = join('config', 'agent-presets')

/** Physical Cordis preset files the packaged runtime verifier requires. */
export const REQUIRED_SHIPPED_AGENT_PRESET_ENTRIES = [
  join('cordis', 'agent.cordis.yml'),
  join('cordis', 'skills', 'cordis-plugin-development', 'SKILL.md'),
  join('cordis', 'skills', 'editing-cordis-compositions', 'SKILL.md'),
] as const

/** Injectable filesystem and package-resolution seam used by focused tests. */
export interface ShippedAgentPresetCopyOptions {
  /** Desktop package root used to resolve first-party runtime packages. */
  readonly desktopRoot: string
  /** Resolve an installed package directory from its package name. */
  readonly resolvePackageRoot: (packageName: string) => string
  /** Return whether a path currently exists. */
  readonly exists: (path: string) => boolean
  /** Copy one directory tree onto another. */
  readonly copyTree: (source: string, destination: string) => void
  /** Read a package manifest as UTF-8 text. */
  readonly readManifest: (path: string) => string
  /** Write a package manifest as UTF-8 text. */
  readonly writeManifest: (path: string, contents: string) => void
}

function resolveInstalledPackageRoot(desktopRoot: string, packageName: string): string {
  const require = createRequire(join(resolve(desktopRoot), 'package.json'))
  return dirname(require.resolve(`${packageName}/package.json`))
}

function createInstalledOptions(desktopRoot: string): ShippedAgentPresetCopyOptions {
  return {
    desktopRoot,
    resolvePackageRoot: packageName => resolveInstalledPackageRoot(desktopRoot, packageName),
    exists: existsSync,
    copyTree: (source, destination) => {
      cpSync(source, destination, { recursive: true })
    },
    readManifest: path => readFileSync(path, 'utf8'),
    writeManifest: (path, contents) => writeFileSync(path, contents),
  }
}

function assertStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new Error(`${BIN_NAME}: ${label} is invalid`)
  }
  return value
}

function withConfigFilesEntry(files: readonly string[]): readonly string[] | undefined {
  if (files.includes(FILES_ENTRY) || files.some(entry => entry === 'config/**' || entry.startsWith('config/'))) {
    return undefined
  }
  return [...files, FILES_ENTRY]
}

/**
 * Copy `@deepseek-ai/dsh-agent-presets/presets` onto the CLI `config/agent-presets`
 * mount and admit `config` in that package's `files` list so Electron Builder keeps it.
 * @param options - Desktop root or injectable copy operations.
 * @returns Destination directory containing the shipped presets.
 */
export function copyShippedAgentPresets(
  options: ShippedAgentPresetCopyOptions | string,
): string {
  const resolved = typeof options === 'string' ? createInstalledOptions(options) : options
  const dshRoot = resolved.resolvePackageRoot(CLI_PACKAGE)
  const presetsRoot = join(resolved.resolvePackageRoot(PRESETS_PACKAGE), 'presets')
  if (!resolved.exists(presetsRoot)) {
    throw new Error(
      `${BIN_NAME}: ${PRESETS_PACKAGE} is missing its shipped presets directory at ${presetsRoot}`,
    )
  }

  const destination = join(dshRoot, MOUNT)
  resolved.copyTree(presetsRoot, destination)
  const missing = REQUIRED_SHIPPED_AGENT_PRESET_ENTRIES
    .map(entry => join(destination, entry))
    .filter(path => !resolved.exists(path))
  if (missing.length > 0) {
    throw new Error(`${BIN_NAME}: shipped agent presets at ${destination} are missing ${missing.join(', ')}`)
  }

  const manifestPath = join(dshRoot, 'package.json')
  const manifest = JSON.parse(resolved.readManifest(manifestPath)) as { files?: unknown }
  const files = withConfigFilesEntry(assertStringList(manifest.files, `${CLI_PACKAGE} package.json files list`))
  if (files !== undefined) {
    resolved.writeManifest(manifestPath, `${JSON.stringify({ ...manifest, files }, undefined, 2)}\n`)
  }
  return destination
}

/** Copy shipped agent presets using the installed desktop dependency graph. */
export function copyInstalledShippedAgentPresets(desktopRoot: string): void {
  copyShippedAgentPresets(desktopRoot)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    copyInstalledShippedAgentPresets(process.argv[2] ?? dirname(dirname(fileURLToPath(import.meta.url))))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
