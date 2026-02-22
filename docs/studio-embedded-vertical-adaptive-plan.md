# Studio 嵌入式纵向自适应改造计划书

## 1. 背景与目标

当前 `Studio` 在主界面嵌入运行时，纵向空间分配与滚动职责不够清晰：
- 容器级可能发生整体滚动，干扰工作流稳定性。
- 左右栏滚动责任不统一，部分区域缺少稳定的「头部固定 + 内容滚动」结构。
- 中间预览区域在某些高度下未能持续占满可用空间。

本计划针对以下目标（与你提出的 3 条要求一一对应）：
1. `Studio` 嵌入时不整体滚动，优先改为每一栏各自滚动。
2. `Studio` 嵌入时，整体 `header` 与 `footer`（mini-history）始终固定在其结构位置。
3. `Studio` 嵌入时，中间预览区始终占满父容器可用最大高度（扣除 `header/footer`）。

---

## 2. 现状分析（代码锚点）

### 2.1 嵌入层
- `src/components/FileManagerPanel.vue`
  - `fm-main` 当前允许 `overflow-y: auto`，会让 `Studio` tab 在外层产生纵向滚动。
  - `Studio` 作为 `tab-panel` 子内容嵌入，尚未对 `studio` tab 做「禁外滚、只内滚」特化。

### 2.2 Studio 主骨架
- `src/components/Studio/Studio.vue`
  - 已具备 `header + body + mini-history-bar` 三段式 DOM（结构基础正确）。
  - `.studio-body` 为 `flex:1` 且 `overflow:hidden`，但三栏内部的滚动契约还不统一。
  - `.panel-section` 缺少统一的「栏容器禁止滚动 + 内部内容区滚动」约束，容易出现行为不一致。

### 2.3 中间预览
- `src/components/Studio/PreviewWidget.vue`
  - 组件已是 `column` 结构，`preview-canvas-wrap` 为 `flex:1`。
  - 存在 `min-height: 220px`，在极端高度场景可能挤压整体布局，影响「严格占满可用空间」目标。

---

## 3. 目标布局契约（实施后）

## 3.1 垂直骨架（Studio 顶层）
- `studio-window` 在嵌入模式采用严格三行：
  - 第 1 行：`studio-header`（固定高度）
  - 第 2 行：`studio-body`（`1fr`，唯一主工作区）
  - 第 3 行：`mini-history-bar`（固定高度，作为 footer）
- `studio-window` 默认 `overflow: hidden`，不承担主滚动。

## 3.2 三栏滚动责任
- `studio-body`：`overflow: hidden`（仅做布局容器）。
- 左/中/右三栏（`panel-section`）本身不滚动，统一为 `display:flex; flex-direction:column; min-height:0; overflow:hidden;`。
- 每栏内部明确划分：
  - 栏内 header/工具条：`flex-shrink:0`
  - 栏内 content：`flex:1; min-height:0; overflow:auto`

## 3.3 预览区占满策略
- `studio-center` 及 `PreviewWidget` 链路保证 100% 高度传递：
  - `studio-center` -> `PreviewWidget` -> `preview-canvas-wrap`
- `preview-canvas-wrap` 为实际占满区域（`flex:1; min-height:0`）。
- 保留最小高度作为兼容兜底时，需使用「嵌入模式降级阈值」而非常驻硬限制。

## 3.4 整体滚动仅作为 fallback
- 默认路径：外层不滚动、studio 不滚动、仅栏内滚动。
- 当父容器高度小于最小可用阈值（建议：`<= 560px`）时，开启有限 fallback：
  - 允许 `studio-window.embedded` 启用 `overflow-y:auto`。
  - fallback 仅用于极限高度防止内容不可达，不作为常态。

---

## 4. 具体改造方案

## 4.1 `FileManagerPanel.vue`（先做）

目标：切断外层纵向滚动对 `Studio` 的干扰。

实施点：
1. 为 studio tab 增加专用类（如 `tab-panel tab-panel-studio`）。
2. 让 `tab-panel-studio` 链路具备：`display:flex; min-height:0; overflow:hidden; height:100%`。
3. 在 `activeTab === 'studio'` 时，`fm-main` 关闭纵向滚动（保留其他 tab 原逻辑）。

验收：
- 切到 `studio` tab 后，滚轮不会驱动 `fm-main` 纵向滚动条。

