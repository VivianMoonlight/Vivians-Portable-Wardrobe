# service / utils 二级结构治理计划（取消 composables）

> 项目：Vivians-Portable-Wardrobe  
> 范围：`src/services`、`src/utils`（`src/composables` 进入淘汰流程）  
> 日期：2026-02-22

---

## 0. 决策变更（2026-02-22）

从本次版本起，架构目标调整为：

1. **取消 composables 作为长期层级**。
2. **只保留 service/utils 二级结构**。
3. 组件层调用路径统一为：`component -> services -> utils`。

说明：已存在 composables 作为历史兼容层，全部进入 `@deprecated` 迁移周期，最终移除目录。

---

## 1. 目标结构定义（最终态）

## 1.1 Service 层（业务编排与领域规则）

职责：

- 承载业务规则、状态编排、跨模块流程。
- 对组件提供稳定业务 API。
- 可以依赖 `utils`，不反向依赖组件。

典型模块：

- `PaletteService`
- `DialogService`
- `LayerTranslator`
- `AssetIndexService`
- `RenderService` / `OptimizedRenderService`
- `StudioStorageService` 等

## 1.2 Utils 层（基础能力与宿主桥接）

职责：

- 提供纯工具函数、宿主桥接、底层 API 适配。
- 不承载业务流程状态。

典型模块：

- `host-window`
- `clone`
- `performance`
- `color-hls`
- `AssetApi` / `RenderApi`
- `canvas` 等

---

## 2. composables 处置策略

`src/composables/*` 全部标记为淘汰对象，策略如下：

- 立即：全部加 `@deprecated`（已部分完成，后续补齐全部文件）。
- 过渡期：仅允许“被动兼容导出”，禁止新增调用方。
- 迁移期：把逻辑下沉到 `services/*`（业务）或 `utils/*`（纯工具）。
- 终态：删除 `src/composables` 目录及相关导出。

---

## 3. 分阶段执行计划

## Phase 1：架构冻结与入口收敛（当前阶段）

目标：冻结 composables 增量、明确二级结构边界。

任务：

- 保留并强化 `src/services/index.js`、`src/utils/index.js` 作为统一导出。
- `src/composables/*` 全量 `@deprecated`，并在文档登记迁移目标。
- 新增 `runtimeEnv`（基于 `host-window`）作为宿主访问建议入口。
- README/架构文档明确：禁止新增 `@/composables/*` 依赖。

完成标准：

- 新代码不再新增 composables 引用。
- 对外调用说明中仅保留 service/utils 两级。

## Phase 2：业务迁移（重点阶段）

目标：把现有 composables 使用点迁移到 service。

任务：

- 为高频链路建立 service facade：
  - `DialogFacadeService`（或在 `DialogService` 内聚合）
  - `PaletteWorkflowService`
  - `ThemeService`（承接 `useTheme` / `useThemedIntegration`）
  - `WindowLayoutService`（承接拖拽缩放响应式）
- 组件改为直接调用 service API，移除 `use*` 调用。
- 清理 store 与 service 的重复编排职责，避免双入口。

完成标准：

- 组件层 `@/composables/*` 引用降为 0。
- 关键页面（Studio / FileManager）仅通过 service/utils 工作。

## Phase 3：移除与收尾

目标：彻底删除 composables 层。

任务：

- 删除 `src/composables` 目录及其 index 导出。
- 删除兼容别名与过渡文档。
- 对外文档、开发规范、脚手架模板全面更新。

完成标准：

- 仓库中不再存在 `use*.js` 组合式封装层。
- 架构图与目录结构与代码一致。

---

## 4. 迁移优先级（按风险/收益）

1. `useTheme` / `useThemedIntegration`（当前调用最多，先迁移）。
2. `useWindowDragResize` / `useAutoSave` / `useUndoRedo`（Studio 主链路）。
3. 其余低调用与零调用 composables（直接清退或并入 service/utils）。

---

## 5. 规则与约束（立即生效）

- 禁止新增 `import ... from '@/composables/*'`。
- 允许修改旧 composables 仅用于迁移，不新增功能。
- 新功能必须落在 `services/*` 或 `utils/*`。
- 组件中出现业务流程代码，优先抽到 `services/*`。

---

## 6. 当前状态（2026-02-22）

- ✅ 已建立 `src/services/index.js` 与 `src/utils/index.js` 统一导出。
- ✅ 已新增 `src/utils/runtimeEnv.js`，作为宿主访问建议入口。
- ✅ 已完成所有 composables 的 `@deprecated` 标记。
- ✅ 已移除 `src/composables/index.js` 聚合出口，避免新增入口。
- ✅ Phase 2 第一批已完成：`ThemeService`、`AutoSaveService`、`UndoRedoService`、`WindowLayoutService` 已改为真实 service 实现（非 composable 门面）。
- ✅ 已删除已迁移 composables：`useTheme`、`useThemedIntegration`、`useAutoSave`、`useUndoRedo`、`useWindowDragResize`。
- ✅ 已完成剩余 composables 清理（`useDraggableWindow`、`useResponsive`、`useSaveStatus`、`useStudioIO`）。
- ✅ `src/composables` 代码文件已全部移除，进入目录删除收尾阶段。

---

## 7. 后续维护

- 每周一次检查 `@/composables/*` 引用数，目标持续下降至 0。
- 每个迁移 PR 必须包含“旧入口 -> 新入口”映射说明。
- 若发现 service 过重，优先拆分为多个 service，而不是恢复 composable 层。
