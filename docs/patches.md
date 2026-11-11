# 补丁逐处清单（P1–P7）

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
| P7 | `wechat` | 微信（WechatAgent）↔ 人格记忆互通 | 26 | — | `assets/wechat-hunks.json` |
| P8 | `wechat-pane` | 平台 → 微信设置页 + 表情只发动图 | 22 | `assets/client.wechat.js` → 插件 `lib/` | `assets/wechat-pane-hunks.json` |

合计锚点 **90 处**，另有整文件模块 `meme-bridge.js` / `plugins-route.js` / `douyin-proactive.js`。

每处补丁在运行时按四种判定之一处理：`PATCHED` 打上 / `ALREADY` 跳过 / `UPSTREAM` 上游已原生实现则自动退役 / `DRIFT` 锚点没了停手报错（见 README「用法」）。

## P1 · 借 dsh-meme 的表情库（`--only meme`，22 处 + 1 个新文件）

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
| 13 | `client.js` | 搬到「日常 → 表情包」页了 | 锚点替换 |
| 14 | `client.soul.js` | 表情包页读 meme 状态 | 锚点替换 |
| 15 | `client.soul.js` | 表情包配置看 dsh-meme 设置 | 锚点替换 |
| 16 | `stickers.js` | 没写要什么表情 | 锚点替换 |
| 17 | `gateway.js` | /\\[表情\\s*[:：]/.test(feelText) | 锚点替换 |
| 18 | `gateway.js` | 抖音私信签名加图 | 锚点替换 |
| 19 | `gateway.js` | 抖音私信拼上图片段 | 锚点替换 |
| 20 | `gateway.js` | 抖音私信传会话 ID | 锚点替换 |
| 21 | `gateway.js` | 抖音分支带上图片 | 锚点替换 |
| 22 | `douyin-social.js` | /\\[表情\\s*[:：]/.test(out.text) | 锚点替换 |

涉及文件：`stickers.js` / `gateway.js` / `index.js` / `config-schema.js` / `routes-v07.js` / `client.js` / `client.soul.js` / `douyin-social.js`。

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

## P7 · 微信（WechatAgent）↔ 人格记忆互通（`--only wechat`，26 处）

| # | 锚点名 | 文件 | 改了什么 | 上游接管判定 |
| --- | --- | --- | --- | --- |
| 1 | `W01` | `lib/chat-archive.js` | 聊天存档：通道归一化（wechat:private / wechat:group）+ 外部桥接写入 append / recent 读取 | — |
| 2 | `W02` | `lib/chat-archive.js` | 聊天存档：取样 sample() 也按归一化通道查 | — |
| 3 | `W03` | `lib/db.js` | db：新增 person_wechat_alias 表（微信 id → canonical_id），person 表结构不动 | — |
| 4 | `W04` | `lib/db.js` | db：老库启动时补建微信别名表 + 唯一索引 | — |
| 5 | `W05` | `lib/db.js` | db：微信认人（canonicalOfWechat / findPersonByWechat / setWechatAlias / resolveOrCreateWechatPerson） | — |
| 6 | `W06` | `lib/gateway-util.js` | gateway-util：微信通道判定（wechatKindOf / isWechatChannelId），platformOf 认出 wechat | — |
| 7 | `W07` | `lib/gateway-util.js` | gateway-util：通道种类识别加微信（wechat-private / wechat-group） | — |
| 8 | `W08` | `lib/gateway-util.js` | gateway-util：微信私聊 / 微信群的中文名、群聊判定、群主归一口径 | — |
| 9 | `W09` | `lib/gateway.js` | gateway：微信私聊 / 微信群不并进 QQ 会话（两侧通道各自独立，只共享人格与记忆） | — |
| 10 | `W10` | `lib/index.js` | index.js：引入微信认人 API | — |
| 11 | `W11` | `lib/index.js` | index.js：微信通道取人 / 群 id（兼容 wechat-private: 老写法） | — |
| 12 | `W12` | `lib/index.js` | index.js：插件重启重建会话时按平台认人（微信走别名表，不再当 QQ 号查） | — |
| 13 | `W13` | `lib/index.js` | index.js：入站消息按微信渠道认人（没登记就建 person + 补登记别名） | — |
| 14 | `W14` | `lib/life.js` | life：主动开口的冷却 / 配额把微信算独立平台 | — |
| 15 | `W15` | `lib/routes-soul.js` | 聊天存档接口：新增 /chat-archive/recent 与 /chat-archive/append，白名单放行微信通道 | — |
| 16 | `W16` | `lib/slang.js` | slang：引入微信 / QQ 认人 API | — |
| 17 | `W17` | `lib/slang.js` | slang：私聊跨渠道共桶（同一个人的微信私聊与 QQ 私聊共用黑话 / 表达） | — |
| 18 | `W18` | `lib/slang.js` | slang：读取时按共桶取，取不到再回退原通道键 | — |
| 19 | `W19` | `lib/slang.js` | slang：学到的东西写进共桶 | — |
| 20 | `W20` | `lib/slang.js` | slang：手动合并写进共桶 | — |
| 21 | `W21` | `lib/slang.js` | slang：外部导入写进共桶 | — |
| 22 | `W22` | `lib/soul-memory.js` | soul-memory：记忆卡片 / 联系人清单的通道种类认得出微信（wechat-private / wechat-group，不再记成 qq-private） | — |
| 23 | `W23` | `lib/gateway.js` | 微信出站表情挑选结果落日志（[表情:] 到底挑到没挑到，对着日志能看见） | — |
| 24 | `W24` | `lib/index.js` | 微信回复规则变量（replyIsWechat） | — |
| 25 | `W25` | `lib/index.js` | 微信回复规则整段（分条 / [表情:] 走 dsh-meme 图库 / 防被带跑 / 上网） | — |
| 26 | `W26` | `lib/gateway.js` | 微信出站不再丢段：一轮里多条 assistant/message 按 id 累积（以前是覆盖，只剩最后一条） | — |

<details><summary>锚点原文（marker）</summary>

```text
# W01
export function normalizeArchiveChannel

# W02
const rows = ch !== ''

# W03
-- 微信身份映射（第一阶段）：照 person_qq_alias 的样子单独一张表

# W04
老库靠这里补表

# W05
export function resolveOrCreateWechatPerson

# W06
export function wechatKindOf

# W07
wechatKindOf(channelId) === 'group' ? 'wechat-group' : 'wechat-private'

# W08
if (kind === 'wechat-private') return '微信私聊';

# W09
if (platformOf(chat?.channelId) === 'wechat') return chat;

# W10
resolveOrCreateBiliPerson, resolveOrCreateWechatPerson,

# W11
function wechatIdOfChannel(channelId) {

# W12
const personId = platform === 'wechat' ? wechatIdOfChannel(row.channel_id) : id;

# W13
if (platformOf(m?.channelId) === 'wechat') {

# W14
s.startsWith('wechat-group:')) return 'wechat';

# W15
if(path === '/chat-archive/recent' && method === 'GET') {

# W16
import { getKv, setKv, canonicalOfWechat, findPersonByQq } from './db.js';

# W17
export function slangBucket(db, channelId) {

# W18
const bucket = slangBucket(this.db, channelId);

# W19
setKv(this.db, `slang.${slangBucket(this.db, channelId)}`, { ...d, terms: terms.slice(0, MAX_TERMS)

# W20
setKv(this.db, `slang.${slangBucket(this.db, channelId)}`, d);
		return d;

# W21
setKv(this.db, `slang.${slangBucket(this.db, channelId)}`, d);
		return { terms: addedTerms, expressions: addedExpr, skipped };

# W22
const isWechat = channelId.startsWith('wechat:')

# W23
[FS-WECHAT-STICKER-TRACE]

# W24
const replyIsWechat = replyWhere === 'wechat-private' || replyWhere === 'wechat-group';

# W25
if (replyIsWechat) {

# W26
[FS-WECHAT-SEG-LOST]

```

</details>

## P8 · 平台 → 微信设置页 + 表情只发动图（`--only wechat-pane`，22 处）

另有整文件模块：`assets/client.wechat.js` → 插件 `lib/`（内容变了要同步升脚本里的版本戳，见维护约定）。

| # | 锚点名 | 文件 | 改了什么 | 上游接管判定 |
| --- | --- | --- | --- | --- |
| 1 | `W27` | `lib/config-schema.js` | config-schema：微信配置加表情动图两项（先发动图 / 只发动图） | — |
| 2 | `W28` | `lib/gateway.js` | gateway：新增 wechatStickerPrefs()（读微信表情动图偏好） | — |
| 3 | `W29` | `lib/gateway.js` | gateway：微信出站按描述挑表情时透传动图偏好 | — |
| 4 | `W30` | `lib/gateway.js` | gateway：微信出站按感觉挑表情时也透传动图偏好 | — |
| 5 | `W31` | `lib/stickers.js` | stickers：resolveFeelRefs 收 animatedFirst / animatedStrict | — |
| 6 | `W32` | `lib/stickers.js` | stickers：resolveFeelRefs 把动图偏好传给 pickByFeel | — |
| 7 | `W33` | `lib/stickers.js` | stickers：pickByFeel 收 animatedFirst / animatedStrict | — |
| 8 | `W34` | `lib/stickers.js` | stickers：pickByFeel 动图排前面 + 严格模式挑不到就不发 | — |
| 9 | `W35` | `lib/stickers.js` | stickers：resolveMemeTags 收 animatedFirst / animatedStrict | — |
| 10 | `W36` | `lib/stickers.js` | stickers：resolveMemeTags 按描述挑图时带上动图偏好 | — |
| 11 | `W37` | `lib/stickers.js` | stickers：pickFromMeme 借 dsh-meme 时也先挑 GIF | — |
| 12 | `W38` | `lib/stickers.js` | stickers：挑图结果带 animated 标记 | — |
| 13 | `W39` | `lib/meme-bridge.js` | meme-bridge：入参说明补动图两项 | — |
| 14 | `W40` | `lib/meme-bridge.js` | meme-bridge：加 isGif / usable 判定 | — |
| 15 | `W41` | `lib/meme-bridge.js` | meme-bridge：要动图时多拉候选，GIF 优先、严格模式不回退 | — |
| 16 | `W42` | `lib/meme-bridge.js` | meme-bridge：返回 animated 标记 | — |
| 17 | `W43` | `lib/routes.js` | routes：新增 wechatState()（微信配置回显） | — |
| 18 | `W44` | `lib/routes.js` | /channels/state 回显里加 wechat | — |
| 19 | `W45` | `lib/routes.js` | routes：新增 POST /channels/wechat-config（只存 soul 侧微信设置） | — |
| 20 | `W46` | `lib/client.js` | client：页签短名与子页签加「微信」 | — |
| 21 | `W47` | `lib/client.js` | client：微信子页签也走 channels 轮询 | — |
| 22 | `W48` | `lib/client.js` | client：微信子页签渲染 WechatPane | — |

<details><summary>锚点原文（marker）</summary>

```text
# W27
stickerAnimatedStrict: z.boolean().default(false), // 挑不到动图就不发这张（宁可没有也不发静态）

# W28
/** 微信表情偏好：微信只认 GIF 动图，静态图发过去一定不动（平台 → 微信 → 表情）[FS-WECHAT-PANE] */

# W29
const tagged = await this.stickers?.resolveMemeTags(feelText, row.workspace_path, this.embedder, { model: this.embeddingModel(), ...stickerPrefs })

# W30
const r = await this.stickers?.resolveFeelRefs(feelText, row.workspace_path, this.embedder, { model: this.embeddingModel(), ...stickerPrefs }) ?? { text: feelText, resolved: [] };

# W31
async resolveFeelRefs(text, workspacePath, embedder, { model = '', animatedFirst = false, animatedStrict = false } = {}) {

# W32
const r = await this.pickByFeel(workspacePath, one.feel, embedder, { model, top: 5, animatedFirst, animatedStrict });

# W33
async pickByFeel(workspacePath, feel, embedder, { model = '', avoid = [], top = 5, animatedFirst = false, animatedStrict = false } = {}) {

# W34
const ordered = wantAnim ? [...ranked].sort((a, b) => (isGif(b.file) ? 1 : 0) - (isGif(a.file) ? 1 : 0)) : ranked;

# W35
async resolveMemeTags(text, workspacePath, embedder, { model = '', max = 2, animatedFirst = false, animatedStrict = false } = {}) {

# W36
resolved.push({ desc, file: r.ok ? r.file : null, fromMeme: r.fromMeme === true, animated: r.animated === true, reason: r.ok ? null : (r.reason ?? null) });

# W37
async pickFromMeme(feel, avoid = [], { animatedFirst = false, animatedStrict = false } = {}) {

# W38
animated: r.animated === true,

# W39
* @returns {Promise<{ok: boolean, path?: string, sourcePath?: string, tag?: string, caption?: string, packName?: string, label?: string, animated?: boolean, reason?: string}>}

# W40
const isGif = (p) => extname(String(p ?? '')).toLowerCase() === '.gif';

# W41
? (memes.find((m) => usable(m) && isGif(m.path)) ?? (animatedStrict === true ? undefined : memes.find(usable)))

# W42
animated: isGif(hit.path),

# W43
const list = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);

# W44
wechat: wechatState(),

# W45
const list = (v, fallback) => (v === undefined ? (Array.isArray(fallback) ? fallback : []) : (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean));

# W46
const TAB_KEYS = { memory: "忆", character: "角", daily: "常", channels: "台", models: "模", system: "统", guide: "引", retrieval: "索", persona: "人", life: "自", inspector: "忆", activity: "动", behavior: "习", qq: "Q", bili: "B", douyin: "抖", wechat: "微", version: "版" };

# W47
const fn = subtab === "retrieval" ? loadRetrieval : subtab === "qq" || subtab === "bili" || subtab === "douyin" || subtab === "wechat" ? loadChannels : null;

# W48
: subtab === "wechat" ? h(ChunkTab, { file: "client.wechat.js", pick: (m) => m.WechatPane, failText: "微信页加载失败", data: channels, refresh: loadChannels, notify })

```

</details>

## 设置里「个人插件」页显示几处（探针口径）

设置 → 系统 → 个人插件 那一页读的是 `assets/plugins-route.js` 里内联的 `PATCH_GROUPS`（探针：靠一段「只有打过才出现」的代码判断在不在），**按功能合并**，条数与上面的锚点数不是一一对应。核对时别拿两边的数字硬对。

| 组 | 锚点 / 改动处数（补丁器） | 页面探针条数 | 差异 |
| --- | --- | --- | --- |
| P1 | 23 | 6 | 少 17 条（合并成功能项） |
| P2 | 5 | 4 | 少 1 条（合并成功能项） |
| P3 | 2 | 2 | 一致 |
| P4 | 6 | 5 | 少 1 条（合并成功能项） |
| P5 | 22 | 11 | 少 11 条（合并成功能项） |
| P6 | 9 | 10 | 多 1 条（一处拆成多项） |
| P7 | 26 | 23 | 少 3 条（合并成功能项） |
| P8 | 23 | — | 页面未覆盖该组 |

页面上某一组显示「已打 N / M」，N 是按探针数出来的；锚点数以本文件为准。探针漏了某处时，页面会少报，但补丁器 `--check` 仍然会管到那一处。

## 维护约定

| 场景 | 该改哪里 |
| --- | --- |
| 新增 / 删除一处锚点 | 改 `assets/<组>-hunks.json`，重跑本脚本生成 docs/patches.md，并把 README 清单里的处数同步 |
| 改了某处 `new` 的内容 | 把上一版 `new` 原文写进该条 `upgradeOld`，否则老机器会停在旧文案（判 `ALREADY` 被挡住） |
| 改 `assets/plugins-route.js` | 同步升 `patch-fish-soul.mjs` 里的 `PLUGINS_ROUTE_VER`，否则新逻辑落不了地 |
| 改 `assets/douyin-proactive.js` | 插件真身 `lib/douyin-proactive.js` 要同步，否则重跑补丁会判漂移 |
| 上游已原生实现 | 该条 `upstreamFixed.present` 写上「上游做了长什么样」，运行时自动退役、不再维护 |
