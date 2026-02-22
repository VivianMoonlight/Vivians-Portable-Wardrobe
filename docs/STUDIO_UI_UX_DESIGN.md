# Studio UI/UX 设计描述文档

## 文档范围
本文件基于 `src/components/Studio/Studio.vue` 及其子组件实现，描述 Studio 的整体交互设计与各模块 UI/UX 职责。

覆盖组件：
- Studio（主容器）
- PreviewWidget
- StackList
- PartListPanel
- PartInspectorPanel
- AssetSelectorPanel
- PalettePanel
- LayerManagerWidget
- HistoryPanel
- SavesManager

---

## 一、Studio 整体 UI/UX 设计

### 1) 设计目标
Studio 的目标是把“外观编辑”拆成可并行处理的几个工作面：
- 左侧看结果（Preview）
- 中间管数据结构（Stack / Part）
- 右侧做属性编辑与替换（Inspector / Asset）
- 可选侧栏承载辅助能力（Palette / Layer / History / Saves）

这种设计适合中高频编辑，强调效率和可控性。

### 2) 布局与空间模型
- 浮窗式工作台：可拖拽、可八方向缩放。
- 自适应视口边界：桌面多栏，移动端切换 Tab。
- 列职责固定：
  - Preview 列：视觉反馈
  - Stack 列：组合管理
  - Part 列：部件与槽位
  - Inspector/Asset 列：参数与替换
  - 可选附加列：Palette、Layer、History、Saves

### 3) 顶部工具栏交互
工具栏按分组组织，降低认知负担：
- Stack 导入导出
- Palette 导入导出
- 面板开关（Palette/Layer/History/Saves）
- 角色导入、应用到目标、导出合并结果
- 自动保存控制（强制保存/清除自动保存）

特点：
- 以 icon-only 为主，配合 `title/aria-label` 提示。
- `active` 表示面板已启用，`disabled` 阻止无效操作。

### 4) 状态反馈与安全性
- 模式反馈：Replace / Multi / Move 使用状态 Chip 显示且可退出。
- 保存反馈：Saving/Saved/Error + 上次保存时间。
- 自动恢复反馈：恢复横幅提示并可关闭。
- 风险操作：删除、清空、覆盖等普遍有确认。

### 5) 视觉系统
- 基于 Design Token（颜色、圆角、阴影、间距）。
- 扁平化主体 + 局部强调色，突出可编辑状态与风险状态。
- `BaseButton`、`StatusChip` 保持交互一致性。

---

## 二、分模块 UI/UX 描述

## 1) PreviewWidget（预览区）
**结构**
- 标题 + 工具按钮（View/Move）+ 刷新按钮
- Canvas 预览区 + 模式提示浮层

**交互**
- View：拖拽平移、滚轮缩放、双击复位
- Move：单层或多层拖动位移
- 拖动更新节流，保证流畅并减少重绘压力

**价值**
- “看图即编辑”，减少参数化心智成本。

## 2) StackList（造型栈列表）
**结构**
- 顶部：新建、复制完整、复制过滤
- 列表项：拖拽手柄、名称/元信息、重命名、删除

**交互**
- 支持拖拽重排（顶部/底部落点反馈）
- 行内重命名（Enter/Blur 提交，Esc 取消）
- 删除采用 armed 二次确认机制

**价值**
- 提升多套组合并行管理效率。

## 3) PartListPanel（部件列表）
**结构**
- 头部：全局可见性、全删
- 控制区：搜索、展开/折叠、显示隐藏组/空槽位
- 主体：按组展示部件与空槽

**交互**
- 组级/部件级显示切换
- 部件与空槽均可进入 Replace 流程
- 部件/组/全部删除都支持二次确认

**价值**
- 同时支持精细编辑与组级批处理。

## 4) PartInspectorPanel（属性检查器）
**结构**
- 模式条：Single/Multi、View/Move、作用范围提示
- 内容：核心属性、图层编辑、高级属性折叠区

**交互**
- 支持单选/多选模式切换
- 多选时进入批量编辑语义
- 键盘快捷：`Ctrl/Cmd+A`、`Ctrl/Cmd+D`、`Esc`

**价值**
- 将资产语义和图层属性统一在同一编辑上下文。

## 5) AssetSelectorPanel（资产替换）
**结构**
- 搜索、视图切换（列表/卡片）、刷新
- 候选资产列表（含缩略图）

**交互**
- 仅 Replace 模式可用
- 悬停预览（不提交）+ 点击应用（提交）
- 缩略图按 DPR 处理，保证清晰度

**价值**
- 先试后用，降低替换风险。

## 6) PalettePanel（颜色面板）
**结构**
- 顶部模式条（浏览/编辑标签）
- Picker + 快捷操作
- Saved Colors 与 Tags 两个区块

**交互**
- Picker 在“编辑标签”与“编辑当前目标”两种模式间切换
- 标签可重命名、删除；保存色可删除、清空
- 关键删除动作支持 Undo Toast

**价值**
- 兼顾即时上色与可复用色彩语义管理。

## 7) LayerManagerWidget（图层优先级）
**结构**
- 按优先级展示图层，可按 part+priority 聚合折叠

**交互**
- 拖拽调整优先级，支持 top/middle/bottom 落点
- 锁定项不可拖动
- 更新采用节流，减少性能抖动

**价值**
- 将隐式图层顺序可视化并可操作化。

## 8) HistoryPanel（历史时间线）
**结构**
- 清空按钮 + Undo/Redo 统计 + 时间线节点

**交互**
- 点击节点可跳转到目标状态
- 自动滚动到 current 节点
- 支持相对时间文案

**价值**
- 提供强可回溯编辑安全网。

## 9) SavesManager（存档管理）
**结构**
- 顶部标题与关闭
- 工具条：新建存档 + 存储占用
- 列表：加载/重命名/删除

**交互**
- 自动存档优先显示
- 加载/删除前确认
- 当前存档有显著视觉标记

**价值**
- 与 History 形成“细粒度回退 + 里程碑存档”双保险。

---

## 三、端到端体验路径
典型路径：
1. 在 StackList 选择/创建栈
2. 在 PartList 选部件或空槽进入替换
3. 在 AssetSelector 悬停预览并应用
4. 在 Inspector 精修属性和图层
5. 用 Palette 统一颜色语义
6. 必要时通过 LayerManager 调层级
7. 通过 History 回退、通过 SavesManager 存档
8. 最终应用到目标角色或导出

该流程形成“探索 → 提交 → 精修 → 回溯保障”的完整闭环。