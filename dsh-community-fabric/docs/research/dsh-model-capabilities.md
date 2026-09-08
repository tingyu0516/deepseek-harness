# 研究：DSH 模型思考强度、多模态识别与社区插件

Status: Source study, 2026-08-17. 本文只记录基于仓库源码、官方文档和公开 GitHub 一手资料的调查结果；不修改产品代码，也不为第三方插件提供安全、质量或兼容性背书。

## 1. 结论摘要

1. 调整思考强度有两层入口：用户通过模型选择器提交当前会话的 `reasoningEffort`；部署者可在提供方或模型配置中设置默认值。DeepSeek 官方适配器支持 `off`、`low`、`high`、`max`，其配置默认是 `high`，但请求显式值优先。pi-ai 适配器把第三方模型声明的档位作为不透明 ID 暴露给 UI，并在发送前拒绝模型未声明的档位。
2. “模型本身支持图片”不等于 DSH 当前路由已经声明图片输入。手工添加模型没有可查询的能力目录，默认按 `[text]` 处理；图片会在网络请求前被能力检查拒绝。自定义提供方需在 `$DSH_HOME/settings.yaml` 的模型 `input: [text, image]`，或在未被目录描述的模型上使用路由级 `defaultInput: [text, image]`。DeepSeek 自有 `chat-completions` 路由在当前文档中是纯文本路由，不能靠该配置把图片能力“变出来”。
3. DSH Desktop/Community Market 提供发现、预览和受控安装社区插件的入口；仓库明确列出 1024Store 与 dshfind 等可选目录源。市场列表是远程不可信元数据，安装前仍由 Host 独立核验 npm、仓库、运行时、生命周期脚本、DSH bundle 和 Profile；插件以本地代码权限运行。
4. 社区确有直接针对本问题的插件/项目，例如 [dsh-plugin-effort-declare](https://github.com/zimodzh/dsh-plugin-effort-declare)、[dsh-plugin-model-capability](https://github.com/yuioi666/dsh-plugin-model-capability)、[dsh-better-reasoning-effort](https://github.com/HaoyueQin/dsh-better-reasoning-effort)，以及改变思考展示/引导的 [dsh-reasoning-cn](https://github.com/William123666/dsh-reasoning-cn)。这些是第三方项目，不应视为官方支持或安全审查结果；使用前应检查代码、版本、权限和与当前 DSH rc 的兼容性。

## 2. 如何调整思考强度

### 2.1 DeepSeek 官方提供方

官方用户指南把提供方配置放在 **Settings → Models**；模型选择会成为新会话的默认模型，已发送请求的会话继续使用其日志记录的模型。对应仓库文档是 [`docs/user/guide/providers.md`](../../deepseek-harness/docs/user/guide/providers.md)。

DeepSeek 适配器的配置参考位于 [`docs/config-catalog.md`](../../deepseek-harness/docs/config-catalog.md#deepseek-aidsh-llm-deepseek)：`thinking` 是部署级开关，`disabled` 会把所有会话请求限制为 `off`；`reasoningEffort` 的可选值是 `off | low | high | max`，默认 `high`。省略 `thinking` 使用提供方默认行为，省略 `reasoningEffort` 使用适配器默认值。官方 DeepSeek API 的思考模式说明见 [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。

实际请求优先级和发送行为由 [`packages/llm/llm-deepseek/src/serialize.ts`](../../deepseek-harness/packages/llm/llm-deepseek/src/serialize.ts) 及其测试覆盖：请求显式 `reasoningEffort` 覆盖 profile 默认值；`off` 被编码为禁用思考，启用档位则发送 `thinking: enabled` 与对应 `reasoning_effort`。部署配置锁定 `thinking: disabled` 时，尝试启用思考会被拒绝，而不是静默改写。

### 2.2 第三方或自定义 OpenAI-compatible 提供方

`dsh-llm-pi-ai` 使用模型的 `reasoningEfforts` 声明建立可选档位。配置字段的说明和解析代码位于 [`packages/llm/llm-pi-ai/README.md`](../../deepseek-harness/packages/llm/llm-pi-ai/README.md)、[`src/catalog.ts`](../../deepseek-harness/packages/llm/llm-pi-ai/src/catalog.ts) 和 [`src/adapter.ts`](../../deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts)。键是 UI 显示的档位，值是实际发送给网关的协议字符串，例如 `max: ultra` 可把 UI 的 `max` 映射为网关需要的 `ultra`。

`adapter.ts` 的 `resolveReasoningLevel()` 会调用 `getSupportedThinkingLevels()`，模型不支持显式档位时在网络 I/O 前抛出 `UNSUPPORTED_REASONING_EFFORT`；它不会自动把档位压低或夹到邻近值。没有 reasoning 元数据的手工模型不公开推理控件，因为把 pi-ai 的单一 `off` 直接显示出来可能只是“省略参数”，无法保证真正关闭提供方自己的默认思考。

网关兼容性也可能让“能调档位”与“请求能成功”分离。pi-ai 根据 provider ID/URL 推断协议；私有网关可能不接受 reasoning 模型使用的 `developer` system role、`max_completion_tokens` 或 `reasoning_effort`。官方用户指南建议在 `$DSH_HOME/settings.yaml` 的 route 或 model 上配置 `compat`，例如 `supportsDeveloperRole: false`、`maxTokensField: max_tokens` 或相应的 `thinkingFormat`。详见 [`docs/user/guide/providers.md`](../../deepseek-harness/docs/user/guide/providers.md#request-compatibility) 和 [`packages/llm/llm-pi-ai/src/adapter.ts`](../../deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts)。

## 3. 为什么多模态模型可能显示“不支持”

### 3.1 DSH 的能力判断是声明式的

模型能力返回结构包含独立的 `inputModalities`；实现中 [`PiAiAdapter.listModels()` 和 `modelInfo()`](../../deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts) 从已解析模型的 `input` 生成该字段。它不是根据模型名称猜测，也不是每次上传图片时向端点探测。

用户指南明确说明：手工录入的模型在端点没有能力发现 API 的情况下按纯文本处理，向它附图会在发送前拒绝。自定义模型需在 `$DSH_HOME/settings.yaml` 写入：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: vision-preview
          input: [text, image]
```

若网关下所有“未被目录描述”的模型都支持图片，可在 route 上设置 `defaultInput: [text, image]`。解析顺序是“模型条目 `input` → 已安装目录条目 → route `defaultInput` → 默认 `[text]`”；目录中已经明确声明的模型不会被较窄的 route 默认值剥除。相关规则、空列表语义和错误情形见 [`docs/user/guide/providers.md`](../../deepseek-harness/docs/user/guide/providers.md#image-input) 与 [`packages/llm/llm-pi-ai/README.md`](../../deepseek-harness/packages/llm/llm-pi-ai/README.md)。

### 3.2 UI 显示与端点真实能力是两件事

`input`/`defaultInput` 是操作者对端点能力的声明，不是远程验证。声明图片能力但端点实际不接受图片时，请求仍会由提供方拒绝；此时应移除授予该能力的 `image`，并开启新会话，因为附件已进入会话日志，原请求可能重复尝试。反过来，端点实际支持图片但目录或手工配置没有声明时，DSH 会在发送前拒绝，以避免把不符合已知模型能力的输入送入网络。

这也解释了“同一个多模态模型在别的软件可用、在 DSH 显示不支持”：软件使用的 provider/model 记录不同，或者模型目录没有覆盖该自定义 ID；DSH 的安全选择是未知即纯文本，而不是依据名称、宣传页面或一次不可靠探测自动放行。MCP 图片处理也再次检查精确调用路由是否声明 `image`，见 [`packages/mcp/mcp-client/src/tools.ts`](../../deepseek-harness/packages/mcp/mcp-client/src/tools.ts)。

## 4. 社区插件与发现渠道

### 4.1 仓库内的发现与安装机制

[`dsh-community-market/README.md`](../../dsh-community-market/README.md) 说明 Desktop 的 **Settings > Plugins > Plugin market** 可发现、预览、管理和移除社区 npm 插件。可添加的目录源必须符合 published catalog manifest 和 `/v1/plugins` provider schema；仓库当前记录的合作源包括 [DSH 1024Store](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) 与 [dshfind](https://dshfind.com)。目录成员资格不等于已安装或已审查。

市场的安装检查是 fail-closed：要求精确稳定 npm 版本、规范仓库和 provider 的 `repository_backlink` 等证据，并由 Host 在预览和执行时分别复核 npm、integrity、运行时、生命周期脚本、DSH bundle 和活动 Profile。README 同时明确说，远程目录数据不可信，已安装插件以用户本地权限运行；因此市场解决的是发现和受控安装，不是第三方代码安全审计。

### 4.2 与本问题直接相关的公开项目

- [zimodzh/dsh-plugin-effort-declare](https://github.com/zimodzh/dsh-plugin-effort-declare)：为手工 OpenAI-compatible 模型补充推理档位声明，直接对应“第三方模型没有思考强度选项”的场景。
- [yuioi666/dsh-plugin-model-capability](https://github.com/yuioi666/dsh-plugin-model-capability)：声明/管理 thinking levels、context window、output caps、input modalities 和网关兼容预设，覆盖思考与图片能力两个问题。
- [HaoyueQin/dsh-better-reasoning-effort](https://github.com/HaoyueQin/dsh-better-reasoning-effort)：在官方 Models 页面卡片中编辑第三方模型的 per-model reasoning effort。
- [William123666/dsh-reasoning-cn](https://github.com/William123666/dsh-reasoning-cn)：中文思考引导/展示方向的非官方插件；它不等同于为提供方声明真实 reasoning API 能力。
- [karoc/dsh-model-reasoning](https://github.com/karoc/dsh-model-reasoning)：另一个围绕模型 reasoning 选择/声明的社区项目，安装前需自行核对当前仓库状态与兼容性。
- [nlqh7/dsh-vision-router](https://github.com/nlqh7/dsh-vision-router)：把聊天图片路由给用户配置的视觉模型，属于“替代性视觉路由”，不是把原文本模型的真实输入能力改成多模态。
- [Junkrat9527/dsh-autovision](https://github.com/Junkrat9527/dsh-autovision)：在 composer 粘贴图片后交给配置的多模态模型处理，同样属于额外路由/转述方案。
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 和 [DSH 1024Store catalog](https://github.com/imsai-sh/awesome-deepseek-harness-plugins)：社区目录/索引，可用于继续检索，但条目本身不是兼容性或安全结论。

以上项目的仓库 README、代码、发布版本和权限应在安装前逐项核对。尤其要确认它们针对的 DSH 版本、是否同时提供 Host/Client face、是否依赖内部 API，以及是否会覆盖官方 Models/UI 插槽；同一功能的重复插件可能造成 slot 冲突或配置覆盖。

## 5. 关键源码与官方资料索引

| 主题 | 仓库位置 | 一手来源 |
| --- | --- | --- |
| DeepSeek 思考配置默认与开关 | [`docs/config-catalog.md`](../../deepseek-harness/docs/config-catalog.md#deepseek-aidsh-llm-deepseek) | [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) |
| 用户配置 provider/model、图片声明、compat | [`docs/user/guide/providers.md`](../../deepseek-harness/docs/user/guide/providers.md) | [DeepSeek API Docs](https://api-docs.deepseek.com/) |
| reasoning effort 解析、能力暴露、请求前拒绝 | [`packages/llm/llm-pi-ai/src/adapter.ts`](../../deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts)、[`src/catalog.ts`](../../deepseek-harness/packages/llm/llm-pi-ai/src/catalog.ts) | [DeepSeek Harness source](https://github.com/deepseek-ai/deepseek-harness) |
| 图片准入的精确模型检查 | [`packages/mcp/mcp-client/src/tools.ts`](../../deepseek-harness/packages/mcp/mcp-client/src/tools.ts) | [DeepSeek Harness source](https://github.com/deepseek-ai/deepseek-harness) |
| 社区插件市场、合作源与安全限制 | [`dsh-community-market/README.md`](../../dsh-community-market/README.md) | [DSH Community Market](https://github.com/DeepSeek-Harness-Desktop/DeepSeek-Harness-Desktop) |

## 6. 操作建议

先确认当前会话使用的 provider ID、model ID 和已解析的 `inputModalities`/reasoning efforts；再按提供方类型修改设置。对 DeepSeek 官方路由，优先使用 Models 页面和 `reasoningEffort`；对自定义网关，先补齐准确的 `input` 与 `reasoningEfforts`，再根据网关错误配置 `compat`。不要只改 UI 文案或模型名称来“解锁”图片，也不要把第三方插件的声明当作端点能力证明。
