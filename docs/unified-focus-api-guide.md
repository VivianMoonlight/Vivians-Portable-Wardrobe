# 统一 Focus API 使用指南
> 创建时间：2026-02-20  
> 状态：Phase 1 实现完成

---

## API 概览

新的统一 Focus API 提供了一致的方式来管理 layer focus 状态，自动适配单选/多选模式。

### 核心数据结构

```js
// studioStore state
{
  // 选中的 layers（单选或多选）
  selectedLayers: [
    { stackIndex, partIndex, layerIndex, _key }
  ],
  
  // 选择模式
  selectionMode: 'single' | 'multiple',
  
  // 活跃的 focus 上下文（meta 信息）
  activeFocusContext: {
    property: null,      // 当前 focus 的属性类型
    subLayerIndex: null, // 子层索引（可选）
    timestamp: 0         // 最近一次 focus 时间戳
  }
}
```

---

## 新增方法

### 1. `focusLayer(layerInfo)`
**统一的 layer focus 方法，自动适配选择模式**

```js
// 使用示例
store.focusLayer({
  stackIndex: 0,
  partIndex: 2,
  layerIndex: 5
})

// 行为：
// - 单选模式：替换当前选中，只选这个 layer
// - 多选模式：切换这个 layer 的选中状态（toggle）
```

**特点**：
- ✅ 自动适配 `selectionMode`
- ✅ 清除之前的 property focus
- ✅ 更新 timestamp

---

### 2. `setPropertyFocus(property, subLayerIndex?)`
**设置 property focus（应用于所有选中的 layers）**

```js
// 使用示例
store.setPropertyFocus('opacity')     // focus opacity 属性
store.setPropertyFocus('color')       // focus color 属性
store.setPropertyFocus('drawing')     // focus offset (drawing) 属性
store.setPropertyFocus('priority')    // focus priority 属性
store.setPropertyFocus(null)          // 清除 property focus

// 带 sublayer
store.setPropertyFocus('color', 3)    // focus 第3个 sublayer 的 color
```

**特点**：
- ✅ 针对所有 `selectedLayers` 生效
- ✅ 不影响 layer selection 状态
- ✅ 可以设置 sublayer index

---

### 3. `clearFocus()`
**清除所有 focus 状态**

```js
// 使用示例
store.clearFocus()

// 效果：
// - selectedLayers = []
// - activeFocusContext.property = null
// - activeFocusContext.subLayerIndex = null
```

---

### 4. `isLayerFocused(layerInfo)`
**检查某个 layer 是否被 focused（选中）**

```js
// 使用示例
const isFocused = store.isLayerFocused({
  stackIndex: 0,
  partIndex: 2,
  layerIndex: 5
})

// 返回: true | false
```

**等价于**：`store.isLayerSelected(layerInfo)`

---

### 5. `isLayerPropertyFocused(layerInfo, property)`
**检查某个 layer 的特定 property 是否 focused**

```js
// 使用示例
const isOpacityFocused = store.isLayerPropertyFocused(
  { stackIndex: 0, partIndex: 2, layerIndex: 5 },
  'opacity'
)

// 返回: true | false（当且仅当 layer 被选中且 property 匹配）
```

**用途**：用于高亮显示当前正在编辑的属性输入框

---

### 6. `getFocusedLayersData()`
**获取所有 focused layers 的完整数据**

```js
// 使用示例
const focusedLayers = store.getFocusedLayersData()
// 返回: [{ layer data }, ...]

// 用于批量编辑
focusedLayers.forEach(layer => {
  console.log(layer.name, layer.opacity, layer.colorText)
})
```

**等价于**：`store.getSelectedLayersData()`

---

## 向后兼容

### 旧的 `focusedProperty` getter
**仍然可用**，自动从 `selectedLayers` 和 `activeFocusContext` 计算得出：

