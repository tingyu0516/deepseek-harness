/** Copy Hu Tao and Furina wallpapers into the Desktop package asset tree. */

import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceDir = join(packageRoot, '..', 'deepseek-harness', 'themes', 'images')
const destDir = join(packageRoot, 'build', 'themes')
const files = ['hutao.png', 'furina.png']

mkdirSync(destDir, { recursive: true })
for (const file of files) {
  copyFileSync(join(sourceDir, file), join(destDir, file))
}
