# Phase 2: 核心组件迁移完成
> 创建时间：2026-02-20  
> 状态：✅ 完成

---

## 迁移总结

所有核心组件已成功迁移至新的统一 Focus API。所有修改都保持向后兼容，旧的 `setFocusedProperty()` 方法仍可使用。

---

## 组件迁移详情

### 1. ColorableLayer.vue ✅

**主要改动**：

#### Focus 检查逻辑更新
```vue
// BEFORE
const isFocused = computed(() => {
  const fp = store.focusedProperty
  if (!fp) return false
  return fp.layerIndex === layerLocal.value.layerIndex
})

// AFTER ✅
const isFocused = computed(() => {
  return store.isLayerFocused({
    stackIndex: props.stackIndex,
    partIndex: props.partIndex,
    layerIndex: layerLocal.value.layerIndex
  })
})
```

#### Property Focus 查询
新增4个 computed 属性用于检查特定属性是否 focused：
```vue
const isColorPropertyFocused = computed(() => 
  store.isLayerPropertyFocused(..., 'color')
)

const isOpacityPropertyFocused = computed(() => 
  store.isLayerPropertyFocused(..., 'opacity')
)

const isDrawingPropertyFocused = computed(() => 
  store.isLayerPropertyFocused(..., 'drawing')
)

const isPriorityPropertyFocused = computed(() => 
  store.isLayerPropertyFocused(..., 'priority')
)
```

#### Visual Move 状态更新
```vue
// BEFORE
const isThisLayerMoving = computed(() => {
  const fp = store.focusedProperty
  if (!fp) return false
  return fp.layerIndex === layerLocal.value.layerIndex
})

// AFTER ✅
const isThisLayerMoving = computed(() => {
  if (store.previewTool !== 'move') return false
  return store.isLayerFocused({ stackIndex, partIndex, layerIndex })
})
```

#### Header 点击处理
```vue
// BEFORE - 使用 toggleSelection()
function handleHeaderClick(e) {
  if (isMultiMode.value) {
    toggleSelection()
  } else {
    selectProperty('color')
  }
}

// AFTER ✅ - 使用新 API focusLayer()
function handleHeaderClick(e) {
  if (isMultiMode.value) {
    store.focusLayer(layerInfo)  // 自动 toggle（多选模式）
  } else {
    store.focusLayer(layerInfo)  // focus 该 layer（单选模式）
    store.setPropertyFocus('color')
  }
}
```

#### Property 选择方法
```vue
// BEFORE
function selectProperty(propName) {
  store.setFocusedProperty({
    part: props.part || store.focusedPart,
    partIndex: props.partIndex,
    stackIndex: props.stackIndex,
    layerIndex: layerLocal.value.layerIndex,
    property: propName
  })
}

// AFTER ✅
function selectProperty(propName) {
  const layerInfo = {
    stackIndex: props.stackIndex,
    partIndex: props.partIndex,
    layerIndex: layerLocal.value.layerIndex
  }
  
  if (!store.isLayerFocused(layerInfo)) {
    store.focusLayer(layerInfo)
  }
  
  store.setPropertyFocus(propName)
}

// AFTER ✅ - Sublayer 版本
function selectSubProperty(subIndex, propName) {
  const layerInfo = {
    stackIndex: props.stackIndex,
    partIndex: props.partIndex,
    layerIndex: layerLocal.value.layerIndex
  }
  
  if (!store.isLayerFocused(layerInfo)) {
    store.focusLayer(layerInfo)
  }
  
  store.setPropertyFocus(propName, subIndex)
}
```

**变更行数**: ~60 行

---

### 2. BatchEditPanel.vue ✅

**主要改动**：

#### 批量编辑时的 Property Focus
在所有的 apply 函数中添加 property focus 设置，以便 UI 反馈当前编辑模式：

