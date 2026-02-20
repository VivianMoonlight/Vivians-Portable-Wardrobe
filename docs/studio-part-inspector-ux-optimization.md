# Studio Part Inspector UX 优化方案

> 面向 `Part Inspector`、`ColorableLayer（layer chip）`、`BatchEditPanel` 的交互重构提案  
> 参考：Photoshop / Figma / 现代 Web 编辑器（context panel + direct manipulation）

## 1) 背景与目标

当前 Studio 的核心编辑流已经具备完整能力（单层编辑、批量编辑、视觉移动、颜色面板联动），但在交互上存在“功能强、心智负担重”的情况：

- 模式切换入口分散（single/multi、view/move、palette、link/unlink）
- 同屏控件密度高，缺少“先做什么、再做什么”的视觉引导
- 批量编辑和单层编辑边界不够清晰，用户容易误判作用范围
- 操作反馈（成功、失败、作用对象）不够统一，难以建立稳定预期

本方案目标：

1. 让用户始终明确 **当前编辑对象**、**当前模式**、**当前作用范围**。
2. 将高频操作压缩为“3步内完成”，降低回忆成本。
3. 让 **单个编辑（single edit）与批量编辑（batch edit）共享同一工作流骨架**，仅在作用范围上有差异。
4. 保持现有能力不缩水，仅重排信息结构与交互优先级。
5. 与项目现有 design token / 组件体系兼容，不引入新视觉体系。

---

## 2) 现有 UX 问题诊断（基于当前实现）

### A. Part Inspector 层面

1. **模式可见性不足**
   - 多选模式、移动模式虽然存在按钮态，但缺少“全局状态条”式提示。
   - 用户在滚动后容易丢失“现在在什么模式”。

2. **信息分组与任务顺序不一致**
   - 当前按“Core / Layer / Advanced”分组是正确方向，但仍缺少“选择摘要 + 当前可执行动作”的前置层。
   - 用户要先理解整屏才能开始操作。

3. **批量编辑入口上下文弱**
   - `BatchEditPanel` 仅在多选中显示，但缺少“作用于 N 项”的强提醒与撤销预期。

### B. Layer Chip（ColorableLayer）层面

1. **行内操作密度高且权重接近**
   - 重置、链接、视觉移动、调色板等次要动作与主输入（opacity/offset）竞争注意力。

2. **可折叠逻辑与选择逻辑耦合复杂**
   - header 点击在 single/multi 下行为变化明显，且 Ctrl/Shift 规则分散，学习成本较高。

3. **属性焦点可见性可再加强**
   - 虽有 focused/selected 状态，但“当前正编辑哪个属性”缺少统一高亮语义。

### C. Batch Edit 层面

1. **操作模型偏“工具台”而非“批处理向导”**
   - 多个 section 平铺，缺少“先选属性→设模式→应用”的顺序引导。

2. **视觉移动与数值编辑混排**
   - `Visual Move` 与 offset 数值编辑并列，用户易误解其优先级和互斥关系。

3. **反馈消息生命周期短且语义有限**
   - 仅显示成功/失败，缺少“影响范围、跳过数量、失败原因分类”。

---

## 3) 设计原则（对齐 Photoshop/Figma 思路）

1. **Selection First**：先清晰显示选中对象，再展示可执行动作。
2. **Mode is Global**：模式必须在面板顶部持续可见，不依赖用户记忆。
3. **Progressive Disclosure**：默认只给高频控制；高级控制按需展开。
4. **Direct Manipulation + Numeric Precision**：拖动/视觉移动和精确输入并存，且互相可同步。
5. **Scope Safety**：任何可能影响多层的操作，都要明确“作用范围 + 可撤销预期”。

---

## 4) 优化后的目标交互模型

## 4.0 统一工作流骨架（Single 与 Batch 共用）

所有属性编辑统一为同一套 4 步流程：

1. **Choose Scope**：确定作用范围（This Layer / Selected N Layers）
2. **Choose Property**：选择属性（Color / Opacity / Offset / Priority）
3. **Set Value**：输入值（Absolute / Relative + 数值或调色）
4. **Apply & Feedback**：提交并显示结果（updated / skipped / failed）

统一约束：

