# Vivian's Portable Wardrobe for Bondage Club / Vivian 的 BC 随身衣橱

A Bondage Club userscript for finding outfits, previewing changes and applying them to a character. Organize outfits with tags and choose what syncs across devices.

为 BC 提供衣物搜索、试穿预览和换装。用多标签整理衣橱，按件选择云同步范围。

## React preview / React 预览版

The React preview follows the **`wardrobe-react`** branch. Install the [React preview loader](https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@wardrobe-react/ViviansPortableWardrobeReactLoader.user.js) in your userscript manager, then reload the game. The loader and its update URLs follow this branch; the current version is defined in [package.json](package.json).

React 预览版跟随 **`wardrobe-react`** 分支。在脚本管理器中安装 [React 预览加载器](https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@wardrobe-react/ViviansPortableWardrobeReactLoader.user.js)，然后刷新游戏。加载器及更新地址均指向此分支，当前版本以 [package.json](package.json) 为准。

Install the loader **once from the link above**. In the script manager it appears as **Vivians Portable Wardrobe (React Preview Loader)** and updates through its `@updateURL`. It loads the current branch bundle when the game opens. If you previously installed the full React bundle or the older VPW script, disable that copy to avoid running two wardrobes.

请从上面的链接**安装一次加载器**；脚本管理器中应显示 **Vivians Portable Wardrobe (React Preview Loader)**。它通过 `@updateURL` 更新自身，并在打开游戏时加载该分支的主程序。如果之前安装过 React 主包或旧版 VPW，请停用旧脚本，避免同时运行两份衣橱。

Publishing a push to `wardrobe-react` now builds a new userscript version, refreshes both CDN files and checks that the CDN serves the committed artifacts. A local Git commit alone is not a release. The game must be reloaded to run the new bundle. Your userscript manager controls when it checks for and installs loader updates; in [Tampermonkey 5.5+](https://www.tampermonkey.net/changelog.php?locale=en&more=true&show=fire), enable **Automatic installation** if you want the loader's displayed version to update without a prompt.

推送到 `wardrobe-react` 后，发布流程会生成新版脚本、刷新两个 CDN 文件并核对线上内容；只在本机提交 Git 不会发布。刷新游戏页面才会运行新版主包。加载器在脚本管理器中显示的版本仍取决于管理器的检查和安装设置；[Tampermonkey 5.5+](https://www.tampermonkey.net/changelog.php?locale=en&more=true&show=fire) 如需无提示安装更新，请开启 **Automatic installation（自动安装）**。

If an earlier loader still has `feat/wardrobe-react` in `@updateURL`, or was installed by pasting a Markdown-formatted URL such as `[https://…](https://…)`, install it once from the direct link above. Those older update addresses cannot discover this branch's releases.

如果已安装加载器的 `@updateURL` 仍包含 `feat/wardrobe-react`，或曾把 `[https://…](https://…)` 这样的 Markdown 链接直接粘贴进去，请从上面的直链重新安装一次；这些旧地址无法发现当前分支的更新。

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
- **BC sync** uses `Player.ExtensionSettings`. VPW conservatively budgets **180000 bytes (180 kB)** for the entire settings object and shows its share alongside other extensions. BC uploads pause when the budget is exceeded; saved local outfits remain available.
  **BC 同步**使用 `Player.ExtensionSettings`。VPW 为整个扩展设置对象保守预留 **180000 字节（180 kB）** 预算，并分别显示衣橱和其他扩展的占用。超过预算时会暂停 BC 上传，本机已保存的衣物仍可使用。
- **Cloudflare sync** is optional and requires a build configured with a deployed [Pages Functions + D1 service](cloudflare/README.md). Enable it in **Settings → Sync method**. Cloudflare then becomes the primary sync source; VPW stops uploading wardrobe content to BC. The service accepts up to **1.8 MB of wardrobe JSON per recovery key**, subject to its other limits. Keep an external copy of the recovery key: anyone with it can read or change that cloud wardrobe. VPW also attempts to save the key in BC extension settings, which still uses part of the BC budget. Cloudflare stores outfit data without end-to-end encryption.
  **Cloudflare 同步**是可选项，需要脚本构建时已配置并部署 [Pages Functions + D1 服务](cloudflare/README.md)。在 **设置 → 同步方式** 中开启后，Cloudflare 成为主要同步源，VPW 不再向 BC 上传衣橱内容。服务对每把恢复密钥最多接受 **1.8 MB 衣橱 JSON**，另有服务容量限制。请在插件外另存恢复密钥；持有密钥的人可以读取或修改对应云衣橱。VPW 也会尝试将密钥保存到 BC 扩展设置，因此它仍占用一小部分 BC 预算。Cloudflare 上的衣物数据没有端到端加密。
- Turning Cloudflare sync off resumes BC sync from the current local wardrobe; it does not delete the Cloudflare copy. Importing a different recovery key switches to a different cloud wardrobe: the old key stays valid and its D1 record remains. Use the **same** key on every device. Devices that keep using BC sync can diverge; cleanup of the old BC copy must wait for a fresh BC comparison and pause for review if it changed. A Cloudflare outage does not silently switch back to BC. Export a JSON backup before changing modes or keys.
  关闭 Cloudflare 同步后，当前本机衣橱会重新走 BC 同步；Cloudflare 副本不会自动删除。导入另一把恢复密钥会切换到另一份云衣橱，旧密钥仍有效，旧 D1 记录也不会删除。所有设备应使用**同一把**密钥；继续使用 BC 同步的设备可能与 Cloudflare 分叉。清理旧 BC 副本前必须核对新鲜 BC 快照，若发现变化则暂停并交由用户审阅。Cloudflare 不可用时不会悄悄切回 BC。切换模式或密钥前请导出 JSON 备份。
- The wardrobe index and recovery copies now use IndexedDB. On first launch, VPW copies readable older `localStorage` records there and removes each unchanged old key only after the database transaction completes. Browser storage policies can still reject an IndexedDB write; a failed save is reported before an outfit is treated as saved or uploaded. The separate `localStorage` usage breakdown describes legacy data, not available space. Export the wardrobe and recovery backups before changing site data. Do not clear all site data.
  衣柜索引与恢复副本现在保存在 IndexedDB。首次打开时，VPW 会迁移可读取的旧 `localStorage` 记录；数据库事务完成后，才移除内容仍相同的旧键。浏览器存储策略仍可能拒绝 IndexedDB 写入；保存失败的衣物不会被标为已保存或上传。`localStorage` 用量明细只用于查看旧数据，不代表可用空间。更改站点数据前，请分别导出衣柜和恢复备份；不要清除整个站点数据。
- In BC mode, BC does not acknowledge each `AccountUpdate`. After a successful send call, VPW treats the upload as assumed saved; the next full login reads cloud data to detect discrepancies or conflicts. Cloudflare mode uses an HTTP response and revision check instead.
  在 BC 模式下，BC 不会逐次回执 `AccountUpdate`。提交调用成功后，VPW 默认视为同步成功；下次完整登录回读数据，用于发现差异或冲突。Cloudflare 模式则根据 HTTP 响应与修订号核对结果。

See the [user guide](USER_GUIDE.md), [中文快速开始](docs/user-docs/01-quick-start.md), [core workflows / 核心工作流](docs/user-docs/02-core-workflows.md), [sync & storage / 云同步与容量](docs/user-docs/06-sync-and-storage.md) and [multi-device sync design / 多端同步设计](docs/MULTI_DEVICE_SYNC_DESIGN.md).

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