```vue
// BEFORE
const applyOpacity = throttle(function() {
  const result = store.batchUpdateOpacity(...)
  // no property focus setting
}, 100)

// AFTER ✅
const applyOpacity = throttle(function() {
  store.setPropertyFocus('opacity')  // 设置 property focus
  const result = store.batchUpdateOpacity(...)
}, 100)
```

改动应用于：
- `applyOpacity()` → 设置 `'opacity'` focus
- `applyOffset()` → 设置 `'drawing'` focus
- `applyPriority()` → 设置 `'priority'` focus
- `openPaletteForBatch()` → 设置 `'color'` focus

#### Visual Move 切换
```vue
// BEFORE
function toggleVisualMove() {
  visualMoveEnabled.value = !visualMoveEnabled.value
  if (visualMoveEnabled.value) {
    store.setPreviewTool('move')
  } else {
    store.setPreviewTool('view')
  }
}

// AFTER ✅
function toggleVisualMove() {
  visualMoveEnabled.value = !visualMoveEnabled.value
  if (visualMoveEnabled.value) {
    store.setPropertyFocus('drawing')  // 设置 drawing focus
    store.setPreviewTool('move')
  } else {
    store.setPreviewTool('view')
  }
}
```

**变更行数**: ~25 行

---

### 3. PartInspectorPanel.vue ✅

**主要改动**：

#### Mode 切换逻辑
在 `studioStore.toggleSelectionMode()` 已实现（Phase 1）。当前组件直接调用该方法，自动获得平滑的模式切换逻辑：

- Single → Multi: 保留当前选中的 layer
- Multi → Single: 只保留第一个选中的 layer

```vue
// 组件方法（无需修改）
function toggleSelectionMode() {
  store.toggleSelectionMode()  // 已在 store 中实现完整逻辑
}
```

**变更行数**: 0（已通过 store 更新实现）

---

## 功能验证

### ✅ 单选模式流程
```
点击 layer 卡片
  ↓
handleHeaderClick() 调用 store.focusLayer()
  ↓
store.focusLayer() 设置 selectedLayers = [this layer]
  ↓
isFocused.value = true（通过 isLayerFocused() 检查）
  ↓
layer 卡片高亮，展开显示属性

点击 opacity 输入框
  ↓
selectProperty('opacity') 调用 store.setPropertyFocus('opacity')
  ↓
activeFocusContext.property = 'opacity'
  ↓
isOpacityPropertyFocused.value = true
  ↓
opacity 输入框高亮
```

### ✅ 多选模式流程
```
Ctrl+点击 layer 卡片
  ↓
handleHeaderClick() 调用 store.focusLayer()
  ↓
store.focusLayer() 切换该 layer 的选中状态（因为在 multi 模式）
  ↓
selectedLayers = [layer1, layer2, layer3] （如果选了3个）
  ↓
所有选中的 layer 都显示高亮

修改 BatchEditPanel 的 opacity 滑块
  ↓
applyOpacity() 调用 store.setPropertyFocus('opacity')
  ↓
所有选中的 layers 都应用 opacity 更新
```

### ✅ 模式切换流程
```
单选模式 + 选中 layer1
  ↓
点击 mode-bar "Multi" chip
  ↓
toggleSelectionMode()
  ↓
store 自动处理过渡逻辑：
  - wasSingleMode && isNowMultiMode
  - selectedLayers 保留 [layer1]
  
进入多选模式，layer1 仍然被选中 ✅

多选模式 + 选中 layer1, layer2, layer3
  ↓
点击 mode-bar "Single" chip
  ↓
toggleSelectionMode()
  ↓
store 自动处理过渡逻辑：
  - !wasSingleMode && !isNowMultiMode
  - selectedLayers 降至 [layer1]（只保留第一个）

进入单选模式，只有 layer1 被选中 ✅
```

---

## 向后兼容性验证

### OldAPI vs NewAPI 对应关系

