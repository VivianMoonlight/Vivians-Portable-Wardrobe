# Studio Store 模块化重构说明

## 概述

本次重构将 studioStore.js 中的业务逻辑提取到独立的 action 模块中，使代码更易于维护和测试。

## 创建的模块

### Action 模块

| 模块 | 路径 | 功能 |
|------|------|------|
| Stack Actions | `src/studio/stack-actions.js` | 栈元素的添加、删除、移动、选择等操作 |
| Palette Actions | `src/studio/palette-actions.js` | 调色板操作：应用颜色/标签、保存颜色等 |
| Focus Actions | `src/studio/focus-actions.js` | 焦点操作：聚焦部分/属性、替换模式等 |
| Rendering Actions | `src/studio/rendering-actions.js` | 渲染操作：合并外观更新、刷新等 |
| Layer Actions | `src/studio/layer-actions.js` | 图层操作：图层条目构建、更新、重建等 |
| Selection Actions | `src/studio/selection-actions.js` | 多选操作：图层选择、批量编辑等 |
| Preview Actions | `src/studio/preview-actions.js` | 预览工具操作：视图/移动模式切换等 |
| Priority Actions | `src/studio/priority-actions.js` | 优先级管理：优先级列表、更新等 |
| Asset Actions | `src/studio/asset-actions.js` | 资产操作：资产加载、查找、应用等 |
| Storage Actions | `src/studio/storage-actions.js` | 存储操作：导入/导出、localStorage 等 |
| Save Actions | `src/studio/save-actions.js` | 保存操作：自动保存、会话管理等 |

### 辅助模块

| 模块 | 路径 | 功能 |
|------|------|------|
| Constants | `src/studio/constants.js` | 常量定义 |
| Stack Utils | `src/studio/stack-utils.js` | 栈操作辅助函数 |
| README | `src/studio/README.md` | Store 架构文档 |

### Composables

| 模块 | 路径 | 功能 |
|------|------|------|
| useDraggableWindow | `src/composables/useDraggableWindow.js` | 窗口拖拽/调整大小 |
| useResponsive | `src/composables/useResponsive.js` | 响应式布局 |
| useStudioIO | `src/composables/useStudioIO.js` | 导入/导出操作 |
| useSaveStatus | `src/composables/useSaveStatus.js` | 保存状态显示 |

### 工具模块

| 模块 | 路径 | 功能 |
|------|------|------|
| clone.js | `src/utils/clone.js` | 克隆工具 |
| performance.js | `src/utils/performance.js` | 性能工具（debounce/throttle） |
| canvas.js | `src/utils/canvas.js` | Canvas 工具 |

## 集成方式

这些模块提供了纯函数接口，可以在 studioStore.js 中逐步集成：

### 示例：在 studioStore.js 中使用 Stack Actions

```javascript
import * as StackActions from '@/studio/stack-actions.js'

// 在 actions 中：
async addElement(el) {
  const result = StackActions.addElementToStacks(this, element, {
    fastClone: this.fastClone,
    ensurePartUid: this.ensurePartUid.bind(this),
    _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
    _updateLayerEntriesColorCss: this._updateLayerEntriesColorCss.bind(this),
    refreshMergedAppearanceData: this.refreshMergedAppearanceData.bind(this),
    pushHistorySnapshot: this.pushHistorySnapshot.bind(this)
  })

  if (result.element) {
    this.stacks.push(result.element)
    this.selectedIndex = this.stacks.length - 1
    this.refreshMergedAppearanceData()
    this.pushHistorySnapshot()
    return result.element
  }
  return null
}
```

### 示例：使用 Palette Actions

```javascript
import * as PaletteActions from '@/studio/palette-actions.js'

applyColorToActivePaletteTargets(newColor) {
  const changed = PaletteActions.applyColorToTargets(this, newColor, {
    paletteModeActive: this.paletteModeActive,
    activePaletteTargets: this.activePaletteTargets,
    stacks: this.stacks,
    findPartByUid: this.findPartByUid.bind(this),
    _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
    _scheduleLayerRefresh: this._scheduleLayerRefresh.bind(this),
    _schedulePartUpdate: this._schedulePartUpdate.bind(this),
    triggerFocusedPartUpdate: this.triggerFocusedPartUpdate.bind(this),
    pushHistorySnapshotThrottled: this.pushHistorySnapshotThrottled.bind(this)
  })

  if (changed) {
    this.paletteMap = result.paletteMap
    this._paletteVersion = result._paletteVersion
  }
  return changed
}
```

### 示例：使用 Focus Actions

