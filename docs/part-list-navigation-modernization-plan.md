# Part List 导航现代化改造计划（面向 Group / Slot 高复杂度场景）

> 日期：2026-02-22  
> 背景：当前 Part List 在 group 与 slot 数量较多时，用户难以快速、准确定位目标 slot。  
> 目标：以最小学习成本提升“找得到、跳得快、选得准”的导航效率。

---

## 1. 现状分析（基于当前 `PartListPanel.vue`）

当前结构是“按 group 的卡片列表 + 组内 part/empty slot 行项”，并提供搜索、展开/折叠、显示隐藏组、显示空槽位等能力。该结构在中小规模下可用，但在高复杂度造型下出现以下问题：

### 1.1 主要痛点
- **滚动负担高**：大量 group + 大量 slot 导致纵向列表过长，目标通常在视口外。
- **定位路径长**：用户需要“先找组，再找槽”，缺少高效跨组跳转入口。
- **识别成本高**：当前搜索结果仍附着在原列表层级中，命中后不够“直达”。
- **上下文容易丢失**：切换 Replace/Polish、展开/折叠后，用户容易失去“我现在在哪个 group/slot”。
- **高频目标不可复用**：常用 slot 没有收藏/最近访问机制，重复操作成本高。

### 1.2 设计机会点
- 把“浏览式导航”升级为“浏览 + 跳转”双通道。
- 把“线性滚动查找”升级为“索引定位 + 模糊检索 + 快捷回访”。
- 把“列表状态”升级为“任务上下文状态”（当前目标、最近目标、固定目标）。

---

## 2. 目标体验（UX North Star）

在任意规模数据下，用户都可以在 **2 步内** 到达目标 slot：
1. 输入关键词或选择索引（group/slot）；
2. 回车/点击即跳转并聚焦。

成功标准：
- 首次定位目标 slot 的平均时间下降（目标：降低 40%+）。
- 错选率下降（目标：降低 30%+）。
- 重复定位（同一会话内）时间显著下降（目标：降低 50%+）。

---

## 3. 交互方案（更直观、便捷、现代）

## 3.1 信息架构：三层导航模型

将 Part List 从“单层滚动列表”升级为“三层导航”：

1. **Group Rail（左侧索引列）**
   - 以紧凑列表显示所有 group（可含计数：已占用/总槽位）。
   - 支持快速点击跳组、键盘上下切换组。
   - 当前组高亮，隐藏组用弱化样式。

2. **Slot List（中间主列表）**
   - 仅展示“当前组”slot（含已占用与空槽）。
   - 支持排序：`已占用优先 / 名称排序 / 最近编辑优先`。
   - 行内保留当前已有操作（替换、显隐、删除），减少迁移成本。

3. **Quick Jump（顶部命令式跳转）**
   - 类似 Command Palette：输入即可跨组检索 `group + slot + asset`。
   - 结果为扁平命中列表，回车后直达目标并自动定位到对应组/槽。
   - 支持关键词语法：`g:`, `s:`, `used`, `empty`（示例：`g:Hair s:Front`）。

> 价值：用户既能“浏览”，也能“直接跳转”；在复杂数据下优先走跳转通道。

## 3.2 核心导航能力

### A. 可视化定位（Where am I）
- 在 Part List 头部增加 **当前位置面包屑**：`Group > Slot > Item`。
- 在 Replace/Polish 切换时固定显示“当前目标槽位”。
- 从 Asset/Inspector 返回时自动滚动并高亮之前目标行（短时闪烁提示）。

### B. 快速到达（How to get there fast）
- 新增 **`Ctrl/Cmd + K` 打开 Quick Jump**。
- 新增 **`[` / `]` 组间跳转**（上一个/下一个 group）。
- 新增 **`Alt + ↑/↓` 槽间跳转**（当前组内）。

### C. 常用目标复用（Do not search twice）
- 增加 **Pinned Slots（固定槽位）** 区块（每组可 pin，或全局 pin）。
- 增加 **Recent Slots（最近访问）** 区块（最近 8~12 条）。
- 在 Quick Jump 结果中优先显示 `Pinned > Recent > Fuzzy`。

## 3.3 视觉与交互细节（现代化但低学习成本）

