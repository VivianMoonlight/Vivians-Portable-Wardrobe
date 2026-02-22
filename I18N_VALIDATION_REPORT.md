# i18n 本地化验证报告

**生成时间**: 2026-02-20  
**工作区**: Vivians-Portable-Wardrobe

---

## 概览

| 指标 | 数值 |
|------|------|
| zh.json 中定义的键数 | 354 |
| en.json 中定义的键数 | 354 |
| 代码中使用的键数 | 285 |

---

## 验证结果

### ✓ 已验证通过的键 (264 个)

两个本地化文件中都有定义且在代码中使用的键。

**示例**（前 20 个）:
1. `assetRender.ariaLabel`
2. `assetRender.asset`
3. `assetRender.loading`
4. `assetRender.part`
5. `assetRender.placeholder`
6. `assetRender.retry`
7. `assetRender.stop`
8. `assetRender.title`
9. `assetSelector.alertApplyFailed`
10. `assetSelector.alertNoReplaceMode`
11. `assetSelector.apply`
12. `assetSelector.applyTitle`
13. `assetSelector.ariaLabel`
14. `assetSelector.candidatesLabel`
15. `assetSelector.groupLabel`
16. `assetSelector.loading`
17. `assetSelector.noMatches`
18. `assetSelector.notInReplaceModePlaceholder`
19. `assetSelector.refreshTitle`
20. `assetSelector.searchAria`

... 及 244 个其他键

---

## ⚠️ 需要修复的问题

### ✗ 两个文件中都缺少的键 (21 个)

这些键在代码中被使用，但在 `zh.json` 和 `en.json` 中都没有定义。需要添加这些键的翻译。

1. `batchEdit.skipped`
2. `colorableLayer.collapse`
3. `colorableLayer.expand`
4. `colorableLayer.selectLayer`
5. `historyViewer.apply`
6. `historyViewer.cancel`
7. `historyViewer.delete`
8. `historyViewer.loadToPreview`
9. `layerGroup.collapse`
10. `layerGroup.expand`
11. `layerGroup.selectAll`
12. `palette.actions.apply`
13. `partInspector.advancedPropertiesTitle`
14. `partInspector.applyTo`
15. `partInspector.applyToCurrentLayer`
16. `partInspector.corePropertiesTitle`
17. `partInspector.layers`
18. `partInspector.selectType`
19. `studio.layersSelected`
20. `studio.replaceMode`
21. `studio.visualMoveMode`

**状态**: 同时缺少中文和英文翻译
**优先级**: 高 - 这些键在代码中被使用，可能导致 UI 显示缺失翻译

### ✗ 只在 zh.json 中有，但在 en.json 中缺失 (0 个)

所有在 zh.json 中使用的键都在 en.json 中对应定义。✓

### ✗ 只在 en.json 中有，但在 zh.json 中缺失 (0 个)

所有在 en.json 中使用的键都在 zh.json 中对应定义。✓

---

## 📊  各类别统计

### 使用状态

| 状态 | 数量 | 百分比 |
|------|------|--------|
| 两个文件都有（已用） | 264 | 92.6% |
| 只在 zh.json（已用） | 0 | 0.0% |
| 只在 en.json（已用） | 0 | 0.0% |
| 两个文件都缺少（已用） | 21 | 7.4% |

### 定义但未使用的键 (90 个)

定义在本地化文件中，但在代码中没有实际使用的键。这些可能是：
- 已弃用的功能
- 备用翻译
- 预留的翻译

**示例**（前 10 个）:
- `assetRender` (分类键)
- `assetSelector` (分类键)
- `batchEdit`
- `batchEdit.apply`
- `batchEdit.layersSelected`
- `batchEdit.title`
- `batchEdit.visualMoveMultiple`
- `colorableLayer` (分类键)
- `colorableLayer.offsetX`
- `colorableLayer.offsetY`

... 及 80 个其他键

---

## 建议

1. **立即处理**: 为 21 个缺失的键添加翻译（中文和英文）
   - 建议所有缺失的键都应该添加到两个文件中
   
2. **优化**: 考虑是否真的需要所有 90 个未使用的键
   - 如果确实是弃用的功能，可以考虑从 locale 文件中删除
   - 如果是备用翻译，建议在代码中添加注释说明用途

3. **文件完整性**: 两个 locale 文件的结构一致，没有单边缺少的键 ✓

---

## 使用的分析工具

- **搜索范围**: `src/**/*.vue` 和 `src/**/*.js` 文件
- **提取模式**: `$t('...')`、`t('...')` 和 `i18n.t('...')`
- **locale 文件**: `locales/zh.json` 和 `locales/en.json`
