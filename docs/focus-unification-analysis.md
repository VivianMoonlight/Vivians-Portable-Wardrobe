# Focus 状态统一化分析与方案
> 创建时间：2026-02-20  
> 目标：统一 Inspector Panel 中的多种 focus 状态，兼容多选模式

---

## 1) 现状分析

### A. 当前 Focus 状态类型

通过代码审查，发现系统中存在以下多种 focus 状态：

#### 1. **Part Focus** (`focusedPartIndex`)
- **位置**: `studioStore.focusedPartIndex`
- **数据结构**: `{ stackIndex, partIndex }`
- **作用**: 指示当前编辑的 Part
- **来源**: `focus-actions.js: focusOnPart()`

#### 2. **Property Focus** (`focusedProperty`)
- **位置**: `studioStore.focusedProperty`
- **数据结构**: 
  ```js
  {
    uid,           // Part UID
    partRef,       // Part 对象引用
    stackIndex,
    partIndex,
    layerIndex,    // 当前 focus 的 layer
    subLayerIndex, // 子层索引（可选）
    property       // 'color' | 'opacity' | 'drawing' | 'priority'
  }
  ```
- **作用**: 指示当前正在编辑的具体属性
- **设置位置**: `ColorableLayer.vue: selectProperty()`
- **问题**: **只能 focus 单一 layer 的单一 property**

#### 3. **Layer Selection** (`selectedLayers`)
- **位置**: `studioStore.selectedLayers`
- **数据结构**: 
  ```js
  [
    { stackIndex, partIndex, layerIndex, _key }
  ]
  ```
- **作用**: 多选模式下选中的 layers 列表
- **来源**: `selection-actions.js`
- **问题**: **与 focusedProperty 独立，没有关联**

#### 4. **Selection Mode** (`selectionMode`)
- **位置**: `studioStore.selectionMode`
- **值**: `'single' | 'multiple'`
- **作用**: 控制是单选还是多选模式

#### 5. **Visual Move State** (`isThisLayerMoving`)
- **位置**: `ColorableLayer.vue` computed
- **逻辑**: `previewTool === 'move' && focusedProperty.layerIndex === thisLayerIndex`
- **作用**: 视觉预览工具的移动状态
- **问题**: **依赖 focusedProperty，在多选时只能移动一个**

#### 6. **UI Element Focus** (DOM focus)
- **位置**: 原生 DOM focus 状态
- **作用**: input/select 等控件的焦点
- **问题**: **与数据层 focus 不同步**

---

### B. 当前问题

#### 问题 1: **Focus 与 Selection 不一致**
- **场景**: 用户在多选模式下选中 3 个 layers，然后点击批量编辑的 opacity 滑块
- **期望**: 所有 3 个 layers 都应该被视为 "focused" 用于编辑
- **实际**: `focusedProperty` 只指向其中一个 layer（或为空）
- **结果**: 
  - UI 视觉反馈混乱（哪个 layer 是 focused？）
  - 数据操作不明确（编辑作用于哪些 layers？）

#### 问题 2: **Property Focus 单一化**
- **场景**: 用户想同时编辑多个 layers 的 color 和 opacity
- **期望**: 可以 focus 多个 properties
- **实际**: `focusedProperty.property` 只能是一个值
- **结果**: 切换 property 编辑时会丢失之前的 focus 状态

#### 问题 3: **Visual Move 与 Multi-Select 不兼容**
- **场景**: 用户选中多个 layers，想批量移动它们的 offset
- **期望**: 所有选中的 layers 都显示移动状态
- **实际**: `isThisLayerMoving` 只检查单个 `focusedProperty.layerIndex`
- **结果**: 只有一个 layer 显示移动状态

#### 问题 4: **Mode-Bar 与 Focus 状态脱节**
- **场景**: 用户点击 mode-bar 切换 Single/Multi 模式
- **期望**: focus 状态应该平滑过渡
- **实际**: 切换模式时 `focusedProperty` 和 `selectedLayers` 各自独立
- **结果**: 
  - Single → Multi: 之前 focused 的 layer 不会自动加入 selectedLayers
  - Multi → Single: selectedLayers 清空，但没有设置新的 focusedProperty

#### 问题 5: **UI Focus 与 Data Focus 分离**
- **场景**: 用户点击一个 layer 的 opacity 输入框
- **期望**: 该 layer 应该被标记为 focused，UI 高亮显示
- **实际**: 
  - DOM focus 在 input 上
  - `focusedProperty` 在 `selectProperty('opacity')` 时设置
  - `isSelected` 在 `toggleSelection()` 时设置
  - 三者之间没有统一的同步机制

---

## 2) 统一方案设计

