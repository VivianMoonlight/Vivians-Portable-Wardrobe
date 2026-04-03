# 主题、语言与移动端 (Theme / Language / Mobile)

本章只讲三件事：怎么换主题、语言怎么决定、手机上能做什么不能做什么。

## 适用场景

- 你想把界面切到浅色/深色/Themed。
- 你想确认为什么界面是英文或中文。
- 你在手机或窄屏上使用 VPW，想知道入口和功能边界。

## 能力速查

| 你要做什么 | 入口 | 结果 |
|---|---|---|
| 切换浅色/深色/Themed | 主面板 `Settings -> Theme Settings` | 主题立即生效，并保存在本地 |
| 使用 Themed 模式 | 同上，点 `Themed mode` | 检测到 Themed BC 时使用其配色；未检测到会回退 |
| 查看语言来源 | 启动时自动 | 当前版本按浏览器语言在 `en/zh` 中自动选择 |
| 在手机上打开 VPW | 悬浮按钮 | 进入移动端壳层（Wardrobe/History/Settings） |

## 操作步骤

### 1) 主题切换

1. 打开 VPW 面板，进入 `Settings` 标签。
2. 在 `Theme Settings` 选择主题：
   - `Light mode`：浅色。
   - `Dark mode`：深色。
   - `Themed mode`：跟随 Themed BC 的颜色体系。
3. 切换后界面立即更新；主题会持久化，重开后保留。

### 2) 语言规则

1. VPW 内置 `en` 与 `zh` 两套语言包。
2. 启动时自动读取浏览器语言主标签（如 `zh-CN -> zh`）。
3. 若不是受支持语言，回退到英文。

说明：当前版本没有独立的“语言切换按钮”，语言主要由浏览器环境决定。

### 3) 移动端入口与使用

1. 屏幕宽度小于移动断点后，VPW 自动进入移动布局。
2. 通过悬浮按钮打开后，你会看到移动主标签：
   - `Wardrobe`
   - `History`
   - `Settings`
3. 在 `Wardrobe/History` 下可切换三个子面板：
   - `Preview`
   - `Wardrobe/History`
   - `Filter`

## 使用边界（重点）

- 移动端不提供 `Studio` 主标签。
- 如果桌面端正在 `Studio`，切到移动布局时会自动回到 `Wardrobe`。
- 移动端保留核心衣柜链路：预览、保存、从 BCX 导入、应用到当前角色。

## 结果预期

- 你可以稳定切换三种主题，并理解 Themed 模式的前提条件。
- 你可以明确语言来源：当前版本自动跟随浏览器语言（en/zh）。
- 你可以在手机上完成衣柜主流程，并清楚 Studio 不在移动端主入口中。

## 常见失败与恢复

### 1) 选了 Themed，但看起来还是默认主题

可能原因：未安装或未启用 Themed BC。

恢复：

1. 先确认 Themed BC 已安装并启用。
2. 回到 `Settings` 重新选择 `Themed mode`。
3. 若仍无变化，先用 `Light/Dark`，排查 Themed BC 状态后再切回。

### 2) 我想手动切语言，但找不到按钮

可能原因：当前版本没有独立语言切换 UI。

恢复：

1. 调整浏览器语言优先级为 `zh` 或 `en`。
2. 刷新页面后重开 VPW。

### 3) 手机上看不到 Studio

可能原因：这是当前移动端设计边界，不是故障。

恢复：

1. 如需 Studio 编辑，请在桌面宽度环境使用。
2. 手机上先完成衣柜管理、预览和应用流程。

## 延伸阅读

- 快速开始: [01-quick-start.md](01-quick-start.md)
- 日常工作流: [02-core-workflows.md](02-core-workflows.md)
- Studio 基础: [03-studio-basics.md](03-studio-basics.md)
- 故障排查: [08-troubleshooting-faq.md](08-troubleshooting-faq.md)
