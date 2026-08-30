import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig } from 'tsdown'

const PACKAGE_NAME = 'dsh-plugin-desktop'
/** Virtual ids must not end in `.css`, or tsdown's css-guard rejects the build. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

function resolveStylesheet(source: string, importer: string | undefined): string | undefined {
  if (source.startsWith('.') || isAbsolute(source)) {
    if (importer === undefined) return undefined
    return resolvePath(dirname(importer), source)
  }
  const require = createRequire(importer === undefined ? import.meta.url : pathToFileURL(importer).href)
  return require.resolve(source)
}

function cssInlinePlugin() {
  return {
    name: 'dsh-css-global-inline',
    resolveId: {
      order: 'pre' as const,
      handler(source: string, importer: string | undefined) {
        if (!source.endsWith('.css')) return null
        const file = resolveStylesheet(source, importer)
        if (file === undefined) return null
        return CSS_VIRTUAL_PREFIX + file + CSS_VIRTUAL_SUFFIX
      },
    },
    async load(this: { addWatchFile(id: string): void }, id: string) {
      if (!id.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = id.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const css = await readFile(fileId, 'utf8')
      const tagId = `${PACKAGE_NAME}/${basename(fileId)}`
      return [
        `const css = ${JSON.stringify(css)};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_NAME)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        'export {};',
      ].join('\n')
    },
  }
}

export default defineConfig([
  {
    name: PACKAGE_NAME,
    entry: {
      index: 'src/index.ts',
      'module-resolution': 'src/module-resolution.ts',
      webserver: 'src/webserver.ts',
      profile: 'src/profile.ts',
      'profile-manager': 'src/profile-manager.ts',
      'profile-service': 'src/profile-service.ts',
      'desktop-plugins': 'src/desktop-plugins.ts',
      pnpm: 'src/pnpm.ts',
      profiles: 'src/profiles.ts',
      diagnostics: 'src/diagnostics.ts',
      notifications: 'src/notifications.ts',
      'diagnostic-export-worker': 'src/diagnostic-export-worker.ts',
      runtime: 'src/runtime.ts',
      'electron-runtime': 'src/electron-runtime.ts',
      'desktop-runtime-environment': 'src/desktop-runtime-environment.ts',
      'desktop-terminal': 'src/desktop-terminal.ts',
      'desktop-cli': 'src/desktop-cli.ts',
      terminal: 'src/terminal.ts',
      'update-checker': 'src/update-checker.ts',
      'update-download': 'src/update-download.ts',
      updates: 'src/updates.ts',
      'windows-agent-presets': 'src/windows-agent-presets.ts',
      'windows-pwsh-sandbox': 'src/windows-pwsh-sandbox.ts',
      'windows-acl-runner': 'src/windows-acl-runner.ts',
      main: 'src/main.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
  },
  {
    name: `${PACKAGE_NAME}/bin`,
    entry: { bin: 'src/bin.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    outputOptions: {
      banner: '#!/usr/bin/env node',
    },
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-runtime/client',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    noExternal: (id: string) => id.startsWith('@deepseek-ai/') ? undefined : true,
    plugins: [cssInlinePlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  {
    name: `${PACKAGE_NAME}/preload`,
    entry: { preload: 'src/preload.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    external: ['electron'],
    outputOptions: {
      entryFileNames: 'preload.cjs',
    },
  },
])
