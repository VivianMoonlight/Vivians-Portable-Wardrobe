# React 迁移版代码简化

> 本文记录索引迁移前的代码清理阶段，行数与测试数属于当时结果。后续已完成衣橱索引与云同步改造，现状见 [衣橱索引与云同步](INDEXED_WARDROBE_SYNC.md)。

本轮针对 React 分支 `336ef8c` 的实际生产代码，集中清理换装规则的重复实现和迁移遗留状态。工作分支为 `design/react-ux-modernization`，目录为 `Vivians-Portable-Wardrobe.worktrees/react-ux-design`。

采用社区 [code-simplifier skill](https://github.com/lichao689/skills/blob/a864cfbdbf9ab46728efcda3422b414b903113a5/skills/workflow/code-simplifier/SKILL.md)，已安装到本机 `code-simplifier`。本轮遵循保留可观察行为、合并重复逻辑、删除无消费者代码的原则。

## 已完成

| 原来的问题 | 简化结果 |
| --- | --- |
| FilterManager 和 fileSystemStore 各自维护模式默认值、槽位来源、替换策略和按钮状态 | 提取 `src/services/outfit-slot-rules.js`，UI 与 store 共用纯规则 |
| 全部、分组、智能切换各复制一段更新和渲染逻辑 | 共用 `setScopeSlotModes`，保留没有变化就不刷新预览的行为 |
| bundle 组装手动维护顺序和去重列表，还遍历没有来源数据的槽位 | 直接按来源分组顺序组装，保留同槽位多件物品、引用和全部属性 |
| 恢复当前穿着和选择候选重复执行模式初始化、预览更新 | 合并公共尾部，保留两条路径不同的锁定及克隆语义 |
| workbench 维护无人读取的移动布局、访问顺序、滚动状态 | 删除相关字段和无调用方法，保留当前标签及衣橱偏好的存储格式 |
| 历史自动记录函数的调用全部已注释，却保留定时器和加载标志 | 删除死链，保留游戏外观变更 hook 驱动的真实历史记录 |
| 隐藏的高级筛选栏仍计算覆盖数量、创建 DOM | 删除从未显示的节点及专用计算 |
| 中英文语言包存在被后续同名键覆盖的旧块 | 删除无效重复定义，核对 JSON 解析结果完全相同 |

计入新增共享规则后，`src` 生产代码净减少 276 行，语言包另减少 48 行；测试和文档不计入这个数字。

## 行为约束与验证

默认策略仍是 `fill-empty`。智能切换仍先操作有来源的槽位，第二次扩展到整个作用域；改变这套交互属于后续产品设计的实现工作。

候选预览保留原数据引用；恢复当前穿着及历史预览仍深克隆。恢复当前穿着可以绕过候选锁，但不会解除锁。`preserve` 仍保留已有选择，并将新槽位置空。

新增 Node 测试入口 `npm test`，共 25 个行为测试：7 个纯规则测试、13 个真实 fileSystem store 测试、5 个 workbench store 测试。store 测试使用真实 Zustand 和业务模块，仅替换游戏宿主与 canvas 渲染边界。测试工具明确声明现有版本的 esbuild 开发依赖，没有升级原依赖版本。

以下验证均已通过（25 个测试通过，类型检查及生产构建通过，差异无空白错误）：

```sh
npm test
npm run typecheck
npm run build
git diff --check
```

实际游戏中的渲染和换装仍需集成环境验证；这些测试覆盖状态及数据结果，不替代游戏内体验检查。

## 后续值得单独处理的部分

- fileSystemStore 仍通过 Proxy 包装可变状态与 action，嵌套操作会产生额外通知。迁到直接 Zustand action 需要明确订阅行为，适合单独重构。
- HistoryViewer 的两步预览调用表面重复，但涉及锁定、克隆和替换策略，不能简单删掉其中一步。
- 原 main 上已有用户未提交的持久化与同步修改，本轮没有改动或合并这些文件。UI 交互原型和衣橱数据格式也保持原状。
