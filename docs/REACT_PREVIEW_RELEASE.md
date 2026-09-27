# React 预览版发布

发布分支为 `wardrobe-react`。加载器、自动更新地址和主脚本下载地址均跟随此分支。版本以 [package.json](../package.json) 为准，打包时同步到加载器。

在脚本管理器中只启用 React 预览加载器。旧版 `ViviansPortableWardrobeLoader.user.js` / `VPW.user.js` 会在同一游戏页面加载并注入全局样式；两版同时启用可能使主界面串样式或重复显示衣橱。

## 当前交互

- 衣物索引支持多个名称唯一的标签，旧文件夹迁移为完整路径标签。
- 浏览提供卡牌和列表两种视图。卡牌使用瀑布流缩略图，列表不创建缩略图。
- 选择衣物后默认完全替换；桌面打开右侧试穿预览和应用栏，手机切换到预览页面。
- 「微调部位」在桌面打开弹窗，在手机切换到微调页面。修改实时更新预览，「完成微调」或返回会保留调整。最后通过预览中的「应用到『角色名』」换装。
- 分组按钮根据实际预览内容决定补入、覆盖或完全替换；已完成时保留结果。单个部件直接选择来源。
- 身形快捷操作只修改本次预览，包含身体、面容、发型和发色。

详细规则见 [索引衣橱与换装流程](INDEXED_OUTFIT_FLOW.md)。云端合并、共享容量及 BC 动态图片加载的实现分别见 [索引与同步](INDEXED_WARDROBE_SYNC.md)、[多端冲突方案](MULTI_DEVICE_SYNC_DESIGN.md)、[预览渲染](PREVIEW_RENDERING.md)。

## 验证与打包

```sh
npm run typecheck
npm test
npm run test:browser
npm run package:react
```

JavaScript 另执行 `node --check` 静态语法检查。浏览器测试使用独立模拟宿主、真实 React 组件和浏览器画布；BC 加载器回归可选择从本地读取固定上游版本。测试不等于真实账号联机验证。

`package:react` 构建并同步 React 加载器版本，将产物写入 `out/`，不会提交、推送或修改稳定版加载器。正式产物关闭 source map。

每次向 `wardrobe-react` 推送后，[React 预览版发布流程](../.github/workflows/publish-react-preview.yml)会检查该推送仍是分支最新提交。如果提交未手动递增 `package.json` 的 `react.N` 版本，流程自动递增版本并同步锁文件；随后检查类型和单元测试、重新打包，并用 VIV 假名把产物提交回分支。流程不使用会再次触发自身的提交凭据，也会跳过带 `[skip react publish]` 的发布提交。若期间又有新推送，旧流程不会覆盖新分支，最新推送负责发布。

自动发布可能在分支上追加一个提交。下次本机开发前先同步 `origin/wardrobe-react`，以免本地分支落后导致推送被拒绝。

发布提交之后，流程刷新并核对 jsDelivr 上的加载器和主包。CDN 临时失败且分支没有新的推送时，可以重跑原流程；若已经产生自动发布提交，重跑只重试 CDN，不再增加版本。发布流程失败时，不应把单纯的 Git 推送当成已送达的插件版本；检查 Actions 结果及 CDN 文件。游戏刷新后加载最新主包；脚本管理器何时把加载器的显示版本自动安装，取决于它自己的更新设置。Tampermonkey 5.5+ 需要按需开启 **Automatic installation（自动安装）**。jsDelivr 分支地址有缓存，查询参数本身不保证即时更新。

发布前核对主脚本与加载器的分支和版本一致，并检查源码、文档、产物及提交身份。使用 VIV 开头的项目假名和 GitHub noreply 邮箱，避免把本地账号路径和个人信息写入发布内容。