| 旧 API | 新 API | 状态 |
|--------|--------|------|
| `store.focusedProperty` | `store.focusedProperty` (computed) | ✅ 仍然可用 |
| `store.setFocusedProperty()` | `store.focusLayer()` + `store.setPropertyFocus()` | ⚠️ 已弃用，但兼容 |
| `store.clearFocusedProperty()` | `store.clearFocus()` | ⚠️ 已弃用，但兼容 |
| layer click 处理 | `store.focusLayer()` | ✅ 新方法 |
| property focus check | `store.isLayerPropertyFocused()` | ✅ 新方法 |

所有旧代码仍然工作，可以逐步迁移。

---

## 代码变更统计

| 组件 | 改动行数 | 新增方法 | 删除方法 |
|------|---------|--------|--------|
| ColorableLayer.vue | ~60 | 4 computed | 0 |
| BatchEditPanel.vue | ~25 | 0 | 0 |
| PartInspectorPanel.vue | 0 | 0 | 0 |
| studioStore.js (Phase 1) | ~120 | 6 方法 + 2 getter | 0 |
| **总计** | **~205** | **12** | **0** |

---

## 测试检查清单

### 单选模式 ✅
- [x] 点击 layer 卡片 → layer 被 focused
- [x] 点击不同 layer → 前一个取消 focus
- [x] 点击 property 输入框 → property 被 focused
- [x] `isFocused` computed 返回正确值
- [x] `isOpacityPropertyFocused` 等返回正确值

### 多选模式 ✅
- [x] Ctrl+点击多个 layers → 所有都被 focused
- [x] 再次 Ctrl+点击已选 layer → 取消选中
- [x] BatchEditPanel 批量编辑 → 所有 focused layers 更新
- [x] Visual Move 切换 → property focus 设置正确

### 模式切换 ✅
- [x] Single → Multi：保留当前选中
- [x] Multi → Single：只保留第一个
- [x] 切换时无 UI 闪烁
- [x] Focus 状态平滑过渡

### 错误检查 ✅
- [x] 无语法错误
- [x] 无 undefined 引用
- [x] 无 computed 循环依赖

---

## 下一步（Phase 3）

### 清理废弃代码
- [ ] 删除旧的 `setFocusedProperty()` 方法（如果没有其他地方使用）
- [ ] 删除旧的 `clearFocusedProperty()` 方法
- [ ] 更新代码注释，标记旧 API 为 deprecated

### 验证其他组件
- [ ] 检查 `LayerManagerWidget.vue` 是否使用旧 API
- [ ] 检查 `PreviewWidget.vue` 是否需要适配
- [ ] 搜索所有 `focusedProperty` 使用，确保都迁移到新 API

### 增强功能（Phase 4）
- [ ] 多 layer visual move 支持
- [ ] 键盘导航（Tab/Arrow keys）
- [ ] Focus 状态持久化

---

## 快速参考

### 新 API 速查表

```js
// Focus 一个 layer（自动适配 single/multi 模式）
store.focusLayer({ stackIndex, partIndex, layerIndex })

// 设置 property focus（针对所有选中的 layers）
store.setPropertyFocus('opacity')  // 'color' | 'opacity' | 'drawing' | 'priority'

// 清除所有 focus
store.clearFocus()

// 查询 focus 状态
store.isLayerFocused({ stackIndex, partIndex, layerIndex })
store.isLayerPropertyFocused({ stackIndex, partIndex, layerIndex }, 'opacity')

// 获取 focused layers 数据
store.getFocusedLayersData()
```

### 组件调用示例

```vue
// ColorableLayer.vue
const isFocused = computed(() => 
  store.isLayerFocused(layerInfo)
)

function handleClick() {
  store.focusLayer(layerInfo)
  store.setPropertyFocus('color')
}

// BatchEditPanel.vue
function onBatchEdit() {
  store.setPropertyFocus('opacity')
  const layers = store.getFocusedLayersData()
  layers.forEach(layer => updateLayer(layer))
}
```

---

**总结**：Phase 2 迁移完成，所有核心组件已采用新统一 Focus API，向后兼容性完全保证。可以进入 Phase 3 清理废弃代码。
