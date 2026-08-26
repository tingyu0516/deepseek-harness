# 角色主题

这里有两套可直接使用的暗色主题 CSS，并且已经接入项目 `ui-theme` 主题系统：

| 文件 | 主题 | 设计关键词 |
|---|---|---|
| `hutao.css` | 胡桃 · 往生堂 | 深檀木、梅红、鎏金、幽魂青 |
| `furina.css` | 芙宁娜 · 水镜歌剧院 | 深海蓝、水光青、珍珠白、歌剧金 |

## 预览

直接用浏览器打开 `preview.html` 即可看到两套主题的实际效果：

```bash
start themes/preview.html
```

## 项目内使用

两个主题已经注册到 `packages/client/ui-theme`，主题 ID 为：

- `hutao`：胡桃
- `furina`：芙宁娜

在客户端代码里可以这样切换：

```ts
ctx.theme.setTheme('hutao')
ctx.theme.setTheme('furina')
```

设置页的“外观”里也会出现这两个主题选项，并且会作为内置主题持久化保存，刷新后仍然保留。

## 独立 CSS 使用

如果只是想单独使用 CSS，也可以在 HTML 中引入对应 CSS，然后把 `theme-hutao` 或 `theme-furina` 类放到根节点上：

```html
<link rel="stylesheet" href="./hutao.css" />
<link rel="stylesheet" href="./furina.css" />

<div class="theme-hutao">
  <!-- 胡桃主题内容 -->
</div>

<div class="theme-furina">
  <!-- 芙宁娜主题内容 -->
</div>
```

也可以挂到 `body` 或 `html` 上做全局切换：

```js
document.documentElement.className = 'theme-furina'
```

## 变量速查

两套主题都提供以下 CSS 变量：

- `--bg`：主背景
- `--bg-image`：角色背景图
- `--bg-overlay`：背景压暗/渐变遮罩
- `--bg-soft`：柔和背景
- `--surface`：卡片 / 面板背景
- `--surface-hover`：悬浮背景
- `--border`：边框
- `--text`：主文字
- `--text-muted`：次要文字
- `--primary`：主色 / 品牌色
- `--primary-hover`：主色悬浮
- `--primary-soft`：主色柔光背景
- `--accent`：强调色
- `--danger` / `--success`：状态色
- `--shadow` / `--radius`：阴影与圆角
- `--font-display`：展示字体
