# BCX 服装偏移排查（React Wardrobe / R134）

先从 BCX 解压后的服装数组中按 Group 和 Name 找到目标物品。记录出问题的图层、角色姿势、渲染后端，以及问题发生在衣柜预览、穿戴还是再次导出。观察同一角色同一姿势，并以角色画布单位比较位置。

## 衣柜里的数据格式

服装卡显示整套衣服的数据格式。无标签时按旧数据处理。右键“设置为新数据”仅更改标签；“转换为新数据”按旧衣补偿规则换算并保存偏移。新数据预览和穿戴使用已保存的数值。右键“撤销转换”可在卡片仍挂载、记录版本未改变时恢复转换前的数据和旧标签。退出或刷新后，临时副本失效。

## 从输入判断 VPW 会怎样处理

- 旧码把坐标放在 Property.LayerOverrides 的图层数组里，例如 DrawingTop 的空字符串键。VPW 在预览和穿戴时按资产层序匹配，计算「旧目标坐标 − 当前姿势下的图层原点」。找不到适用的姿势原点时使用默认原点。开启旧衣偏移兼容后，按下表换算并四舍五入，半数向远离零的方向取整。换算在临时副本上完成。
- 原生 TranslationX/Y 是整件平移，LayerTranslationX/Y 是按层名存储的平移。某个轴已经提供原生平移时，直接读取该轴的平移。开启兼容也会补偿转存为原生格式的旧衣。只有空对象的 LayerOverrides 数组不能证明该物品还需要旧坐标迁移。一个服装包可以同时包含两种格式。
- 资产未加载、层数不匹配或旧坐标形状无法识别时，函数可能返回原物品。先核对运行时 Asset.Layer，再决定是否需要支持新格式。[转换实现](../src/services/migrate-outfit-offsets.js)

## 旧衣平移倍率

| 旧衣物品 | 游戏原生 WebGL |
| --- | ---: |
| 无缩放 | 0.5 |
| 整件或任一图层有非单位缩放 | 1 |

按物品判断缩放，同时换算整件和各层的 X、Y 平移。关闭兼容即可按原倍率穿戴新衣。

## 从症状缩小范围

| 观察到的现象 | 优先检查 |
| --- | --- |
| 切换兼容开关，只有部分物品变化 | 分轴检查旧坐标和原生平移。给原生平移再减半可能破坏作者在相同后端调好的衣服。 |
| 正常站立也出现上百单位横移 | 比较默认原点和实际 DrawPose。实测左右丝袜在 LegsClosed 的绘制 X 为 0，默认 X 为 125。用默认值做减法曾产生多余的 −125。 |
| 位置约为预期的两倍 | R134 公共绘制先加平移，WebGL 后端还会再使用平移。记录后端和镜像状态；镜像横轴有额外处理。上游更新后应复核。[CommonDraw.js](https://www.bondage-europe.com/R134/BondageClub/Scripts/CommonDraw.js) · [GLDraw.js](https://www.bondage-europe.com/R134/BondageClub/Scripts/GLDraw.js) |
| 日志出现 Invalid integer value 6.5 等 | 查看报错的槽位、层名和轴。检查 Network 中实际执行的用户脚本正文及版本；历史上分支 CDN 曾在发布整数修复后继续返回旧包。原生输入也可能自带小数。 |
| 图层互相盖住，或轮廓看起来移位 | 分开检查 OverridePriority、Opacity、Scale 和 Rotation。先找出实际可见层，再查它的位置。 |

## 一套混合格式服装的例子

月亮发饰左层原生平移为 (−9, 47)。Ribbons4 左层为 (−180, −28)，整件还有 (−8, −1)，因此绘制端收到的左层合计为 (−188, −29)，同时整件 ScaleX 为 3。SeraphWings 的 WingTip3 和 WingTip4 分层 Y 分别是 −278 和 −272，还设置了逐层缩放和透明度。这三件的数据在旧码换算之前已经包含位移。仅凭数值无法判断作者在哪个游戏版本或后端调好了位置。

穿到自己身上后，可在游戏控制台按实际槽位读取生效属性。预览使用独立角色，Player 反映的是已穿戴结果。

```js
const groups = new Set(['Luzi_HairAccessory3_2', 'HairAccessory3_笨笨蛋Luzi', 'Wings_笨笨蛋Luzi']);
console.table(Player.Appearance.filter(i => groups.has(i.Asset.Group.Name)).flatMap(i =>
  i.Asset.Layer.map((layer, index) => {
    const p = i.Property ?? {};
    const name = layer.Name ?? '';
    return {
      item: i.Asset.Name, index, layer: name,
      x: (p.TranslationX ?? 0) + (p.LayerTranslationX?.[name] ?? 0),
      y: (p.TranslationY ?? 0) + (p.LayerTranslationY?.[name] ?? 0),
      opacity: Array.isArray(p.Opacity) ? p.Opacity[index] : p.Opacity,
    };
  })
));
```

若穿戴后的合计平移等于输入，继续在同姿势、同后端对比原生换装和 VPW 的绘制结果。若数值发生变化，在 prepareOutfitOffsets 返回处和 ServerAppearanceLoadFromBundle 返回后分别核对属性，结合游戏的校验日志定位丢失发生在哪一步。