- **分栏布局**：Group Rail（窄）+ Slot List（宽），减少横向信息噪声。
- **粘性头部**：搜索/筛选/当前位置固定，滚动时不丢上下文。
- **行态反馈统一**：`hover / active / replacing / focused` 语义一致。
- **搜索结果即时高亮**：关键词在 group/slot 名称中高亮。
- **空状态明确引导**：无结果时给出“清除筛选/显示隐藏组”快捷入口。

---

## 4. 最小可行版本（MVP）范围

为避免一次性重构过大，MVP 先做“导航提效主路径”：

### M1（必须）
1. Group Rail（组索引跳转）
2. Quick Jump（跨组检索 + 直达）
3. 当前目标面包屑 + 返回后自动定位高亮

### M2（建议）
4. Recent Slots
5. 组/槽键盘导航快捷键

### M3（增强）
6. Pinned Slots
7. 高级筛选语法（`used/empty/g:/s:` 完整支持）

---

## 5. 开发执行计划（落地到现有工程）

## 5.1 影响文件（建议）
- `src/components/Studio/PartListPanel.vue`
- `src/stores/studioStore.js`
- `src/components/Studio/Studio.vue`（若需统一快捷键入口）
- `src/locales/*`（新增文案）

## 5.2 状态模型扩展（store）
建议新增：

```ts
interface PartListNavState {
  activeGroupId: string | null
  activeSlotKey: string | null
  quickJumpOpen: boolean
  quickJumpQuery: string
  recentSlotKeys: string[]
  pinnedSlotKeys: string[]
}
```

并新增 action：
- `setActiveGroup(groupId)`
- `setActiveSlot(slotKey)`
- `openQuickJump()/closeQuickJump()`
- `recordRecentSlot(slotKey)`
- `togglePinSlot(slotKey)`
- `jumpToSlot(slotKey, options)`（含自动展开、滚动、高亮）

## 5.3 分 Sprint 实施

### Sprint 1（P0：导航骨架）
- PartList 改为 Group Rail + 当前组 Slot List。
- 点击 group 即切换当前组，不再默认渲染所有组的完整内容。
- 保留现有替换/显隐/删除能力，不改业务语义。

**验收**：100+ slot 场景下，从任意 group 跳到目标组不超过 1 次滚动。

### Sprint 2（P0：Quick Jump）
- 新增顶部 Quick Jump 输入与结果面板。
- 支持 `group/slot/asset` 模糊检索，回车直达。
- 命中后自动切组 + 滚动 + 高亮目标槽。

**验收**：用户可不滚动列表完成跨组定位。

### Sprint 3（P1：最近与快捷键）
- 引入 Recent Slots。
- 增加组/槽键盘导航。
- 与 Replace/Polish 状态联动，保持当前位置可见。

**验收**：重复定位同一槽位显著更快。

### Sprint 4（P2：收藏与高级语法）
- 引入 Pinned Slots。
- 完整支持 `g:/s:/used/empty` 检索语法。

**验收**：高级用户可高度依赖键盘与命令式导航完成操作。

---

## 6. 度量与验证

埋点建议（最少集）：
- `partlist_nav_jump_used`（是否使用 Quick Jump）
- `partlist_nav_time_to_slot_ms`（从触发到定位完成）
- `partlist_nav_miss_click`（定位后 3 秒内切换到非目标槽）
- `partlist_nav_repeat_target_ms`（同目标二次定位耗时）

AB 验证建议：
- A：当前全量组列表方案
- B：新方案（Group Rail + Quick Jump）
- 周期：1~2 周，样本按重度用户优先。

---

## 7. 风险与规避

- **风险 1：老用户习惯被打断**  
  规避：保留“经典模式开关”（短期），并在新模式中复用原按钮语义。

- **风险 2：状态复杂度上升**  
  规避：导航状态集中在 `studioStore` 的独立子状态，避免散落组件本地 state。

- **风险 3：搜索结果与实际数据不一致**  
  规避：检索统一复用现有 `group/slot` 解析逻辑，避免双实现。

---

## 8. 结论

本方案的核心不是“把列表做得更花”，而是把导航从 **滚动查找** 升级为 **索引 + 跳转 + 回访**。  
对于你当前“group 与 slot 数量多、目标难以快速准确抵达”的问题，这是一套可渐进落地、收益明确、且符合现代编辑器交互习惯的改造路径。
