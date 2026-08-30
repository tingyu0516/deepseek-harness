import { defineConfig } from 'tsdown'

const PACKAGE_NAME = 'dsh-plugin-pet-core'

export default defineConfig([
  {
    name: PACKAGE_NAME,
    entry: { index: 'src/index.ts' },
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
    name: `${PACKAGE_NAME}/live2d-viewer`,
    entry: { 'pet-live2d-viewer': 'src/live2d/viewer.ts' },
    tsconfig: 'tsconfig.live2d.json',
    outDir: 'lib',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: true,
    alias: {
      '@framework': './vendor/cubism-framework',
    },
  },
])
