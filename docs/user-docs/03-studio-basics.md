# Studio 基础 (Studio Basics)

本章只讲 Studio 的基础能力: 选中部件、改颜色/透明/位移/层级、批量编辑、保存与回滚。

## 适用场景

- 你想微调某一件衣服的颜色、透明度、位置。
- 你想只改某几个图层，不想整套重做。
- 你想把编辑结果应用到当前目标，或先保存为 Studio 会话。

## 功能速查

| 你要做什么 | 在哪里 | 功能键/动作 |
|---|---|---|
| 把当前角色导入为可编辑堆栈 | Studio 顶部工具栏 | `Import Character as Stack` |
| 把编辑结果穿到目标身上 | Studio 顶部工具栏 | `Apply to target` |
| 导出合并后的结果到衣柜 | Studio 顶部工具栏 | `Export merged` |
| 新建/重命名/排序堆栈 | 左侧 `Stack List` | `+`、`Rename`、拖拽/上下移动 |
| 选部件并控制显示/删除/替换 | 中间 `Part List` | 眼睛、删除、`⇄` |
| 改单个图层属性 | 右侧 `Part Inspector` | 颜色、透明、Offset、Priority |
| 批量改多个图层 | `Part Inspector` 多选模式 | `Batch Edit` |
| 回到任意历史状态 | Studio `History` 面板 | 选时间点并跳转 |
| 保存/读取 Studio 会话 | `Saves Manager` | `Save Current` / `Load` |

## 操作步骤

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

- `Color`: 改图层颜色，可走调色板。
- `Opacity`: 调透明度。
- `Offset (X/Y)`: 改绘制偏移。
- `Priority`: 改图层前后层级。

提示:

- 每个属性旁的 `↺` 可将该属性恢复到默认。
- `View/Move` 可切换预览与可视化位移工具。

### 步骤 4: 多图层批量编辑

1. 在 `Part Inspector` 切到 `Multi` 模式。
2. 勾选多个图层，打开 `Batch Edit`。
3. 选择要批量改的属性: `Opacity` / `Offset` / `Priority` / `Color`。
4. 选择模式:
   - `=` 绝对值: 直接设置为某个固定值。
   - `±` 相对值: 在原值基础上增减。

### 步骤 5: 保存、应用、回滚

1. 先点 `Save Current` 保存 Studio 会话(可重命名、可回载)。
2. 确认效果后，点 `Apply to target` 应用到目标。
3. 如果改崩了，打开 `History` 面板，跳回之前状态。

## 结果预期

- 你可以稳定完成“选部件 -> 调图层 -> 应用目标”的基础编辑闭环。
- 单图层与多图层都可编辑，并支持绝对/相对两种批量改法。
- 编辑过程有会话保存和历史回滚，误操作可恢复。

## 常见失败与恢复

### 1) 改了参数但画面没变化

可能原因:

- 选中的不是当前焦点图层。
- 当前图层不可着色或不支持该属性。

恢复:

1. 在 `Part List` 重新点一次目标部件。
2. 在 `Part Inspector` 确认当前高亮图层。
3. 用 `↺` 复位该属性后再重试。

### 2) 无法切到 Move

可能原因:

- 当前没有有效焦点部件。

恢复:

1. 先在 `Part List` 点击一个具体部件。
2. 再切换 `View/Move`。

### 3) 批量编辑没有生效

可能原因:

- 没有选中任何图层。
- 选中的图层不支持当前批量属性(例如颜色)。

恢复:

1. 切换到 `Multi`，重新勾选图层。
2. 先用 `Opacity` 或 `Priority` 验证批量链路，再处理颜色。

### 4) 加载保存后状态和预期不同

可能原因:

- 载入的是旧会话。

恢复:

1. 在 `Saves Manager` 按时间确认会话。
2. 若仍不对，去 `History` 面板跳回正确时间点。

## 延伸阅读

- 日常文件管理、过滤应用: [02-core-workflows.md](02-core-workflows.md)
- 数据备份与导入导出: [05-data-backup-import-export.md](05-data-backup-import-export.md)
- 常见报错自救: [08-troubleshooting-faq.md](08-troubleshooting-faq.md)
