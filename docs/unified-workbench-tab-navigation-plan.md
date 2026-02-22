# VPW 单窗口标签页整合与衣柜模块 UI 改造计划书

> 日期：2026-02-22  
> 目标：将「衣柜模块」「历史记录模块」「Studio 模块」整合到同一个工作窗口，以标签页导航统一操作入口，并在不牺牲现有能力的前提下显著降低学习成本与操作跳转成本。

---

## 1. 现状总览（基于当前实现）

## 1.1 当前模块组织方式
- `App.vue`：只负责悬浮入口按钮和 `FileManagerPanel` 显隐。
- `FileManagerPanel.vue`：主窗口壳，内部在主区切换 `FileManager` 与 `HistoryViewer`（通过 `showHistory` 布尔开关）。
- `Studio/Studio.vue`：独立浮窗，通过 `FileManagerPanel` 头部按钮（🎨）单独弹出。

这意味着当前用户心智是：
1) 进入衣柜主窗；2) 在衣柜/历史之间切换；3) 需要时再打开另一个 Studio 独立窗。

## 1.2 当前交互优势
- 能力完整，模块边界清晰。
- 文件管理和历史回看已支持嵌入模式（`embedded`）。
- Studio 已有成熟的高密度编辑工作流与移动端内部 tab。

## 1.3 当前关键问题（整体 UI）
- **窗口分裂**：衣柜/历史在一个窗，Studio 在另一个窗，跨模块操作需要视觉与焦点切换。
- **入口语义不统一**：头部图标按钮承担“模块切换 + 功能动作”混合职责，新用户难以理解。
- **状态不可见**：当前没有明确的“你正在哪个模块”的全局导航状态。
- **学习路径不连续**：典型路径“选衣柜文件 → 看历史 → 进 Studio 精修”中断明显。
- **移动端映射弱**：Studio 内部有 tab，但全局层（衣柜/历史/Studio）没有统一 tab 模型。

---

## 2. 目标架构：单窗口 Workbench + 顶部标签页

## 2.1 目标信息架构
将现有交互升级为统一工作台：

- **一个窗口壳（Workbench Shell）**
  - 保留当前拖拽、缩放、主题、关闭能力。
- **一个全局标签栏（Global Tabs）**
  - 标签：`衣柜` / `历史` / `Studio`
- **一个内容区域（Tab Content）**
  - 各模块按标签切换展示，不再弹出第二个主窗。

## 2.2 标签页语义与行为规范
- 默认进入：`衣柜`。
- 标签切换不关闭状态：各标签内部滚动位置与局部状态可回访。
- 最近访问标签持久化：重开窗口恢复上次标签。
- 键盘快捷：
  - `Ctrl/Cmd + 1` 衣柜
  - `Ctrl/Cmd + 2` 历史
  - `Ctrl/Cmd + 3` Studio
  - `Ctrl/Cmd + Tab` 下一个标签

## 2.3 桌面与移动统一策略
- 桌面：标题栏下方固定全局标签条。
- 移动端：保留顶部 3-tab 全局切换；Studio 内部 4-tab（结构/替换/属性/历史）继续保留。
- 优先级：全局 tab > Studio 内部 tab，避免层级冲突。

---

## 3. 作为 UI 设计专家给出的衣柜模块专项修改意见

以下建议聚焦 `FileManager.vue`（衣柜）在“高频检索 + 快速应用”场景中的可用性。

## 3.1 信息层级优化（先看什么，后做什么）
- **问题**：顶部动作 + 搜索 + 面包屑都在，但信息优先级不稳定。
- **建议**：固定三段式头部：
  1) 路径与上下文（面包屑）
  2) 检索区（搜索、范围切换、清空）
  3) 动作区（新建、刷新等）
- **收益**：用户先定位，再检索，再执行动作，认知路径稳定。

## 3.2 动作语义优化（减少图标猜测）
- **问题**：仅图标按钮较多（尤其跨模块入口时代）。
- **建议**：
  - 衣柜模块内保留 icon-only，但在 hover/长按时显示明确文案。
  - 关键高风险动作（删除/清空）保持二次确认并突出 danger 语义。
  - 对“范围切换（当前/全局）”显示文本 chip（`当前目录` / `全局`），不只靠 🌐 图标。

