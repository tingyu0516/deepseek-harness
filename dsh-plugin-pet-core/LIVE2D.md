# 桌宠 Live2D 渲染

`dsh-plugin-pet-core` 的唯一角色渲染方式就是 Live2D。共享引擎在页面加载后
自动注入部署者本机放置的 Cubism Core 与渲染胶水；`character.json` 必须声明
`live2d` 模型，资产无法解析时桌宠窗口**不会打开**，并在插件日志中给出原因
（早期版本的内联 SVG 渲染器已彻底移除）。

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
- 打开窗口前，主进程要求 `.model3.json` 与 Core 脚本同时存在并把两者的
  `file://` URL 注入 boot payload；缺失即不开窗。

## 渲染页契约

`pet.html` 不自行加载任何脚本或模型文件。共享引擎的
`PetWindowController` 在页面加载完成后、注入 boot 之前，会自动完成：

1. 通过 `executeJavaScript` 评估 `assets/live2d/vendor/` 下的 Cubism Core；
2. 注入内置渲染胶水（`PET_LIVE2D_RUNTIME_GLUE`）和整份内存资产表；
3. boot payload 只携带 `live2d.model`（模型在资产表中的键）。页面据此
   `attach` WebGL 画布；缺少 `model` 时跳过，不再要求 `core` URL。
4. 注入全程有超时；渲染页的 `attach` 失败会把具体原因通过
   `dsh-pet-<id>://live2dfailed` 回传主进程日志。

v1 已知边界：裁剪蒙版按官方编码写入离屏缓冲后取样；正片叠底/加法使用官方 WebGL 因子。有 Idle 组时循环播放待机动作，其它动作播完回 Idle。循环待机的时长不延长单击表情；表情在数秒后撤掉。模型声明的 Expressions 在单击时随机叠加（跳过牌子与 `walkSwitch`）。`walkSwitch` 只在漫步状态揭示走路部件。模型 `HitAreas` 把单击路由到对应动作组（胡桃的吐舌头/脸红/好奇/阴险/胡桃摇）；重叠时取更小的网格，点空或点在角色外不触发。无 HitArea 的模型点在网格上视为 `body`（芙宁娜随机表情）。点选坐标取画布元素自身的显示框，与等比缩放后的模型对齐。右键摊手（无该动作时回退到 Tap 组）。双击对声明了 `outfit` 的角色调用 `toggleForm`（芙宁娜默认白色/芒，再双击播变荒，再双击播变芒），否则播 Special。`outfit` 每帧把形态参数钉在闩锁值上（芙宁娜 `Param4`：1 白 / 0 黑），切形态动作播放期间改由曲线驱动；不靠藏白衣摆。动作求值之后、`model.update()` 之前运行 `physics3.json` 摆锤（裙摆、头发、布料）。不播放模型自带的音频。拖动用 `movementX` 加主进程钉死的窗口尺寸，避免 Windows DPI 把窗口越拖越大。

## 许可证义务（部署者承担）

1. **Cubism Core**：按 Live2D 官方《Live2D Proprietary Software License》
   或相关 SDK 协议自行获取、接受并保留其条款文本。Core 只作为本地 vendor
   文件使用，本仓库及其 npm 包不含、也不随包分发 Core。
2. **模型文件**：只放置你能确认再分发/使用授权的模型。推荐顺序：
   - 明确开放许可证的独立仓库（核对 LICENSE 后连同署名一并保留）；
   - Live2D 官方示例模型集（受《Free Material License》约束，仅随宿主
     应用使用）；
   - “免费模型合集”类仓库默认**不可用**，除非逐个模型核实了原始授权。
3. 在同目录放置一份 `LICENSE-MODEL.md`，记录来源、作者、许可证与获取日期。
4. 个人非商业使用不免除上述出处要求；角色名（胡桃/芙宁娜等）与第三方 IP
   相关的商业化使用另有额外限制，不在本插件的支持范围。

## 排查

- 桌宠不出现：查插件日志里的 `live2d assets missing ... pet window will not
  open`——目录未创建、文件名与 `live2d.model` 不一致、或缺少 Core 脚本。
- 窗口出现但空白：查 `live2d injection failed (...)` 或
  `live2d attach failed in renderer: ...` 两行日志，原因是注入阶段或模型
  加载阶段的第一个失败点。
- 状态不映射：动作分组按 `STATE_GROUPS` 别名表匹配；未映射的状态回退到
  模型 `Idle` 组（没有 Idle 时才只保留呼吸）。
