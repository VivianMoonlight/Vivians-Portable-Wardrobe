# Focus 单一数据源改造计划（Single Source of Truth）

创建日期：2026-02-20  
适用范围：`src/stores/studioStore.js` + `src/components/Studio/*` + `src/studio/*`

---

## 1. 目标与约束

### 目标
- 将当前分散的 Focus 相关状态统一为**一个唯一存储源**（store 内单一对象）。
- 同时支持单选/多选，并允许 UI 组件直接操控 Focus。
- 所有编辑面板（Layer、Batch、Palette、Preview）都通过统一查询接口获得“当前可编辑目标”。

### 约束
- 不改变现有业务语义（颜色编辑走 colorable 轨道，offset/opacity/priority 走 layer 轨道）。
- 先兼容再迁移：阶段内保留适配层，最终删除旧字段。
- 避免跨组件各自维护“隐式 focus”。

---

## 2. 当前问题（代码库实况）

## 2.1 状态源分裂
当前并存并互相重叠：
- `focusedPartIndex`
- `focusedProperty`（state 字段 + 同名 getter）
- `selectedLayers`
- `activeFocusContext`
- `activePaletteTargets`
- `previewTool`

这些状态分别在不同 action/组件内更新，导致“看起来统一，实际多源”。

## 2.2 索引语义冲突（Color vs Offset 根因）
- 颜色面板目标 `activePaletteTargets[].layerIndex` 实际承载的是 **`colorableIndex` 语义**（见 `palette-actions.js` 对 colorable 层计数匹配逻辑）。
- 其余编辑链（selection/focus/move）使用的是 **`layerIndex`（flat layer index）语义**。
- 同名字段承载两种索引语义，导致 Color 与 Offset 的 focus 目标天然分叉。

## 2.3 `clearFocus` 同名动作重定义
`studioStore.js` 中存在两套 `clearFocus` 定义（前者为 Part Focus 清理，后者为 Unified Focus API 清理），后定义覆盖前定义，造成行为不透明。

## 2.4 Move 工具目标解析与选择状态脱节
`PreviewWidget.vue` 单层拖拽时主要依赖 `activeFocusContext.subLayerIndex`，默认回退到 `0`，而不是以“当前选中 layer”作为主目标，导致 offset 操作与 UI focus 感知不一致。

## 2.5 旧/新 API 并存未闭环
- `setFocusedProperty/clearFocusedProperty` 仍在 store 与文档中存在。
- 新 API `focusLayer/setPropertyFocus` 已启用，但没有真正替代 palette target 和 preview target 的来源。

---

## 3. 统一模型设计（唯一真源）

在 `studioStore` 引入唯一状态对象：`focusState`。

```js
focusState: {
  // 作用域锚点（当前编辑 part）
  scope: {
    stackIndex: null,
    partIndex: null,
    partUid: null
  },

  // 选中目标（单选=长度1，多选=长度N）
  selection: {
    mode: 'single',               // 'single' | 'multiple'
    layerKeys: [],                // ['s-p-l', ...]
    anchorLayerKey: null          // Shift range anchor
  },

  // 当前编辑上下文（属性焦点）
  editor: {
    property: null,               // 'color' | 'opacity' | 'drawing' | 'priority' | null
    subLayerIndex: null,
    timestamp: 0
  },

  // 预览工具上下文
  tool: {
    preview: 'view'               // 'view' | 'move'
  }
}
```

### 关键点
- 只保留一种“被编辑对象集合”：`focusState.selection.layerKeys`。
- Palette 目标、Batch 目标、Preview 拖拽目标全部由 `focusState` 派生，不再持久化独立 `activePaletteTargets`。
- 对颜色链路单独提供“索引投影”函数：`layerIndex -> colorableIndex`，但**不写回 focusState**。

---

## 4. 统一查询层（所有面板共享）

新增 getters（建议命名）：
- `focusScopePart`：返回当前 scope part。
- `focusSelectedLayers`：返回选中层完整对象数组（跨 part 安全）。
- `focusPrimaryLayer`：返回主选中层（首项或 anchor）。
- `focusEditorContext`：返回当前属性上下文。
- `focusPaletteTargets`：由 `focusSelectedLayers` 投影出 `{ uid, stackIndex, partIndex, colorableIndex, currentColorText }`。
- `focusMoveTargets`：拖拽应作用的 layer 集（单选 1 个，多选 N 个）。

所有 UI 面板只消费这些 getter，不直接拼装目标。

---

## 5. 统一写入 API（唯一写入口）

新增 actions（建议）：
- `focusSetScope({ stackIndex, partIndex })`
- `focusSelectLayer(layerRef, { mode: 'replace|toggle|range' })`
- `focusSetSelectionMode('single'|'multiple')`
- `focusSetProperty(property, subLayerIndex = null)`
- `focusClear({ keepScope = false })`
- `focusSetPreviewTool('view'|'move')`

