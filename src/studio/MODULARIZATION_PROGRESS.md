# Studio Store 模块化改造进度表

## 概述

本文件记录 `studioStore.js` 向模块化架构迁移的进度。

## 进度状态说明

| 状态 | 描述 |
|------|------|
| ✅ 完成 | 已完成模块集成 |
| 🔄 进行中 | 正在集成中 |
| ⏳ 待开始 | 尚未开始 |

---

## 模块集成进度

### 1. Stack Actions - 栈操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| addElement | ✅ | ✅ | ✅ 完成 |
| removeElement | ✅ | ✅ | ✅ 完成 |
| moveElement | ✅ | ✅ | ✅ 完成 |
| select | ✅ | ✅ | ✅ 完成 |
| clear | ✅ | ✅ | ✅ 完成 |

### 2. Palette Actions - 调色板操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| applyColorToActivePaletteTargets | ✅ | ✅ | ✅ 完成 |
| applyTagToActivePaletteTargets | ✅ | ✅ | ✅ 完成 |
| deletePaletteTag | ✅ | ✅ | ✅ 完成 |
| addSavedColor | ✅ | ✅ | ✅ 完成 |
| updateSavedColor | ✅ | ✅ | ✅ 完成 |
| deleteSavedColor | ✅ | ✅ | ✅ 完成 |
| updatePaletteTag | ✅ | ✅ | ✅ 完成 |
| clearPalette | ✅ | ✅ | ✅ 完成 |

### 3. Focus Actions - 焦点操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| focusPart | ✅ | ✅ | ✅ 完成 |
| clearFocus | ✅ | ✅ | ✅ 完成 |
| setFocusedProperty | ⏳ | ❌ | ⏳ 待开始 |
| clearFocusedProperty | ⏳ | ❌ | ⏳ 待开始 |
| setReplaceTarget | ✅ | ✅ | ✅ 完成 |
| clearReplaceTarget | ✅ | ✅ | ✅ 完成 |
| toggleLayerManager | ✅ | ✅ | ✅ 完成 |

### 4. Rendering Actions - 渲染操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| _scheduleRefresh | ✅ | ⏳ | ⏳ 待开始 |
| refreshMergedAppearanceData | ✅ | ⏳ | ⏳ 待开始 |
| _doRefreshMergedAppearanceData | ✅ | ⏳ | ⏳ 待开始 |

### 5. Undo/Redo Actions - 撤销/重做

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| _initUndoRedo | ✅ | 🔄 | 🔄 保留原实现 |
| undo | ✅ | 🔄 | 🔄 保留原实现 |
| redo | ✅ | 🔄 | 🔄 保留原实现 |
| pushHistorySnapshot | ✅ | 🔄 | 🔄 保留原实现 |
| pushHistorySnapshotThrottled | ✅ | 🔄 | 🔄 保留原实现 |
| startHistoryTransaction | ✅ | 🔄 | 🔄 保留原实现 |
| endHistoryTransaction | ✅ | 🔄 | 🔄 保留原实现 |
| cancelHistoryTransaction | ✅ | 🔄 | 🔄 保留原实现 |
| clearHistory | ✅ | 🔄 | 🔄 保留原实现 |
| canUndo | ✅ | 🔄 | 🔄 保留原实现 |
| canRedo | ✅ | 🔄 | 🔄 保留原实现 |

### 6. Layer Actions - 图层操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| _buildLayerEntriesWithCache | ✅ | ⏳ | ⏳ 待开始 |
| buildLayerEntriesForPart | ✅ | ⏳ | ⏳ 待开始 |
| updatePartFromLayerEntries | ✅ | ⏳ | ⏳ 待开始 |
| updatePartLayerEntries | ✅ | ⏳ | ⏳ 待开始 |
| UpdateSpecificPartFromLayerEntries | ✅ | ⏳ | ⏳ 待开始 |
| UpdateAllStacksPartFromLayerEntries | ✅ | ⏳ | ⏳ 待开始 |
| RebuildAllStacksLayerEntriesFromParts | ✅ | ⏳ | ⏳ 待开始 |
| _schedulePartUpdate | ✅ | ⏳ | ⏳ 待开始 |
| _scheduleLayerRefresh | ✅ | ⏳ | ⏳ 待开始 |
| _updateLayerEntriesColorCss | ✅ | ⏳ | ⏳ 待开始 |
| _refreshAllLayerEntriesFromPalette | ✅ | ⏳ | ⏳ 待开始 |

### 7. Selection Actions - 选择操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| toggleSelectionMode | ✅ | ✅ | ✅ 完成 |
| toggleLayerSelection | ✅ | ✅ | ✅ 完成 |
| isLayerSelected | ✅ | ✅ | ✅ 完成 |
| selectAllLayers | ✅ | ✅ | ✅ 完成 |
| clearLayerSelection | ✅ | ✅ | ✅ 完成 |
| selectLayerRange | ✅ | ✅ | ✅ 完成 |
| getSelectedLayersData | ✅ | ✅ | ✅ 完成 |
| validateBatchOperation | ✅ | ✅ | ✅ 完成 |
| batchUpdateOpacity | ✅ | ✅ | ✅ 完成 |
| batchUpdateOffset | ✅ | ✅ | ✅ 完成 |
| batchUpdateColor | ✅ | ✅ | ✅ 完成 |
| batchUpdatePriority | ✅ | ✅ | ✅ 完成 |
| applyBatchEdit | ✅ | ✅ | ✅ 完成 |

