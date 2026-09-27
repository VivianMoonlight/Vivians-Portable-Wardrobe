# Vivian's Portable Wardrobe for Bondage Club / Vivian 的 BC 随身衣橱

A Bondage Club userscript for finding outfits, previewing changes and applying them to a character. Organize outfits with tags and choose what syncs across devices.

为 BC 提供衣物搜索、试穿预览和换装。用多标签整理衣橱，按件选择云同步范围。

## React preview / React 预览版

The React preview follows the **`wardrobe-react`** branch. Install the [React preview loader](https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@wardrobe-react/ViviansPortableWardrobeReactLoader.user.js) in your userscript manager, then reload the game. The loader and its update URLs follow this branch; the current version is defined in [package.json](package.json).

React 预览版跟随 **`wardrobe-react`** 分支。在脚本管理器中安装 [React 预览加载器](https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@wardrobe-react/ViviansPortableWardrobeReactLoader.user.js)，然后刷新游戏。加载器及更新地址均指向此分支，当前版本以 [package.json](package.json) 为准。

Install the loader **once from the link above**. In the script manager it appears as **Vivians Portable Wardrobe (React Preview Loader)** and updates through its `@updateURL`. It loads the current branch bundle when the game opens. If you previously installed the full React bundle or the older VPW script, disable that copy to avoid running two wardrobes.

请从上面的链接**安装一次加载器**；脚本管理器中应显示 **Vivians Portable Wardrobe (React Preview Loader)**。它通过 `@updateURL` 更新自身，并在打开游戏时加载该分支的主程序。如果之前安装过 React 主包或旧版 VPW，请停用旧脚本，避免同时运行两份衣橱。

## Find, preview, apply / 找衣物、预览、应用

1. Open the wardrobe from the floating button. Search outfits or tags, then use the tag and cloud filters to narrow the results.
   点击悬浮按钮打开衣橱。搜索衣物或标签，再用标签及云同步范围筛选。
2. Browse **Cards** for a masonry layout with previews, or **List** for names, tags and actions without thumbnails.
   用 **卡牌** 浏览瀑布流缩略图，或切换到不带缩略图的 **列表** 查看名称、标签和操作。
3. Select an outfit. Its full appearance opens in the right preview pane on desktop, or on a separate preview page on mobile. Selection starts with full replacement.
   选择衣物后，桌面右侧显示试穿预览，手机切换到预览页面。每次选择都默认完全替换。
4. Open **Adjust outfit** when needed. Group buttons show the next action based on the current preview: **Add**, **Replace** or **Full replace**. Individual sliders choose **Original**, **Outfit** or **Empty** directly. **Done adjusting** returns to the preview and keeps your changes. Adjustments open in a dialog on desktop and on a separate page on mobile.
   按需打开 **微调部位**。分组按钮根据当前预览显示 **补入、覆盖或完全替换**；部件滑块直接选择 **原角色、所选衣物或置空**。**完成微调** 保留调整并返回预览。桌面微调使用弹窗，手机微调使用独立页面。
5. Check the target character, then use **Apply to “character name”**. Closing the desktop preview or choosing **Back to wardrobe** on mobile keeps your search, filters and browsing position.
   确认目标角色后，点击 **应用到「角色名」**。桌面收起预览、手机点击 **返回衣橱**，都会保留搜索、筛选和浏览位置。

Selecting an outfit and adjusting the preview do not change the character. Applying remains subject to BC permissions, locks and available assets.

选衣和微调只改变预览，实际换装仍受 BC 权限、锁具和资产可用性限制。

For your own character, **Settings → Outfit controls → Allow force apply to myself** reveals a red **Force apply** button in the preview. This setting is off by default and stays in this browser for the current BC account. The button attempts to bypass BC clothing settings; the game may still reject or alter the result. Check your character after using it.

如需对自己的角色尝试强制换装，可在 **设置 → 换装选项 → 允许对自己强制换装** 中开启，预览页便会显示红色 **强制应用** 按钮。此设置默认关闭，按当前 BC 账号保存在本机。游戏仍可能拒绝或调整换装结果，请在操作后检查角色外观。

## Organize and sync / 整理与同步

