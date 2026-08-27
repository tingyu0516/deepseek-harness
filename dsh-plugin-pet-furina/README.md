# dsh-plugin-pet-furina

Furina-themed desktop pet plugin for DSH Desktop — the companion is a
community-sourced Live2D model (placed locally under `assets/live2d/`, see
[LIVE2D](../dsh-plugin-pet-core/LIVE2D.md)) framed with the deep-sea palette
of the bundled Furina character theme for its speech bubble.

## What it does

- Adds a transparent, always-on-top companion window that can be dragged
  anywhere and survives restarts at its last position. The window only opens
  when the Live2D assets are in place; otherwise the log explains what is
  missing.
- Reacts to your work: the star conducts while a user-initiated turn runs,
  takes a triumphant bow when it completes, and sheds purely dramatic tears
  when it fails (background jobs included).
- Speaks bilingual lines (中文 / English) picked from the character's own
  script; idle chatter and event reactions are toggleable.
- Registers a tray menu (`Pet · Furina`) with a Show companion checkbox;
  double-click the character for her special performance, single-click for a
  pat.

## Install

Add `dsh-plugin-pet-furina` to the active desktop profile's
`dsh.profile.bundles` list and restart DSH Desktop. The bundle can be
disabled or removed again through Desktop's plugin management.

## License

MIT © Anywhere Labs. The bundled Live2D model and Cubism Core remain the
property of their respective owners — see `assets/live2d/LICENSE-MODEL.md`
for provenance; local, non-commercial use only, no redistribution.
