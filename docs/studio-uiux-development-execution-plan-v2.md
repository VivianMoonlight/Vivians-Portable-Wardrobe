# Studio UI/UX V2 可直接开发执行方案
> 对应文档：`docs/studio-uiux-architecture-proposal-v2.md`  
> 目标：把设计提案拆解为可排期、可开发、可验收的组件改造清单

---

## 1. 范围与原则

## 1.1 本次改造范围（Studio 域）
- `src/components/Studio/Studio.vue`
- `PreviewWidget.vue`
- `StackList.vue`
- `PartListPanel.vue`
- `PartInspectorPanel.vue`
- `AssetSelectorPanel.vue`
- `PalettePanel.vue`
- `LayerManagerWidget.vue`
- `HistoryPanel.vue`
- `SavesManager.vue`
- `src/stores/studioStore.*`（若存在拆分模块同样纳入）

## 1.2 不在本轮范围
- FileManager 域重构（`FileManager*`）
- 视觉主题大改（token 体系不重建）
- 后端协议调整（仅前端状态与交互编排）

## 1.3 开发原则
- 先“信息架构与状态机”后“样式微调”。
- 先 Easy 默认可用，再开放 Pro 扩展。
- 所有自动切换都要可覆盖（用户手动 Pin 优先）。

---

## 2. 目标架构（工程视角）

## 2.1 新增核心状态（建议落在 studioStore）

```ts
type WorkspaceMode = 'easy' | 'pro'
type TaskStage = 'assemble' | 'replace' | 'polish' | 'commit'
type PanelId = 'inspector' | 'asset' | 'palette' | 'layer' | 'history' | 'saves'
type PanelState = 'pinned' | 'peek' | 'hidden'

interface StudioUiState {
  workspaceMode: WorkspaceMode
  taskStage: TaskStage
  activeContextPanel: 'inspector' | 'asset' | 'palette'
  panelStates: Record<PanelId, PanelState>
  pinnedPanel: PanelId | null
  mobileTab: 'structure' | 'replace' | 'property' | 'history'
  firstRunGuideDone: boolean
}
```

## 2.2 新增动作（Action）
- `setWorkspaceMode(mode)`
- `setTaskStage(stage)`
- `openContextPanel(panel, reason)`
- `pinPanel(panel)` / `unpinPanel(panel)`
- `setPanelState(panel, state)`
- `onReplaceEnter(payload)` / `onReplaceApplied()`
- `enterPeekPanel(panel)` / `exitPeekPanel(panel)`
- `hydrateUiLayout()` / `persistUiLayout()`

---

## 3. 组件改造清单（可直接开发）

## 3.1 `Studio.vue`（最高优先级）

**改造目标**
- 成为唯一布局编排器：Easy/Pro 工作台切换、任务阶段条、面板可见性裁决。

**具体任务**
1. 顶栏加入：`WorkspaceMode` 切换（Easy/Pro）。
2. 加入任务阶段条：`Assemble/Replace/Polish/Commit`。
3. 重构三栏布局：左结构、中预览、右上下文。
4. 右栏实现“单主面板”容器（Inspector/Asset/Palette 三选一）。
5. 底部挂载 mini history bar（Undo/Redo/Jump）。
6. Pro 模式才显示可选抽屉（Layer/Full History/Saves）。

**依赖**
- 依赖 store 新状态：`workspaceMode/taskStage/activeContextPanel/panelStates`。

**验收标准**
- Easy 模式首屏只出现结构+预览+一个右侧主面板。
- Replace 进入后自动切到 Asset，应用后自动回 Inspector。
- 手动 Pin 面板后不会被自动切走。

---

## 3.2 `PartListPanel.vue`

**改造目标**
- 作为“结构层”入口，驱动 Replace/Polish 任务切换。

**具体任务**
1. 选中部件/空槽时触发 `setTaskStage('replace')`。
2. 触发 `openContextPanel('asset', 'part-selected')`。
3. 分组默认折叠策略统一：仅展开当前组，其余收起。
4. 提供“返回精修”快捷入口（进入 Inspector）。

**验收标准**
- 任意入口（部件/空槽）进入替换时，右栏状态一致且可预期。

---

## 3.3 `AssetSelectorPanel.vue`

**改造目标**
- 纯 Replace 任务面板；应用后自动回流到精修。

**具体任务**
1. 强约束仅在 `taskStage=replace` 或显式打开时可交互。
2. 点击应用资产后触发 `onReplaceApplied()`。
3. `onReplaceApplied()` 默认执行：
   - `setTaskStage('polish')`
   - `openContextPanel('inspector', 'replace-applied')`
4. 保留悬停预览，但增加“未提交提示”状态。

**验收标准**
- 连续替换不出现面板错乱；应用后稳定回到 Inspector。

---

## 3.4 `PartInspectorPanel.vue`

**改造目标**
- 成为统一属性编辑主面板（Single/Multi + Move/View 的最终落点）。

**具体任务**
1. 读取 `taskStage` 动态显示字段：
   - `polish`: 显示颜色/位移/优先级核心项
   - `replace`: 显示只读提示 + 快捷跳 Asset
2. 高级属性区默认折叠，按需展开。
3. 多选模式下默认展开批量字段，折叠单体细节。
4. 保留现有快捷键并补全状态提示文案。

**验收标准**
- 不同任务阶段下，Inspector 内容复杂度可感知下降。

---

## 3.5 `PalettePanel.vue`

**改造目标**
- 从常驻大面板改为“可 Peek 的上下文工具”。

