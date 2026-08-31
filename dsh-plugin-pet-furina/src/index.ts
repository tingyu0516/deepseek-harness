/** Furina desktop pet: thin character entry over the shared pet engine. */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { createPetPlugin, parsePetCharacterDocument } from 'dsh-plugin-pet-core'

const require = createRequire(import.meta.url)
const characterPath = fileURLToPath(new URL('../assets/character.json', import.meta.url))
const live2dDir = fileURLToPath(new URL('../assets/live2d/', import.meta.url))

const plugin = createPetPlugin({
  pluginName: 'desktop-pet-furina',
  trayOrder: 31,
  loadCharacter: () => parsePetCharacterDocument(
    JSON.parse(readFileSync(characterPath, 'utf8')) as unknown,
  ),
  loadHtmlPath: () => require.resolve('dsh-plugin-pet-core/pet.html'),
  // Live2D stays optional: when license-compliant assets are dropped into
  // assets/live2d/ this resolves, otherwise the pet keeps its SVG look.
  loadLive2DDir: () => (existsSync(live2dDir) ? live2dDir : undefined),
})

export const name = plugin.name
export const inject = plugin.inject
export const apply: (ctx: Context) => void = plugin.apply
