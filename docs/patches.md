# 补丁逐处清单（P1–P6）

> **本文件由 `tools/gen-patch-docs.mjs` 根据 `assets/*-hunks.json` 生成，请勿手改。**
> 锚点增删后跑 `node tools/gen-patch-docs.mjs` 重生成；`--check` 可校验是否与 JSON 一致。
> 组级说明、开关位置、配额算法、验证与回滚见 [README.md](../README.md) 与 [CHANGELOG.md](../CHANGELOG.md)，本文件只回答「每一处到底改了什么」。

## 组与 `--only` 对照

| 组 | `--only` 名 | 用途 | 锚点处数 | 整文件模块 | 数据文件 |
| --- | --- | --- | --- | --- | --- |
| P1 | `meme` | 借 dsh-meme 的表情库 | — | `assets/meme-bridge.js` → 插件 `lib/` | — |
| P2 | `douyin` | douyin-social —— 回评论发不出 / 图文无 BGM | 5 | — | `assets/douyin-hunks.json` |
| P3 | `remount` | index —— 热更新后人格卡 + 记忆块掉线 | 2 | — | `assets/index-hunks.json` |
| P4 | `plugins` | 设置 → 系统 → 已装插件 | 5 | `assets/plugins-route.js` → 插件 `lib/` | `assets/plugins-hunks.json` |
| P5 | `dm` | 抖音 —— 主动给互关好友发私信 | 21 | `assets/douyin-proactive.js` → 插件 `lib/` | `assets/dm-hunks.json` |
| P6 | `share` | 刷到有意思的就发给你 → 视频卡片 | 9 | — | `assets/share-hunks.json` |

合计锚点 **42 处**，另有整文件模块 `meme-bridge.js` / `plugins-route.js` / `douyin-proactive.js`。

每处补丁在运行时按四种判定之一处理：`PATCHED` 打上 / `ALREADY` 跳过 / `UPSTREAM` 上游已原生实现则自动退役 / `DRIFT` 锚点没了停手报错（见 README「用法」）。

## P1 · 借 dsh-meme 的表情库（`--only meme`，13 处 + 1 个新文件）

这一组的改动**不放在 `*-hunks.json` 里**，直接写在 `patch-fish-soul.mjs` 的 `patchMeme()` 内（`replaceOnce` / `replaceFunction`），下面按脚本源码逐处列出。

| # | 目标文件 | 改了什么 | 类型 |
| --- | --- | --- | --- |
| 0 | `lib/meme-bridge.js` | 新增只读取图桥（内容来自 `assets/meme-bridge.js`，已存在且一致则跳过） | 新文件 |
| 1 | `stickers.js` | 加 imageRef 帮助函数 | 锚点替换 |
| 2 | `stickers.js` | stickerConfig 加 meme 开关 | 锚点替换 |
| 3 | `stickers.js` | StickerBox 构造参数加 meme | 锚点替换 |
| 4 | `stickers.js` | 整函数替换 `async resolveFeelRefs(` | 整函数替换 |
| 5 | `stickers.js` | 整函数替换 `async pickByFeel(` | 整函数替换 |
| 6 | `gateway.js` | 挑表情日志改成友好名字 | 锚点替换 |
| 7 | `index.js` | import { createMemeBridge } | 锚点替换 |
| 8 | `index.js` | 造 meme 桥 | 锚点替换 |
| 9 | `index.js` | 把 meme 桥交给 StickerBox | 锚点替换 |
| 10 | `index.js` | 提示词里加借库说明 | 锚点替换 |
| 11 | `config-schema.js` | config-schema 加 meme | 锚点替换 |
| 12 | `routes-v07.js` | /stickers/config 收 meme | 锚点替换 |
| 13 | `client.js` | 借 dsh-meme 的表情库 | 锚点替换 |

涉及文件：`stickers.js` / `gateway.js` / `index.js` / `config-schema.js` / `routes-v07.js` / `client.js`。

| 项 | 说明 |
| --- | --- |
| 开关 | 设置 → 表情包 → 「用 dsh-meme 的表情库」（默认关） |
| 上游状态 | 🟡 仍需（上游未接入 dsh-meme）；上游 lib 下任意 js 出现 `dshMeme` 就在运行时自动退役 |
| 标记 | 每处改动行尾带 `FS-MEME-BRIDGE-PATCH`，`--check` 与体检靠它认 |
| 关闭方式 | 关掉开关即可；彻底回滚就删 `lib/meme-bridge.js` 并把 `lib/` 从备份拷回 |