- 同一属性在 single/batch 使用相同控件形态（slider、number、mode toggle、apply/reset）。
- 文案、按钮位置、反馈语义一致；用户只需学习一次。
- 差异只体现在 Scope Banner：`Apply to this layer` vs `Apply to N layers`。

## 4.1 Part Inspector 信息架构（建议）

将面板分为 4 个稳定区：

1. **Global Mode Bar（固定顶部）**
   - 显示并可切换：`Single / Multi`、`View / Move`。
   - 持续显示：`Selected: N layers`（即使滚动也可见）。

2. **Selection Summary（任务起点）**
   - 单选时：显示 `LayerName + PartName`。
   - 多选时：显示 `N selected`、`colorable M`、是否跨 part。

3. **Quick Actions（高频）**
   - 单选 / 多选共用同一属性编辑顺序：`Property -> Mode -> Value -> Apply`。
   - 多选仅替换 Scope 与结果统计，不更换交互结构。

4. **Detail Sections（细节）**
   - `Core Properties`、`Layer Edits`、`Advanced` 保留，但默认折叠策略更激进：
     - 单选：展开 `Layer Edits`
     - 多选：展开 `Batch Edit`

## 4.2 Layer Chip（ColorableLayer）结构重排

每个 layer 卡片按“主任务优先”分为：

1. **Header（选择 + 折叠 + 名称）**
   - 多选模式仅负责选择，不承担折叠逻辑（避免歧义）。
   - 折叠入口固定为箭头按钮，行为恒定。

2. **Primary Controls（始终可见）**
   - `Opacity`、`Offset`、`Priority` 主输入。

3. **Secondary Actions（收纳）**
   - `Reset`、`Link`、`Visual Move`、`Palette` 收纳为右侧 action group（图标+tooltip 保留）。
   - 默认弱化视觉权重，仅 hover/focus 强调。

4. **SubLayer Details（按需展开）**
   - 保持只读为主，避免与主层编辑语义冲突。

## 4.3 Batch Edit 交互模型

将 `BatchEditPanel` 从“多工具堆叠”改为与单层编辑一致的“统一应用流程”：

1. 第一步：选择属性（Opacity / Offset / Priority / Color）
2. 第二步：选择模式（Absolute / Relative）
3. 第三步：输入值并 `Apply`

并补充两个安全机制：

- **Scope Banner**：始终显示 `Apply to N layers`。
- **Result Summary**：应用后显示 `updated / skipped / failed` 计数。

> 说明：single edit 使用同构流程，只是 Scope 固定为当前层，并支持更即时的自动提交（如 slider input）。

---

## 5) 关键交互规范（建议落地规则）

### 5.1 选择规则统一

- Click：单项选择
- Ctrl/Cmd + Click：增减选择
- Shift + Click：区间选择（同一 part 内）
- Esc：有选择则清空；无选择则退出 multi

> 规则保持与现代列表编辑器一致，减少模式外记忆。

### 5.2 模式切换规则

- 切到 `Move` 时：自动聚焦 `drawing/offset` 属性。
- 离开 `Move` 时：保留数值，不触发额外提交。
- `Move` 在 multi 下默认对“当前选中集合”生效，且顶部明确提示。

### 5.3 提交与反馈规则

- 连续输入（slider/number）保持节流提交（single/batch 同规则）。
- 按钮操作（reset/apply）即时提交（single/batch 同规则）。
- 所有提交在面板底部统一 toast 区输出：
  - 成功：更新数量
  - 警告：跳过原因（如不可着色）
  - 错误：失败原因分组

### 5.4 Single / Batch 一致性规则

- 同属性必须共享同名控件与同序布局（如 opacity 一律“模式切换 → slider/number → apply/reset”）。
- single 的“即时修改”与 batch 的“显式 Apply”并存时，需在 UI 上明确标记提交策略。
- reset 行为统一：single 重置当前层，batch 重置目标集合到各自默认值。
- 键盘交互统一：Enter 提交、Esc 取消当前输入态（不改变全局模式）。

---

## 6) 组件级改造映射（对应当前代码）

## 6.1 `PartInspectorPanel.vue`