```javascript
import * as FocusActions from '@/studio/focus-actions.js'

focusPart(part) {
  const result = FocusActions.focusOnPart(this, part, {
    focusedPartIndex: this.focusedPartIndex,
    findPartByUid: this.findPartByUid.bind(this),
    clearLayerSelection: this.clearLayerSelection.bind(this)
  })

  this.focusedPartIndex = result.focusedPartIndex
  if (result.clearLayerSelection) {
    this.clearLayerSelection()
  }
}
```

### 示例：使用 Layer Actions

```javascript
import * as LayerActions from '@/studio/layer-actions.js'

// 构建图层条目（带缓存）
buildLayerEntriesForPart(part) {
  return LayerActions.buildLayerEntriesWithCache(
    part,
    this.layerEntriesCache,
    this._paletteVersion,
    false,
    {
      paletteSnapshot: () => this.paletteSnapshot,
      resolveAssetForPart: (p) => this.resolveAssetForPart(p),
      getAssetCandidatesForPart: (p) => this.getAssetCandidatesForPart(p),
      findAssetGroupEntryForPart: (p) => this.findAssetGroupEntryForPart(p)
    }
  )
}

// 更新图层条目
updatePartFromLayerEntries(part, entries) {
  const newPart = LayerActions.updatePartFromLayerEntries(
    part,
    entries,
    this.resolveAssetForPart.bind(this)
  )
  if (newPart) {
    newPart.layerEntries = this._buildLayerEntriesWithCache(newPart, true)
    return newPart
  }
  return null
}
```

### 示例：使用 Selection Actions

```javascript
import * as SelectionActions from '@/studio/selection-actions.js'

// 切换图层选择
toggleLayerSelection(layerInfo) {
  const result = SelectionActions.toggleLayerSelection(this, layerInfo)
  this.selectedLayers = result.selectedLayers
}

// 批量更新透明度
batchUpdateOpacity(value, mode = 'absolute') {
  const result = SelectionActions.batchUpdateOpacity(this, value, mode)
  if (result.success) {
    this._scheduleLayerRefresh()
    this._schedulePartUpdate()
    this._scheduleRefresh()
    this.triggerFocusedPartUpdate()
    this.pushHistorySnapshot()
  }
}

// 选择所有图层
selectAllLayers() {
  const result = SelectionActions.selectAllLayers(this)
  this.selectedLayers = result.selectedLayers
}
```

### 示例：使用 Preview Actions

```javascript
import * as PreviewActions from '@/studio/preview-actions.js'

// 设置预览工具
setPreviewTool(tool) {
  const result = PreviewActions.setPreviewTool(tool)
  this.previewTool = result.previewTool
}

// 切换预览工具
togglePreviewTool() {
  const result = PreviewActions.togglePreviewTool(this)
  this.previewTool = result.previewTool
}

// 切换渲染器模式
toggleRendererMode(useOptimized = true) {
  const result = PreviewActions.toggleRendererMode(useOptimized)
  this.useOptimizedRenderer = result.useOptimizedRenderer
  this.refreshMergedAppearanceData()
}
```

### 示例：使用 Priority Actions

```javascript
import * as PriorityActions from '@/studio/priority-actions.js'

// 获取选中元素的优先级列表
getPriorityListForSelected() {
  return PriorityActions.getPriorityListForSelected(
    this,
    this.getGroupDescriptionForPart.bind(this)
  )
}

// 更新优先级
updatePrioritiesForSelected(updates = []) {
  const result = PriorityActions.updatePrioritiesForSelected(
    this,
    updates,
    this.getGroupDescriptionForPart.bind(this)
  )
  this.stacks = result.stacks
  this._scheduleRefresh()
}
```

### 示例：使用 Asset Actions

```javascript
import * as AssetActions from '@/studio/asset-actions.js'

// 加载资产数据
async loadAssetData() {
  const res = await AssetActions.loadAssetData()
  this.assetGroupsRaw = res.assetGroupsRaw
  this.assetIndex = res.assetIndex
  return res.assetGroupsRaw
}

// 应用资产到选中栈
async applyAssetToSelectedStack(asset, replaceTarget = null) {
  const result = AssetActions.applyAssetToSelectedStack(
    this,
    asset,
    replaceTarget,
    {
      ensurePartUid: this.ensurePartUid.bind(this),
      _buildLayerEntriesWithCache: this._buildLayerEntriesWithCache.bind(this),
      fastClone: this.fastClone
    }
  )
  this.stacks = result.stacks
  this.focusedPartIndex = result.focusedPartIndex
  this._scheduleRefresh()
  this.pushHistorySnapshot()
}
```

### 示例：使用 Storage Actions