- Save your current outfit or import outfits from **Import / Export**. Use **Manage tags** to create unique tag names, and an outfit's **⋯ → Edit tags** menu to add multiple tags.
  在 **导入 / 导出** 中保存当前穿着或导入衣物。用 **管理标签** 创建名称不重复的标签，再从衣物的 **⋯ → 编辑标签** 添加多个标签。
- Old folders migrate to full-path tags. Deleting a tag keeps its outfits.
  旧文件夹迁移为完整路径标签，删除标签会保留衣物。
- Local-save status and cloud progress are shown separately. Each outfit can be **Cloud enabled** or kept on **This device only**.
  本机保存与云端进度分别显示，每件衣物可选择 **参与云同步** 或 **仅保存在本机**。
- All extensions share a **180000-byte (180 kB)** settings budget. The storage panel shows VPW's share and other extensions' usage. Uploads pause when over the limit; saved local outfits remain available.
  所有扩展共享 **180000 字节（180 kB）** 设置容量。面板显示 VPW 与其他扩展的占用，超限会暂停上传，已保存的本机衣物仍可使用。
- A `VPWardrobe_index_*` `QuotaExceededError` means this browser rejected a write to the site's `localStorage`. Its per-site quota or storage policy can block writes even with free disk space; BC's 180 kB cloud figures do not measure it. The error panel estimates this site's stored VPW and other `localStorage` data. Local writes prefer UTF-16 compression and fall back to Base64 if needed; the cloud format is unchanged. Export and check a readable JSON backup before changing site data, then use **Retry local save**. Do not clear all site data.
  `VPWardrobe_index_*` 的 `QuotaExceededError` 表示浏览器拒绝向此站点的 `localStorage` 写入。即使磁盘空间充足，站点独立配额或浏览器存储策略也可能阻止写入；BC 云端 180 kB 用量不反映本机空间。报错区域会估算此站点已存的 VPW 和其他 `localStorage` 数据。新版优先用 UTF-16 压缩本机数据，必要时回退 Base64；云端格式不变。先导出并核对可读取的 JSON 备份，再检查站点数据并点击 **重试本机保存**；不要直接清除整个站点数据。
- BC does not acknowledge each `AccountUpdate`. After a successful send call, VPW shows the upload as assumed saved; the next full login reads cloud data to detect discrepancies or conflicts. Export a JSON backup before switching devices.
  BC 不会逐次回执 `AccountUpdate`。提交调用成功后，VPW 默认显示同步成功；下次完整登录回读云端数据，用于发现差异或冲突。换设备前请导出 JSON 备份。

See the [user guide](USER_GUIDE.md), [中文快速开始](docs/user-docs/01-quick-start.md), [core workflows / 核心工作流](docs/user-docs/02-core-workflows.md) and [sync & storage / 云同步与容量](docs/user-docs/06-sync-and-storage.md).

## Development / 开发

```sh
npm ci
npm run typecheck
npm test
npm run test:browser
npm run package:react
```

`package:react` creates `out/Vivians-Portable-Wardrobe.user.js` and `out/ViviansPortableWardrobeReactLoader.user.js`, without committing or pushing. Production bundles omit source maps. Browser tests use Edge on Windows and Chromium elsewhere; set `PLAYWRIGHT_CHANNEL` to choose an installed browser.

`package:react` 生成上述主脚本和加载器，不会提交或推送。正式产物不包含 source map。浏览器测试在 Windows 使用 Edge，其他系统使用 Chromium，可通过 `PLAYWRIGHT_CHANNEL` 指定已安装的浏览器。

The development host uses mock characters and assets. Automated checks do not replace testing in the real game.

开发宿主使用模拟角色和资源，自动检查不能替代真实游戏验证。交互和渲染实现见 [索引衣橱与换装流程](docs/INDEXED_OUTFIT_FLOW.md)及[预览渲染](docs/PREVIEW_RENDERING.md)。

## Credits / 致谢

This project draws on [BC Outfit Manager (BCOM)](https://github.com/Utsumi24/BCOM#bc-outfit-manager-bcom) by **@Utsumi24**.

本项目参考了 **@Utsumi24** 的 BC Outfit Manager，感谢其贡献。

