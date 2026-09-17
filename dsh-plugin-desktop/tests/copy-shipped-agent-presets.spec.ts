import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  REQUIRED_SHIPPED_AGENT_PRESET_ENTRIES,
  copyShippedAgentPresets,
} from '../scripts/copy-shipped-agent-presets.ts'

describe('shipped agent preset materialization', () => {
  it('copies presets onto the CLI mount and admits config in the package files list', () => {
    const copyTree = vi.fn()
    const writeManifest = vi.fn()
    const dshRoot = join('/desktop', 'node_modules', '@deepseek-ai', 'dsh')
    const presetsRoot = join('/desktop', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets')
    const destination = join(dshRoot, 'config', 'agent-presets')
    const present = new Set([presetsRoot, ...REQUIRED_SHIPPED_AGENT_PRESET_ENTRIES.map(entry => join(destination, entry))])

    const copied = copyShippedAgentPresets({
      desktopRoot: '/desktop',
      resolvePackageRoot: (packageName) => {
        if (packageName === '@deepseek-ai/dsh') return dshRoot
        if (packageName === '@deepseek-ai/dsh-agent-presets') {
          return join('/desktop', 'node_modules', '@deepseek-ai', 'dsh-agent-presets')
        }
        throw new Error(packageName)
      },
      exists: path => present.has(path),
      copyTree,
      readManifest: () => JSON.stringify({ name: '@deepseek-ai/dsh', files: ['lib/*.js'] }),
      writeManifest,
    })

    expect(copied).toBe(destination)
    expect(copyTree).toHaveBeenCalledWith(presetsRoot, destination)
    expect(JSON.parse(writeManifest.mock.calls[0]![1] as string)).toEqual({
      name: '@deepseek-ai/dsh',
      files: ['lib/*.js', 'config'],
    })
  })

  it('leaves an already admitted files list unchanged', () => {
    const writeManifest = vi.fn()
    const dshRoot = join('/desktop', 'node_modules', '@deepseek-ai', 'dsh')
    const destination = join(dshRoot, 'config', 'agent-presets')
    const present = new Set([
      join('/desktop', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets'),
      ...REQUIRED_SHIPPED_AGENT_PRESET_ENTRIES.map(entry => join(destination, entry)),
    ])

    copyShippedAgentPresets({
      desktopRoot: '/desktop',
      resolvePackageRoot: packageName => join('/desktop', 'node_modules', packageName),
      exists: path => present.has(path),
      copyTree: () => undefined,
      readManifest: () => JSON.stringify({ files: ['lib/*.js', 'config'] }),
      writeManifest,
    })

    expect(writeManifest).not.toHaveBeenCalled()
  })

  it('fails loud when a required Cordis preset file is absent after copy', () => {
    const destination = join('/desktop', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets')
    const missing = join(destination, REQUIRED_SHIPPED_AGENT_PRESET_ENTRIES[2]!)

    expect(() => copyShippedAgentPresets({
      desktopRoot: '/desktop',
      resolvePackageRoot: packageName => join('/desktop', 'node_modules', packageName),
      exists: path => path !== missing,
      copyTree: () => undefined,
      readManifest: () => JSON.stringify({ files: ['lib/*.js'] }),
      writeManifest: () => undefined,
    })).toThrow(missing)
  })
})
