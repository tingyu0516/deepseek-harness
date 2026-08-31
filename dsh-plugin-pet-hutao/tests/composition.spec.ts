import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parsePetCharacterDocument } from 'dsh-plugin-pet-core'
import { apply, inject, name } from '../src/index.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  name: string
  dsh?: { bundle?: { patch?: string } }
}
const character = parsePetCharacterDocument(
  JSON.parse(readFileSync(join(packageRoot, 'assets', 'character.json'), 'utf8')) as unknown,
)

describe('dsh-plugin-pet-hutao composition', () => {
  it('declares exactly the canonical bundle patch', () => {
    expect(manifest.name).toBe('dsh-plugin-pet-hutao')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patch = readFileSync(join(packageRoot, 'cordis.patch.yml'), 'utf8')
    expect(patch.replace(/\r\n/gu, '\n')).toBe(
      [
        '# Hu Tao desktop pet: one Host row owning its transparent companion window.',
        '- insert:',
        '    - id: desktop-pet-hutao',
        '      name: dsh-plugin-pet-hutao',
        '',
      ].join('\n'),
    )
  })

  it('exports one desktop-runtime-gated Cordis plugin', () => {
    expect(name).toBe('desktop-pet-hutao')
    expect(inject).toEqual(['desktopRuntime'])
    expect(typeof apply).toBe('function')
  })

  it('ships a valid Hu Tao character document', () => {
    expect(character.id).toBe('hutao')
    expect(character.copy.zh.label).toBe('胡桃')
    expect(character.copy.en.label).toBe('Hu Tao')
    expect(character.palette.accent).toBe('#e05252')
  })

  it('points the Live2D renderer at the canonical model entry', () => {
    expect(character.live2d.model).toBe('pet.model3.json')
    expect(character.live2d.core).toBe('vendor/live2dcubismcore.min.js')
  })
})
