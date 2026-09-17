/** Launcher-owned preinstall rows: character pets plus pinned community plugins. */

/** One package the desktop launcher inserts and omits when a profile already owns it. */
export interface DesktopLauncherPreinstall {
  /** npm or workspace package name. `package.json` owns the version. */
  readonly packageName: string
  /** Loader id copied from that package's published `cordis.patch.yml`. */
  readonly loaderId: string
  /** Host entry path inside the installed package. */
  readonly entryFile: string
}

/**
 * Insert/omit catalog for launcher preinstalls.
 * YAML specials (`better-sidebar` disabled, `ds-harness-remote` dsh-TUI pair, `web` search overlay) stay in `cordis.patch.yml`.
 * Unpack extras (`pet-core`, Live2D models) stay in `scripts/verify-packaged-runtime.ts`.
 */
export const DESKTOP_LAUNCHER_PREINSTALLS = [
  { packageName: 'dsh-plugin-pet-hutao', loaderId: 'desktop-pet-hutao', entryFile: 'lib/index.js' },
  { packageName: 'dsh-plugin-pet-furina', loaderId: 'desktop-pet-furina', entryFile: 'lib/index.js' },
  { packageName: 'dsh-better-sidebar', loaderId: 'better-sidebar', entryFile: 'lib/index.js' },
  { packageName: '@linxin666/dsh-remote-web-ui', loaderId: 'remote-web-ui', entryFile: 'lib/index.js' },
  { packageName: '@linxin666/dsh-client-ui-task-board', loaderId: 'ui-task-board', entryFile: 'lib/index.js' },
  { packageName: 'dsh-context', loaderId: 'dsh-context', entryFile: 'lib/index.js' },
  { packageName: '@changfenhuang/dsh-genui', loaderId: 'genui', entryFile: 'lib/index.js' },
  { packageName: 'dsh-models-config-plugin', loaderId: 'models-config-plugin', entryFile: 'src/index.js' },
  { packageName: '@liustack/modsearch', loaderId: 'modsearch', entryFile: 'dsh/index.js' },
  { packageName: 'ds-harness-remote', loaderId: 'ds-harness-remote', entryFile: 'dist/index.js' },
] as const satisfies readonly DesktopLauncherPreinstall[]

/** Package names used to drop a launcher insert when the selected profile already owns that bundle. */
export const DESKTOP_LAUNCHER_PREINSTALL_PACKAGES = new Set<string>(
  DESKTOP_LAUNCHER_PREINSTALLS.map(plugin => plugin.packageName),
)

/** Physical Host files that must exist for each launcher-preinstalled package. */
export const DESKTOP_LAUNCHER_PREINSTALL_RUNTIME_ENTRIES = DESKTOP_LAUNCHER_PREINSTALLS.flatMap(plugin => [
  `node_modules/${plugin.packageName}/package.json`,
  `node_modules/${plugin.packageName}/${plugin.entryFile}`,
])

/** Package specifiers that profile fallback links must resolve for launcher preinstalls. */
export const DESKTOP_LAUNCHER_PREINSTALL_PACKAGE_SPECIFIERS = DESKTOP_LAUNCHER_PREINSTALLS.map(
  plugin => plugin.packageName,
)
