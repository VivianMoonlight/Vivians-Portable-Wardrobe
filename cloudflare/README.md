# VPW Cloudflare 同步服务

这个目录是独立的 Cloudflare Pages + D1 服务。Pages 提供数据查看和备份页面；Pages Function 提供带修订号的衣柜 API；D1 只保存每把密钥当前的一份衣柜，不保存历史快照。插件只有在用户选择 Cloudflare 同步时才使用它。

服务不使用 BC 角色编号或电子邮箱来验证身份。插件生成 32 字节随机恢复密钥，格式为 `vpw1_` 加 43 位 base64url；API 只在 `Authorization: Bearer <密钥>` 中接收它。D1 只保存密钥的 SHA-256 摘要。密钥丢失后无法找回；持有密钥的人可以读取和修改对应衣柜。网页仅在当前页面内存里保留密钥，刷新即清除。数据存入 D1 时并未做端到端加密。

在插件中导入另一把恢复密钥，是让该设备改用另一份云衣柜；这**不会撤销旧密钥或删除旧 D1 记录**。当前 API 没有撤销或删除密钥对应衣柜的操作。若旧密钥已泄露，单纯换密钥不能阻止持有者继续访问旧衣柜。迁移前请导出备份，并让所有需要同步的设备使用同一把密钥。

其他设备若继续使用 BC 衣柜同步，BC 副本可能在 Cloudflare 启用后继续变化，与 D1 衣柜分叉。客户端清理 `ExtensionSettings.VPWardrobe` 和设备标记前，必须将新鲜 BC 登录快照与已知基线比较；有变化或无法核对时暂停清理并交由用户审阅。BC 不提供逐次写入回执或条件写入，快照比较也不能阻止之后的旧设备再次写入；所有设备应切换或停用 BC 衣柜同步。

## API

- `GET /api/wardrobe`：返回 `{ revision, index, updatedAt }`。新密钥对应 `{ revision: 0, index: null, updatedAt: null }`；因此空数据也可能表示输入了另一把有效格式的密钥。
- `PUT /api/wardrobe`：发送 `{ expectedRevision, index }`，其中 `index` 为 schema 3 的云端投影。成功返回 `{ revision, updatedAt }`；修订号不一致返回 HTTP 409 和 `{ error: "conflict", revision, index, updatedAt }`。客户端必须核对并让用户处理不能自动合并的冲突，不能无条件重试覆盖。
- 衣柜 JSON 最大 1,800,000 字节。超过时返回 HTTP 413 `{ error: "too-large", maxIndexBytes }`；不要将它误报为 BC 的 180 kB 限额。Cloudflare D1 的单行/字符串上限目前为 2 MB。
- 免费版部署设有保护上限：整个实例最多 100 把密钥，每个 Cloudflare 识别的 IP 每个 UTC 日最多创建 2 把密钥，每把密钥每个 UTC 日最多写入 500 次。超出时返回 HTTP 429 `{ error: "capacity-reached" }` 或 `{ error: "write-limit" }`。这些上限可控制数据量和写入量，但不能替代 Cloudflare 的流量防护。

同一个密钥只有一条活动记录。写入通过 D1 原子 `INSERT OR IGNORE` 或带 `WHERE revision = ?` 的 `UPDATE` 完成；两个设备以相同版本同时提交时只有一个成功。网络断开后，客户端应重新 GET 并比较，而不是假定写入失败或成功。

## 首次部署（需要 Cloudflare 登录）

先在这个目录运行本地测试：

```sh
node --test test/*.test.js
```

确认准备部署时，在 Cloudflare 免费账户登录 Wrangler，创建 D1，并把返回的数据库 ID 填入本地 `wrangler.toml`。不要提交真实配置、恢复密钥或 Cloudflare 登录信息：

```sh
npx wrangler login
npx wrangler d1 create vpw-cloud-sync
cp wrangler.toml.example wrangler.toml
# 将 wrangler.toml 中的 REPLACE_WITH_D1_DATABASE_ID 换成创建结果
npx wrangler d1 execute vpw-cloud-sync --remote --file=schema.sql
npx wrangler pages project create vpw-cloud-sync --production-branch wardrobe-react
npx wrangler pages secret put VPW_PROVISIONING_SECRET --project-name=vpw-cloud-sync
npx wrangler pages deploy public --project-name=vpw-cloud-sync --branch wardrobe-react
```

输入 `VPW_PROVISIONING_SECRET` 时使用独立生成的至少 32 字符随机值，例如先运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`，再粘贴到 Wrangler 的密钥提示中。它只保存在 Cloudflare 服务端，用来以 HMAC 摘要记录每日创建者 IP；插件不用发送这个值。没有此密钥或 Cloudflare 提供的客户端 IP 时，新衣柜创建会关闭，但已有衣柜可继续读写。

上面的命令需在 `cloudflare/` 目录运行；Pages 的 `functions/` 会与静态网页一起部署。当前生产服务位于 [vpw-cloud-sync.pages.dev](https://vpw-cloud-sync.pages.dev/)，项目根目录的 `.env.production` 已设置 `VITE_CLOUDFLARE_SYNC_URL`，因此 `npm run package:react` 会连接这个地址。自建部署需修改该值或在打包环境中覆盖它。地址会写进插件构建产物，插件设置里没有地址输入框。若项目名已被占用，请同时修改 Pages 项目名和本地 Wrangler 的 `name`。单把恢复密钥只在当前浏览器页面的内存中使用，不在 Pages 网页的 localStorage 中保存。

Cloudflare 免费方案目前对 D1 的单库容量为 500 MB、账户总存储为 5 GB，另有限制每日行读写次数。这个实现每把密钥只占一行，但单份衣柜仍受 1.8 MB 的主动限制；100 把密钥的理论 JSON 上限约为 180 MB。公开端点仍可能遭到读取请求洪泛或分布式创建滥用。CORS 不能阻止脚本和命令行请求，公开部署时还应关注 Cloudflare 指标并在可用时配置 [速率限制规则](https://developers.cloudflare.com/waf/rate-limiting-rules/)。完整限制以 [D1 官方文档](https://developers.cloudflare.com/d1/platform/limits/) 和 [定价页](https://developers.cloudflare.com/d1/platform/pricing/) 为准。
