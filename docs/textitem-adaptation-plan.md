# TextItem 适配方案（基于 TypedItem / ModularItem）

## 1. 目标与范围

在现有 `typeditem` 与 `modularitem` 结构适配基础上，新增 `text` archetype 的统一适配能力，满足以下场景：

1. **物品本体是 TextItem**（`archetype: "text"`）
2. **ModularItem 的某个 module 的某个 option 挂载 Text 子属性**（通常用于控制文字显示/隐藏）

本期仅做数据与编辑能力适配，不改变现有 typed/modular 的交互范式。

---

## 2. 现状结论

当前实现入口：

- `src/utils/AssetApi.js`
  - 已有：`getTypedAssetOptions(group, name)`
  - 已有：`getModularAssetData(group, name)`
  - 缺失：`TextItemDataLookup` 解析入口
- `src/components/Studio/PartInspectorPanel.vue`
  - 已有：Typed 选项编辑（`Property.TypeRecord`）
  - 已有：Modular 选项编辑（`Property.TypeRecord[moduleKey]`）
  - 缺失：Text 字段编辑（`Property.Text*`）

结论：当前结构链路完整，但仅覆盖 `TypeRecord`，尚未覆盖 `TextItemDataLookup` 驱动的文本属性。

---

## 3. 数据特征（依据样例）

### 3.1 TextItem 定义来源

- 数据入口固定为：`TextItemDataLookup[key]`
- 每个条目关键字段：
  - `textNames: string[]`（如 `['Text']` 或 `['Text19','Text20','Text21']`）
  - `maxLength: Record<string, number>`（每个文本键的长度上限）
  - `parentOption`（若来自 modular option，会携带关联信息）

### 3.2 实际值存储位置

- 运行时值在 `part.Property` 下，按键保存：
  - `Property.Text`
  - `Property.Text19` / `Property.Text20` / ...
- 同一 Property 内可能并存多个 `TextN`，不应在切换时盲目清除。

### 3.3 与 Modular 联动

- Modular 当前选项由 `Property.TypeRecord[moduleKey]` 决定
- 仅当当前选中的 option 带 `ArchetypeData.archetype === 'text'` 时，才显示该 option 对应的文本字段
- 未选中时可隐藏输入 UI，但建议保留历史值（不自动清空）

---

## 4. 统一适配模型（建议）

在 `AssetApi` 新增统一解析函数（命名建议）：

- `getTextItemDefinitionsForPart(group, name, partProperty)`

输出统一定义数组：

```ts
interface TextFieldDef {
  key: string;         // Text / Text19 / Text20 ...
  maxLength: number;   // 字符上限
}

interface TextItemDef {
  source: 'self' | 'modular-option';
  lookupKey: string;   // TextItemDataLookup 的 key
  textFields: TextFieldDef[];
  parentModuleKey?: string;
  parentOptionIndex?: number;
}
```

说明：

- `self`：物品本体 text archetype
- `modular-option`：来自当前已选 modular option 的 text 子属性

---

## 5. 解析算法

输入：`group`, `name`, `part.Property`

步骤：

1. 生成资产主键：`assetKey = group + name`
2. **本体 text 检查**
   - 若 `TextItemDataLookup[assetKey]` 存在，则加入 `source='self'`
3. **modular text 检查**
   - 读取 `ModularItemDataLookup[assetKey]`
   - 遍历 `modules`
   - 根据 `TypeRecord[module.Key]` 获取当前 option
   - 若该 option 的 `ArchetypeData.archetype === 'text'` 且有 `ArchetypeData.key`
     - 读取 `TextItemDataLookup[ArchetypeData.key]`，加入 `source='modular-option'`
4. 每个 text lookup 条目展开为 `textFields`：
   - key 来自 `textNames`
   - maxLength 来自 `maxLength[key]`，缺失时给安全回退值（如 255）
5. 返回定义数组（空数组表示无 text 编辑能力）

---

## 6. UI 适配方案（PartInspector）

在 `PartInspectorPanel.vue` 增加 Text 编辑区（位于结构编辑区，与 typed/modular 同级）。

### 6.1 展示规则

- `showStructureFields === true` 且 `textDefinitions.length > 0` 时显示
- 对每个 `TextItemDef` 渲染其 `textFields`
- label 默认显示字段名（`Text19` 等）；后续可接入字典化文案

### 6.2 编辑行为

- 每个输入框绑定当前值：`part.Property?.[field.key] ?? ''`
- 输入时执行长度约束：`value.slice(0, maxLength)`
- 保存方式：
  - clone 当前 `Property`
  - 仅覆盖对应 `Text*` 键
  - 调用 `store._updateFocusedPartProperty('Property', newProp)`
- 不改动其他 `Text*` 键，不做隐式清空

### 6.3 输入控件策略

- 先统一用单行输入（`BaseInput` 或当前标准输入）
- “单行/多行”以字段数量表达：
  - 1 个字段：1 行
  - 多个字段：多行分开编辑
- 若后续确认某字段必须多行，再扩展为 textarea（本期不引入额外复杂度）

---

## 7. 边界与降级策略

1. `TextItemDataLookup` 不可用：返回空定义，UI 不显示 text 区块
2. lookup key 存在但条目异常（无 `textNames`）：忽略该条目
3. `TypeRecord` 缺失时 modular text 默认不激活
4. 切换 modular option 后：
   - 重新计算 `textDefinitions`
   - UI 跟随显示/隐藏
   - 历史 `TextN` 值保留

---

## 8. 实施清单（最小改动）

### 8.1 数据层

- 文件：`src/utils/AssetApi.js`
- 新增：`getTextItemDefinitionsForPart(group, name, partProperty)`
- 导出到 `AssetApi`

### 8.2 视图层

- 文件：`src/components/Studio/PartInspectorPanel.vue`
- 新增：
  - `textDefinitions`（`ref`/`computed`）
  - `refreshTextDefinitions()`
  - `getTextValue(fieldKey)`
  - `onTextChange(fieldKey, maxLength, event)`
- 在结构区模板增加 text 字段渲染

### 8.3 验证

- 本体 TextItem（如 `ClothCheerleaderTop`）可编辑 `Property.Text`
- Modular option text（如 `...g1`）在对应 option 激活时显示并可编辑 `Text19/20/21`
- 输入超限被截断
- 切换 option 不丢失已写文本

---

## 9. 验收标准

满足以下条件即通过：

1. 不破坏现有 typed/modular 选择逻辑
2. TextItem 字段由 `TextItemDataLookup` 驱动，不硬编码键名
3. 支持“本体 text”与“modular option text”两种来源
4. 文本值稳定落在 `part.Property[Text*]`
5. 无 `TextItemDataLookup` 时系统可正常降级

---

## 10. 后续可选增强（非本期）

1. 字段 label 本地化（基于 `dialogPrefix` / 字典）
2. 区分单行与多行输入控件（textarea）
3. 增加字符计数与接近上限提示
4. 可选“切换 option 时清理隐藏字段”策略开关（默认关闭）
