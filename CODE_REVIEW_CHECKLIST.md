# 代码修改审查清单 - Inspector VS Selector 冲突解决方案

## 📝 修改文件清单

### 1. studioStore.js ✅

#### 修改位置：state 定义
```javascript
// 行 ~245
_previewStack: [],
_activePreviewId: null
```
- [x] 状态添加正确
- [x] 变量名称清晰（以 `_` 前缀表示内部状态）
- [x] 初始值正确

#### 修改位置：actions 部分
```javascript
// 在 togglePreviewTool() 之后添加
pushPreview(id, priority, previewData, source = '')
popPreview(id)
_updateActivePreview()
isPreviewActive(id)
```

**检查清单：**
- [x] 方法签名清晰
- [x] 参数验证完整
- [x] 错误处理到位
- [x] 渲染调用使用正确的 renderer
- [x] 空堆栈时正确调用 `refreshMergedAppearanceData()`
- [x] JSDoc 注释完整

#### 代码质量检查
```javascript
// ✅ 正确性
- pushPreview 中有去重逻辑：this._previewStack.filter(p => p.id !== id)
- _updateActivePreview 中的遍历逻辑正确
- popPreview 中正确过滤

// ✅ 安全性
- 参数验证：if (!id || typeof priority !== 'number') return
- 空堆栈检查：if (this._previewStack.length === 0)
- try-catch 包装渲染调用

// ✅ 性能
- 直接数组操作（无额外遍历）
- 渲染只在堆栈改变时进行
```

---

### 2. AssetSelectorPanel.vue ✅

#### 修改位置：onHoverAssetImpl (行 ~587)

**原代码问题：**
```javascript
// ❌ 直接修改 store.mergedAppearanceData
store.mergedAppearanceData = mergedPreview
store.previewRenderer.renderPreviewWithItem(toRaw(store.mergedAppearanceData))
```

**修改后：**
```javascript
// ✅ 使用堆栈系统
store.pushPreview('asset-hover', 1, mergedPreview, 'asset-hover')
```

**检查清单：**
- [x] 去掉直接赋值 `store.mergedAppearanceData`
- [x] 去掉直接调用 `renderPreviewWithItem`
- [x] 正确使用 `pushPreview` 方法
- [x] 优先级设置为 1（正确）
- [x] 保留 `lastPreviewMerged` 和 `hoverPreviewActive` 的赋值（用于状态跟踪）

#### 修改位置：onLeaveAssetImpl (行 ~603)

**原代码问题：**
```javascript
// ❌ 直接调用 refreshMergedAppearanceData
store.refreshMergedAppearanceData && store.refreshMergedAppearanceData()
```

**修改后：**
```javascript
// ✅ 从堆栈移除
store.popPreview('asset-hover')
```

**检查清单：**
- [x] 去掉 `refreshMergedAppearanceData()` 调用
- [x] 使用 `popPreview()` 替代
- [x] 保留 `hoverPreviewActive = false`
- [x] ID 与 onHoverAssetImpl 中的 ID 匹配

#### 代码一致性
- [x] 所有 `pushPreview` 调用使用相同的优先级 (1)
- [x] 没有混合旧方法和新方法
- [x] 注释已更新

---

### 3. PartInspectorPanel.vue ✅

#### 修改位置：_applyLayerHoverBlinkFrame (行 ~763)

**原代码问题：**
```javascript
// ❌ 直接修改并渲染
store.mergedAppearanceData = appearance
activeRenderer.renderPreviewWithItem(appearance)
```

**修改后：**
```javascript
// ✅ 使用堆栈系统
const previewId = `layer-blink-${context.stackIndex}-${context.partIndex}`
store.pushPreview(previewId, 2, appearance, 'layer-blink')
```

**检查清单：**
- [x] 去掉直接赋值
- [x] 去掉直接渲染调用
- [x] previewId 使用动态生成（基于 stackIndex/partIndex）
- [x] 优先级设置为 2（高于资产悬停）
- [x] 正确访问 context 对象属性

**问题修复：**
- ✅ 原来的代码使用 `activeRenderer`，新代码在 store 的 `_updateActivePreview` 中统一处理

#### 修改位置：stopLayerHoverBlink (行 ~813)

**原代码问题：**
```javascript
// ❌ 直接调用 refreshMergedAppearanceData
try { store.refreshMergedAppearanceData() } catch (e) { /* ignore */ }
```

**修改后：**
```javascript
// ✅ 从堆栈移除
const previewId = `layer-blink-${context.stackIndex}-${context.partIndex}`
store.popPreview(previewId)
```

**检查清单：**
- [x] previewId 使用相同的命名规则
- [x] 去掉直接 refresh 调用
- [x] 使用 `popPreview()` 替代
- [x] context 对象正确访问
- [x] 空检查保留：`if (!context) return`

