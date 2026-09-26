# Vivian's Portable Wardrobe for Bondage Club / Vivian 的 BC 随身衣柜

当前分支：**feat/wardrobe-react** · React 预览版 **0.10.1-react.2**。

安装 [React 预览加载器](https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@feat%2Fwardrobe-react/ViviansPortableWardrobeReactLoader.user.js)。加载器和更新地址均跟随这个 feat 分支。

本地检查与打包：

```sh
npm ci
npm run typecheck
npm test
npm run test:browser
npm run package:react
```

打包会生成 `out/Vivians-Portable-Wardrobe.user.js` 和 `out/ViviansPortableWardrobeReactLoader.user.js`。正式产物不包含 source map。浏览器测试在 Windows 默认使用 Edge，其它系统使用 Chromium，可通过 `PLAYWRIGHT_CHANNEL` 指定已安装的浏览器。

A BC script that adds a **portable wardrobe system** with a preview mirror and advanced outfit management.  
本脚本为 BC 游戏提供 **随身衣柜**，内置预览镜和高级服装管理功能。

---

## ✨ Features / 功能

### 🪞 Preview & Adjust / 预览与微调

- Click an outfit to open **Preview & Adjust**. Each selection starts with a complete replacement from that outfit, ready to fine-tune.
  点击服装进入 **预览与微调**；每次选择都从该服装的全量替换开始，再按需调整。
- Return to the wardrobe with your search and tag filter preserved.
  返回衣橱时保留搜索和标签筛选。

### 🏷️ Indexed Wardrobe / 索引衣橱

- Browse a masonry layout and search by outfit or tag name. Each outfit can have multiple tags, with unique tag names across the wardrobe.
  用瀑布流浏览，搜索服装名或标签名；一套服装可以拥有多个标签，标签名称在衣橱内唯一。
- Filter by tag or cloud inclusion in the desktop sidebar or mobile filter drawer.
  在桌面侧栏或手机筛选抽屉中，按标签和云同步范围筛选。
- Use the card's **⋯** menu or right-click to edit tags, rename, export or delete an outfit.
  点击卡片的 **⋯** 或右键菜单，编辑标签、重命名、导出或删除服装。
- Existing folders migrate to path tags, with outfits stored in one searchable index.
  旧文件夹迁移为路径标签，服装统一收录到可搜索的索引中。

### 🎛️ Outfit Adjustments / 装扮微调

- Choose the original character, selected outfit or empty for each slot. Group source buttons cycle through **Add → Replace → Full replace** for broader changes.
  每个部位可直接选择原角色、所选衣物或置空；分组来源按钮按 **补入 → 覆盖 → 完全替换** 循环，方便批量调整。
- Finish with the single **Apply to “character name”** button at the bottom of the preview workspace.
  完成微调后，使用预览页末尾唯一的 **应用到「角色名」** 按钮换装。

### ☁️ Storage & Sync / 存储与同步

- Save locally first, then sync selected outfits. Each outfit has its own cloud toggle.
  先保存到本机，再同步选中的服装；每套服装都有独立的云同步开关。
- The panel checks a **180000-byte (180 kB)** shared extension-settings budget and the upload packet size. Uploads pause when over budget; saved local outfits remain available.
  面板检查所有扩展共享的 **180000 字节（180 kB）**设置预算及上传单包大小；超限暂停上传，保留已保存的本机服装。
- **Submitted is not verified**: verification requires fresh cloud data returned on login or reconnect. Local-save and cloud-sync status are shown separately.
  **已提交不等于已核验**：核验依赖登录或重连返回的新鲜云端数据。本机保存与云端同步分别显示状态。
- Import/export outfit codes and JSON backups. Backup import adds outfits as new copies and reuses matching tag names; repeated imports can create duplicates.
  支持装扮代码与 JSON 备份。备份导入会新增服装副本并复用同名标签；重复导入可能产生重复服装。

### New functions / 新功能
- Widget resizing & dragging overhaul  
  窗口拖动和缩放重构   
- Dressroom plug-in  
  Dressroom 插件支持  
- Multi-language support  
  多语言支持   
---

## 🚀 How to Start / 如何使用

1. Click the **bottom-left button** to open the wardrobe.  
   点击 **左下角悬浮按钮** 打开衣柜。  
2. Save your current outfit or import outfits from **Import / Export**. Create tags under **Manage tags**, then assign them through an outfit's **⋯ → Edit tags** menu.
   在 **导入 / 导出** 中保存当前装扮或导入服装；通过 **管理标签** 新建标签，再用服装的 **⋯ → 编辑标签** 分配标签。
3. Search by outfit or tag name, then narrow the results using the sidebar filters. On mobile, open **Filters** for the same controls.
   搜索服装名或标签名，再用侧栏筛选结果；手机上点击 **筛选** 打开相同的筛选项。
4. Click an outfit to open **Preview & Adjust**, starting from its complete appearance. Adjust groups or individual slots; **Back to wardrobe** keeps your search and tag filter.
   点击服装进入 **预览与微调**，从所选服装的完整装扮开始，按组或逐部位调整；**返回衣橱** 会保留搜索和标签筛选。
5. Check the target character and preview, then click **Apply to “character name”** at the bottom.
   确认目标角色和预览效果，点击末尾的 **应用到「角色名」**。
6. Use each card's cloud toggle to choose what syncs. Check local-save and cloud status in the storage panel, and export a JSON backup before switching devices.
   用卡片上的云开关选择同步范围，查看存储面板的本机保存与云端状态；换设备前导出一份 JSON 备份。

See [Sync & Storage / 云同步与容量](docs/user-docs/06-sync-and-storage.md) for retry, quota and backup details.

---

## 📥 Load Script / 加载脚本

- **Direct Userscript / 直接用户脚本**:
- https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/ViviansPortableWardrobeLoader.user.js
- old version/旧版本
- https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/PortableWardrobeLoader.user.js


- **Bookmark / 书签栏**:
```javascript
  javascript:(()=>{fetch('https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/ViviansPortableWardrobeLoader.user.js?'+Date.now()).then(r=>r.text()).then(r=>eval(r));})();
```
- old version/旧版本
```javascript
  javascript:(()=>{fetch('https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/PortableWardrobeLoader.user.js?'+Date.now()).then(r=>r.text()).then(r=>eval(r));})();
```
---

## 📝 TODO

- TextedItem Compatibility
- CraftedItem Compatibility
- ...

---

## ⚠️ Disclaimer / 注意事项

- This version is **under development** and may be unstable.  
- 该版本 **仍在开发中**，可能不稳定。  
- Always backup your data before use.  
- 使用前请务必备份数据。  

---

## 💝 Special Thanks / 特别感谢

- **@Utsumi24**, author of [BC Outfit Manager (BCOM)](https://github.com/Utsumi24/BCOM#bc-outfit-manager-bcom)  
- 本项目参考了 **BC Outfit Manager (BCOM)**，感谢 @Utsumi24 的贡献。  
- A data migration function will be added in future versions.  
- 计划在未来版本中添加数据迁移功能。