## P2 · douyin-social —— 回评论发不出 / 图文无 BGM（`--only douyin`，5 处）

| # | 锚点名 | 文件 | 改了什么 | 上游接管判定 |
| --- | --- | --- | --- | --- |
| 1 | `douyin-comment-visible` | `lib/douyin-social.js` | 评论区状态按可见性判定（折叠态不再误判为已打开） | `itemsVisible` |
| 2 | `douyin-note-tab` | `lib/douyin-social.js` | 作品详情页只走 note/video 直链 + 点右侧「评论(n)」Tab | — |
| 3 | `douyin-reply-visible` | `lib/douyin-social.js` | 回复只在可见评论条目里找并用真实鼠标点击 | `const pool = shown.length ? shown : all;` |
| 4 | `douyin-music-trace` | `lib/douyin-social.js` | BGM 挑歌先滤掉非歌曲条目（0.15.32：配乐不确认就不发布，不再硬兜底） | `douyin.music.last` |
| 5 | `douyin-social-header` | `lib/douyin-social.js` | douyin-social.js 文件头加补丁标记 | `__never_by_upstream_social_header__` |

<details><summary>锚点原文（marker）</summary>

```text
# douyin-comment-visible
const boxes = [...document.querySelectorAll

# douyin-note-tab
评论[（(]?

# douyin-reply-visible
const shown = all.filter(vis);

# douyin-music-trace
创作的原声

# douyin-social-header
FS-DOUYIN-SOCIAL-PATCH

```

</details>

## P3 · index —— 热更新后人格卡 + 记忆块掉线（`--only remount`，2 处）

| # | 锚点名 | 文件 | 改了什么 | 上游接管判定 |
| --- | --- | --- | --- | --- |
| 1 | `index-remount-our-session` | `lib/index.js` | 自家会话每条消息补挂人格段（热更新后人格卡 + 记忆块不再掉线） | `gateway?.isOurSession(agentId) === true) mountSectionsFor` |
| 2 | `index-remount-map` | `lib/index.js` | sectionsMounted 从 Set 改 Map（换 ctx 才重挂，同一 ctx 不重复注册） | `sectionsMounted.get(id) === agent.ctx` |

<details><summary>锚点原文（marker）</summary>

```text
# index-remount-our-session
if (gateway?.isOurSession(agentId) === true) mountSectionsFor(payload?.agent);

# index-remount-map
const sectionsMounted = new Map();

```

</details>

## P4 · 设置 → 系统 → 已装插件（`--only plugins`，5 处）

另有整文件模块：`assets/plugins-route.js` → 插件 `lib/`（内容变了要同步升脚本里的版本戳，见维护约定）。

