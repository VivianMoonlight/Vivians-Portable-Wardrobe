# 用户文档计划表

更新时间: 2026-04-03

## 文档存放建议

建议将面向用户的正式文档统一放在以下目录:

- `docs/user-docs/`

原因:

1. 与 `docs/` 下现有架构/重构计划文档分层，避免混杂。
2. 便于未来按章节拆分、多人协作与版本维护。
3. 可逐步把根目录 `USER_GUIDE.md` 的内容迁移到该目录。

## 用户文档信息架构

- `docs/user-docs/00-index.md` 总览与导航
- `docs/user-docs/01-quick-start.md` 快速开始
- `docs/user-docs/02-core-workflows.md` 核心工作流
- `docs/user-docs/03-studio-basics.md` Studio 基础
- `docs/user-docs/04-studio-advanced.md` Studio 高级
- `docs/user-docs/05-data-backup-import-export.md` 数据与备份
- `docs/user-docs/06-sync-and-storage.md` 云同步与容量
- `docs/user-docs/07-theme-language-mobile.md` 主题/语言/移动端
- `docs/user-docs/08-troubleshooting-faq.md` 故障排查与 FAQ

## 用户文档计划表

| 阶段 | 文档文件 | 目标读者 | 目标结果 | 主要内容 | 优先级 | 状态 |
|---|---|---|---|---|---|---|
| Phase 1 | `00-index.md` | 全部用户 | 快速找到入口 | 文档导航、功能地图、阅读路径 | P0 | 已完成 |
| Phase 1 | `01-quick-start.md` | 新用户 | 5 分钟完成首次使用 | 安装、入口按钮、保存/预览/应用、首次备份 | P0 | 已完成 |
| Phase 1 | `05-data-backup-import-export.md` | 全部用户 | 降低丢档风险 | 全库备份恢复、单套导出、BCX 互通 | P0 | 已完成 |
| Phase 1 | `08-troubleshooting-faq.md` | 遇到问题用户 | 自助定位常见问题 | 按症状排查、失败恢复步骤、已知问题 | P0 | 已完成 |
| Phase 2 | `02-core-workflows.md` | 日常用户 | 覆盖高频操作 | 文件管理、搜索排序、预览、过滤、应用模式、历史恢复 | P1 | 已完成 |
| Phase 2 | `03-studio-basics.md` | 进阶用户 | 能稳定使用 Studio | 栈/部件/属性/替换模式/基础编辑 | P1 | 已完成 |
| Phase 2 | `07-theme-language-mobile.md` | 全部用户 | 清晰理解界面配置 | 主题、语言、移动端入口与使用边界 | P1 | 已完成 |
| Phase 3 | `04-studio-advanced.md` | 深度用户 | 完成复杂编辑 | 图层优先级、多选批量、调色板与标签、撤销重做 | P2 | 已完成 |
| Phase 3 | `06-sync-and-storage.md` | 数据敏感用户 | 理解同步容量规则 | 云同步范围、180KB 限制、超限行为与建议 | P2 | 已完成 |

## 口径统一规则（写作前先确认）

1. 移动端支持状态必须统一为同一版本口径（避免“支持/不支持”并存）。
2. 入口按钮位置描述使用当前实现，不引用历史位置。
3. 数据安全章节必须优先给出“会不会丢数据”和“如何恢复”。
4. 每篇文档统一结构: 适用场景 -> 操作步骤 -> 结果预期 -> 常见失败与恢复。

## 里程碑建议

- M1: 发布 `00-index.md` + `01-quick-start.md` + `05-data-backup-import-export.md` + `08-troubleshooting-faq.md`
- M2: 发布 `02-core-workflows.md` + `03-studio-basics.md` + `07-theme-language-mobile.md`
- M3: 发布 `04-studio-advanced.md` + `06-sync-and-storage.md`
