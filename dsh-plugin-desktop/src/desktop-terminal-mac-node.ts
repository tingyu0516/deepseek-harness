/** Prefer Electron's LSUIElement Plugin helper for macOS Node-mode children. */

import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

/**
 * Locate the Plugin helper sibling of one macOS application executable.
 * @param appExecutable - `process.execPath` of the Desktop application.
 * @returns the Plugin helper Mach-O path, which may not exist yet.
 */
export function macPluginHelperExecutable(appExecutable: string): string {
  const name = basename(appExecutable)
  return resolve(
    dirname(appExecutable),
    '..',
    'Frameworks',
    `${name} Helper (Plugin).app`,
    'Contents',
    'MacOS',
    `${name} Helper (Plugin)`,
  )
}

/**
 * Choose the executable used by terminal `ELECTRON_RUN_AS_NODE` shims.
 * The Plugin helper is an LSUIElement binary, so Node-mode children do not
 * appear as extra Dock icons. The GUI executable remains the fallback.
 * @param appExecutable - `process.execPath` of the Desktop application.
 * @param exists - injectable existence probe.
 * @returns the helper when present, otherwise `appExecutable`.
 */
export function resolveMacRunAsNodeExecutable(
  appExecutable: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const helper = macPluginHelperExecutable(appExecutable)
  return exists(helper) ? helper : appExecutable
}
