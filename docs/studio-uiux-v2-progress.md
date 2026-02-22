# Studio UI/UX V2 重构进度表

> 独立跟踪文档（仅跟踪 Studio V2）
> 基线方案：`docs/studio-uiux-development-execution-plan-v2.md`

## 总览

| 模块 | 任务 | 状态 | 负责人 | 最后更新 |
|---|---|---|---|---|
| 状态机 | 新增 `workspaceMode/taskStage/panelStates/pinnedPanel/mobileTab` | ✅ 已完成 | Copilot | 2026-02-21 |
| 状态机 | 新增 Action：`setWorkspaceMode/openContextPanel/pinPanel/onReplaceEnter/onReplaceApplied/hydrate/persist` | ✅ 已完成 | Copilot | 2026-02-21 |
| Studio 布局 | Easy/Pro 切换入口（顶部） | ✅ 已完成 | Copilot | 2026-02-21 |
| Studio 布局 | 任务阶段条（Assemble/Replace/Polish/Commit） | ✅ 已完成 | Copilot | 2026-02-21 |
| Studio 布局 | 三栏基线（结构/预览/上下文） | ✅ 已完成 | Copilot | 2026-02-21 |
| Studio 布局 | 右栏单主面板（Inspector/Asset/Palette） | ✅ 已完成 | Copilot | 2026-02-21 |
| Studio 布局 | 底部 mini history bar（Undo/Redo/Jump） | ✅ 已完成 | Copilot | 2026-02-21 |
| Replace 链路 | `Part -> Replace` 自动进入 Asset | ✅ 已完成（store 接管） | Copilot | 2026-02-21 |
| Replace 链路 | `Apply -> Polish + Inspector` 自动回流 | ✅ 已完成（store 接管） | Copilot | 2026-02-21 |
| Pro 抽屉 | Layer/History/Saves 受 `workspaceMode=pro` 控制 | ✅ 已完成（基线） | Copilot | 2026-02-21 |
| 移动端 | 4-tab：结构/替换/属性/历史 | ✅ 已完成（基线） | Copilot | 2026-02-21 |
| 持久化 | `studio.ui.*` 本地持久化 | ✅ 已完成 | Copilot | 2026-02-21 |

## 下一步（短期）

| 优先级 | 事项 | 目标文件 | 状态 |
|---|---|---|---|
| P0 | 将 PartList 的“返回精修”显式入口做成可见按钮 | `PartListPanel.vue` | ✅ 已完成 |
| P0 | 让 Inspector 按 `taskStage` 降噪显示字段 | `PartInspectorPanel.vue` | ✅ 已完成 |
| P1 | Palette 的 Peek 失焦收回细化（含 Pin 优先） | `PalettePanel.vue` + `Studio.vue` | ✅ 已完成 |
| P1 | Easy 模式下 Full History 与 mini history 的交互一致性 | `Studio.vue` | ✅ 已完成 |
| P1 | 左栏活页式（Stack -> Part -> Layer）并将 Inspector 左移 | `Studio.vue` | ✅ 已完成 |
| P1 | 活页任务联动增强 + 活页文案语义化 | `Studio.vue` | ✅ 已完成 |
| P1 | 活页文案个性化（stacks / 当前stack名 / 当前部件名） | `Studio.vue` | ✅ 已完成 |
| P1 | Palette 高级赋色模式（Color Tag + HLS 偏移）方案设计与实施排期 | `docs/palette-color-tag-hls-advanced-mode-plan.md` | ✅ 已完成（MVP 实施） |
| P0 | Part List 导航现代化实施（Group Rail + Quick Jump + Recent + 快捷键） | `PartListPanel.vue` | ✅ 已完成（M1/M2 核心） |
| P1 | Part List 大规模 group/slot 导航现代化方案设计（索引+直达） | `docs/part-list-navigation-modernization-plan.md` | ✅ 已完成（已进入实施） |
| P2 | 首次引导（3~5 步）骨架与开关 | `Studio.vue` + store | ⏳ 未开始 |

