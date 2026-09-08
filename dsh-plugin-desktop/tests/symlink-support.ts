import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Whether this process may create file symbolic links. Windows reserves
 * symlink creation for privileged accounts unless Developer Mode grants it,
 * so specs that need file symlinks probe once and skip the link-shaped cases
 * when the filesystem rejects creation. Directory junctions
 * (`symlinkSync(target, link, 'junction')`) need no privilege and stay
 * runnable unconditionally on Windows.
 */
function probeFileSymlinkSupport(): boolean {
  const root = mkdtempSync(join(tmpdir(), 'dsh-symlink-probe-'))
  try {
    const target = join(root, 'target')
    writeFileSync(target, '')
    try {
      symlinkSync(target, join(root, 'link'), 'file')
      return true
    } catch {
      return false
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export const canCreateFileSymlinks: boolean = probeFileSymlinkSupport()