#### 代码一致性
- [x] previewId 生成规则与 _applyLayerHoverBlinkFrame 相同
- [x] 优先级与定义一致
- [x] 其他代码逻辑（setInterval、visibility toggle）保持不变

#### 观察者依赖验证
```javascript
// 这些观察器仍然调用 stopLayerHoverBlink()，确保清理
watch(part, () => { stopLayerHoverBlink() })
watch(updateFlag, () => { stopLayerHoverBlink() })
watch(focusedPartIndex, () => { stopLayerHoverBlink() })
watch(selectedLayers, () => { stopLayerHoverBlink() })
```
- [x] 所有观察器仍然在调用清理函数
- [x] 清理现在通过 `popPreview()` 完成

---

## 🔍 交叉依赖检查

### 1. studioStore 中是否有其他地方调用 mergedAppearanceData？

**搜索结果分析：**
- [x] `refreshMergedAppearanceData()` 在 store 中定义 → ✅ 未破坏
- [x] Studio.vue 中有调用 `refreshMergedAppearanceData()` → ✅ 仍然有效
- [x] PartInspectorPanel 中其他地方调用 `refreshMergedAppearanceData()` → ✅ 仍然有效
- [x] AssetSelectorPanel 中其他引用已修改 → ✅ 完成

### 2. renderPreviewWithItem 调用检查

**验证：**
- [x] store 的 `_updateActivePreview()` 中正确调用
- [x] 使用正确的 renderer（`useOptimizedRenderer` 判断）
- [x] 错误处理已加 try-catch
- [x] 其他地方的 renderPreviewWithItem 调用未改变

### 3. 预览数据完整性检查

**验证：**
- [x] `createPreviewDataWithAsset()` 返回的数据格式
- [x] `_buildLayerHoverBlinkAppearance()` 返回的数据格式
- [x] 两种数据都兼容 `renderPreviewWithItem()` 的输入

---

## ✨ 新增方法功能验证

### pushPreview() 功能验证
```javascript
✅ 参数验证：id 和 priority 验证
✅ 去重：如果 ID 已存在则替换
✅ 堆栈操作：push 新预览
✅ 触发更新：调用 _updateActivePreview()
✅ 时间戳记录：用于调试
```

### popPreview() 功能验证
```javascript
✅ 参数验证：id 验证
✅ 数组过滤：使用 filter 正确移除
✅ 触发更新：调用 _updateActivePreview()
```

### _updateActivePreview() 功能验证
```javascript
✅ 堆栈为空处理：调用 refreshMergedAppearanceData()
✅ 优先级排序：正确找出最高优先级
✅ 预览比较：只在改变时更新
✅ 渲染调用：使用正确的 renderer
✅ 错误处理：try-catch 包装
```

### isPreviewActive() 功能验证
```javascript
✅ 简单的 ID 比较
✅ 用于外部查询（虽然当前未使用，但为未来扩展预留）
```

---

## 🎯 集成测试场景

### 单元测试建议
```javascript
// 测试 pushPreview 去重
pushPreview('test', 1, {a:1})
pushPreview('test', 2, {b:2})
// 期望：堆栈中只有一个 'test' 预览，优先级为 2

// 测试优先级排序
pushPreview('low', 1, {})
pushPreview('high', 2, {})
popPreview('high')
// 期望：active 恢复为 'low'

// 测试堆栈为空恢复
pushPreview('test', 1, {})
popPreview('test')
// 期望：调用了 refreshMergedAppearanceData()
```

### 集成测试场景
```javascript
// 场景 1: AssetSelector alone
// 场景 2: PartInspector alone  
// 场景 3: Both active (layer should win)
// 场景 4: Layer hover then unhover (asset should restore)
// 场景 5: Rapid hovering (no crashes, correct final state)
```

---

## 📋 最终检查清单

- [x] 所有修改都已应用
- [x] 没有语法错误
- [x] 变量命名应遵循项目约定
- [x] 代码注释清晰
- [x] 向后兼容性（其他代码不受影响）
- [x] 错误处理完整
- [x] 性能考虑（不过度优化）
- [x] 文档已创建

## 🚀 部署准备

### 前提条件
- [x] 测试用户界面 OK
- [x] 没有控制台错误
- [x] 性能指标 OK
- [x] 文档已更新

### 回滚计划
如果发现问题：
1. 恢复 studioStore.js 的 state 和 actions 修改
2. 恢复 AssetSelectorPanel.vue 的两个函数
3. 恢复 PartInspectorPanel.vue 的两个函数

**影响范围**: 只有 hover 预览功能受影响，其他功能不受影响
