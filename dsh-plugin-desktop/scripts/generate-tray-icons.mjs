/** Generate native tray bitmaps from the repository-owned brand SVG. */

import { statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'tray-icon.svg')
const source = await readFile(sourcePath, 'utf8')
const sourceMtime = statSync(sourcePath).mtimeMs

const BRAND_BLUE = '#4D6BFE'
if (!source.includes(`fill="${BRAND_BLUE}"`) || /<style\b/iu.test(source)) {
  throw new Error(`generate-tray-icons: tray-icon.svg must use the fixed brand color ${BRAND_BLUE}`)
}

const variants = [
  ['tray-iconTemplate.png', '#000000', 16],
  ['tray-iconTemplate@2x.png', '#000000', 32],
  ['tray-icon-blue.png', BRAND_BLUE, 16],
  ['tray-icon-blue@1.25x.png', BRAND_BLUE, 20],
  ['tray-icon-blue@1.5x.png', BRAND_BLUE, 24],
  ['tray-icon-blue@2x.png', BRAND_BLUE, 32],
]

/** An output newer than the SVG source is current; skip the rewrite. */
function isCurrent(output) {
  try {
    const stat = statSync(output)
    return stat.isFile() && stat.size > 0 && stat.mtimeMs >= sourceMtime
  } catch {
    return false
  }
}

await Promise.all(variants.map(async ([filename, color, size]) => {
  const output = join(buildRoot, filename)
  if (isCurrent(output)) return
  const rendered = source.replaceAll(BRAND_BLUE, color)
  const png = await sharp(Buffer.from(rendered))
    .resize({ width: size, height: size, fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(output, png)
}))