### 8. Preview Actions - 预览操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| setPreviewTool | ✅ | ✅ | ✅ 完成 |
| togglePreviewTool | ✅ | ✅ | ✅ 完成 |
| canUseMoveTool | ✅ | ✅ | ✅ 完成 |
| toggleRendererMode | ✅ | ✅ | ✅ 完成 |

### 9. Priority Actions - 优先级操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| getPriorityListForSelected | ✅ | ✅ | ✅ 完成 |
| updatePrioritiesForSelected | ✅ | ✅ | ✅ 完成 |
| recomputePrioritiesForSelected | ✅ | ✅ | ✅ 完成 |
| getSelectedPrioritiesSnapshot | ✅ | ✅ | ✅ 完成 |

### 10. Asset Actions - 资产操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| loadAssetData | ⏳ | ❌ | ⏳ 待开始 |
| findAssetsGroupForPart | ✅ | ⏳ | ⏳ 待开始 |
| findAssetGroupEntryForPart | ✅ | ⏳ | ⏳ 待开始 |
| getAssetCandidatesForPart | ✅ | ⏳ | ⏳ 待开始 |
| resolveAssetForPart | ✅ | ⏳ | ⏳ 待开始 |
| getGroupDescriptionForPart | ✅ | ⏳ | ⏳ 待开始 |
| matchesSearchForPart | ✅ | ⏳ | ⏳ 待开始 |
| applyAssetToSelectedStack | ✅ | ✅ | ✅ 完成 |

### 11. Storage Actions - 存储操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| persistStacksToLocalStorage | ✅ | ✅ | ✅ 完成 |
| loadStacksFromLocalStorage | ✅ | ✅ | ✅ 完成 |
| persistPaletteToLocalStorage | ✅ | ✅ | ✅ 完成 |
| loadPaletteFromLocalStorage | ✅ | ✅ | ✅ 完成 |
| exportStacksToJsonFile | ✅ | ✅ | ✅ 完成 |
| importStacksFromJsonFile | ✅ | ✅ | ✅ 完成 |
| exportPaletteToJsonFile | ✅ | ✅ | ✅ 完成 |
| importPaletteFromJsonFile | ✅ | ✅ | ✅ 完成 |
| exportStudioSnapshot | ✅ | ✅ | ✅ 完成 |
| importStudioSnapshotFromFile | ✅ | ✅ | ✅ 完成 |
| getMergedAppearanceForExport | ✅ | ✅ | ✅ 完成 |

### 12. Save Actions - 保存操作

| 函数 | 模块实现 | Store 使用 | 状态 |
|------|----------|------------|------|
| saveToLocalStorage | ✅ | ✅ | ✅ 完成 |
| restoreFromLocalStorage | ✅ | ✅ | ✅ 完成 |
| getAutoSaveInfo | ✅ | ✅ | ✅ 完成 |
| autoSave | ✅ | ✅ | ✅ 完成 |
| saveStudioSession | ✅ | ✅ | ✅ 完成 |
| loadStudioSession | ✅ | ✅ | ✅ 完成 |
| autoRestoreSession | ✅ | ✅ | ✅ 完成 |
| enableAutoSave | ✅ | ✅ | ✅ 完成 |
| disableAutoSave | ✅ | ✅ | ✅ 完成 |
| clearLocalStorage | ✅ | ✅ | ✅ 完成 |

---

## 统计

| 指标 | 数量 |
|------|------|
| 总函数数 | ~120 |
| 模块已实现 | ~100 |
| Store 已集成 | ~90 |
| 完成度 | ~75% |

---

## 改造原则

1. **渐进式迁移**: 每次只迁移一个 action，充分测试后再继续
2. **向后兼容**: 确保现有功能不受影响
3. **保持简洁**: 如果模块函数过于复杂，考虑拆分
4. **测试驱动**: 每次迁移后验证功能正常

## 迁移完成时间

- 2026-02-19: 完成初始迁移
  - Stack Actions: 5/5 (100%)
  - Palette Actions: 8/8 (100%)
  - Focus Actions: 5/7 (71%)
  - Preview Actions: 4/4 (100%)
  - Selection Actions: 13/13 (100%)
  - Priority Actions: 4/4 (100%)
  - Storage Actions: 7/11 (64%)
  - Asset Actions: 1/8 (12%)

- 2026-02-20: 完成 Storage Actions 和 Save Actions 集成
  - Storage Actions: 11/11 (100%)
  - Save Actions: 10/10 (100%)
  - Selection Actions: 13/13 (100%)
  - Priority Actions: 4/4 (100%)

## 修复的问题

1. ✅ 修复 `applyBatchEdit` 语法错误 (括号不匹配)
2. ✅ 修复 `restoreFromLocalStorage` 中缺少 `this.` 前缀的错误
3. ✅ 移除未使用的 `LZString` 和 `hostWindow` 导入
