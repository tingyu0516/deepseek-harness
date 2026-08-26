import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const destDir = join(packageRoot, 'build', 'themes')
const files = ['hutao.jpg', 'furina.jpg']
const sources = [
  join(packageRoot, 'assets', 'themes'),
  join(packageRoot, '..', 'deepseek-harness', 'themes', 'images'),
  join(packageRoot, '..', 'deepseek-harness', 'apps', 'web', 'public', 'themes'),
]

function sourceFile(file) {
  for (const dir of sources) {
    const filePath = join(dir, file)
    if (existsSync(filePath)) return filePath
  }
  throw new Error(
    `dsh-plugin-desktop: missing ${file}. Looked in:\n${sources.map(dir => `  ${dir}`).join('\n')}`,
  )
}

mkdirSync(destDir, { recursive: true })
for (const file of files) {
  copyFileSync(sourceFile(file), join(destDir, file))
}