```javascript
import * as StorageActions from '@/studio/storage-actions.js'

// 导出栈到 JSON 文件
exportStacksToJsonFile(filename = 'stacks.json') {
  return StorageActions.exportStacksToJsonFile(this, filename)
}

// 导入栈从 JSON 文件
async importStacksFromJsonFile(file) {
  const result = await StorageActions.importStacksFromJsonFile(file)
  if (result.success) {
    this.stacks = result.stacks
    if (result._partUidCounter) {
      this._partUidCounter = result._partUidCounter
    }
    this.RebuildAllStacksLayerEntriesFromParts()
    this._refreshAllLayerEntriesFromPalette()
    this.refreshMergedAppearanceData()
  }
  return result.success
}

// 持久化到 localStorage
persistStacksToLocalStorage() {
  return StorageActions.persistStacksToLocalStorage(this)
}

// 从 localStorage 加载
loadStacksFromLocalStorage() {
  const result = StorageActions.loadStacksFromLocalStorage()
  if (result) {
    this.stacks = result.stacks
    this._partUidCounter = result._partUidCounter
    this.RebuildAllStacksLayerEntriesFromParts()
    this._refreshAllLayerEntriesFromPalette()
    this.refreshMergedAppearanceData()
    return true
  }
  return false
}
```

### 示例：使用 Save Actions

```javascript
import * as SaveActions from '@/studio/save-actions.js'

// 保存到 localStorage（带压缩）
async saveToLocalStorage() {
  this.saveStatus = 'saving'
  const result = await SaveActions.saveToLocalStorage(this)
  this.saveStatus = result.saveStatus
  if (result.success) {
    this.lastSaveTime = result.lastSaveTime
  }
  return result.success
}

// 恢复从 localStorage
async restoreFromLocalStorage() {
  const result = await SaveActions.restoreFromLocalStorage()
  if (result.restored) {
    this.stacks = result.data.stacks
    this.paletteMap = result.data.paletteMap
    this._paletteNextCounter = result.data._paletteNextCounter
    this._partUidCounter = result.data._partUidCounter
    this.selectedIndex = result.data.selectedIndex
    this.focusedPartIndex = result.data.focusedPartIndex
    this._paletteVersion++
    this.RebuildAllStacksLayerEntriesFromParts()
    this._refreshAllLayerEntriesFromPalette()
    this.refreshMergedAppearanceData()
    this.lastSaveTime = result.timestamp
  }
  return result
}

// 自动保存
async autoSave() {
  if (!this.autoSaveEnabled) return
  this.saveStatus = 'saving'
  const result = SaveActions.autoSave(this)
  this.saveStatus = result.saveStatus
  if (result.success) {
    this.lastSaveTime = result.lastSaveTime
  }
}

// 保存会话
async saveStudioSession(name) {
  this.saveStatus = 'saving'
  const result = SaveActions.saveStudioSession(this, name)
  this.saveStatus = result.saveStatus
  if (result.success) {
    this.currentSaveId = result.id
    this.lastSaveTime = result.lastSaveTime
  }
  return result
}

// 加载会话
async loadStudioSession(id) {
  const result = SaveActions.loadStudioSession(id)
  if (result.success) {
    const data = result.data
    this.stacks = data.stacks || []
    this.paletteMap = data.paletteMap || {}
    this._paletteNextCounter = data._paletteNextCounter || 0
    this._partUidCounter = data._partUidCounter || 0
    this.selectedIndex = data.selectedIndex ?? -1
    this.currentSaveId = id
    this._paletteVersion++
    this.RebuildAllStacksLayerEntriesFromParts()
    this._refreshAllLayerEntriesFromPalette()
    this.refreshMergedAppearanceData()
  }
  return result
}
```

### 示例：使用 historyStore（Wave 2）

```javascript
import { useStudioHistoryStore } from '@/stores/studio/historyStore'

const historyStore = useStudioHistoryStore()

// 在 actions 中：
undo() {
  return historyStore.undo(this)
}

redo() {
  return historyStore.redo(this)
}
```

## 重构的优势

1. **关注点分离**：每个 action 模块负责特定领域的逻辑
2. **更易测试**：纯函数更容易进行单元测试
3. **代码可读性**：相关逻辑集中在同一文件中
4. **减少大文件**：虽然主 store 还保持完整，但业务逻辑已分离
5. **渐进式迁移**：可以逐步将 actions 迁移到新模块

## 下一步建议

1. **逐步集成**：一次集成一个 action 模块，充分测试后再继续
2. **保持向后兼容**：确保现有功能不受影响
3. **添加测试**：为提取的 action 模块创建单元测试
4. **类型定义**：考虑添加 TypeScript 类型定义以获得更好的类型安全

## 注意事项

1. **状态一致性**：action 返回的对象可能包含多个需要同时更新的状态，确保正确应用
2. **依赖关系**：某些 actions 依赖 store 的内部方法（如 _scheduleRefresh），需要保持这些接口
3. **事件触发**：注意哪些操作需要触发历史记录、刷新等副作用
4. **错误处理**：保持现有的错误处理逻辑
