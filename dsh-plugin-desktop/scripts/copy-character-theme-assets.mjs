import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const destDir = join(packageRoot, 'build', 'themes')
const files = ['hutao.png', 'furina.png']
const sources = [
  join(packageRoot, 'assets', 'themes'),
  join(packageRoot, '..', 'deepseek-harness', 'themes', 'images'),
  join(packageRoot, '..', 'deepseek-harness', 'apps', 'web', 'public', 'themes'),
]

function isFile(filePath) {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function isDirectory(filePath) {
  try {
    return statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

function sourceFile(file) {
  for (const dir of sources) {
    const filePath = join(dir, file)
    if (isFile(filePath)) return filePath
    // A directory named foo.png is not the wallpaper; look one level in.
    const nested = join(filePath, file)
    if (isDirectory(filePath) && isFile(nested)) return nested
  }
  throw new Error(
    `dsh-plugin-desktop: missing ${file}. Looked in:\n${sources.map(dir => `  ${dir}`).join('\n')}`,
  )
}

mkdirSync(destDir, { recursive: true })
for (const file of files) {
  const src = sourceFile(file)
  const dest = join(destDir, file)
  if (isDirectory(dest)) rmSync(dest, { recursive: true, force: true })
  // Skip a same-size file already in place so a running Electron (or a
  // leftover directory-shaped dest) cannot block yarn dev on copyfile.
  if (isFile(dest) && statSync(dest).size === statSync(src).size) continue
  if (existsSync(dest) && isFile(dest)) rmSync(dest, { force: true })
  copyFileSync(src, dest)
}