### A. 核心原则

1. **Selection First**: 选中状态是第一优先级
   - 在多选模式下，`selectedLayers` 是编辑操作的目标集
   - 在单选模式下，`focusedProperty.layerIndex` 等价于单一选中

2. **Property Focus 是 Meta 状态**: 
   - Property focus（color/opacity/drawing/priority）是针对选中集的 meta 信息
   - 不应该与 layer selection 混淆

3. **单一数据源**: 
   - 避免多个独立的 focus 状态
   - 所有 focus 查询应该通过统一的 getter

4. **Mode 决定行为**: 
   - `selectionMode` 决定用户交互方式
   - Focus 状态应该适配当前 mode

---

### B. 新数据结构

#### 方案 1: 扩展 `focusedProperty` 支持多 layers

```js
// studioStore.js
{
  focusedContext: {
    // Part level
    uid: null,
    partRef: null,
    stackIndex: null,
    partIndex: null,
    
    // Layer level (支持多个)
    layers: [
      { layerIndex: 0, subLayerIndex: null }
    ],
    
    // Property level (当前 focus 的属性类型)
    property: null,  // 'color' | 'opacity' | 'drawing' | 'priority' | null
    
    // Meta
    timestamp: Date.now()
  }
}
```

**优点**:
- 明确的层次结构（Part → Layers → Property）
- 支持多 layers focus
- 保持现有 property 语义

**缺点**:
- 与现有 `selectedLayers` 部分重复
- 需要同步两处数据

---

#### 方案 2: 统一到 `selectedLayers` + `activeFocusContext`

```js
// studioStore.js
{
  // 选中的 layers（多选或单选）
  selectedLayers: [
    { stackIndex, partIndex, layerIndex, _key }
  ],
  
  // 当前活跃的编辑上下文（基于 selectedLayers）
  activeFocusContext: {
    // 当前正在编辑的属性类型
    property: null,  // 'color' | 'opacity' | 'drawing' | 'priority' | null
    
    // 子层索引（针对 sublayers，可选）
    subLayerIndex: null,
    
    // 时间戳（用于追踪最近一次操作）
    timestamp: Date.now()
  }
}
```

**优点**:
- 数据不重复，selectedLayers 是唯一的选中数据源
- activeFocusContext 只存储 meta 信息
- 清晰的职责分离

**缺点**:
- 需要重构现有的 `focusedProperty` 引用

---

#### **推荐方案**: 方案 2（统一到 selectedLayers）

**原因**:
1. 避免数据重复和同步问题
2. selectedLayers 本身已经支持单选（数组长度为 1）和多选
3. activeFocusContext 只存储轻量级 meta 信息
4. 简化逻辑：所有编辑操作都基于 selectedLayers

---

### C. 统一的 Focus API

#### 1. **设置 Layer Focus**

```js
// studioStore.js

// 单选：聚焦到某个 layer
focusLayer(layerInfo) {
  // layerInfo: { stackIndex, partIndex, layerIndex }
  
  if (this.selectionMode === 'multiple') {
    // 多选模式：切换选中状态
    this.toggleLayerSelection(layerInfo)
  } else {
    // 单选模式：替换为单一选中
    this.selectedLayers = [{
      stackIndex: layerInfo.stackIndex,
      partIndex: layerInfo.partIndex,
      layerIndex: layerInfo.layerIndex,
      _key: buildLayerKey(...)
    }]
  }
  
  // 清除 property focus（用户可能想编辑不同的属性）
  this.activeFocusContext.property = null
}

// 设置 Property Focus（针对当前选中的 layers）
setPropertyFocus(property) {
  // property: 'color' | 'opacity' | 'drawing' | 'priority' | null
  
  if (this.selectedLayers.length === 0) {
    console.warn('[Focus] No layers selected, cannot set property focus')
    return
  }
  
  this.activeFocusContext = {
    property,
    subLayerIndex: null,
    timestamp: Date.now()
  }
}

// 清除所有 focus
clearFocus() {
  this.selectedLayers = []
  this.activeFocusContext = {
    property: null,
    subLayerIndex: null,
    timestamp: 0
  }
}
```

#### 2. **查询 Focus 状态**

```js
// studioStore.js getters

// 检查某个 layer 是否被选中（focused）
isLayerFocused(layerInfo) {
  return this.isLayerSelected(layerInfo)  // 复用现有逻辑
}

// 检查某个 layer 的某个 property 是否 focused
isLayerPropertyFocused(layerInfo, property) {
  return this.isLayerSelected(layerInfo) && 
         this.activeFocusContext.property === property
}

// 获取当前 focused 的 layers 数据
getFocusedLayersData() {
  return this.getSelectedLayersData()  // 复用现有逻辑
}

// 获取当前 focus 的 property 类型
get focusedProperty() {
  return this.activeFocusContext.property
}
```

