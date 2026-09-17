# 桌面预装插件

[English](preinstalled-plugins.md) | 中文

DSH Desktop 通过启动器补丁挂载一组第三方插件，方式和胡桃、芙宁娜角色包相同。在这里钉死 npm 版本。不要再把同一包加进 profile bundle：bundle 补丁会插入相同的 Loader id，启动失败。

归属文件是 `src/launcher-preinstall.ts`（insert/omit 目录）、`dsh-plugin-desktop/package.json`（精确依赖版本）、`dsh-plugin-desktop/cordis.patch.yml`（Loader insert 行和 YAML 特例）、`.yarnrc.yml` 的 `npmPreapprovedPackages`（否则当天发布的 npm 包会被 Yarn 以 `YN0016` 隔离），以及 GitHub-only 包所需的 `approvedGitRepositories`。当所选 profile 已经拥有该包时，`src/profile.ts` 会丢掉启动器里的对应 insert。

## 当前钉定

| 包 | 版本 | Loader id | 上游 |
|---|---|---|---|
| `dsh-plugin-pet-hutao` | workspace `0.1.0-dev.0` | `desktop-pet-hutao` | 本仓库 |
| `dsh-plugin-pet-furina` | workspace `0.1.0-dev.0` | `desktop-pet-furina` | 本仓库 |
| `dsh-better-sidebar` | `0.19.1` | `better-sidebar` | https://github.com/omdsh-dev/DSH-better-sidebar |
| `@linxin666/dsh-remote-web-ui` | `0.3.23` | `remote-web-ui` | https://github.com/zhu1090093659/dsh-web/tree/main/packages/dsh-remote-web-ui |
| `@linxin666/dsh-client-ui-task-board` | `0.3.23` | `ui-task-board` | https://github.com/zhu1090093659/dsh-web/tree/main/packages/dsh-task-board |
| `dsh-context` | `0.53.1` | `dsh-context` | https://github.com/bowenliang123/dsh-context |
| `@changfenhuang/dsh-genui` | `0.11.1-preview.2` | `genui` | https://github.com/omdsh-dev/dsh-genui |
| `dsh-models-config-plugin` | GitHub `6355d9b`（`0.1.0`） | `models-config-plugin` | https://github.com/MarvekG/deepseek-harness-model-config |
| `@liustack/modsearch` | `5.10.3` | `modsearch` | https://github.com/liustack/modsearch |
| `ds-harness-remote` | `0.4.14` | `ds-harness-remote` | https://github.com/liguobao/ds-harness-remote |

`dsh-genui` 使用 `0.11.1-preview.2` 线，因为它声明了 0.1.6-alpha 的 peer。extended 与 advanced 框架声明官方 `rightbar` 子槽，并实现 `ctx.layout.openRightbar` / `closeRightbar`。compatibility 模式继续用官方 AppFrame 右栏。原来的 overlay 抽屉已去掉；composer 上的 git 分支条仍以 `desktop-composer-branch` 注入。`dsh-better-sidebar` 占用官方右栏并保留底部工作台，不替换左侧项目/会话栏。

`dsh-models-config-plugin` 不在 npm 上：钉 GitHub commit，并把 `https://github.com/MarvekG/deepseek-harness-model-config.git` 留在 `approvedGitRepositories`。启动器的 `web` 覆盖层设置 `searchProvider: modsearch`，并保留 `fetchProvider: http`。`ds-harness-remote` 复制已发布的两行 Loader：Desktop Host id 在没有 dsh-TUI 时保持启用，`ds-harness-remote-tui` 在 Desktop 上保持停用。

## 更新某一钉定

1. 对照上游 README 和面向 DSH `0.1.6-alpha.1` 的 `peerDependencies` 确认 npm 版本或 GitHub commit。
2. 若 Yarn 报 `YN0016` 隔离，把该包留在 `.yarnrc.yml` 的 `npmPreapprovedPackages`。若报 `YN0080`，把仓库 URL 留在 `approvedGitRepositories`。
3. npm 包运行 `corepack yarn workspace dsh-plugin-desktop add <name>@<version>`；GitHub-only 包用 `add <name>@github:<owner>/<repo>#commit=<sha>`。
4. 保持 `cordis.patch.yml` 里的 Loader `id` 和 `name` 与该包已发布的 `cordis.patch.yml` 一致。复制 `better-sidebar` 的双挂载 `disabled: !!js` 守卫，以及 `ds-harness-remote` 成对的 dsh-TUI 守卫。`web` 覆盖层会整份替换该行 config，因此 `searchProvider: modsearch` 旁边必须保留 `fetchProvider: http`。
5. 改 `src/launcher-preinstall.ts`（`packageName`、Loader `id`、Host 入口文件）。`profile.ts` 和 `scripts/verify-packaged-runtime.ts` 读这份目录。`dsh-models-config-plugin` 发布 `src/index.js`；`@liustack/modsearch` 发布 `dsh/index.js`；`ds-harness-remote` 发布 `dist/index.js`。
6. 把新版本或 commit 记进这张表。

不要为这些钉定改 `deepseek-harness/` 里的文件。不要把 submodule 钉定更新和这次桌面预装改动混在同一次提交里。