## 变更记录

- 2026-02-21：完成 Sprint 1 基线（状态机、三栏布局、右栏单主面板、Replace 自动回流、独立进度表建立）。
- 2026-02-21：完成 P0（PartList 返回精修入口；Inspector 按 taskStage 降噪，replace 阶段只读提示 + 跳转 Asset）。
- 2026-02-21：完成 P1（Palette 在 peek 且未 pin 时支持失焦自动收回；颜色应用后自动收回 peek；Full History 改为“非移动端且主动展开即显示”，mini history 在 Full History 显示时自动隐藏）。
- 2026-02-22：完成左栏活页式 UI（Stack List -> Part List -> Layer List），并将桌面端 Inspector 整合进左栏；右栏保留 Asset/Palette 上下文。
- 2026-02-22：完成活页任务联动增强（按 taskStage/选中栈/聚焦部件自动翻页）与活页文案语义化（造型栈/部件列表或替换/图层属性或精修）。
- 2026-02-22：活页文案改为动态个性化显示：`stacks` / 当前选中 stack 名称 / 当前聚焦 part 名称，并对长文案做省略显示 + title 提示。
- 2026-02-22：新增 `docs/palette-color-tag-hls-advanced-mode-plan.md`，完成 Palette “Color Tag + HLS 偏移”高级赋色模式的 UIUX 融合设计与分 Sprint 实施计划。
- 2026-02-22：完成 Palette 高级赋色模式 MVP 实施：`PaletteService` 支持 `tag|h/l/s` DSL 解析与展开，`studioStore`/`palette-actions` 新增 Apply/Reset/Detach 动作，`PalettePanel` 接入 Advanced 折叠区与 Suggest 流程，并补齐中英文案。
- 2026-02-22：新增 `docs/part-list-navigation-modernization-plan.md`，完成 Part List 面向高复杂度 group/slot 的导航现代化方案（Group Rail + Quick Jump + Recent/Pinned + 快捷键）与分 Sprint 执行计划。
- 2026-02-22：完成 Part List 导航现代化第一轮实施（`PartListPanel.vue`）：双栏结构（Group Rail + 当前组 Slot List）、Quick Jump（支持 `g:/s:/used/empty`）、Recent Slots、`Ctrl/Cmd+K`、`[`/`]`、`Alt+↑/↓`，并加入自动定位与高亮回显。

## 校验记录

| 时间 | 校验项 | 结果 |
|---|---|---|
| 2026-02-21 | `npm run build` | ✅ 构建通过；存在既有告警（`palette-actions.js` 引用 `PaletteService.js` 未导出的符号），与本次改造无直接关系 |
| 2026-02-21 | `npm run build`（P0变更后） | ✅ 构建通过；同样存在既有告警（`palette-actions.js` 导出不匹配），与本次改动无直接关系 |
| 2026-02-21 | `npm run build`（P1变更后） | ✅ 构建通过；存在既有告警（`palette-actions.js` 引用 `PaletteService.js` 未导出符号），与本次改动无直接关系 |
| 2026-02-22 | `npm run build`（左栏活页式+Inspector左移） | ✅ 构建通过；存在既有告警（`palette-actions.js` 引用 `PaletteService.js` 未导出符号），与本次改动无直接关系 |
| 2026-02-22 | `npm run build`（活页任务联动增强+文案语义化） | ✅ 构建通过；存在既有告警（`palette-actions.js` 引用 `PaletteService.js` 未导出符号），与本次改动无直接关系 |
| 2026-02-22 | `npm run build`（活页文案个性化） | ✅ 构建通过；存在既有告警（`palette-actions.js` 引用 `PaletteService.js` 未导出符号），与本次改动无直接关系 |
| 2026-02-22 | `npm run build`（PartList 导航现代化第一轮实施） | ✅ 构建通过 |
