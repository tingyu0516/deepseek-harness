# dsh-plugin-pet-core

Shared engine for DSH Desktop character pet plugins. It owns everything a
desktop companion needs except the character itself:

- `createPetPlugin()` — a Cordis Host plugin factory that gates on the
  `desktopRuntime` service, registers live settings, contributes the tray
  menu, and stays completely inert in an ordinary (non-desktop) DSH boot.
- `PetWindowController` — lifecycle for one transparent, frameless,
  always-on-top window with position persistence, host→page pushes, and
  periodic strolls along the work area.
- `PetActivityTracker` — maps user-initiated session turns and background
  jobs onto pet states (`work` / `cheer` / `sad`), mirroring the desktop
  notifications row's filtering rules.
- `pet.html` — the sandboxed renderer page: a dependency-free bubble/emote
  state machine driven through `window.__dshPet.boot()/dispatch()`; the
  character itself is rendered entirely by the Live2D runtime that
  `PetWindowController` injects (Cubism Core plus renderer glue) after load.

Character plugins (such as `dsh-plugin-pet-hutao` and
`dsh-plugin-pet-furina`) depend on this package, ship a strictly validated
`assets/character.json` (palette, lines, and a required `live2d` model
declaration), and declare a one-row `dsh.bundle.patch` for the desktop profile.
Each plugin's `assets/live2d/` must hold a resolvable `.model3.json` model and
`vendor/live2dcubismcore.min.js`; when assets are missing the pet window never
opens and the plugin log says so.

This package is a library: it declares no loadable bundle of its own, and it
ships no Live2D model or Cubism Core binary. For the Live2D asset directory
contract, renderer hook, and license obligations, see [LIVE2D.md](./LIVE2D.md).

## License

MIT © Anywhere Labs
