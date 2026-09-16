/** Generate the macOS Dock icon with the platform's visual safe area. */

import { statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Pixel width and height of the generated macOS icon canvas. */
export const MAC_APP_ICON_CANVAS_SIZE = 1024
/** Pixel width and height of the centered source artwork. */
export const MAC_APP_ICON_ARTWORK_SIZE = 824
/** Transparent inset on each edge of the generated macOS icon. */
export const MAC_APP_ICON_INSET = (MAC_APP_ICON_CANVAS_SIZE - MAC_APP_ICON_ARTWORK_SIZE) / 2

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourcePath = join(packageRoot, 'build', 'app-icon.png')
const outputPath = join(packageRoot, 'build', 'app-icon-mac.png')

/**
 * Whether a PNG's metadata matches the macOS icon contract.
 * @param {import('sharp').Metadata} metadata
 * @param {Buffer | undefined} icc - source ICC profile the icon must carry.
 */
function matchesIconContract(metadata, icc) {
  return metadata.format === 'png'
    && metadata.width === MAC_APP_ICON_CANVAS_SIZE
    && metadata.height === MAC_APP_ICON_CANVAS_SIZE
    && metadata.space === 'rgb16'
    && metadata.depth === 'ushort'
    && metadata.bitsPerSample === 16
    && metadata.channels === 4
    && metadata.hasAlpha === true
    && icc !== undefined
    && metadata.icc?.equals(icc) === true
}

/**
 * Derive the macOS application icon without changing the cross-platform source.
 * An output that already satisfies the contract is left untouched so a routine
 * build never rewrites a multi-megabyte file.
 * @param {string} source - absolute path to the square source PNG.
 * @param {string} output - absolute path for the generated macOS PNG.
 * @returns {Promise<void>} Resolves after the complete PNG has been written.
 */
export async function generateMacAppIcon(source = sourcePath, output = outputPath) {
  if (resolve(source) === resolve(output)) {
    throw new Error('generate-mac-app-icon: output must not overwrite the source icon')
  }

  const metadata = await sharp(source).metadata()
  if (!matchesIconContract(metadata, metadata.icc)) {
    throw new Error(
      `generate-mac-app-icon: source must be a ${MAC_APP_ICON_CANVAS_SIZE}x${MAC_APP_ICON_CANVAS_SIZE} RGBA16 PNG with an ICC profile`,
    )
  }

  let existing
  try {
    existing = statSync(output).isFile() ? await sharp(output).metadata() : undefined
  } catch {
    existing = undefined
  }
  if (existing !== undefined && matchesIconContract(existing, metadata.icc)) return

  const rendered = await sharp(source, { failOn: 'warning' })
    .resize({
      width: MAC_APP_ICON_ARTWORK_SIZE,
      height: MAC_APP_ICON_ARTWORK_SIZE,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .extend({
      top: MAC_APP_ICON_INSET,
      bottom: MAC_APP_ICON_INSET,
      left: MAC_APP_ICON_INSET,
      right: MAC_APP_ICON_INSET,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toColourspace('rgb16')
    .keepIccProfile()
    .png({
      compressionLevel: 9,
      progressive: false,
      adaptiveFiltering: false,
      palette: false,
    })
    .toBuffer()

  const generated = await sharp(rendered).metadata()
  if (!matchesIconContract(generated, metadata.icc)) {
    throw new Error('generate-mac-app-icon: generated icon did not preserve the source color data')
  }

  writeFileSync(output, rendered)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await generateMacAppIcon()
}