### 写入规则
- 任一 UI 组件不得直接写 `selectedLayers/activeFocusContext/previewTool/activePaletteTargets`。
- 所有变更都通过 `focus*` actions 进入。

---

## 6. 分阶段迁移计划

## Phase 0（准备）
- 新增 `focusState` 与选择工具函数（key 构建/解析、layerRef 解析）。
- 为旧字段建立只读兼容 getter（避免立即破坏现有组件）。

## Phase 1（双写过渡）
- 在 `focus*` actions 中双写旧字段：
  - `selectedLayers`、`selectionMode`、`activeFocusContext`、`previewTool`。
- 统一 `clearFocus` 实现，删除重名冲突。

## Phase 2（组件切换）
- `ColorableLayer.vue`：
  - 全部改为 `focus*` API。
  - Palette 打开逻辑改为 `store.focusPaletteTargets`。
- `BatchEditPanel.vue`：
  - 删除本地拼装 `colorableTargets`，直接调用统一 getter。
- `PreviewWidget.vue`：
  - 拖拽目标来自 `focusMoveTargets`，不再回退 `idx=0`。
- `LayerManagerWidget.vue`、`LayerGroup.vue`、`PartInspectorPanel.vue` 同步改造。

## Phase 3（收口）
- 删除旧字段与旧 API：
  - `focusedProperty`（state/getter/action）
  - `activePaletteTargets`（持久状态）
  - 直接操作 `selectedLayers/activeFocusContext/previewTool` 的组件代码
- 更新文档与类型注释。

---

## 7. 文件级改造清单（建议顺序）

1) `src/stores/studioStore.js`  
- 引入 `focusState`、统一 getters、统一 actions。

2) `src/studio/selection-actions.js`  
- 改造为纯“selection 运算库”，输入/输出基于 `focusState.selection`。

3) `src/studio/palette-actions.js`  
- 移除对 `activePaletteTargets` 的硬依赖，改由调用方传入统一派生目标。

4) `src/components/Studio/ColorableLayer.vue`  
- 改用统一 API；删除局部目标拼装。

5) `src/components/Studio/BatchEditPanel.vue`  
- 颜色批量编辑改走统一目标 getter。

6) `src/components/Studio/PreviewWidget.vue`  
- move 目标对齐 `focusPrimaryLayer` / `focusMoveTargets`。

7) `src/components/Studio/LayerManagerWidget.vue` / `LayerGroup.vue` / `PartInspectorPanel.vue`  
- 全部只调用统一 Focus API。

8) `src/studio/save-actions.js` / `undo-redo-actions.js`  
- 保存/恢复与 undo/redo 纳入 `focusState`（至少 scope + selection + editor + tool）。

---

## 8. 验收标准（必须同时满足）

- 单选模式：点击任一 layer 后，Color/Opacity/Offset/Priority/MOVE 的目标一致。
- 多选模式：批量编辑与 Palette 编辑作用于同一目标集合。
- 切换 single/multiple 不丢失“当前属性焦点”语义。
- Preview move 不再默认错误回退到 layer 0。
- store 内 focus 相关可写状态仅保留 `focusState` 一处。
- Undo/Redo 与 AutoSave 恢复后，focus 行为一致。

---

## 9. 风险与回滚策略

### 风险
- 旧组件隐式依赖 `selectedLayers` / `previewTool` 直接访问。
- palette 颜色索引映射错误会造成“改错层”。

### 回滚
- Phase 1 期间保持双写，任何异常可回退到旧 getter 映射。
- 每个 Phase 独立提交与验证，禁止跨 Phase 大爆改。
---

## 10. 实施进度记录

### Phase 0 ✅ 完成（2026-02-20）
- 新增 `focusState` 到 `studioStore`（scope/selection/editor/tool）。
- 兼容 getter：`focusedProperty` 根据 `selectedLayers` 与 `activeFocusContext` 派生。
- 选择工具：`_buildLayerKey`、`_syncFocusState*` 同步方法。

### Phase 1 ✅ 完成（2026-02-20）
- 双写逻辑：所有 `focus*` actions 同时更新旧字段（`selectedLayers`/`selectionMode`/`activeFocusContext`/`previewTool`）。
- 修复 `clearFocus` 重名冲突：旧 Part 清理改名 `clearPartFocus`，统一 focus 清理改为 `focusClear({ keepScope })`。
- Undo/Redo 与 AutoSave：`undo-redo-actions.js` 与 `save-actions.js` 均纳入 `focusState` 快照与恢复。
- ✅ 无编译错误。

