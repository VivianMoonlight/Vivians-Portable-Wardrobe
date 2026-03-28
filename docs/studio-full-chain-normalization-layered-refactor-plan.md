# Studio 全链路规范化与分层重构 Plan

## 1. 背景与目标
当前 Studio 已具备较完整编辑能力，但链路存在以下系统性问题：
- 写入入口分散，副作用触发分散（refresh/history/rebuild 在多处触发）。
- `layerEntries <-> part <-> merged bundle` 双向重建导致对象形态漂移。
- fast-path 比较规则严格，而上游输出未规范化，导致 slow-path 高频触发。
- `studioStore` 同时承担状态、调度、渲染控制、宿主调用编排，层次混杂。

本计划目标：
1. 统一写接口与事务边界，降低高频交互抖动。
2. 建立规范化数据契约，提升渲染 fast-path 命中率。
3. 完成分层抽象（Presentation / Application / Domain / Infrastructure）。
4. 采用渐进迁移（Strangler）确保可回滚、不阻断开发。

---

## 2. 当前链路诊断（概览）
UI 事件主链：
`Palette/Layer/Preview 组件 -> studioStore actions -> studio action modules -> LayerTranslator/PaletteService -> AssetApi stackOutfitData -> OptimizedRenderService -> hostWindow API`

关键风险点：
- 高频交互同帧触发多段重计算（layer refresh / part rebuild / merged refresh）。
- `Property` 形态不稳定（字段存在性、空对象、类型波动）导致 fast-path 失败。
- hostWindow API 在主线程上放大慢路径成本（CharacterRefresh / ValidationSanitizeProperties）。

---

## 3. 目标分层架构

### 3.1 Presentation Layer
职责：UI 渲染、交互事件、状态展示。
约束：只调用应用层统一接口；不直接访问 renderer/host API。

### 3.2 Application Layer
职责：命令执行、事务管理、查询投影、副作用协调。
建议组件：
- `StudioFacade`
- `CommandBus`
- `TransactionCoordinator`
- `QueryService`

### 3.3 Domain Layer
职责：纯业务规则、规范化、状态不变量校验。
建议组件：
- `StackDomain`
- `LayerDomain`
- `PaletteDomain`
- `RenderDomain`
- `NormalizationPolicy`

### 3.4 Infrastructure Layer
职责：与宿主 API、存储、渲染器实现交互。
建议组件：
- `HostRenderAdapter`
- `AssetAdapter`
- `StorageAdapter`
- `OptimizedRendererGateway`

---

## 4. 统一接口规范

### 4.1 写接口（唯一入口）
```ts
studio.execute(command, options?)
```
- command 必须显式声明：`type`, `payload`, `meta`。
- 不允许组件直接调用低层 store action 组合。

### 4.2 事务接口（高频交互）
```ts
studio.beginInteraction(kind, meta?)
studio.applyDelta(delta)
studio.commitInteraction()
studio.cancelInteraction()
```
语义：
- 交互中：仅更新实时投影（layerEntries + preview）。
- 提交时：一次性 part 重建 + history snapshot + 持久化触发。

### 4.3 读接口（查询投影）
```ts
studio.query(name, params?)
```
- 示例：`activePaletteTargets`, `focusedLayer`, `renderStats`, `selectionSummary`。

### 4.4 渲染管线接口
```ts
renderPipeline.render(input)
```
固定阶段：
1. `composeInput`
2. `normalizeBundle`
3. `diffAndApply`
4. `refreshCharacter`
5. `draw`

---

## 5. 规范化策略（核心）

### 5.1 双契约模型
- 比较契约（fast-path comparator DTO）：仅保留
  - `Group`, `Name`, `Color`, `Property.Shift`, `Property.Opacity`
- 渲染契约（render DTO）：固定字段存在性与类型，避免 undefined/缺失抖动。

### 5.2 Property 规范化规则
- 统一缺省：缺失字段显式归一（例如 `null` 或固定空结构）。
- 类型固定：同字段不允许在 number/array/object 间来回切换。
- 输出稳定：key 顺序、嵌套结构保持可预测。

### 5.3 结构稳定性规则
- 高频路径禁止临时插入/删除无关字段。
- 局部更新禁止触发全栈 map+reconstruct。

---

## 6. 迁移路线（Strangler Pattern）


### Phase 1: 数据契约与规范化
- 引入 `NormalizationPolicy` 与 comparator DTO。
- 在渲染入口统一 normalize 后再进行 diff。

### Phase 2: 统一写入口
- 引入 `StudioFacade.execute()` 与事务 API。
- 将 Palette 高频交互先迁移到事务接口。

### Phase 3: 分层拆分
- 把 `studioStore` 内部混合职责拆到 `CommandBus/Coordinator/Domain`。
- 渐进替换旧 action 模块调用点。

### Phase 4: 渲染管线收口
- 统一走 `renderPipeline.render()`。
- 清理重复 refresh/rebuild 触发点。

### Phase 5: 清理与固化
- 保留兼容层一段时间（旧 API -> 新 facade）。
- 指标达标后移除旧路径。

---

## 7. 风险与回滚

### 风险
- 重构期间行为偏差（undo/redo、palette 标签语义、preview 同步时序）。
- 双路径并存带来的维护复杂度。

### 回滚策略
- 所有新路径以 feature flag 包裹。
- 每阶段可单独开关并回退到旧路径。
- 迁移批次内保证可逆提交（小步提交）。

---

## 8. 验收标准
1. 功能一致性：同操作序列前后结果一致。
4. 可靠性：undo/redo、import/export、autosave、multi-select 无回归。

---

## 9. 第一批可执行任务（建议）
1. 增加 `normalizeForFastPath(bundle)` 并接入 `OptimizedRenderService` 比较阶段。
2. 引入 `StudioFacade.execute()`，先覆盖 Palette 相关写操作。
3. 将 Palette/Advanced offset 拖动统一到 `begin/apply/commit` 事务模型。
4. 把 `studioStore` 中散落的 `_schedulePartUpdate + _scheduleRefresh + snapshot` 合并为一次提交路径。

---