## 3.3 列表扫描效率优化（找得更快）
- **问题**：大目录下扫描成本高。
- **建议**：
  - 增加「排序入口」：最近修改 / 名称 / 类型。
  - 增加「快速过滤 chip」：`文件夹`、`套装`、`角色快照`。
  - 保持当前拖拽逻辑，但强化拖拽落点反馈（目标目录高亮）。

## 3.4 预览与筛选侧栏策略优化
- **问题**：桌面双侧栏信息密度高，移动端通过 toggle 切换，状态感偏弱。
- **建议**：
  - 侧栏增加折叠状态标识（图标 + 文本）。
  - 侧栏折叠状态持久化（按设备宽度分别存储）。
  - 在衣柜 tab 中将“预览优先”设为默认，筛选栏按需展开。

## 3.5 空状态与新手引导
- 空目录时给出一级 CTA：`导入衣柜` / `新建文件夹`。
- 搜索无结果时给出快捷恢复：`清空关键词` + `切换到全局搜索`。

---

## 4. 完整改造方案（可直接落地）

## 4.1 新增工作台状态模型（建议新 store）

建议新增 `src/stores/workbenchStore.js`：

```ts
type WorkbenchTab = 'wardrobe' | 'history' | 'studio'

interface WorkbenchState {
  activeTab: WorkbenchTab
  lastTab: WorkbenchTab
  tabVisitOrder: WorkbenchTab[]
  tabScrollState: Record<WorkbenchTab, { x: number; y: number }>
  wardrobeUi: {
    searchScope: 'current' | 'all'
    sortBy: 'recent' | 'name' | 'type'
    leftPanelCollapsed: boolean
    rightPanelCollapsed: boolean
  }
}
```

持久化键建议：
- `vpw.workbench.activeTab`
- `vpw.workbench.wardrobeUi`

## 4.2 组件职责重组

### A. `FileManagerPanel.vue`（升级为 Workbench Shell）
- 新增全局 tab 导航条（衣柜/历史/Studio）。
- 删除旧的二元切换按钮语义（`showHistory` 只做兼容过渡）。
- Studio 入口按钮从“打开弹窗”改为“切换到 Studio 标签”。

### B. `Studio.vue`（新增嵌入模式）
- 增加 `embedded`（或 `inWorkbench`）模式：
  - 嵌入时不再渲染外层遮罩与独立窗框；
  - 保留原内部工作区与工具栏。
- 旧弹窗模式保留一段时间作为 feature flag 回滚通道。

### C. `FileManager.vue` / `HistoryViewer.vue`
- 保持 embedded 模式主干不变。
- 衣柜模块按 3.1~3.5 的建议微调头部结构和动作语义。

## 4.3 推荐视觉稿结构（文本线框）

```text
┌─────────────────────────────────────────────────────────┐
│ VPW Workbench                               [主题][关闭] │
├─────────────────────────────────────────────────────────┤
│ [衣柜] [历史] [Studio]                                 │
├─────────────────────────────────────────────────────────┤
│ Tab Content                                             │
│  - 衣柜: 预览 | 文件列表 | 筛选                          │
│  - 历史: 时间记录列表                                    │
│  - Studio: 结构/替换/属性/历史 (原 Studio 内部)          │
└─────────────────────────────────────────────────────────┘
```

---

## 5. 分阶段实施计划（Sprint）

## Sprint 1（P0）：全局 tab 骨架落地
- 在 `FileManagerPanel.vue` 增加 tab 状态与导航 UI。
- 将衣柜/历史切换从布尔改为枚举 tab。
- Studio 按钮改为切换 tab（仍可临时保持旧弹窗备用）。

**验收**：用户在单窗内可完成衣柜↔历史↔Studio 基本切换。

## Sprint 2（P0）：Studio 嵌入化
- `Studio.vue` 支持 embedded 模式。
- Workbench 中渲染 `Studio` 内容，不再开启独立窗。
- 验证拖拽/缩放行为只保留一套壳逻辑。

**验收**：不存在“双主窗体”并行；Studio 主要能力无回归。

## Sprint 3（P1）：衣柜模块体验升级
- 按 3.1~3.5 实施头部信息层级、搜索语义、过滤/排序、空状态。
- 移动端优化侧栏状态感与持久化。

**验收**：衣柜模块在大目录下检索效率与操作可理解性明显提升。