**具体任务**
1. 支持 `enterPeekPanel('palette')` 临时呼出。
2. 颜色应用完成/失焦时自动 `exitPeekPanel('palette')`。
3. 若用户手动 Pin，则保持常驻并禁止自动收回。

**验收标准**
- 默认流程中调色不打断主任务；Pin 后行为稳定。

---

## 3.6 `HistoryPanel.vue`

**改造目标**
- Easy 模式仅保留 mini 历史条；完整时间线放 Pro 抽屉。

**具体任务**
1. 抽离 mini 视图（Undo/Redo/当前节点跳转）。
2. Full History 仅在 Pro 或主动展开时显示。

**验收标准**
- Easy 模式不再出现长时间线滚动区域。

---

## 3.7 `LayerManagerWidget.vue`

**改造目标**
- 作为高级工具，仅在 `taskStage=polish` 且 Pro 模式优先展示。

**具体任务**
1. 与任务阶段联动显示优先级。
2. 非 polish 阶段默认 hidden。

**验收标准**
- 新手流程不会过早暴露图层复杂度。

---

## 3.8 `SavesManager.vue`

**改造目标**
- 里程碑管理入口，不占首屏主空间。

**具体任务**
1. Easy 模式为快捷入口（按钮/抽屉）。
2. Pro 模式可常驻侧栏。
3. 与 Commit 阶段联动强调“保存/导出”动作。

**验收标准**
- 保存能力可达但不干扰主编辑流程。

---

## 3.9 `PreviewWidget.vue`

**改造目标**
- 保持中心反馈稳定，增加任务上下文可见性。

**具体任务**
1. 叠加轻量任务标签（Assemble/Replace/Polish/Commit）。
2. Replace 时显示当前槽位上下文。
3. Move 时强化交互提示（拖拽/退出）。

**验收标准**
- 用户始终知道“我现在在做什么”。

---

## 4. 折叠/可见逻辑实现清单

## 4.1 规则优先级（必须实现）
1. 用户手动 Pin 优先级最高。  
2. 自动任务切换优先级次之。  
3. 默认策略最后生效。

## 4.2 关键规则（代码化）
- `if pinnedPanel === targetPanel => keep`
- `if taskStage === 'replace' => activeContextPanel='asset'`
- `if replaceApplied && pinnedPanel !== 'asset' => activeContextPanel='inspector'`
- `if workspaceMode==='easy' => layer/history/saves default hidden`

## 4.3 持久化键建议
- `studio.ui.workspaceMode`
- `studio.ui.panelStates`
- `studio.ui.pinnedPanel`
- `studio.ui.lastTaskStage`

---

## 5. 迭代计划（按周执行）

## Sprint 1（布局与状态机）
- 完成 store 新状态与 action。
- `Studio.vue` 三栏重排 + 右栏单主面板容器。
- Easy/Pro 切换可用。

**交付物**
- 可运行的 Easy 默认工作台。

## Sprint 2（任务驱动链路）
- 打通 `PartList -> Asset -> Inspector` 自动回流。
- `taskStage` 与面板显示联动。
- mini history bar 上线。

**交付物**
- 新手 3 分钟闭环可走通。

## Sprint 3（高级能力回挂）
- Layer/Full History/Saves 作为 Pro 抽屉接回。
- Palette Peek + Pin 行为稳定化。
- UI 布局持久化。

**交付物**
- Pro 模式效率不低于当前版本。

---

## 6. 开发任务拆分模板（可直接贴到任务系统）

每个任务建议包含：

```text
Title: [StudioV2][Component] <具体改造点>
Scope: 文件 + 状态 + 交互
Input: 依赖的 store 字段/action
Output: UI行为变化 + 事件回调
DoD:
  - 交互验收通过
  - 无控制台错误
  - 移动端基础可用
  - 不回归现有快捷键
Risk:
  - 状态冲突点
  - 回归影响面
```

---

## 7. 回归与验收清单

## 7.1 功能回归
- Stack 新建/复制/重命名/删除正常。
- Part 搜索、显示隐藏、删除流程正常。
- Replace 悬停预览 + 点击应用正常。
- Inspector 单选/多选编辑正常。
- Undo/Redo 与自动保存正常。

## 7.2 交互一致性验收
- 右栏同一时刻仅一个主面板可见。
- 自动切面板不覆盖手动 Pin。
- Easy 模式首屏复杂度明显低于旧版。

## 7.3 性能验收
- Replace 连续应用无明显卡顿。
- 面板切换无抖动与重排闪烁。
- 高频编辑场景（颜色/位移）输入延迟可控。

---

## 8. 风险与应对

1. **状态耦合过高**（Studio.vue 与多个面板互相触发）  
   - 应对：统一事件入口（store action），禁止跨组件直接改可见性。

2. **旧逻辑回归**（现有 replace/multi 逻辑复杂）  
   - 应对：保留兼容开关 `useStudioV2Ui`，逐步放量。

3. **移动端适配成本上升**  
   - 应对：先实现桌面完整闭环，移动端按 4-tab 简化能力映射。

---

## 9. 最终交付定义（Definition of Done）

- 默认进入 Easy Workspace，3 分钟内可完成首次编辑闭环。  
- 关键流程自动化：`Part -> Replace -> Inspect` 可稳定回流。  
- 折叠状态机统一：Pinned/Peek/Hidden 在各面板行为一致。  
- Pro 能力完整可用，且不弱于当前生产效率。  
- 无关键回归（替换、历史、保存、导出、快捷键）。
