# Vivian's Portable Wardrobe for Bondage Club / Vivian 的 BC 随身衣柜

# The 0.9 Version is out now! / v0.9版本已发布

A BC script that adds a **portable wardrobe system** with a preview mirror and advanced outfit management.  
本脚本为 BC 游戏提供 **随身衣柜**，内置预览镜和高级服装管理功能。

---

## ✨ Features / 功能

### 🪞 Display Mirror / 预览镜  
- Preview your outfit in real time.  
- 实时预览当前装扮。  

### 📁 Modern File System / 文件管理  
- Drag & drop files/folders to organize outfits.  
- Hover to preview outfits.  
- Right-click for context menu.  
- 拖动文件/文件夹管理装扮。  
- 悬停预览装扮。  
- 右键打开操作菜单。  

### 🎛️ Outfit Application Panel / 装扮应用面板  
- Apply full or partial outfits.  
- Combine elements from multiple saved outfits.  
- 可选择应用完整装扮或部分装扮。  
- 可组合多个已保存装扮的元素。  

### ☁️ Storage / 存储  
- Compressed online + local storage (TODO: select cloud storage).  
- Import/export outfit codes.  
- Backup/load all outfits.  
- 支持在线压缩存储 + 本地存储（TODO: 可选择云端保存）。  
- 支持导入/导出装扮代码。  
- 支持整库备份与恢复。  

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
2. Drag items to move them.  
   拖动文件或文件夹来移动顺序。  
3. Right-click on items to open the menu.  
   右键点击打开操作菜单。  
4. Hover over outfits to preview in the mirror.  
   悬停在装扮上可在预览镜中查看效果。  
5. Use the control panel to apply full or partial outfits.  
   使用控制面板选择应用完整装扮或部分装扮。  

---

## 📥 Load Script / 加载脚本

- **Direct Userscript / 直接用户脚本**:
- https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/ViviansPortableWardrobeLoader.user.js
- old version/旧版本
- https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/PortableWardrobeLoader.user.js


- **Bookmark / 书签栏**:
```javascript
  javascript:(()=>{fetch('https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/PortableWardrobeLoader.user.js?'+Date.now()).then(r=>r.text()).then(r=>eval(r));})();
```
- old version/旧版本
```javascript
  javascript:(()=>{fetch('https://vivianmoonlight.github.io/Vivians-Portable-Wardrobe/ViviansPortableWardrobeLoader.user.js?'+Date.now()).then(r=>r.text()).then(r=>eval(r));})();
```
---

## 📝 TODO

- Implement online storage limit  
  实现在线存储容量限制  
- Cloud/local selective-save toggle  
  云端/本地选择性保存
- TextedItem Compatibility
- CraftedItem Compatibility
- Import from Current Wardrobe
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