#### 3. **兼容现有代码**

```js
// studioStore.js - 向后兼容的 computed

// 迁移期：保留 focusedProperty 作为 computed
get focusedProperty() {
  if (this.selectedLayers.length === 0) return null
  
  const firstLayer = this.selectedLayers[0]
  return {
    // Part info
    uid: this.focusedPart?._uid || null,
    partRef: this.focusedPart || null,
    stackIndex: firstLayer.stackIndex,
    partIndex: firstLayer.partIndex,
    
    // Layer info
    layerIndex: firstLayer.layerIndex,
    subLayerIndex: this.activeFocusContext.subLayerIndex,
    
    // Property info
    property: this.activeFocusContext.property
  }
}
```

---

### D. 组件层适配

#### 1. **ColorableLayer.vue** 修改

```vue
<script setup>
// BEFORE
const isFocused = computed(() => {
  const fp = store.focusedProperty
  if (!fp) return false
  return fp.layerIndex === layerLocal.value.layerIndex
})

// AFTER
const isFocused = computed(() => {
  return store.isLayerFocused({
    stackIndex: props.stackIndex,
    partIndex: props.partIndex,
    layerIndex: layerLocal.value.layerIndex
  })
})

// Property focus check
const isPropertyFocused = (property) => {
  return store.isLayerPropertyFocused(
    { stackIndex: props.stackIndex, partIndex: props.partIndex, layerIndex: layerLocal.value.layerIndex },
    property
  )
}

// Header click
function handleHeaderClick(e) {
  if (isMultiMode.value) {
    // 多选模式：切换选中
    if (e.shiftKey) {
      handleRangeSelection()
    } else {
      toggleSelection()
    }
  } else {
    // 单选模式：focus 该 layer
    store.focusLayer({
      stackIndex: props.stackIndex,
      partIndex: props.partIndex,
      layerIndex: layerLocal.value.layerIndex
    })
  }
}

// Property input focus
function selectProperty(propName) {
  // 先确保 layer 被选中
  if (!isFocused.value) {
    store.focusLayer({
      stackIndex: props.stackIndex,
      partIndex: props.partIndex,
      layerIndex: layerLocal.value.layerIndex
    })
  }
  
  // 设置 property focus
  store.setPropertyFocus(propName)
}
</script>
```

#### 2. **BatchEditPanel.vue** 修改

```vue
<script setup>
// BEFORE
// 依赖 store.selectedLayers 判断是否有选中

// AFTER
const hasSelection = computed(() => store.selectedLayers.length > 0)
const focusedLayers = computed(() => store.getFocusedLayersData())

// 批量编辑操作自动应用于所有 focused layers
function applyOpacity(value) {
  const layers = focusedLayers.value
  layers.forEach(layer => {
    store.updateLayerOpacity(layer, value)
  })
}
</script>
```

#### 3. **PartInspectorPanel.vue** 修改

```vue
<script setup>
// Mode 切换时的 focus 迁移
function toggleSelectionMode() {
  const wasSingle = store.selectionMode === 'single'
  store.toggleSelectionMode()
  
  const isNowMulti = store.selectionMode === 'multiple'
  
  if (wasSingle && isNowMulti) {
    // Single → Multi: 保留当前 focused layer 作为第一个选中
    // (已自动保留在 selectedLayers 中，无需额外操作)
  } else if (!wasSingle && !isNowMulti) {
    // Multi → Single: 保留第一个选中作为 focused layer
    if (store.selectedLayers.length > 1) {
      const first = store.selectedLayers[0]
      store.selectedLayers = [first]
    }
  }
}
</script>
```

---

## 3) 迁移计划

### Phase 1: 添加新 API（向后兼容）✅ **已完成**
- [x] 添加 `activeFocusContext` 状态到 studioStore
- [x] 实现新的 `focusLayer()` 和 `setPropertyFocus()` 方法
- [x] 添加 `isLayerFocused()` 和 `isLayerPropertyFocused()` getters
- [x] 保留 `focusedProperty` 作为 computed（向后兼容）
- [x] 增强 `toggleSelectionMode()` 的模式切换逻辑
- [x] 创建使用指南文档

**实施日期**: 2026-02-20  
**变更文件**: `studioStore.js`  
**文档**: [统一 Focus API 使用指南](./unified-focus-api-guide.md)

### Phase 2: 迁移核心组件
- [ ] 迁移 `ColorableLayer.vue` 使用新 API
- [ ] 迁移 `BatchEditPanel.vue` 使用新 API
- [ ] 迁移 `PartInspectorPanel.vue` 模式切换逻辑
- [ ] 测试单选/多选切换流畅性

