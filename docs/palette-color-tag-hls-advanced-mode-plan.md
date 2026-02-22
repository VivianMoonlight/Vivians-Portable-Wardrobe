# Palette 高级赋色模式方案（Color Tag + HLS 偏移）

> 目标：在现有 Palette 基础上引入“可复用语义色 + 可控偏移”的高级赋色能力，提升批量换色效率与风格一致性。  
> 对齐范围：`Studio V2` 任务流、右栏单主面板、`Peek/Pin/Hidden` 状态机。  
> 日期：2026-02-22

## 实施进度（维护中）

更新时间：2026-02-22

- Sprint 1（解析与应用底座）：✅ 已完成
- Sprint 2（Store Action 与历史系统接线）：✅ 已完成
- Sprint 3（PalettePanel 交互接入）：✅ 已完成（MVP 交付）
- Sprint 4（i18n、导入导出与文档）：🟡 部分完成（i18n + 文档已完成；导入导出非法 DSL 交互提示待补）

本次实现范围（MVP）：
- ✅ `Tag + HLS 偏移` DSL 解析、格式化、渲染展开
- ✅ `Apply / Reset / Detach / Suggest from current` UI 与 Store 动作
- ✅ Undo/Redo 通过既有 `pushHistorySnapshotThrottled` 链路接入
- ✅ 中英文本地化键补齐
- ✅ Tag 重命名与删除场景兼容 `Tag+Offset` 引用

---

## 1. 背景与问题

当前 `PalettePanel` 已具备：
- Tag 命名与全局引用（`paletteMap`）
- 直接色编辑（picker 对 active targets）
- Tag 编辑模式（编辑 Tag 定义值）
- 与 `taskStage`、`activeContextPanel`、`Peek/Pin` 联动

但在“统一风格 + 局部微调”场景仍有痛点：
- 仅用 Tag：可统一但不够灵活（同一主题下不同层的轻微明暗差异难表达）。
- 仅用直接色：灵活但难维护（后期全局换色成本高）。
- 批量调色时常在“语义一致性”和“局部个性”间反复取舍。

---

## 2. 设计目标

1. 在不破坏现有色值系统的前提下，新增“Tag 基色 + HLS 偏移”表达。
2. 保持 Easy 模式默认简洁：高级能力按需展开，不干扰基础路径。
3. 兼容现有导入导出、Undo/Redo、渲染展开逻辑。
4. 支持渐进迁移：旧数据零改造可继续工作。

---

## 3. 概念模型

## 3.1 术语

- **Color Tag**：命名色（例如 `skin.base`、`accent.gold`），存于 `paletteMap`。
- **HLS 偏移**：在 Tag 基色基础上的参数化偏移：`H`（色相）、`L`（亮度）、`S`（饱和度）。
- **Resolved Color**：运行时计算后的最终颜色（用于渲染与写入 layer entry）。

## 3.2 新表达式（引用值）

在 `part.Color` 的字符串位置新增一种引用语法：

`tagName|h:+8,l:-6,s:+10`

说明：
- `tagName`：已存在于 `paletteMap` 的 tag key。
- `h/l/s`：整数偏移，推荐范围：
  - `h`: `[-180, 180]`
  - `l`: `[-100, 100]`
  - `s`: `[-100, 100]`
- 未提供项按 `0` 处理。

示例：
- `accent.gold|l:-12`（同色系更深）
- `fabric.blue|h:+6,s:+8,l:+4`（轻微偏冷并更鲜艳）

## 3.3 为什么选“字符串 DSL”而非对象结构

选用字符串 DSL 的原因：
- 与当前 `part.Color` 可直接共存（原本就是 string/array 的混合生态）。
- 对旧存档与现有分支最小侵入。
- 导入导出 JSON 兼容成本最低。

后续如需强类型结构，可在内部增加 parser/serializer，不影响存档表面格式。

---

## 4. 数据与兼容策略

## 4.1 `paletteMap` 保持不变

`paletteMap` 继续存“Tag -> 基础颜色值（hex/rgb/array）”，不直接存偏移。

偏移信息绑定在“使用处”（layer 的 Color 引用）而非“定义处”（Tag），避免全局连带风险。

## 4.2 兼容优先级

颜色解析优先级建议：
1. 普通 CSS 色值（hex/rgb/hsl/name）
2. 纯 Tag（`tagName`）
3. Tag+Offset（`tagName|h:...,l:...,s:...`）
4. 无法解析则回退原值（并记录 warn）

## 4.3 迁移与回滚

- **迁移**：无需数据迁移脚本；旧值按旧逻辑解析。
- **回滚**：若关闭高级模式，DSL 字符串可被当作普通字符串处理并提示不可解析，不影响其他数据。

---

## 5. UI/UX 融合方案（对齐现有 V2）

## 5.1 入口位置

仅在 `PalettePanel` 中新增“高级赋色（Advanced）”折叠区，位于 picker 下方、Saved/Tags 上方。

- Easy：默认折叠。
- Pro：记忆上次展开状态。

## 5.2 交互流程

### 流程 A：基于 Tag 应用偏移

1. 选择目标 layer（已有流程）。
2. 在 Advanced 区选择 `Base Tag`。
3. 调整 `H/L/S` 三个滑杆。
4. 点击 `Apply`：写入 `tag|h:...,l:...,s:...` 到 active targets。
5. 预览刷新，保留 Undo 单步回退。