## 4.2 `Studio.vue`（核心）

目标：建立稳定的「固定头尾 + 中间工作区」布局主干。

实施点：
1. 嵌入模式下 `studio-window` 采用三段骨架（建议 grid/flex 二选一，保持最小改动）。
2. `studio-body` 强制 `min-height:0; overflow:hidden;`，作为栏位容器。
3. 统一 `panel-section` 契约：
   - 栏容器不滚动；
   - 将滚动下沉到栏内内容区。
4. 左右栏补齐「header 固定 + content 滚动」结构（缺失处补 wrapper）。
5. `mini-history-bar` 作为 footer 固定在底部结构位置，不随内容滚动。

验收：
- header 和 mini-history-bar 在交互期间始终可见且位置稳定。
- 左右栏内容超长时，仅各自栏内出现滚动。

## 4.3 `PreviewWidget.vue`（中间区）

目标：预览区始终占满中栏可用高度。

实施点：
1. `preview-widget` 保持 `height:100%` + `min-height:0`。
2. `preview-canvas-wrap` 改为严格填充：`flex:1; min-height:0`。
3. `min-height:220px` 改为条件化策略：
   - 非嵌入模式可保留；
   - 嵌入模式下取消硬性最小高度，避免挤压头尾和侧栏结构。
4. 校准 `setCanvasBackingSize()` 的高度读取逻辑，避免重复扣减导致可视区缩水。

验收：
- 父容器高度变化时，中间预览可连续拉伸/收缩，始终占满 `body` 中栏可用空间。

---

## 5. 实施步骤与排期建议

### Phase A：外层滚动隔离（0.5 天）
- 完成 `FileManagerPanel.vue` studio-tab 特化。
- 验证 studio tab 下外层不滚，其他 tab 行为不回归。

### Phase B：Studio 三段骨架与三栏滚动契约（1 天）
- 重构 `Studio.vue` 嵌入样式链路。
- 完成左右栏内滚动职责下沉。

### Phase C：预览区占满与 fallback（0.5 天）
- 调整 `PreviewWidget.vue` 高度策略。
- 增加极限高度 fallback 开关（阈值可配置）。

### Phase D：回归与微调（0.5 天）
- 桌面/小屏/低高度场景回归。
- 处理滚动条闪烁、双滚动、sticky 失效等边缘问题。

---

## 6. 验收清单（必须全部通过）

## 6.1 对应需求 1：分栏滚动
- [ ] 嵌入 studio 时，整体不出现主滚动条（常态场景）。
- [ ] 左栏超长，仅左栏内容区滚动。
- [ ] 右栏超长，仅右栏内容区滚动。
- [ ] 中间预览不因左右栏滚动而位移。

## 6.2 对应需求 2：header/footer 固定
- [ ] `studio-header` 始终固定在顶部结构位。
- [ ] `mini-history-bar` 始终固定在底部结构位。
- [ ] 任一侧栏滚动不影响头尾可见性。

## 6.3 对应需求 3：中间预览占满
- [ ] 中栏预览高度 = 父容器可用高度（扣除 header/footer）。
- [ ] 面板高度变化时预览连续自适应，无突兀跳变。
- [ ] 极端低高度下 fallback 生效且内容仍可达。

---

## 7. 风险与缓解

1. **双滚动回归风险**：某些子组件自带 `overflow:auto`。
   - 缓解：统一滚动职责矩阵，逐栏检查 `header/content` 结构。

2. **高度链断裂风险**：父级未设置 `min-height:0` 导致子级无法收缩。
   - 缓解：对 `fm-main -> tab-panel-studio -> studio-container -> studio-window -> studio-body -> panel-section` 全链路补齐。

3. **预览画布尺寸抖动风险**：容器高度变化频繁触发重绘。
   - 缓解：在 `ResizeObserver` 回调中做节流，并仅在尺寸变化时重算 backing store。

---

## 8. 交付物

- 代码改造范围：
  - `src/components/FileManagerPanel.vue`
  - `src/components/Studio/Studio.vue`
  - `src/components/Studio/PreviewWidget.vue`
- 文档：本计划书（当前文件）
- 验收记录：建议补充到 `docs/studio-uiux-v2-progress.md` 的一节「嵌入式纵向自适应」
