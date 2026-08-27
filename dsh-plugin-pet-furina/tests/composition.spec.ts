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

describe('dsh-plugin-pet-furina composition', () => {
  it('declares exactly the canonical bundle patch', () => {
    expect(manifest.name).toBe('dsh-plugin-pet-furina')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patch = readFileSync(join(packageRoot, 'cordis.patch.yml'), 'utf8')
    expect(patch.replace(/\r\n/gu, '\n')).toBe(
      [
        '# Furina desktop pet: one Host row owning its transparent companion window.',
        '- insert:',
        '    - id: desktop-pet-furina',
        '      name: dsh-plugin-pet-furina',
        '',
      ].join('\n'),
    )
  })

  it('exports one desktop-runtime-gated Cordis plugin', () => {
    expect(name).toBe('desktop-pet-furina')
    expect(inject).toEqual(['desktopRuntime'])
    expect(typeof apply).toBe('function')
  })

  it('ships a valid Furina character document', () => {
    expect(character.id).toBe('furina')
    expect(character.copy.zh.label).toBe('芙宁娜')
    expect(character.copy.en.label).toBe('Furina')
    expect(character.palette.accent).toBe('#4cc9f0')
  })

  it('points the Live2D renderer at the canonical model entry', () => {
    expect(character.live2d.model).toBe('pet.model3.json')
    expect(character.live2d.core).toBe('vendor/live2dcubismcore.min.js')
    expect(character.live2d.hideParameters).toEqual(['Param15'])
    // Only the watermark board stays pinned; walk accessory is reveal-on-switch.
    expect(character.live2d.hideParts).toEqual([
      'Part187',
      'Part148',
    ])
    expect(character.live2d.expressionRevealParts).toEqual({ walkSwitch: ['Part148'] })
    // Param4 1 = white form, 0 = black form; each side hides its mirror set.
    expect(character.live2d.outfit).toEqual({
      parameter: 'Param4',
      lowParts: [
        'Part88', 'Part92', 'Part113', 'Part114', 'Part165', 'Part115', 'Part116',
        'Part175', 'Part176', 'Part168', 'Part170', 'Part122', 'Part125', 'Part172',
        'Part158', 'Part25', 'Part81',
      ],
      highParts: [
        'Part87', 'Part91', 'Part109', 'Part110', 'Part164', 'Part111', 'Part112',
        'Part173', 'Part174', 'Part167', 'Part169', 'Part123', 'Part124', 'Part171',
        'Part157', 'Part24', 'Part80',
      ],
    })
  })
})
