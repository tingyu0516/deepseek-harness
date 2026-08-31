import { describe, expect, it } from 'vitest'
import {
  parsePetCharacterDocument,
  pickPetLine,
  PetCharacterError,
  type PetCharacterDocument,
} from '../src/contracts.ts'

function validDocument(overrides: {
  id?: string
  palette?: Record<string, unknown>
  lines?: unknown
  baseSize?: Record<string, unknown>
  live2d?: Record<string, unknown>
  omitLive2d?: boolean
} = {}): Record<string, unknown> {
  const lines = {
    greet: ['嗨！'],
    idle: ['无聊中…'],
    work: ['努力中！'],
    cheer: ['太棒了！'],
    sad: ['呜…'],
    pat: ['嘿嘿'],
    special: ['看招！'],
  }
  return {
    id: overrides.id ?? 'hutao',
    copy: {
      zh: { label: '测试', lines: overrides.lines ?? lines },
      en: { label: 'Test', lines: overrides.lines ?? lines },
    },
    palette: overrides.palette ?? {
      accent: '#e05252',
      bubbleBg: '#2e2027',
      bubbleText: '#f2e6d8',
      bubbleBorder: '#5a3a42',
    },
    baseSize: overrides.baseSize ?? { width: 216, height: 300 },
    ...(overrides.omitLive2d === true ? {} : { live2d: overrides.live2d ?? { model: 'pet.model3.json' } }),
  }
}

describe('parsePetCharacterDocument', () => {
  it('accepts a complete document', () => {
    const document = parsePetCharacterDocument(validDocument()) as PetCharacterDocument
    expect(document.id).toBe('hutao')
    expect(document.copy.zh.label).toBe('测试')
    expect(document.copy.en.lines.cheer).toEqual(['太棒了！'])
    expect(document.palette.accent).toBe('#e05252')
    expect(document.baseSize).toEqual({ width: 216, height: 300 })
    expect(document.live2d).toEqual({
      model: 'pet.model3.json',
      core: 'vendor/live2dcubismcore.min.js',
    })
  })

  it('rejects unknown ids', () => {
    expect(() => parsePetCharacterDocument(validDocument({ id: 'venti' })))
      .toThrow(PetCharacterError)
  })

  it('accepts optional hideParameters and freezes the list', () => {
    const document = parsePetCharacterDocument(validDocument({
      live2d: { model: 'pet.model3.json', hideParameters: ['Param15'] },
    })) as PetCharacterDocument
    expect(document.live2d.hideParameters).toEqual(['Param15'])
  })

  it('accepts optional hideParts', () => {
    const document = parsePetCharacterDocument(validDocument({
      live2d: { model: 'pet.model3.json', hideParts: ['Part187'] },
    })) as PetCharacterDocument
    expect(document.live2d.hideParts).toEqual(['Part187'])
  })

  it('accepts optional expressionRevealParts', () => {
    const document = parsePetCharacterDocument(validDocument({
      live2d: {
        model: 'pet.model3.json',
        expressionRevealParts: { walkSwitch: ['Part148'] },
      },
    })) as PetCharacterDocument
    expect(document.live2d.expressionRevealParts).toEqual({ walkSwitch: ['Part148'] })
  })

  it('accepts optional outfit switch', () => {
    const document = parsePetCharacterDocument(validDocument({
      live2d: {
        model: 'pet.model3.json',
        outfit: { parameter: 'Param4', lowParts: ['Part92'], highParts: ['Part91'] },
      },
    })) as PetCharacterDocument
    expect(document.live2d.outfit).toEqual({
      parameter: 'Param4',
      lowParts: ['Part92'],
      highParts: ['Part91'],
    })
  })

  it('accepts outfit with only a form parameter', () => {
    const document = parsePetCharacterDocument(validDocument({
      live2d: { model: 'pet.model3.json', outfit: { parameter: 'Param4' } },
    })) as PetCharacterDocument
    expect(document.live2d.outfit).toEqual({ parameter: 'Param4' })
  })

  it('rejects malformed outfit parts', () => {
    expect(() => parsePetCharacterDocument(validDocument({
      live2d: { model: 'pet.model3.json', outfit: { parameter: 'Param4', lowParts: [3], highParts: [] } },
    }))).toThrow(/outfit\.lowParts/u)
  })

  it('rejects malformed hideParameters entries', () => {
    expect(() => parsePetCharacterDocument(validDocument({
      live2d: { model: 'pet.model3.json', hideParameters: ['ok', 3] },
    }))).toThrow(/hideParameters/u)
  })

  it('rejects missing line categories', () => {
    expect(() => parsePetCharacterDocument(validDocument({
      lines: { greet: ['嗨'] },
    }))).toThrow(/lines\.idle/u)
  })

  it('rejects empty line arrays', () => {
    expect(() => parsePetCharacterDocument(validDocument({
      lines: {
        greet: ['嗨'], idle: ['无'], work: ['工'], cheer: [], sad: ['呜'], pat: ['拍'], special: ['特'],
      },
    }))).toThrow(PetCharacterError)
  })

  it('rejects malformed palette colors', () => {
    expect(() => parsePetCharacterDocument(validDocument({
      palette: {
        accent: 'red', bubbleBg: '#2e2027', bubbleText: '#f2e6d8', bubbleBorder: '#5a3a42',
      },
    }))).toThrow(/palette\.accent/u)
  })

  it('rejects out-of-range base sizes', () => {
    expect(() => parsePetCharacterDocument(validDocument({ baseSize: { width: 72, height: 300 } })))
      .toThrow(/baseSize\.width/u)
  })

  it('rejects non-object roots', () => {
    expect(() => parsePetCharacterDocument('hutao')).toThrow(PetCharacterError)
    expect(() => parsePetCharacterDocument(null)).toThrow(PetCharacterError)
  })

  it('rejects documents without a live2d block now that SVG is gone', () => {
    expect(() => parsePetCharacterDocument(validDocument({ omitLive2d: true })))
      .toThrow(/live2d/u)
  })

  it('rejects Live2D asset names that escape the plugin directory', () => {
    for (const model of ['../evil.model3.json', 'sub/../x.model3.json', '/abs.model3.json', 'model.json']) {
      expect(() => parsePetCharacterDocument(validDocument({ live2d: { model } })))
        .toThrow(/live2d\.model/u)
    }
  })

  it('rejects Live2D core names that are not relative js assets', () => {
    expect(() => parsePetCharacterDocument(validDocument({
      live2d: { model: 'pet.model3.json', core: '../system.js' },
    }))).toThrow(/live2d\.core/u)
  })
})

describe('pickPetLine', () => {
  const document = parsePetCharacterDocument(validDocument()) as PetCharacterDocument

  it('returns a line from the requested category', () => {
    expect(pickPetLine(document, 'zh', 'cheer', () => 0)).toBe('太棒了！')
    expect(pickPetLine(document, 'en', 'cheer', () => 0.99)).toBe('太棒了！')
  })

  it('never escapes the category list', () => {
    for (let index = 0; index < 50; index += 1) {
      const line = pickPetLine(document, 'zh', 'idle', () => 1.5)
      expect(document.copy.zh.lines.idle).toContain(line)
    }
  })
})