| # | 锚点名 | 文件 | 改了什么 | 上游接管判定 |
| --- | --- | --- | --- | --- |
| 1 | `client-system-plugins-tab` | `lib/client.js` | 系统设置多一个「个人插件」子页 | `["plugins", "个人插件"]` |
| 2 | `client-installed-plugins-pane` | `lib/client.js` | 个人插件（dsh-fish-soul 补丁）清单 | `function InstalledPlugins()` |
| 3 | `client-plugins-pane-route` | `lib/client.js` | 面板分发里把「个人插件」子页接到清单组件 | `subtab === "plugins" ? h(Boundary, { name: "已装插件" }` |
| 4 | `routes-import-plugins` | `lib/routes.js` | routes.js 引入 plugins 路由 | `handlePluginsRoute` |
| 5 | `routes-mount-plugins` | `lib/routes.js` | 路由分派里挂上 /plugins/* | `handlePluginsRoute({ method, path, req, send, sameOrigin })` |

<details><summary>锚点原文（marker）</summary>

```text
# client-system-plugins-tab
["plugins", "已装插件"]

# client-installed-plugins-pane
function InstalledPlugins()

# client-plugins-pane-route
subtab === "plugins" ? h(Boundary, { name: "已装插件" }

# routes-import-plugins
import { handlePluginsRoute } from './routes-plugins.js';

# routes-mount-plugins
handlePluginsRoute({ method, path, req, send, sameOrigin })

```

</details>

## P5 · 抖音 —— 主动给互关好友发私信（`--only dm`，21 处）

另有整文件模块：`assets/douyin-proactive.js` → 插件 `lib/`（内容变了要同步升脚本里的版本戳，见维护约定）。

| # | 锚点名 | 文件 | 改了什么 | 上游接管判定 |
| --- | --- | --- | --- | --- |
| 1 | `dm-social-import` | `douyin-social.js` | import 主动私信模块 | — |
| 2 | `dm-social-methods` | `douyin-social.js` | 加 maybeDm / dmNow / dmCandidates，status 带 dm | — |
| 3 | `dm-index-tick` | `index.js` | 自走层 tick 里问一次要不要主动发 | — |
| 4 | `dm-persona-soul` | `index.js` | 抖音主动私信：把人格卡全文递给 DouyinSocial | — |
| 5 | `dm-schema` | `config-platforms.js` | config-platforms.js：配置 schema 加 dm（同一个人一天几次 / 同一个人隔几小时 / 选中的名单） | — |
| 6 | `dm-state` | `routes-douyin.js` | 设置页状态回显 dm（含候选名单与已选人） | — |
| 7 | `dm-save` | `routes-douyin.js` | 保存设置带 dm（含 targets 校验） | — |
| 8 | `dm-now-route` | `routes-douyin.js` | 新路由 /douyin/dm-candidates 与 /douyin/dm-now | — |
| 9 | `dm-form` | `client.douyin.js` | 表单初值加 dmPerDay/dmCoolHours | — |
| 10 | `dm-vars` | `client.douyin.js` | 取出 dm 状态 + 勾选名单的本地状态 | — |
| 11 | `dm-saveui` | `client.douyin.js` | 保存时带上 dm（含 targets） | — |
| 12 | `dm-ui` | `client.douyin.js` | 设置页加「主动私信」分组（拉名单 / 点选人 / 一天几次 / 隔几小时） | — |
| 13 | `dm-http-client` | `lib/douyin-http.js` | 纯 HTTP 客户端补 selfProfile / collection / userPosts（分享视频按类型挑作品要用） | `__never_by_upstream_dm_http_client__` |
| 14 | `dm-http-social` | `lib/douyin-social.js` | DouyinSocial 接纯 HTTP 客户端（分享视频按类型挑作品） | `__never_by_upstream_dm_http_social__` |
| 15 | `dm-http-index` | `lib/index.js` | 实例化 DouyinSocial 时传入 douyinHttp | `__never_by_upstream_dm_http_index__` |
| 16 | `gw-dm-session-methods` | `lib/gateway.js` | gateway：加 triggerDouyinProactive / sendDouyinDm（主动私信走会话） | — |
| 17 | `gw-dm-session-reply` | `lib/gateway.js` | sendReply：主动私信那一轮允许回抖音（forceDouyin） | — |
| 18 | `gw-dm-session-silent` | `lib/gateway.js` | sendReply：她这轮不说话时回置 douyinSilent | — |
| 19 | `gw-dm-session-send` | `lib/gateway.js` | sendReply：抖音单独一条、只发文字（sendDouyinDm） | — |
| 20 | `dm-session-social-field` | `lib/douyin-social.js` | DouyinSocial 记住 sayViaSession（没接上就退回插件自己发） | — |
| 21 | `dm-session-wire` | `lib/index.js` | index.js 把 gateway.triggerDouyinProactive 接到 DouyinSocial.sayViaSession | — |

<details><summary>锚点原文（marker）</summary>

```text
# dm-social-import
FS-DM-import

# dm-social-methods
FS-DM-methods

# dm-index-tick
FS-DM-tick

# dm-persona-soul
FS-DM-persona

# dm-schema
FS-DM-schema

# dm-state
FS-DM-state

# dm-save
FS-DM-save

# dm-now-route
FS-DM-now

# dm-form
FS-DM-form

# dm-vars
FS-DM-var

# dm-saveui
FS-DM-saveui

# dm-ui
FS-DM-ui

# dm-http-client
async userPosts(secUid

# dm-http-social
this.http = http ?? null

# dm-http-index
分享视频时按类型挑作品：走纯 HTTP 拿她自己的作品列表

# gw-dm-session-methods
[FS-DM-SESSION]

# gw-dm-session-reply
[FS-DM-SESSION]

# gw-dm-session-silent
douyinOutbound

# gw-dm-session-send
[FS-DM-SESSION]

# dm-session-social-field
this.sayViaSession = typeof sayViaSession

# dm-session-wire
sayViaSession: (name, hint) =>

```

</details>

## P6 · 刷到有意思的就发给你 → 视频卡片（`--only share`，9 处）

| # | 锚点名 | 文件 | 改了什么 | 上游接管判定 |
| --- | --- | --- | --- | --- |
| 1 | `share-social-import` | `lib/douyin-social.js` | douyin-social.js：引入 shareBrowsedVideo（刷到的视频也发卡片） | — |
| 2 | `share-social-method` | `lib/douyin-social.js` | douyin-social.js：加 dmShareBrowsed（把刷到的视频用卡片发给主人） | — |
| 3 | `share-index-target` | `lib/index.js` | index.js：抖音刷到的分享改发抖音私信卡片（douyinShareTarget + douyinShareCard） | — |
| 4 | `share-life-dep` | `lib/life.js` | life.js：LifeEngine 接 douyinShareCard（发视频卡片） | — |
| 5 | `share-life-queuesig` | `lib/life.js` | life.js：queueShare 收下 videoId（刷到的那条视频） | — |
| 6 | `share-life-reason` | `lib/life.js` | life.js：抖音刷到的分享存成卡片信息（不再存「链接 + 感受」那句） | — |
| 7 | `share-life-parse` | `lib/life.js` | life.js：加 parseShareCard（认 reason 里存的卡片信息，顺手拼出退回用的链接文案） | — |
| 8 | `share-life-deliver` | `lib/life.js` | life.js：deliverOne 先发视频卡片，卡片不通才退回发链接（QQ） | — |
| 9 | `share-browse-videoid` | `lib/douyin-browse.js` | douyin-browse.js：把刷到的那条视频的 id 一起交上去（发卡片要用） | — |

<details><summary>锚点原文（marker）</summary>

```text
# share-social-import
[FS-SHARE-CARD] 引入 shareBrowsedVideo

# share-social-method
dmShareBrowsed(opts)

# share-index-target
[FS-SHARE-CARD] 刷到的分享改发抖音私信卡片

# share-life-dep
this.douyinShareCard =

# share-life-queuesig
queueShare({ platform, title, author, url, impression, videoId })

# share-life-reason
SHARE_CARD_TAG]${JSON.stringify

# share-life-parse
function parseShareCard(

# share-life-deliver
[FS-SHARE-CARD] 刷到的分享先发视频卡片

# share-browse-videoid
afterRound(this, '抖音', watched, (w) => ({ title: w.title, author: w.author, videoId: w.id }))

```

</details>

## 设置里「个人插件」页显示几处（探针口径）

设置 → 系统 → 个人插件 那一页读的是 `assets/plugins-route.js` 里内联的 `PATCH_GROUPS`（探针：靠一段「只有打过才出现」的代码判断在不在），**按功能合并**，条数与上面的锚点数不是一一对应。核对时别拿两边的数字硬对。

| 组 | 锚点 / 改动处数（补丁器） | 页面探针条数 | 差异 |
| --- | --- | --- | --- |
| P1 | 14 | 5 | 少 9 条（合并成功能项） |
| P2 | 5 | 4 | 少 1 条（合并成功能项） |
| P3 | 2 | 2 | 一致 |
| P4 | 6 | 5 | 少 1 条（合并成功能项） |
| P5 | 22 | 11 | 少 11 条（合并成功能项） |
| P6 | 9 | 10 | 多 1 条（一处拆成多项） |

页面上某一组显示「已打 N / M」，N 是按探针数出来的；锚点数以本文件为准。探针漏了某处时，页面会少报，但补丁器 `--check` 仍然会管到那一处。

## 维护约定

| 场景 | 该改哪里 |
| --- | --- |
| 新增 / 删除一处锚点 | 改 `assets/<组>-hunks.json`，重跑本脚本生成 docs/patches.md，并把 README 清单里的处数同步 |
| 改了某处 `new` 的内容 | 把上一版 `new` 原文写进该条 `upgradeOld`，否则老机器会停在旧文案（判 `ALREADY` 被挡住） |
| 改 `assets/plugins-route.js` | 同步升 `patch-fish-soul.mjs` 里的 `PLUGINS_ROUTE_VER`，否则新逻辑落不了地 |
| 改 `assets/douyin-proactive.js` | 插件真身 `lib/douyin-proactive.js` 要同步，否则重跑补丁会判漂移 |
| 上游已原生实现 | 该条 `upstreamFixed.present` 写上「上游做了长什么样」，运行时自动退役、不再维护 |
