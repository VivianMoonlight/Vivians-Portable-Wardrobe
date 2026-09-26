# 预览资源加载与调度

衣服列表与侧栏预览生成静态快照。绘制继续经过 BC 的动态造型钩子；资源完成后释放临时角色，不持续播放角色动画。

## 旧实现为什么慢

- 缩略图每隔 500 ms 重新绘制，并用 `getImageData` 读回像素计算哈希。即使图片已缓存，也要再等一次轮询才能确认画面相同；这是旧算法的等待门槛，不是真实账号的测速结果。
- 两次画面相同不能证明资源加载结束：慢图片到达前，空白或缺层画面也会保持不变。
- 每次轮询重新装载外观，`CharacterNaked` 的默认刷新加上显式 `CharacterRefresh` 重复构建角色。
- 绘制后立即归还角色池，下一件衣服会改变角色外观。晚到图片按外观匹配角色时，可能无法再找到原预览；侧栏单次绘制后直接结束，也收不到后续补图。

## BC 的实际加载链

`CharacterLoadSimple` 创建并注册轻量角色；`ServerAppearanceLoadFromBundle` 校验和装载外观，不负责刷新。准备完成后调用一次 `CharacterRefresh(C, false, false)`，即可进入姿势、效果和图层构建。[Character.js](https://gitgud.io/BondageProjects/Bondage-College/-/blob/02a7130050fcce7c96fcebf252b39dbbc1b0f1ed/BondageClub/Scripts/Character.js#L1227)、[Server.js](https://gitgud.io/BondageProjects/Bondage-College/-/blob/02a7130050fcce7c96fcebf252b39dbbc1b0f1ed/BondageClub/Scripts/Server.js#L678)

`CharacterLoadCanvas` 同步调用 `CharacterAppearanceBuildCanvas`。名称为 `AfterLoadCanvas` 的角色钩子位于实际构建之前，不能作为图片加载完成通知。`MustDraw` 也只是重绘标记。[Character.js](https://gitgud.io/BondageProjects/Bondage-College/-/blob/02a7130050fcce7c96fcebf252b39dbbc1b0f1ed/BondageClub/Scripts/Character.js#L1526)

BC 有两条独立的图片缓存路径：

| 绘制后端 | 资源入口 | 完成后的处理 |
| --- | --- | --- |
| Canvas 2D | `DrawGetImage` 返回缓存中的 `Image` | 图片加载后调用 `DrawRefreshCharacterForImage`，标记相关角色 `MustDraw` |
| WebGL | `GLDrawLoadImage` 与 `GLDrawImageCache` | 图片加载后更新纹理，再标记相关角色；纹理遮罩也走此入口 |

因此只监听 `DrawGetImage` 会漏掉 WebGL；为了监听而额外调用另一条加载入口，又可能重复请求图片。[Drawing.js](https://gitgud.io/BondageProjects/Bondage-College/-/blob/02a7130050fcce7c96fcebf252b39dbbc1b0f1ed/BondageClub/Scripts/Drawing.js#L137)、[GLDraw.js](https://gitgud.io/BondageProjects/Bondage-College/-/blob/02a7130050fcce7c96fcebf252b39dbbc1b0f1ed/BondageClub/Scripts/GLDraw.js#L628)

## 新实现

`src/utils/RenderApi.js` 为每个任务创建独立渲染会话，直到完成或取消前保留同一个 BC 角色。SDK 钩子只记录该会话实际绘制中用到的图片，不等待其他玩家或界面的资源，也不清理 BC 的公共图片缓存。

首次装载使用 `CharacterNaked(C, false)`、装载外观、一次 `CharacterRefresh(C, false, false)`。后续图片事件合并到下一次 `requestAnimationFrame`，只标记角色重新构建画布。重绘可以发现动态造型带来的新依赖；最终一次绘制确认所有依赖已完成，才发布可缓存的快照。

图片失败沿用 BC 自己的重试机制，不把第一次 `error` 当成加载结束。最终失败或超时会留下可重试错误，不把残缺图记作成功。任务结束时移除图片监听、取消计划帧并调用 `CharacterDelete(C, false)`；共享图片和纹理仍由 BC 管理。

`src/services/RenderService.js` 的 `observe(item, callback, { preview })` 返回取消订阅函数。React 组件只在可见区域及缩略图附近的预加载区域订阅；最后一个订阅退出后，未完成任务立即取消。主预览使用独立槽位并优先启动，不排在所有缩略图之后。

角色外观先进入预览，历史与筛选资料在后台初始化；资料到达后保留等待期间的服装选择与部位设置。离屏时组件清除源画布引用、缩小目标画布缓冲区，重新进入时再恢复；图片仍在加载时可显示已经绘制的部分与加载指示。

默认最多保留 2 个在途缩略图任务和 1 个主预览任务，每帧最多启动 2 个任务。这些数值限制等待网络期间的临时角色数量和同帧启动工作量，不表示多线程绘制；BC 的同步绘制仍运行在主线程。

成功快照按 `JSON.stringify(data)` 和目标尺寸复用，服务持有的完成快照使用 LRU 缓存，默认按 `宽 × 高 × 4` 估算限制为 16 MiB。此预算不包括 BC 公共资源缓存、在途角色以及组件仍显示的画布。外观变化形成新任务，旧任务回调不能覆盖新预览；容器尺寸改变只缩放已经生成的快照，不重新装载服装。

最终错误会释放任务与槽位，不进行无期限自动重试。组件再次进入可见区域并重新订阅时，可以启动新尝试。

动态 `BeforeDraw`、`AfterDraw` 和正常 `DrawCharacter` 流程仍由 BC 执行。保留这些入口，可以让 BC 决定图层、遮罩和动态造型；不在衣柜里另写资源路径解析器。[CommonDraw.js](https://gitgud.io/BondageProjects/Bondage-College/-/blob/02a7130050fcce7c96fcebf252b39dbbc1b0f1ed/BondageClub/Scripts/CommonDraw.js#L320)

## 验证与边界

验证重点是缓存资源能否立即完成、慢图片能否补全、2D/WebGL 依赖是否都被观察、失败重试是否保留、取消后的回调是否隔离，以及临时角色与监听能否释放。仓库测试通过 `npm test` 运行，浏览器流程通过 `npm run test:browser` 运行；最终通过情况以本次运行结果为准。

默认加载器测试使用独立编写的协议模型，不携带 BC 源码。持有本地 BC 源码时，可把 `VPW_BC_SOURCE_DIR` 环境变量指向包含 `Drawing.js`、`GLDraw.js`、`Appearance.js` 的目录（也支持 `bc-` 文件名前缀），再执行 `node --test test/render-api.test.js`，使用原版加载函数运行相同用例。

上述 BC 机制核对自固定提交 `02a7130050fcce7c96fcebf252b39dbbc1b0f1ed`（2026-09-24）。本轮本地测试不代表真实账号、真实网络的延迟测量；资源的首次下载仍取决于 BC 服务和用户网络。代码中的超时、并发数和缓存上限是资源管理参数，不是速度承诺。
