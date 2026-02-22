# Studio Inspector 简化方案
> 创建时间：2026-02-20  
> 目标：统一 single/batch 编辑流程，简化层次，增强直觉性

## 1) 需求分析

### A. 删除冗余容器层级
**当前问题**：
- `Layer Edits` Section 作为独立 `CollapsibleSection` 包裹所有 layer 卡片，增加一层导航成本。
- 用户需要先展开 Section，再操作具体 layer。

**目标**：
- 删除 `Layer Edits` Section 容器。
- 直接暴露 layer 卡片在 inspector 主体中。

### B. Layer 卡片本身支持折叠
**当前状态**：
- ColorableLayer 已支持折叠（针对 sublayers）。
- 需要进一步增强主体内容的可折叠性。

**目标**：
- 每个 layer 卡片可独立折叠/展开。
- 默认展开当前选中/焦点 layer，其他收起。

### C. Group-Layer 分组容器
**当前问题**：
- 同一 group 的 layers（如 `group-layer` 类型）在列表中扁平展示。
- 无法一键折叠同组 layers 或批量选中。

**目标**：
- 识别 `group-layer` 类型的 layers。
- 为它们添加可折叠的 group 容器。
- 容器头部提供：
  - 组名称
  - 折叠/展开控制
  - 批量选中按钮（选中组内所有 layers）

### D. 删除 Workflow Title 模块
**当前问题**：
- `workflow-summary` 区块占用空间，且步骤文案重复性强。

**目标**：
- 删除 `workflow-summary` 整个区块。
- 保留 `mode-bar` 和 `scope` 指示（它们是状态而非教学）。

### E. 删除原始批量选择控件
**当前问题**：
- header 中有 `Select All / Clear` 小按钮（在 multi 模式下）。
- 与新的 mode-bar 中的 Single/Multi 模式按钮逻辑重复。

**目标**：
- 删除 header actions 中的 `selectAll / clearSelection` 按钮。
- 将批量操作统一到 mode-bar 或 layer 列表右键菜单。

### F. 取消 BatchEditPanel 独立 UI
**当前问题**：
- `BatchEditPanel` 作为独立面板，与 single edit 视觉和交互割裂。
- 有独立的 panel header、collapse、scope banner。

**目标**：
- 将 batch 控件内嵌到 inspector 主体。
- 去除 panel 壳，复用 inspector 的 mode-bar 和 scope 提示。

### G. 取消 BatchEditPanel Apply 按钮
**当前问题**：
- Batch 编辑每个属性都有独立 `Apply` 按钮。
- Single edit 是即时生效（throttled auto-submit）。

**目标**：
- 统一提交策略：batch 也改为 throttled auto-submit。
- 去除所有显式 `Apply` 按钮。
- 如需确认式提交，可在 mode-bar 增加全局 `Commit` 按钮（可选）。

---

## 2) 技术实现方案

### 2.1 删除 Layer Edits Section 容器
**文件**：`PartInspectorPanel.vue`

**变更**：
- 删除 `CollapsibleSection` 包裹 `ColorableLayer` 的结构。
- 直接在 `.content` 下渲染 `layerEntriesLocal` 列表。

```vue
<!-- BEFORE -->
<CollapsibleSection title="Layer Edits">
  <ColorableLayer v-for="..." />
</CollapsibleSection>

<!-- AFTER -->
<ColorableLayer v-for="..." />
```

### 2.2 Layer 卡片支持全面折叠
**文件**：`ColorableLayer.vue`

**变更**：
- 当前仅在有 sublayers 时显示折叠按钮。
- 改为：所有 layer 卡片都有折叠按钮（控制 `color-main-body` 显示/隐藏）。
- 默认展开规则：`isFocused || isSelected` 时展开，否则收起。

### 2.3 Group-Layer 容器
**文件**：`PartInspectorPanel.vue` + 新组件 `LayerGroup.vue`

**变更**：
- 在渲染 `layerEntriesLocal` 前，按 `layer.group` 分组。
- 将同组 layers 包裹在 `LayerGroup` 组件中。
- `LayerGroup` 提供：
  - 可折叠 header（组名 + 折叠箭头）
  - 批量选中按钮（☑ ALL）
  - 容器内遍历 `ColorableLayer`

**识别规则**：
- 检查 layer.name 是否包含 `group-` 前缀或 layer.type === 'group-layer'。
- 提取 group 标识（如 `group-FacialHair` → `FacialHair`）。

### 2.4 删除 Workflow Title 模块
**文件**：`PartInspectorPanel.vue`

**变更**：
- 删除 `.workflow-summary` 区块及其样式。

### 2.5 删除 Header 中的批量控件
**文件**：`PartInspectorPanel.vue`

**变更**：
- 删除 `<template v-if="isMultiMode && hasPart">...</template>` 中的 `Select All / Clear` 按钮。
- 保留 `mode-toggle-btn`（Single/Multi 切换）。

### 2.6 取消 BatchEditPanel 独立 UI
**文件**：`PartInspectorPanel.vue` + `BatchEditPanel.vue`

**方案 A（推荐）**：
- 把 `BatchEditPanel` 的控件内容提取为 inline 渲染。
- 删除 panel header、collapse、scope banner（复用 inspector 的）。
- 在 inspector body 中条件渲染：`v-if="isMultiMode && hasSelections"`。