1. 增加固定的 `Global Mode Bar`（模式 + 选中数量）。
2. 在 body 顶部增加 `Selection Summary`。
3. 将 `BatchEditPanel` 提升为多选主编辑区，`Layer Edits` 次之。
4. 统一键盘提示文案与按钮 tooltip（A/D/Esc）。

## 6.2 `ColorableLayer.vue`

1. 将 header 点击行为拆分：
   - checkbox 专注选择
   - arrow 专注折叠
2. 主输入区与次要 action 区分组，且输入控件顺序对齐 Batch 面板。
3. 对“当前编辑属性”增加行级高亮（例如 data-focused-property）。
4. 对 sublayer 信息保持只读，但增加“继承自主层”的提示语义。

## 6.3 `BatchEditPanel.vue`

1. 改为“单属性焦点编辑”布局，并复用 single edit 的控件排布。
2. 增加 Scope Banner 与 Result Summary。
3. `Visual Move` 从 Offset section 独立为全局工具开关（与 inspector mode bar 对齐）。
4. feedback 信息统一为可枚举结果对象（便于 i18n 与日志）。
5. 每个属性的 mode/value/apply 行为与 `ColorableLayer` 保持一一对应。

---

## 7) 分期实施计划（低风险迁移）

### P0（结构与可见性，低风险）

- 新增 `Global Mode Bar` + `Selection Summary`
- 统一 tooltip 与快捷键提示
- Batch 结果反馈改为结构化计数
- 定义 single/batch 共享的属性编辑骨架（Property -> Mode -> Value -> Apply）

**验收**：用户可在任意滚动位置辨识模式与作用范围。

### P1（交互语义统一，中风险）

- `ColorableLayer` header 行为拆分
- Batch 改为与 single 同构的单属性焦点流程
- 统一 move 模式入口（Inspector 与 Batch 一致）

**验收**：单选/多选同属性任务路径可按同一认知步骤完成，且均可 3 步内完成。

### P2（细节打磨与性能）

- 行级 focused-property 高亮
- 反馈系统与可观察日志对齐
- 增加首次引导文案（可选）

**验收**：误操作率下降，重复回退操作减少。

---

## 8) 建议衡量指标（用于验证改造收益）

1. **Task Completion Time**：
   - 单层改色/改透明/改偏移的平均完成时间。
2. **Mode Error Rate**：
   - 用户在错误模式下触发操作的比例。
3. **Batch Apply Confidence**：
   - 批量操作后立即撤销或反向修正的比例。
4. **Interaction Depth**：
   - 完成核心任务的平均点击数（目标：下降）。

---

## 9) 结论

当前实现的核心能力已经接近专业编辑器，但交互组织仍偏“工程导向”。本方案不要求重写业务逻辑，重点通过 **single/batch 共用工作流、模式可见性、选择优先、分层披露、作用范围安全提示** 来提升“直觉可用性”。建议先实施 P0/P1，以最小风险获得最大 UX 收益。

---

## 10) 变更清单（可执行）与实施状态

### A. `PartInspectorPanel.vue`

- [x] 新增固定 `Mode Bar`（Single/Multi + View/Move + Scope）
- [x] 新增 `Workflow Summary`（Scope -> Property -> Value -> Apply）
- [x] 在 Inspector 主视图持续显示作用范围文案

### B. `BatchEditPanel.vue`

- [x] 从“多 section 并列”改为“单属性焦点流程”
- [x] 新增 `Scope Banner`（Apply to N layers）
- [x] 新增属性切换 Tab（Opacity/Offset/Priority/Color）
- [x] 保留并对齐 Absolute/Relative 模式开关
- [x] 新增结构化 `Result Summary`（updated/skipped/failed）
- [x] 无 selection 时禁用 apply 级操作

### C. `ColorableLayer.vue`

- [x] Header 中“选择”与“折叠”入口解耦
- [x] 折叠改为专用箭头按钮，行为恒定
- [x] Single 模式点击 header 以聚焦当前 layer 属性，而非隐式折叠

### D. 下一步（建议）

- [ ] 将 single edit 的行内控件布局进一步对齐 Batch（控件顺序和按钮位置 1:1）
- [ ] 引入统一的提交策略标识（Auto apply / Click apply）
- [ ] 为结果摘要接入 i18n keys（`batchEdit.skipped`、`batchEdit.failed` 等）