## Sprint 4（P1）：键盘与可访问性完善
- 完成全局 tab 快捷键与 ARIA 语义：
  - `role="tablist"`, `role="tab"`, `role="tabpanel"`。
- 补齐焦点管理：切 tab 后焦点进入当前面板首个可交互元素。

**验收**：键盘-only 用户可完成全路径操作。

---

## 6. 影响文件清单（建议）

- `src/components/FileManagerPanel.vue`（主改造）
- `src/components/Studio/Studio.vue`（新增嵌入模式）
- `src/components/FileManager.vue`（衣柜专项优化）
- `src/components/HistoryViewer.vue`（tab 面板语义适配）
- `src/stores/workbenchStore.js`（新增）
- `src/locales/zh-CN.json` / `src/locales/en-US.json`（tab 与新文案）

---

## 7. 风险与规避

- **风险 1：Studio 嵌入改造回归面广**  
  规避：先引入 `embedded` 分支，不立即删除旧弹窗路径；通过 feature flag 渐进切换。

- **风险 2：窗口行为冲突（拖拽/缩放重复）**  
  规避：Workbench 统一壳负责窗口行为，Studio 在嵌入模式禁止重复窗口控制。

- **风险 3：用户习惯迁移成本**  
  规避：首版保留“快速切回上一个标签”与简短引导提示。

---

## 8. 验收指标（量化）

- 从衣柜到 Studio 的切换步骤：从“切窗+定位”降为“一次 tab 点击/快捷键”。
- 新用户完成“选择套装→查看历史→Studio 精修”流程成功率提升。
- 衣柜模块检索成功时间（大目录）目标下降 30%+。

---

## 9. Filter 栏专项改造（slot 可视化 + 应用模式）

### 9.1 用户痛点复盘
- 现有 `select-filter` 只能看“是否选中”，看不到：
  - 当前角色在哪些 slot 上已有部件；
  - 当前 hover 套装在哪些 slot 上有内容。
- 应用逻辑单一，无法表达三类常见意图：
  - 仅补空位；
  - 可替换并补齐；
  - 完全按选中 slot 覆盖。
- 缺少“按选中 slot 移除部件”的快捷路径。

### 9.2 交互方案（已落地）
- 在 Filter 栏新增 **slot 状态图例**：
  - `C` = 角色当前拥有该 slot；
  - `H` = 当前 hover 套装包含该 slot。
- 在每个 filter item 上增加状态标记与边框语义，支持快速扫描“C/H/CH”。
- 在 Filter 栏新增 **应用模式切换**（与 select-filter 同步工作）：
  - `仅增添空槽`：只向角色当前为空的选中 slot 添入部件；
  - `增添并替换`：对 hover 套装中存在的选中 slot 进行覆盖，不清空缺失 slot；
  - `完全置换`：先清空全部选中 slot，再按 hover 套装写入（缺失即清空）。
- 新增动作按钮：
  - `按模式应用`；
  - `移除选中槽位`。

### 9.3 实现落点
- `src/stores/fileSystemStore.js`
  - 新增 `applyMode` 状态与 `setApplyMode`。
  - 新增 `slotPresenceMap`（角色 vs hover 套装 slot 对比）。
  - 新增 `applyFilteredOutfitToCharacter` 与 `removeSelectedSlotsFromCharacter`。
- `src/components/FilterManager.vue`
  - 新增模式区、图例区、应用/移除动作。
  - filter item 增加 `C/H` 状态标签。
- `src/components/FileItem.vue`
  - 文件双击/右键“应用到角色”改为走新模式化应用逻辑。

### 9.4 验收标准（专项）
- 用户可在 Filter 栏直接识别角色 slot 与 hover 套装 slot 的重合/差异。
- 三种应用模式能在同一组 select-filter 下得到可预期结果。
- `移除选中槽位` 仅影响当前选中的 slot，不影响未选中 slot。
- 关键负反馈（误点、找不到入口、切错窗口）明显下降。

---

## 9. 结论

你当前产品的核心问题不是“功能不够”，而是“能力分散在多个窗口导致心智割裂”。  
采用「单窗口 Workbench + 全局标签页」后，能够把衣柜、历史、Studio 串成一条连续工作流；再叠加衣柜模块的信息层级和检索语义优化，可以同时提升新手可学性与高频用户效率。