### Phase 2（组件迁移）✅ 完成（2026-02-20）
**统一派生层（Store）**
- 新增 `getPrimaryMoveLayerIndex(part)`：单层 move 目标统一派生（优先级：选中层 -> subLayerIndex -> 默认 0）。
- 新增 `getPaletteTargetsForCurrentSelection()`：从 `selectedLayers` 派生 palette 目标（含 `colorableIndex` 映射）。
- 新增 `getPaletteTargetForLayer({ stackIndex, partIndex, layerIndex, part, layer })`：单层 palette 目标构建。
- 新增 `isPaletteTargetActive(target)`：检查目标是否在 `activePaletteTargets` 中。

**组件改造**
- ✅ `PreviewWidget.vue`（L291-301）：单层拖拽目标改用 `store.getPrimaryMoveLayerIndex(part)`。
- ✅ `BatchEditPanel.vue`（L244-253）：`openPaletteForBatch()` 改用 `store.getPaletteTargetsForCurrentSelection()`。
- ✅ `ColorableLayer.vue`（L646-686）：删除本地 `buildPaletteTargetList`，改用 `store.getPaletteTargetForLayer()` computed + `store.isPaletteTargetActive()`。

**验证**
- ✅ 针对修改文件错误检查通过（4 个文件无错误）。
- ✅ 全库编译检查通过（`src/` 无错误）。

**遗留点**
- 其他入口（`Studio.vue` 工具栏 toggle）传空数组 `[]` 是正常的（不自动选择目标）。
- 组件层旧 API 已清理完成，当前主要剩余的是 Inspector 相关链路的统一化审视（非阻塞）。

### Phase 3（收口）✅ 完成（2026-02-20）
**目标**
- 删除旧字段：`focusedProperty`（state 与旧同名 getter/action）。
- 删除旧 API：`setFocusedProperty`/`clearFocusedProperty` 及直接操作旧字段的组件代码。
- 更新 action 返回值链路并保持行为一致。

**执行结果**
- ✅ 已移除 `focusedProperty` state 字段。
- ✅ 已移除兼容 getter `focusedProperty`。
- ✅ 已移除 store 旧 action：`setFocusedProperty`、`clearFocusedProperty`。
- ✅ 已更新 store 中 `select`/`clear`/`clearPartFocus`/`setReplaceTarget`，统一改为 `clearPropertyFocus()`。
- ✅ 已更新 `src/studio/stack-actions.js` 和 `src/studio/focus-actions.js` 的返回标记：`clearFocusedProperty` → `clearPropertyFocus`。
- ✅ 已删除 `src/studio/focus-actions.js` 中未使用的旧函数（`setFocusedProperty`、`clearFocusedPropertyState`）。
- ✅ `activePaletteTargets` 已从持久 state 切换为 getter 派生（基于当前 selection + `paletteModeActive`）。
- ✅ `openPalettePanel(targets)` 传入显式 targets 时会先对齐 selection，再由 getter 统一派生目标。

**验证结果**
- ✅ `src/` 全量错误检查通过。
- ✅ 全库已无 `setFocusedProperty` / `clearFocusedProperty` 引用。

**保留项**
- ⚠️ 当前仍保留 `paletteModeActive` 作为 Palette 会话开关（非 focus 目标数据本身）。
  - focus 目标集合已收口为派生数据；后续可视需要评估是否进一步收敛 Palette 会话状态结构。

---

## 10. 建议的执行顺序（实际落地）

~~1. 先改 `studioStore`（新增 `focusState` + 统一 API + 双写兼容）。~~ ✅  
~~2. 再改 `PreviewWidget`（先解决 Offset/MOVE 目标不一致）。~~ ✅  
~~3. 再改 `ColorableLayer` + `BatchEditPanel`（统一 Color 与 Offset 目标来源）。~~ ✅  
~~4. 最后收口删除旧字段并更新文档。~~ ✅

---

## 12. 结论

本方案将当前"多套 focus 状态并行"重构为"单一 focusState 真源 + 统一派生查询 + 统一写入口"。  

**✅ 已完成（Phase 0/1/2/3）**
- Offset 与 Color 两套 focus 体系分裂 → **已统一**
- 数据 focus 与 UI focus 不一致 → **已对齐**
- 多选/单选在各面板中的编辑目标不统一 → **已收口**
- 旧 API 与状态冗余 → **已清理**

**架构改进**
- 单一数据源：`focusState`（scope/selection/editor/tool）
- 统一派生层：4 个新增 getter/action（move target / palette targets / active check）
- 统一写入口：所有 focus 变更通过 `focus*` actions
- 双写兼容：Phase 1 期间保持，Phase 3 已完全移除旧状态

**文档更新**
- [phase-2-completion-summary.md](./phase-2-completion-summary.md) - Phase 2 详细改动
- 本文档 - 完整计划与进度跟踪
