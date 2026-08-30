/** Host-side Live2D runtime: inject Cubism Core, the official viewer, and assets. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, posix, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSET_EXTENSIONS = new Set([
  '.model3.json', '.moc3', '.physics3.json', '.cdi3.json',
  '.exp3.json', '.motion3.json', '.png', '.jpg', '.jpeg',
])
/** Files irrelevant to rendering. */
const SKIPPED_NAMES = new Set(['LICENSE-MODEL.md'])
const SKIPPED_DIRS = new Set(['vendor'])
/** Split base64 payloads across several evaluations to stay far below the
 * message-size range where Electron IPC gets fragile. */
const CHUNK_CHARS = 4 * 1024 * 1024
/** Prefix matching `LAppDefine.ShaderPath` in the official sample. */
export const CUBISM_SHADER_PREFIX = 'dsh-cubism-shaders/'

export interface PetLive2DAssetChunk {
  /** Forward-slash path relative to the asset directory (matches model refs). */
  readonly key: string
  readonly part: number
  readonly parts: number
  readonly data: string
}

function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const name = basename(here)
  return name === 'src' || name === 'lib' ? dirname(here) : here
}

function* walkAssets(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}${sep}${entry}`
    const stats = statSync(full)
    if (stats.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry)) yield* walkAssets(full)
      continue
    }
    if (SKIPPED_NAMES.has(entry)) continue
    const lower = entry.toLowerCase()
    let matched = false
    for (const ext of ASSET_EXTENSIONS) {
      if (lower.endsWith(ext)) {
        matched = true
        break
      }
    }
    if (matched) yield full
  }
}

function chunksFromBase64(key: string, b64: string): PetLive2DAssetChunk[] {
  const parts = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS))
  const chunks: PetLive2DAssetChunk[] = []
  for (let part = 0; part < parts; part += 1) {
    chunks.push({ key, part, parts, data: b64.slice(part * CHUNK_CHARS, (part + 1) * CHUNK_CHARS) })
  }
  return chunks
}

/**
 * Read every whitelisted Live2D asset under `dir` and cut them into
 * base64 chunks for in-page delivery. Ordered deterministically so repeated
 * boots behave identically.
 */
export function collectPetLive2DAssetChunks(dir: string): PetLive2DAssetChunk[] {
  const root = fileURLToPath(dir.startsWith('file:') ? dir : `file:///${dir.replace(/\\/gu, '/')}`)
  const chunks: PetLive2DAssetChunk[] = []
  const keys: string[] = []
  const contents: string[] = []
  for (const full of walkAssets(root)) {
    keys.push(posix.join(...full.slice(root.length).split(sep)))
    contents.push(readFileSync(full).toString('base64'))
  }
  const order = keys.map((key, index) => ({ key, index })).sort((a, b) => a.key.localeCompare(b.key))
  for (const { key, index } of order) {
    chunks.push(...chunksFromBase64(key, contents[index]!))
  }
  return chunks
}

/**
 * Official Cubism WebGL shaders, keyed so the Framework `fetch` of
 * `ShaderPath + filename` hits the injected table.
 */
export function collectPetLive2DShaderChunks(): PetLive2DAssetChunk[] {
  const dir = join(packageRoot(), 'vendor', 'cubism-shaders')
  if (!existsSync(dir)) return []
  const chunks: PetLive2DAssetChunk[] = []
  for (const entry of readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
    if (!entry.endsWith('.vert') && !entry.endsWith('.frag')) continue
    const b64 = readFileSync(join(dir, entry)).toString('base64')
    chunks.push(...chunksFromBase64(`${CUBISM_SHADER_PREFIX}${entry}`, b64))
  }
  return chunks
}

/** Evaluate-ready JS statement appending one chunk into the page-side stash.
 *  Ends with `void 0` so executeJavaScript has no multi-megabyte completion
 *  value to structured-clone back over IPC. */
export function petLive2DChunkStatement(chunk: PetLive2DAssetChunk): string {
  const key = JSON.stringify(chunk.key)
  return `(window.__DSH_PET_LIVE2D_PARTS ??= {})[${key}] ??= [];`
    + `window.__DSH_PET_LIVE2D_PARTS[${key}][${String(chunk.part)}]=${JSON.stringify(chunk.data)};void 0;`
}

/** Finalize statement folding the part stash into the resolved asset table. */
export function petLive2DFinalizeStatement(): string {
  return '(window.__DSH_PET_LIVE2D_ASSETS = Object.fromEntries('
    + 'Object.entries(window.__DSH_PET_LIVE2D_PARTS ?? {})'
    + '.map(([k, v]) => [k, v.join("")])));'
    + 'delete window.__DSH_PET_LIVE2D_PARTS;'
}

/**
 * Official Cubism Framework viewer IIFE. Production reads the built
 * `lib/pet-live2d-viewer.js` (or tsdown's `.iife.js` name); tests fall
 * back to a tiny stub so injection coverage does not require a prior bundle.
 */
export function readPetLive2DViewerText(): string {
  const root = packageRoot()
  for (const name of ['pet-live2d-viewer.js', 'pet-live2d-viewer.iife.js']) {
    const built = join(root, 'lib', name)
    if (existsSync(built)) return readFileSync(built, 'utf8')
  }
  const stub = join(root, 'tests', 'fixtures', 'pet-live2d-viewer.stub.js')
  if (existsSync(stub)) return readFileSync(stub, 'utf8')
  throw new Error('pet live2d viewer bundle missing; run the package build')
}

/**
 * Read the operator-procured Cubism Core script from a file URL or plain path.
 * @throws when unreadable; callers treat any failure as "keep the pet window
 * closed".
 */
export function readPetLive2DCoreText(coreFileUrlOrPath: string): string {
  const path = coreFileUrlOrPath.startsWith('file:')
    ? fileURLToPath(coreFileUrlOrPath)
    : coreFileUrlOrPath
  return readFileSync(path, 'utf8')
}
