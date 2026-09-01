# dsh-plugin-pet-core

DSH Desktop 角色桌宠插件的共享引擎。除角色本身外，桌宠所需的一切都由它提供：

- `createPetPlugin()` —— Cordis Host 插件工厂：以 `desktopRuntime` 服务为门控，
  注册实时生效的设置项、贡献托盘菜单；在普通（非桌面版）DSH 启动中完全静默。
- `PetWindowController` —— 透明、无边框、始终置顶窗口的生命周期管理：位置
  持久化、Host→页面事件推送，以及沿工作区的定期漫步。窗口加入所有工作区
  （在全屏应用上也可见），macOS 切换桌面或全屏 Space 时桌宠跟随，
  不会留在原桌面。
- `PetActivityTracker` —— 把用户发起的会话回合与后台任务映射为桌宠状态
  （`work` / `cheer` / `sad`），过滤规则与桌面通知行一致。
- `pet.html` —— 沙箱渲染页：零依赖的气泡/表情状态机，通过
  `window.__dshPet.boot()/dispatch()` 驱动；角色本体完全交给 Live2D 渲染器，
  由 `PetWindowController` 在页面加载后自动注入 Cubism Core 与官方 Cubism Framework 查看器。

角色插件（如 `dsh-plugin-pet-hutao` 与 `dsh-plugin-pet-furina`）依赖本包，
附带经严格校验的 `assets/character.json`（配色、台词与必填的 `live2d`
模型声明），并通过单行 `dsh.bundle.patch` 声明桌面 profile 的 Loader 行。
角色插件的 `assets/live2d/` 下必须放置可解析的 `.model3.json` 模型与
`vendor/live2dcubismcore.min.js`；资产缺失时桌宠窗口不会打开并在日志中说明。

本包是库：自身不声明任何可加载的 bundle，也不分发任何 Live2D 模型或
Cubism Core 二进制。启用 Live2D 渲染的资源放置方式、目录契约与许可证
义务见 [LIVE2D.md](./LIVE2D.md)。

## 许可证

MIT © Anywhere Labs
