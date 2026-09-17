# Desktop preinstalled plugins

English | [中文](preinstalled-plugins.zh.md)

DSH Desktop mounts a small set of third-party plugins through the launcher patch, the same way it mounts the Hu Tao and Furina character packages. Pin the npm versions here. Do not add the same packages as profile bundles: a bundle patch would insert the same Loader ids twice and fail startup.

The owning files are `src/launcher-preinstall.ts` (insert/omit catalog), `dsh-plugin-desktop/package.json` (exact dependency versions), `dsh-plugin-desktop/cordis.patch.yml` (Loader insert rows and YAML specials), `.yarnrc.yml` `npmPreapprovedPackages` (Yarn otherwise quarantines a same-day npm publish with `YN0016`), and `.yarnrc.yml` `approvedGitRepositories` for GitHub-only packages. `src/profile.ts` omits a launcher insert when the selected profile already owns that package.

## Current pins

| Package | Version | Loader id | Upstream |
|---|---|---|---|
| `dsh-plugin-pet-hutao` | workspace `0.1.0-dev.0` | `desktop-pet-hutao` | this repository |
| `dsh-plugin-pet-furina` | workspace `0.1.0-dev.0` | `desktop-pet-furina` | this repository |
| `dsh-better-sidebar` | `0.19.1` | `better-sidebar` | https://github.com/omdsh-dev/DSH-better-sidebar |
| `@linxin666/dsh-remote-web-ui` | `0.3.23` | `remote-web-ui` | https://github.com/zhu1090093659/dsh-web/tree/main/packages/dsh-remote-web-ui |
| `@linxin666/dsh-client-ui-task-board` | `0.3.23` | `ui-task-board` | https://github.com/zhu1090093659/dsh-web/tree/main/packages/dsh-task-board |
| `dsh-context` | `0.53.1` | `dsh-context` | https://github.com/bowenliang123/dsh-context |
| `@changfenhuang/dsh-genui` | `0.11.1-preview.2` | `genui` | https://github.com/omdsh-dev/dsh-genui |
| `dsh-models-config-plugin` | GitHub `6355d9b` (`0.1.0`) | `models-config-plugin` | https://github.com/MarvekG/deepseek-harness-model-config |
| `@liustack/modsearch` | `5.10.3` | `modsearch` | https://github.com/liustack/modsearch |
| `ds-harness-remote` | `0.4.14` | `ds-harness-remote` | https://github.com/liguobao/ds-harness-remote |

`dsh-genui` uses the `0.11.1-preview.2` line because it declares 0.1.6-alpha peers. Extended and advanced frames declare the official `rightbar` child and implement `ctx.layout.openRightbar` / `closeRightbar`. Compatibility mode keeps the official AppFrame right column. The previous overlay drawer is gone; the composer git-branch chip remains as `desktop-composer-branch`. `dsh-better-sidebar` occupies that official right column and keeps a bottom workbench; it does not replace the left project/session sidebar.

`dsh-models-config-plugin` is not on npm: pin the GitHub commit and keep `https://github.com/MarvekG/deepseek-harness-model-config.git` in `approvedGitRepositories`. The launcher `web` overlay sets `searchProvider: modsearch` and keeps `fetchProvider: http`. `ds-harness-remote` copies both published Loader rows: the Desktop Host id stays active unless dsh-TUI is present, and `ds-harness-remote-tui` stays inactive on Desktop.

## Update one pin

1. Confirm the npm version or GitHub commit against the upstream README and `peerDependencies` for DSH `0.1.6-alpha.1`.
2. If Yarn reports `YN0016` quarantine, keep the package in `.yarnrc.yml` `npmPreapprovedPackages`. If Yarn reports `YN0080`, keep the repository URL in `approvedGitRepositories`.
3. Run `corepack yarn workspace dsh-plugin-desktop add <name>@<version>` for npm, or `add <name>@github:<owner>/<repo>#commit=<sha>` for a GitHub-only package.
4. Keep the Loader `id` and `name` in `cordis.patch.yml` identical to that package's published `cordis.patch.yml`. Copy `better-sidebar`'s double-mount `disabled: !!js` guard and `ds-harness-remote`'s complementary dsh-TUI pair. The `web` overlay replaces that row's whole config, so keep `fetchProvider: http` beside `searchProvider: modsearch`.
5. Update `src/launcher-preinstall.ts` (`packageName`, Loader `id`, Host `entryFile`). `profile.ts` and `scripts/verify-packaged-runtime.ts` read that catalog. `dsh-models-config-plugin` ships `src/index.js`; `@liustack/modsearch` ships `dsh/index.js`; `ds-harness-remote` ships `dist/index.js`.
6. Record the new version or commit in this table.

Do not edit files inside `deepseek-harness/` for these pins. Do not mix a submodule pin update with this desktop preinstall change.