### Phase 3: 清理废弃代码
- [ ] 删除 `setFocusedProperty()` 旧方法
- [ ] 删除 `clearFocusedProperty()` 旧方法
- [ ] 移除 `focusedProperty` state（只保留 computed）
- [ ] 更新 `focus-actions.js` 模块

### Phase 4: 增强功能
- [ ] 实现多 layers 的 visual move 支持
- [ ] 优化 focus 视觉反馈（高亮边框、图标）
- [ ] 添加键盘导航（Tab/Arrow keys）
- [ ] focus 状态持久化（保存到 localStorage）

---

## 4) 风险与缓解

### 风险 1: 破坏现有功能
**缓解**: 
- Phase 1 保持完全向后兼容
- 逐步迁移，每个组件独立测试
- 保留旧 API 作为 deprecated，逐步废弃

### 风险 2: 性能问题（频繁计算 focus 状态）
**缓解**:
- 使用 computed 和 reactive 自动缓存
- focus 状态查询使用 Map/Set 优化（O(1) 查找）
- 避免 watch 嵌套和循环依赖

### 风险 3: UI 反馈不同步
**缓解**:
- 统一 focus 状态来源（selectedLayers）
- 所有 UI 组件从同一个 getter 读取
- 添加 timestamp 追踪最近操作

---

## 5) 验收标准

1. **单选模式**：
   - 点击 layer 卡片 → layer 被选中（高亮）
   - 点击 property 输入框 → layer 被选中且 property 被 focus（边框高亮）
   - 切换到另一个 layer → 之前的 layer 取消选中

2. **多选模式**：
   - 点击多个 layer 卡片 → 所有 layers 都被选中（高亮）
   - 点击批量编辑的 opacity 滑块 → 所有选中的 layers 同时更新
   - Visual move 工具 → 所有选中的 layers 都显示移动状态

3. **模式切换**：
   - Single → Multi：当前 focused layer 自动加入 selectedLayers
   - Multi → Single：保留第一个选中的 layer，其他取消选中
   - 切换流畅，无闪烁或状态丢失

4. **视觉一致性**：
   - Focused layer 的边框高亮
   - Focused property 的输入框高亮
   - 多选时所有 layers 都有选中标记（checkbox 勾选）

---

## 6) 附录：技术细节

### A. Focus State 生命周期

```
User Action → Store Action → State Update → Component Re-render → UI Feedback
    ↓              ↓              ↓                ↓                  ↓
Click Layer   focusLayer()   selectedLayers   computed update    Border highlight
Click Input   setPropertyFocus()  activeFocusContext  isFocused=true  Input focus
```

### B. 数据流图

```
┌─────────────────────────────────────────────────────────┐
│                     studioStore                         │
├─────────────────────────────────────────────────────────┤
│  selectedLayers: [{ stackIndex, partIndex, layerIndex }]│
│  activeFocusContext: { property, subLayerIndex }        │
│                                                         │
│  focusLayer(layerInfo) ──► selectedLayers              │
│  setPropertyFocus(prop) ──► activeFocusContext         │
│                                                         │
│  isLayerFocused(layerInfo) ◄── selectedLayers          │
│  isLayerPropertyFocused(layerInfo, prop) ◄── both      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │      ColorableLayer.vue        │
        ├────────────────────────────────┤
        │  isFocused ──► border highlight│
        │  isPropertyFocused('opacity')  │
        │           ──► input focus      │
        └────────────────────────────────┘
```

### C. 关键代码位置

| 文件 | 行数 | 功能 |
|------|------|------|
| `studioStore.js` | 183-185 | selectedLayers, selectionMode 定义 |
| `studioStore.js` | 135 | focusedProperty 定义（待废弃） |
| `studioStore.js` | 332-359 | setFocusedProperty/clearFocusedProperty |
| `selection-actions.js` | 1-435 | Selection 操作逻辑 |
| `focus-actions.js` | 1-160 | Focus 操作逻辑 |
| `ColorableLayer.vue` | 219-227 | isFocused computed |
| `ColorableLayer.vue` | 300-347 | handleHeaderClick, toggleSelection |
| `ColorableLayer.vue` | 546-562 | selectProperty, selectSubProperty |

---

**总结**：当前系统的 focus 状态分散在多个独立的 state 中，导致单选/多选模式不一致、视觉反馈混乱。推荐方案是统一到 `selectedLayers` + `activeFocusContext`，所有 focus 查询基于 selectedLayers，property focus 作为 meta 信息存储。这样可以保证数据单一来源、简化逻辑、兼容多选模式。