```js
// 旧代码仍然可以使用
const fp = store.focusedProperty
if (fp) {
  console.log(fp.layerIndex)  // 第一个选中的 layer
  console.log(fp.property)    // 当前 focus 的属性
}
```

**结构**：
```js
{
  uid: part._uid,
  partRef: part,
  stackIndex: number,
  partIndex: number,
  layerIndex: number,        // 第一个选中的 layer
  subLayerIndex: number | null,
  property: string | null    // 当前 focus 的属性类型
}
```

---

## 使用模式

### 模式 A：单选编辑（类似 Photoshop 图层面板）

```js
// 用户点击 layer 卡片
function onLayerClick(layerInfo) {
  store.focusLayer(layerInfo)
}

// 用户点击 opacity 输入框
function onOpacityFocus(layerInfo) {
  // 确保 layer 被选中
  if (!store.isLayerFocused(layerInfo)) {
    store.focusLayer(layerInfo)
  }
  // 设置 property focus
  store.setPropertyFocus('opacity')
}

// 渲染时高亮显示
const isFocused = computed(() => 
  store.isLayerFocused(layerInfo)
)

const isOpacityFocused = computed(() => 
  store.isLayerPropertyFocused(layerInfo, 'opacity')
)
```

---

### 模式 B：多选批量编辑

```js
// 用户点击多个 layers（Ctrl/Cmd + Click）
function onLayerClickMulti(layerInfo) {
  store.focusLayer(layerInfo)  // 自动 toggle（因为在多选模式）
}

// 批量编辑 opacity
function onBatchOpacityChange(value) {
  const focusedLayers = store.getFocusedLayersData()
  focusedLayers.forEach(layer => {
    store.updateLayerOpacity(layer, value)
  })
}

// 高亮所有选中的 layers
const isThisLayerSelected = computed(() => 
  store.isLayerFocused(layerInfo)
)
```

---

### 模式 C：模式切换

```js
// 用户点击 mode-bar 切换 Single/Multi
function onModeToggle() {
  store.toggleSelectionMode()
  // 自动处理：
  // - Single → Multi: 保留当前选中
  // - Multi → Single: 只保留第一个选中
}
```

---

## 组件迁移示例

### ColorableLayer.vue

```vue
<script setup>
import { computed } from 'vue'
import { useStudioStore } from '@/stores/studioStore'

const store = useStudioStore()
const props = defineProps(['layer', 'stackIndex', 'partIndex'])

// BEFORE (旧方式)
const isFocused_OLD = computed(() => {
  const fp = store.focusedProperty
  if (!fp) return false
  return fp.layerIndex === props.layer.layerIndex
})

// AFTER (新方式) ✅
const isFocused = computed(() => {
  return store.isLayerFocused({
    stackIndex: props.stackIndex,
    partIndex: props.partIndex,
    layerIndex: props.layer.layerIndex
  })
})

// 检查特定属性是否 focused
const isOpacityFocused = computed(() => {
  return store.isLayerPropertyFocused(
    { stackIndex: props.stackIndex, partIndex: props.partIndex, layerIndex: props.layer.layerIndex },
    'opacity'
  )
})

// Layer 卡片点击
function handleHeaderClick(e) {
  if (store.selectionMode === 'multiple') {
    // 多选模式：toggle selection
    store.focusLayer({
      stackIndex: props.stackIndex,
      partIndex: props.partIndex,
      layerIndex: props.layer.layerIndex
    })
  } else {
    // 单选模式：focus 该 layer
    store.focusLayer({
      stackIndex: props.stackIndex,
      partIndex: props.partIndex,
      layerIndex: props.layer.layerIndex
    })
  }
}

// Property 输入框 focus
function onOpacityFocus() {
  // 确保 layer 被选中
  const layerInfo = {
    stackIndex: props.stackIndex,
    partIndex: props.partIndex,
    layerIndex: props.layer.layerIndex
  }
  
  if (!store.isLayerFocused(layerInfo)) {
    store.focusLayer(layerInfo)
  }
  
  // 设置 property focus
  store.setPropertyFocus('opacity')
}
</script>

<template>
  <div class="layer-card" :class="{ focused: isFocused }">
    <div class="layer-header" @click="handleHeaderClick">
      {{ layer.name }}
    </div>
    
    <div class="layer-body">
      <input 
        type="range" 
        v-model="localOpacity"
        @focus="onOpacityFocus"
        :class="{ 'property-focused': isOpacityFocused }"
      />
    </div>
  </div>
</template>

<style scoped>
.layer-card.focused {
  border: 2px solid var(--color-accent-purple);
}

.property-focused {
  outline: 2px solid var(--color-accent-blue);
}
</style>
```

