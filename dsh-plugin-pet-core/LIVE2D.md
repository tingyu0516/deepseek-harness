# 桌宠 Live2D 渲染

`dsh-plugin-pet-core` 的唯一角色渲染方式就是 Live2D。共享引擎在页面加载后
注入部署者本机放置的 Cubism Core，以及官方 Cubism SDK for Web 的 Framework
查看器；`character.json` 必须声明 `live2d` 模型，资产无法解析时桌宠窗口
**不会打开**，并在插件日志中给出原因。

## 目录契约

每个角色插件拥有自己的资源目录：

```
<plugin>/assets/live2d/
  pet.model3.json            # 由 character.json 的 live2d.model 声明
  *.moc3 / *.png ...         # 模型引用的其余文件
  vendor/live2dcubismcore.min.js   # live2d.core 的默认位置
```

- `character.json` 中的 `live2d.model` 必须是相对资产名（如
  `pet.model3.json`），校验器拒绝绝对路径与 `..` 穿越。
- 打开窗口前，主进程要求 `.model3.json` 与 Core 脚本同时存在；缺失即不开窗。

## 渲染页契约

`pet.html` 不自行加载任何脚本或模型文件。共享引擎的
`PetWindowController` 在页面加载完成后、注入 boot 之前，会自动完成：

1. 通过 `executeJavaScript` 评估 `assets/live2d/vendor/` 下的 Cubism Core；
2. 注入官方 Framework 查看器（`lib/pet-live2d-viewer.js`）和整份内存资产表
   （含模型文件与 Cubism WebGL 着色器）；
3. boot payload 只携带 `live2d.model`。页面据此 `attach` WebGL 画布。
4. 注入全程有超时；渲染页的 `attach` 失败会把具体原因通过
   `dsh-pet-<id>://live2dfailed` 回传主进程日志。

查看器按 Cubism SDK for Web 示例的方式加载 `model3.json`：Idle 组循环待机，
Expressions 用官方 `setExpression` / `setRandomExpression`，`physics3.json`
由 Framework 运行。单击走模型 `HitAreas`（若带 `Motion` 字段则播对应组），
没有命中区域时随机表情并尝试 `Pat` / `TapBody`。双击播 `Special` 组。
不播放模型自带的音频。拖动仍用 `movementX` 加主进程钉死的窗口尺寸。

## 许可证义务（部署者承担）

1. **Cubism Core**：按 Live2D 官方《Live2D Proprietary Software License》
   或相关 SDK 协议自行获取、接受并保留其条款文本。Core 只作为本地 vendor
   文件使用，本仓库及其 npm 包不含、也不随包分发 Core。
2. **Cubism Framework**：随本包 vendored 的 `vendor/cubism-framework/` 与
   `vendor/cubism-shaders/` 受《Live2D Open Software License》约束，见
   [CUBISM-FRAMEWORK-LICENSE.md](./vendor/CUBISM-FRAMEWORK-LICENSE.md)。
3. **模型文件**：只放置你能确认再分发/使用授权的模型。推荐顺序：
   - 明确开放许可证的独立仓库（核对 LICENSE 后连同署名一并保留）；
   - Live2D 官方示例模型集（受《Free Material License》约束，仅随宿主
     应用使用）；
   - “免费模型合集”类仓库默认**不可用**，除非逐个模型核实了原始授权。
4. 在同目录放置一份 `LICENSE-MODEL.md`，记录来源、作者、许可证与获取日期。
5. 个人非商业使用不免除上述出处要求；角色名（胡桃/芙宁娜等）与第三方 IP
   相关的商业化使用另有额外限制，不在本插件的支持范围。

## 排查

- 桌宠不出现：查插件日志里的 `live2d assets missing ... pet window will not
  open`——目录未创建、文件名与 `live2d.model` 不一致、或缺少 Core 脚本。
- 窗口出现但空白：查 `live2d injection failed (...)` 或
  `live2d attach failed in renderer: ...` 两行日志。
- 完全退出桌面后再开：改查看器后，旧进程仍会画旧页。