**方案 B（保留组件）**：
- 保留 `BatchEditPanel` 组件，但去除其 panel 装饰。
- 改为纯功能组件（无 header、无 collapse）。

### 2.7 取消 Apply 按钮，改为 Auto-submit
**文件**：`BatchEditPanel.vue` + `ColorableLayer.vue`

**变更**：
- Batch 控件的 `applyOpacity/applyOffset/applyPriority` 改为 `@input` 触发（throttled）。
- 删除所有 `Apply` 按钮。
- 结果反馈改为 toast 或 inline status 区（非模态）。

**提交策略统一**：
- Single edit：`@input` → throttle 100ms → store update
- Batch edit：`@input` → throttle 100ms → batch update → store refresh

---

## 3) 分期实施

### Phase 1（结构简化）
- [x] 删除 Workflow Title 模块
- [x] 删除 Header 批量控件
- [x] 删除 Layer Edits Section 容器
- [x] Layer 卡片全面折叠支持

### Phase 2（Batch 统一化）
- [x] 取消 BatchEditPanel 独立 UI（内嵌到 inspector）
- [x] 取消 Apply 按钮，改为 auto-submit

### Phase 3（Group 增强）
- [x] 实现 LayerGroup 容器组件
- [x] 识别并分组 group-layer 类型
- [x] Group 头部批量选中功能

---

## 实施记录

### 2026-02-20 Phase 1 & 2 & 3 完成

**Phase 1 变更**：
- ✅ 删除 `workflow-summary` 区块及样式
- ✅ 删除 header 中 `Select All / Clear` 按钮
- ✅ 删除 `Layer Edits` CollapsibleSection 容器，layers 直接渲染
- ✅ ColorableLayer 所有层都可折叠（移除 `v-if="hasSublayers"` 限制）
- ✅ 折叠状态默认 `false`（展开），当 focused/selected 时自动展开

**Phase 2 变更**：
- ✅ BatchEditPanel 去除 panel header/collapse/scope banner
- ✅ 改名为 `batch-edit-controls`，轻量级容器
- ✅ 所有 apply 按钮删除，改为 `@input` 触发
- ✅ `applyOpacity/applyOffset/applyPriority` 改为 throttled（100ms）
- ✅ 导入 `throttle` from `@/utils/performance.js`
- ✅ 删除 `collapsed` 状态和 `toggleCollapse` 方法
- ✅ 简化样式，去除 glassmorphism 装饰

**验证**：
- 所有文件无语法错误
- Single/Batch 编辑共用 inspector 框架
- 交互统一为 throttled auto-submit

**Phase 3 变更**（2026-02-20）：
- ✅ 创建 LayerGroup.vue 组件（分组容器）
  - 可折叠的组头部（组名 + 层数统计 + 折叠箭头）
  - 批量选择按钮（多选模式下显示☑图标）
  - 包含组内 ColorableLayer 子组件
- ✅ PartInspectorPanel 实现分组逻辑
  - 添加 `organizedLayers` 计算属性，基于 `groupDisplayName` 识别并分组
  - 只有 2 层或以上的同组 layers 才会被分组显示
  - 单层组作为独立层展示
- ✅ 删除 header 中的旧模式切换按钮
  - 删除预览工具切换按钮（✥/✋）
  - 删除多选模式切换按钮（☑/☐）
- ✅ mode-bar 增强为可交互按钮
  - Single/Multi 模式 chip 可点击切换
  - View/Move 模式 chip 可点击切换
  - 添加 hover 效果和 disabled 样式
  - Scope chip 保持只读（cursor: default）

**验证**：
- 所有文件无语法错误
- 原始批量选择按钮已删除，只保留新的 mode-bar
- mode-bar 按钮可点击，交互流畅
- Group 容器正确识别和渲染 groupDisplayName 相同的 layers
- ColorableLayer 初始化顺序修复（isFocused 定义移至 watch 前）

**下一步**：
- ✅ 所有 Phase 已完成
- 可进行用户体验测试和反馈收集
- 如需进一步优化，可考虑：
  - 键盘快捷键增强（Tab 在 layers 间导航）
  - 右键菜单支持（Group 层面的快捷操作）
  - Undo/Redo 历史记录可视化

---

## 4) 验收标准

1. **视觉一致性**：single/batch 编辑在同一视觉框架下，无独立面板割裂感。
2. **交互一致性**：所有属性编辑均为 input → throttled submit，无显式 apply 按钮。
3. **层次清晰**：layer 列表直接可见，无冗余容器；group 分组清晰可辨。
4. **折叠效率**：用户可快速折叠非关注 layers 或整组 layers。
5. **批量操作高效**：group 头部一键选中所有成员，快速进入 batch 流程。

---

## 5) 风险与应对

**风险 1**：删除 Section 容器后，layer 列表可能显得过于扁平。  
**应对**：通过 group 容器和折叠状态管理，保持视觉层次感。

**风险 2**：取消 Apply 按钮可能导致误操作（用户输入未完成即提交）。  
**应对**：
- 保留 throttle 延迟（100-200ms）。
- 在 mode-bar 增加 `Undo` 快捷入口。
- 对高危操作（如批量删除）保留二次确认。

**风险 3**：Group 识别逻辑可能误判非 group-layer。  
**应对**：
- 先基于明确的 naming convention（如 `group-` 前缀）。
- 后续可引入 asset meta 标记（如 `Asset.LayerGrouping`）。