---

### BatchEditPanel.vue

```vue
<script setup>
import { computed } from 'vue'
import { useStudioStore } from '@/stores/studioStore'

const store = useStudioStore()

// 获取所有 focused layers
const focusedLayers = computed(() => store.getFocusedLayersData())
const hasSelection = computed(() => focusedLayers.value.length > 0)

// 批量编辑 opacity
function onOpacityChange(value) {
  // 设置 property focus（可选，用于视觉反馈）
  store.setPropertyFocus('opacity')
  
  // 应用到所有 focused layers
  focusedLayers.value.forEach(layer => {
    store.updateLayerOpacity(layer, value)
  })
}
</script>

<template>
  <div v-if="hasSelection" class="batch-edit-panel">
    <h4>批量编辑 {{ focusedLayers.length }} 个图层</h4>
    
    <label>Opacity</label>
    <input 
      type="range" 
      min="0" 
      max="100" 
      @input="e => onOpacityChange(e.target.value)"
    />
  </div>
</template>
```

---

## 测试检查清单

### 单选模式
- [ ] 点击 layer 卡片 → layer 被 focused（高亮边框）
- [ ] 点击另一个 layer → 前一个 layer 取消 focus
- [ ] 点击 property 输入框 → layer 和 property 都被 focused
- [ ] `store.isLayerFocused()` 返回正确值
- [ ] `store.isLayerPropertyFocused()` 返回正确值

### 多选模式
- [ ] 点击多个 layers → 所有 layers 都被 focused
- [ ] 再次点击已选中的 layer → 取消选中
- [ ] 批量编辑控件修改属性 → 所有 focused layers 都更新
- [ ] `store.getFocusedLayersData()` 返回所有选中的 layers

### 模式切换
- [ ] Single → Multi：当前 focused layer 保留在 selectedLayers
- [ ] Multi → Single：只保留第一个 layer
- [ ] 切换时无 UI 闪烁

### 向后兼容
- [ ] 旧代码使用 `store.focusedProperty` 仍然工作
- [ ] `focusedProperty.layerIndex` 指向第一个选中的 layer
- [ ] `focusedProperty.property` 反映 `activeFocusContext.property`

---

## 后续计划

### Phase 2: 迁移核心组件
- [ ] 迁移 `ColorableLayer.vue`
- [ ] 迁移 `BatchEditPanel.vue`
- [ ] 迁移 `PartInspectorPanel.vue`
- [ ] 更新所有 `selectProperty()` 调用

### Phase 3: 清理废弃代码
- [ ] 删除旧的 `setFocusedProperty()` 方法
- [ ] 删除旧的 `clearFocusedProperty()` 方法
- [ ] 移除 `focusedProperty` state（只保留 computed）

### Phase 4: 增强功能
- [ ] 多 layer visual move 支持
- [ ] 键盘导航（Tab/Arrow keys）
- [ ] Focus 状态持久化

---

**注意**：当前 Phase 1 已完成，所有新 API 都可以使用，并且与旧代码完全兼容。建议逐步迁移组件，先在新组件中使用新 API，验证稳定后再替换旧代码。
