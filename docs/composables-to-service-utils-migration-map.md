# composables -> service/utils 迁移映射

> 日期：2026-02-22  
> 目标架构：`component -> services -> utils`

---

## 1. 总体原则

- `use*` 逻辑不再新增。
- 业务编排迁移到 `services/*`。
- 纯工具保留在 `utils/*`。
- 迁移期间允许 composables 保持兼容，但统一标记 `@deprecated`。

---

## 2. 模块映射清单

| 旧入口（composables） | 迁移目标 | 分类 | 状态 |
|---|---|---|---|
| `useTheme` | `services/ThemeService` | 业务编排 | 已完成并删除旧文件 |
| `useThemedIntegration` | `services/ThemedIntegrationService`（由 `ThemeService` 调用） | 业务编排 | 已完成并删除旧文件 |
| `useAutoSave` | `services/AutoSaveService` | 业务编排 | 已完成并删除旧文件 |
| `useUndoRedo` | `services/UndoRedoService` | 业务编排 | 已完成并删除旧文件 |
| `useWindowDragResize` | `services/WindowLayoutService` | 业务编排 | 已完成并删除旧文件 |
| `useDraggableWindow` | 合并到 `services/WindowLayoutService` 或删除 | 业务编排 | 待清理 |
| `useResponsive` | 合并到 `services/WindowLayoutService` 或组件内联 | 业务编排 | 待清理 |
| `useSaveStatus` | 合并到 `services/StudioStorageService` 辅助 API | 业务编排 | 待清理 |
| `useStudioIO` | 拆分到 `services/StudioStorageService` + `services/DialogService` | 业务编排 | 待清理 |
| `useDraggableWindow` | 删除（未使用） | 业务编排 | 已完成并删除旧文件 |
| `useResponsive` | 删除（未使用） | 业务编排 | 已完成并删除旧文件 |
| `useSaveStatus` | 删除（未使用） | 业务编排 | 已完成并删除旧文件 |
| `useStudioIO` | 删除（未使用） | 业务编排 | 已完成并删除旧文件 |

---

## 3. 当前引用热点（优先迁移）

1. `useStudioIO`（导入导出流程）
2. `useSaveStatus`（保存状态展示）
3. `useResponsive`（响应式状态）
4. `useDraggableWindow`（旧窗口拖拽实现）

---

## 4. 执行顺序建议

### Step A（先做）
- 建立 `ThemeService`，替换所有 `useTheme` / `injectTheme` 调用。

进度（2026-02-22）：
- ✅ 已创建 `services/ThemeService.js`（真实实现）
- ✅ 主题相关组件导入已从 `composables/useTheme` 切换到 `services/ThemeService`

### Step B
- 建立 `UndoRedoService`、`AutoSaveService`，替换 `Studio.vue` 中 `useUndoRedo` / `useAutoSave`。

进度（2026-02-22）：
- ✅ 已创建 `services/UndoRedoService.js` 与 `services/AutoSaveService.js`（真实实现）
- ✅ `Studio.vue` 导入已切换到 service 入口

### Step C
- 建立 `WindowLayoutService`，替换 `BaseWindow.vue` 对 `useWindowDragResize` 的调用。

进度（2026-02-22）：
- ✅ 已创建 `services/WindowLayoutService.js`（真实实现）
- ✅ `BaseWindow.vue` 导入已切换到 service 入口

补充（2026-02-22）：
- ✅ 已删除 5 个已迁移 composable 文件：`useTheme`、`useThemedIntegration`、`useAutoSave`、`useUndoRedo`、`useWindowDragResize`

### Step D（收尾）
- 删除已无引用 composables 文件。
- 最终删除 `src/composables` 目录。

进度（2026-02-22）：
- ✅ 已删除剩余 4 个 composable 文件：`useDraggableWindow`、`useResponsive`、`useSaveStatus`、`useStudioIO`
- ✅ 代码层面 composables 已清空（无引用）
