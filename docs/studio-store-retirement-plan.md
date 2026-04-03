# StudioStore 退场收口计划（终局版）

## 1. 目标与范围
本计划用于在现有“分域状态 + 星型命令中枢（混合）”基础上，逐步退役 `studioStore`，最终让其从“业务入口”降级为“兼容壳”，并在条件满足时彻底删除。

目标终态：
1. 组件层不再依赖 `useStudioStore`。
2. 状态真值全部归属 domain stores（core/asset/render/selection/palette/panel/history/persistence）。
3. 写路径统一经命令中枢（StudioFacade + StudioCommandBus + TransactionCoordinator）。
4. `studioStore` 不再承载业务逻辑，仅保留短期兼容代理，最终删除。

非目标：
1. 不在本计划中重做业务功能与交互形态。
2. 不在同一阶段并行引入大规模 UI 改版。

---

## 2. 当前基线（已完成）
1. Wave 0 组件入口首轮收口已完成，组件层 `useStudioStore` 直接引用已清零。
2. Wave 1 面板真值已收口到 `panelStore`，`studioStore` panel 镜像 state 已删除并改为代理绑定。
3. Wave 2/3 代码层主体已拆分：history/persistence 主要逻辑已在领域 store，`studioStore` 以薄委托为主。
4. Wave 4~7 已建立 domain stores 与 bridge 体系，core/asset/render/palette/selection 均已有实质承接。

---

## 3. 总体策略
采用“三层退场法”：
1. 入口退场：组件与业务侧先退出 `studioStore` 直接依赖。
2. 逻辑退场：`studioStore` 内部行为改为纯代理，不再保留可变真值与复杂编排。
3. 物理退场：用兼容适配层替换 `useStudioStore`，最终删除文件与历史别名。

配套约束：
1. 每阶段只做一个主收口主题。
2. 不新增任何长期 legacy alias。
3. 每阶段均需构建通过 + 最小回归通过。
4. 所有跨域写操作必须可追溯到命令中枢入口。

---

## 4. 分阶段计划

### 阶段 A：冻结期（API 冻结 + 观测）
目标：停止 `studioStore` 新增能力，建立退场观测面。

动作：
1. 在代码规范中标记：禁止新增 `studioStore` 业务 action。
2. 为 `studioStore` 兼容入口增加使用计数（按方法维度）。
3. 在 PR 模板加入检查项：是否新增对 `studioStore` 的直接依赖。

验收：
1. 连续 2 次迭代无新增 `studioStore` 业务方法。
2. 兼容入口调用分布可导出并可审计。


### 阶段 B：命令中枢外提（从壳中解耦）
目标：将“命令网关 + 事务协调”从 `studioStore` 依附关系里进一步解耦。

实施进度（2026-04-03）:
1. 已完成第一部：`StudioCommandBus` 已改为可注册式总线（`registerHandler/registerHandlers/unregisterHandler/getRegisteredCommandTypes`）。
2. 已完成第二部：默认命令映射已从主文件外提到 `src/studio/command-hub/default-command-handlers.js`，历史元数据构建已外提到 `src/studio/command-hub/history-meta.js`。
3. 已完成第三部：`StudioFacade` 暴露命令注册与查询能力（`registerCommandHandler/registerCommandHandlers/getRegisteredCommandTypes`）。
4. 已完成第四部：默认命令处理已按 domain 拆分到 `src/studio/command-hub/handlers/*`（palette/part-layer/batch/asset/history/saves/stack），`default-command-handlers` 仅保留组装职责。
5. 待完成：补最小单测/契约测试，验证命令注册与执行行为。

动作：
1. 固化 `execute/query/interaction` 作为公共写入门面。
2. 将命令映射表按 domain 拆分并建立注册机制（可测试）。
3. 把历史元数据合并策略抽到命令层可复用模块。

验收：
1. 新增写路径无需触达 `studioStore` 即可注册命令处理。
2. 命令中枢可在独立单测中运行。


### 阶段 C：bridge 收口（render + asset）
目标：补齐未完成桥接，切断组件对 `studioStore` render/asset 兼容入口依赖。

动作：
1. 新建并接入 `renderBridge`。
2. 视需要补 `assetBridge`（若组件仍需组合读模型）。
3. 将组件内 `studio` 直取 render 字段/方法改为 bridge/domain 调用。

验收：
1. 组件层不再直接访问 `studioStore` 的 render 兼容字段/方法。
2. render 兼容层删除窗口条件满足。


### 阶段 D：兼容方法瘦身（studioStore 纯代理化）
目标：`studioStore` 仅保留路由代理，不再保留业务实现。

动作：
1. 清理 `studioStore` 内剩余“带状态逻辑”的方法实现。
2. 统一改为 `domainStore.method(studio, ...)` 或命令中枢调用。
3. 收敛 `_sync*` 方法，保留最小必要兼容。

验收：
1. `studioStore` 不再包含复杂业务分支与重建逻辑。
2. 文件体量显著下降（以方法数/行数统计）。


### 阶段 E：兼容壳切换（API 迁移完成）
目标：对外入口从 `useStudioStore` 迁移到 `useStudioDomainStores` + bridges。

动作：
1. 建立迁移映射文档（旧 API -> 新入口）。
2. 对剩余内部调用点执行批量替换。
3. 设立临时 `compatStudioApi` 仅保留必要别名。

验收：
1. 仓库内业务代码无 `useStudioStore` 依赖。
2. 兼容 API 覆盖率低于阈值（例如 < 5% 调用）。


### 阶段 F：物理删除（最终退役）
目标：删除 `studioStore` 主体，实现彻底退场。

动作：
1. 删除 `studioStore` 内部实现，仅保留过渡 shim（如需 1 个版本窗口）。
2. 清理无用 proxy bindings 与 legacy 同步逻辑。
3. 删除弃用文档与过时导出。

验收：
1. 无 `useStudioStore` 导入。
2. 命令与查询全部走中枢/领域。
3. 全量构建与核心回归通过。

---

## 5. 回归矩阵（每阶段最小必测）
1. 编辑链路：stack CRUD、part focus、replace。
2. 历史链路：undo/redo/jump/clear。
3. 持久化链路：autosave、session save/load、import/export。
4. 渲染链路：preview overlay、layer blink、normal refresh、renderer 切换。
5. 面板链路：context/tool dock/bottom tray/modal。

---

## 6. 风险与回滚
高风险点：
1. 事务结束时机偏移导致历史快照丢失或重复。
2. bridge 读模型差异导致 UI 层显示偏差。
3. 兼容入口删除过早导致第三方脚本/旧组件断裂。

回滚策略：
1. 每阶段独立 PR，禁止跨阶段混改。
2. 保留 feature flag：`facade on/off` 与关键命令处理开关。
3. 若回归失败，按阶段回滚，不回滚已稳定 domain 真值归属。

---

## 7. 建议 PR 切分
1. PR-A：阶段 A（冻结规则 + 观测埋点）。
2. PR-B：阶段 B（命令中枢外提与注册）。
3. PR-C：阶段 C（render/asset bridge 接入与组件迁移）。
4. PR-D：阶段 D（studioStore 纯代理化）。
5. PR-E：阶段 E/F（兼容壳切换 + 物理删除）。

---

## 8. 退出条件（Definition of Done）
1. `studioStore` 不再承载业务逻辑与状态真值。
2. 组件层只使用 domain stores 与 bridges。
3. 写路径统一经命令中枢，读路径无中心化回退。
4. 回归矩阵通过，且连续 2 个版本无兼容告警。
