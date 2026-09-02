import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PET_SPEECH_SLOT_PX } from '../src/pet-window.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const page = readFileSync(join(packageRoot, 'pet.html'), 'utf8')

describe('pet.html renderer contract', () => {
  it('exposes the host bridge', () => {
    expect(page).toContain('window.__dshPet')
    expect(page).toContain('boot: boot')
    expect(page).toContain('dispatch: dispatch')
    expect(page).toContain('state: function')
    expect(page).toContain('setLive2D: applyLive2D')
  })

  it('delegates all character rendering to the Live2D runtime', () => {
    expect(page).toContain('__dshPetLive2DRuntime')
    expect(page).toContain('runtime.attach(petWrap, spec)')
    expect(page).toContain("callRuntime('setState'")
    expect(page).toContain('rt.tap(clientX, clientY)')
    expect(page).toContain("callRuntime('playMotionGroup', 'Special')")
    expect(page).toContain('if (!spec || !spec.model) return Promise.resolve(false);')
    expect(page).not.toContain('spec.core')
    expect(page).toContain('live2dfailed')
  })

  it('carries no SVG presentation contract anymore', () => {
    for (const marker of [
      '.pet-body', '.pet-hair-l', '.pet-hair-r', '.pet-eye',
      '.pet-arm-l', '.pet-arm-r', '.pet-companion', '.pet-shadow',
      'data-state', 'character.svg', 'l2d-ready', '@keyframes pet-',
    ]) {
      expect(page).not.toContain(marker)
    }
  })

  it('keeps a strict content security policy without remote sources', () => {
    expect(page).toContain('default-src \'none\'')
    expect(page).toContain('script-src \'unsafe-inline\' \'wasm-unsafe-eval\'')
    expect(page).toContain('img-src blob:')
    expect(page).not.toContain('connect-src')
    expect(page).not.toMatch(/src=["']https?:\/\//u)
    expect(page).not.toMatch(/href=["']https?:\/\//u)
  })

  it('renders transparently for the WebGL canvas', () => {
    expect(page).toContain('background: transparent')
    expect(page).toContain('touch-action: none')
    expect(page).toContain('.pet-wrap canvas')
    expect(page).toContain('max-width: 100%')
    expect(page).toContain('align-items: flex-end')
    expect(page).toContain(`--pet-speech-slot: ${String(PET_SPEECH_SLOT_PX)}px`)
    expect(page).toMatch(/\.bubble \{[^}]*position: absolute;/u)
    expect(page).toMatch(/\.bubble \{[^}]*max-height: calc\(var\(--pet-speech-slot\)/u)
    expect(page).toMatch(/\.pet-wrap \{[^}]*top: var\(--pet-speech-slot\);/u)
  })

  it('drags via the private scheme instead of app-region', () => {
    expect(page).not.toContain('-webkit-app-region')
    expect(page).toContain("'://' + path")
    expect(page).toContain('dragstart?ox=')
    expect(page).toContain('dragend')
    expect(page).toContain('setPointerCapture')
    expect(page).toContain('DRAG_THRESHOLD_PX')
    expect(page).toContain('DBLCLICK_MS')
    expect(page).toContain('wasDragging')
    expect(page).toContain('dragging')
    expect(page).toContain('pointerdown')
    expect(page).toContain('pointermove')
    expect(page).toContain('pointerup')
    expect(page).toContain('tapFace')
    expect(page).toContain('playSpecial')
    expect(page).toContain('contextmenu')
    expect(page).toContain("enter('pat', pick('pat'), 3200)")
    expect(page).toContain('overPet')
    expect(page).toContain('coversPoint')
    expect(page).toContain("callRuntime('playMotionGroup', 'Special')")
    expect(page).toContain('applyLive2D(payload.live2d).then')
    expect(page).not.toContain('toggleForm')
    expect(page).not.toContain('pickExpression')
    expect(page).not.toContain('CLICK_EXPRESSIONS')
    expect(page).not.toContain('STATE_EXPRESSIONS')
    expect(page).not.toContain('MOVE_MAX_PER_MESSAGE')
    expect(page).not.toContain('queueMoveDispatch')
  })

  it('honors reduced-motion preferences for the bubble', () => {
    expect(page).toContain('prefers-reduced-motion')
  })
})
