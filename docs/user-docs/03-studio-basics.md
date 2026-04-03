# 🎨 Studio 基础 (Studio Basics)

本章只讲 Studio 的基础能力: 选中部件、改颜色/透明/位移/层级、批量编辑、保存与回滚。

## 🎯 适用场景

- 你想微调某一件衣服的颜色、透明度、位置。
- 你想只改某几个图层，不想整套重做。
- 你想把编辑结果应用到当前目标，或先保存为 Studio 会话。

## ⚡ 功能速查

| 你要做什么 | 在哪里 | 功能键/动作 |
|---|---|---|
| 把当前角色导入为可编辑对象 | Studio 顶部工具栏 | `Import Character as Stack` |
| 把编辑结果穿到目标身上 | Studio 顶部工具栏 | `Apply to target` |
| 导出合并后的结果到衣柜 | Studio 顶部工具栏 | `Export merged` |
| 新建/重命名/排序项目 | 左侧 `Stack List` | `+`、`Rename`、拖拽/上下移动 |
| 选部件并控制显示/删除/替换 | 中间 `Part List` | 眼睛、删除、`⇄` |
| 改单个图层属性 | 右侧 `Part Inspector` | 颜色、透明、Offset、Priority |
| 批量改多个图层 | `Part Inspector` 多选模式 | `Batch Edit` |
| 回到任意历史状态 | Studio `History` 面板 | 选时间点并跳转 |
| 保存/读取 Studio 会话 | `Saves Manager` | `Save Current` / `Load` |

---

## 🛠️ 操作步骤

### 步骤 1: 导入一个可编辑对象
1. 打开 Studio。
2. 点击顶部工具栏 `Import Character as Stack`。
3. 左侧 `Stack List` 出现一个新堆栈后，点击它作为当前编辑目标。

### 步骤 2: 选中要改的部件
1. 在 `Part List` 里按分组找到目标部件。
2. 点击部件行后，右侧 `Part Inspector` 会显示该部件可编辑属性。
3. 需要定位空槽位时，可开启 `Show Empty Slots`。

### 步骤 3: 单图层精修
在 `Part Inspector` 里展开图层后，可直接修改以下属性:
- **Color**: 改图层颜色，可走调色板。
- **Opacity**: 调透明度。
- **Offset (X/Y)**: 改绘制偏移。
- **Priority**: 改图层前后层级。

> 💡 **提示**: 
> - 每个属性旁的 `↺` 可将该属性恢复到默认。
> - `View/Move` 可切换预览与可视化位移工具。

### 步骤 4: 多图层批量编辑
1. 在 `Part Inspector` 切到 `Multi` 模式。
2. 勾选多个图层，打开 `Batch Edit`。
3. 选择要批量改的属性: `Opacity` / `Offset` / `Priority` / `Color`。
4. 选择模式:
   - `=` 绝对值: 直接设置为某个固定值。
   - `±` 相对值: 在原值基础上增减。

### 步骤 5: 保存、应用、回滚
1. 先点 `Save Current` (Saves Manager) 保存 Studio 会话以便随时回载。
2. 确认效果后，点顶部的 `Apply to target` 穿到目标小人身上。
3. 如果改崩了，打开 `History` 面板，跳回之前状态。

---

## 🚑 常见失败与急救

### 症状：改了参数但画面没变化
**检查**:
- 选中的是不是当前焦点图层？当前图层是否支持上色？
**恢复**: 
1. 在 `Part List` 重新点一次目标部件。
2. 在 `Part Inspector` 确认当前高亮图层。
3. 用 `↺` 复位该属性后再重试。

### 症状：无法切到 Move 模式
**检查**: 当前没有有效焦点部件。
**恢复**: 先在 `Part List` 点击一个具体部件，再切换 `View/Move`。

### 症状：批量编辑没有生效
**检查**: 没有选中图层，或者该属性不支持批量(例如在不可上色的图层上改颜色)。
**恢复**: 切换到 `Multi`，重新勾选图层。先测试 `Opacity` 确认功能正常，再处理颜色。

### 症状：加载保存后状态和预期不同
**检查**: 载入的是旧的或者错误的会话存档。
**恢复**: 先在 `Saves Manager` 查看保存时间，如果还不准，去 `History` 时间线跳转回退。

---

## 📖 下一步看什么？

- **如何处理更多高级需求(图层重排/调色板高级标签)？** 👉 [04-studio-advanced.md](04-studio-advanced.md)
- **回到衣柜整理你的战利品？** 👉 [02-core-workflows.md](02-core-workflows.md)
- **数据怎么安全带走？** 👉 [05-data-backup-import-export.md](05-data-backup-import-export.md)