### 流程 B：从当前颜色“反推并创建”偏移引用

1. 用户已有直接色。
2. 点击 `Suggest from current`（以选定 Tag 为基准估算偏移）。
3. 可微调后 `Apply as Tag+Offset`。

### 流程 C：清除偏移

- `Reset Offset`：保留 Tag，仅把偏移归零（还原为纯 Tag）。
- `Detach to Raw`：解析当前结果后写回纯色（断开与 Tag 联动）。

## 5.3 与现有状态机对齐

- 保持 `openPalettePanel`、`enterPeekPanel('palette')`、失焦 auto-close 现有行为。
- 若 `panelStates.palette === 'pinned'`，高级区状态持久化并常驻。
- 在 `taskStage=replace` 时，高级区仍可用，但默认折叠避免分散主任务注意力。

---

## 6. 技术实施计划

## Sprint 1：解析与应用底座（服务层）

目标：在不改 UI 的前提下打通运行能力。

改造点：
- `src/services/PaletteService.js`
  - 新增 `parseTagOffsetRef(value)`
  - 新增 `formatTagOffsetRef(tag, offset)`
  - 新增 `resolveTagOffsetColor(ref, paletteMap)`
  - 在 `expandTagsInAppearance` 路径中支持 DSL 解析
- 新增 HLS 工具函数（建议 `src/utils/color-hls.js`）
  - `hex/rgb -> hls`
  - 应用偏移并 clamp
  - `hls -> css color`

验收：
- 纯 Tag 与旧色值行为不变。
- DSL 能正确解析并渲染。
- 失败回退不崩溃，控制台可诊断。

## Sprint 2：Store Action 与历史系统接线

目标：让高级模式成为一等编辑动作。

改造点：
- `src/studio/palette-actions.js`
  - 新增 `applyTagOffsetToTargets(state, payload, helpers)`
  - 新增 `clearTagOffsetOnTargets(...)`
- `src/stores/studioStore.js`
  - 暴露 `applyTagOffsetToActivePaletteTargets(...)`
  - 暴露 `resetTagOffsetToTag(...)`
  - 确保 `pushHistorySnapshotThrottled` 与 `paletteUpdateFlag` 在高级模式下触发一致

验收：
- 每次 Apply/Reset 产生可预期 Undo 节点。
- 不破坏现有 `applyColorToActivePaletteTargets`。

## Sprint 3：PalettePanel 交互接入

目标：完成最小侵入 UI 交付。

改造点：
- `src/components/Studio/PalettePanel.vue`
  - 新增 Advanced 折叠区
  - 新增 Base Tag 选择器、H/L/S 滑杆、Apply/Reset/Detach 按钮
  - 新增当前目标值解析展示（显示“纯Tag/Tag+Offset/Raw”）
  - 与 `editingTagId` 模式互斥：编辑 Tag 定义时禁用 Advanced Apply

验收：
- Easy 模式默认视觉不增加噪音。
- 高级操作路径 ≤ 3 步完成。

## Sprint 4：i18n、导入导出与文档

改造点：
- `locales/en.json`、`locales/zh.json` 增加 advanced 文案键
- 导入导出无需改格式，但补充校验提示（非法 DSL）
- 更新用户文档：高级模式说明 + 示例

验收：
- 双语完整。
- 旧文件可导入，新文件可回放。

---

## 7. 关键算法规则

## 7.1 偏移计算

基色 $C_{base}$ 转换到 HLS 后应用偏移：

$$
H' = (H + \Delta h) \bmod 360
$$

$$
L' = clamp(L + \Delta l, 0, 100),\quad S' = clamp(S + \Delta s, 0, 100)
$$

再将 $(H',L',S')$ 转回 RGB/HEX。

## 7.2 合法性与边界

- 当 Tag 基色不是可转 HLS 的单色（如复杂数组）时：
  - V1 仅支持单色偏移；复杂值提示“当前 Tag 不支持偏移”。
- 当偏移超范围：
  - UI 层先限制；解析层再做二次 clamp。
- 当 Tag 不存在：
  - 保留原值并警告，不中断渲染。

---

## 8. 风险与控制

1. **色彩空间差异风险**：HLS 在极端颜色上的视觉变化不线性。  
   控制：提供 `Preview` + `Reset` + `Detach`。

2. **复杂颜色值兼容风险**：Tag 可能映射数组/特殊结构。  
   控制：V1 先限制单色 Tag，复杂结构只读提示。

3. **性能风险**：大量 layer 实时拖拽可能频繁解析。  
   控制：复用现有 throttle；对 parser + resolved color 做短期缓存。

---

## 9. 验收清单（DoD）

- 功能：能创建并应用 `Tag + HLS 偏移`，并在预览中正确显示。
- 兼容：旧 palette 存档零破坏。
- 历史：Undo/Redo 对高级赋色完整可回退。
- UI：Easy 模式不增加主路径复杂度，Pro 可高效批量调色。
- i18n：中英文完整。
- 构建：`npm run build` 通过（允许记录既有无关告警）。

---

## 10. 推荐首发范围（MVP）

为控制复杂度，首发只做：
- 单色 Tag 的 H/L/S 偏移
- 单目标与多目标应用
- Apply/Reset/Detach 三动作

暂缓：
- 曲线映射、渐变多节点偏移、偏移预设库
- 复杂颜色对象的自动偏移

该范围可在当前架构下快速落地，并且不与现有 `Studio V2` 任务化主线冲突。
