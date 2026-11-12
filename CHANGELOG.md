# 变更说明（补丁仓，非插件本体）

本文件记录本仓库每次打给 `dsh-fish-soul`（已安装那一份）的补丁改动：改了什么、开关在哪、配额怎么算、怎么验证、怎么回滚。
不含上游源码，也不改上游版本号。

---

## 新增 P10：微信主人接管开关 + 静态表情换动图 + 面板状态；services/ 跟随启动脚本入库

**为什么改**：三件事凑一起。

1. **微信发出去的表情包是静止的**。模型挑表情时给的是 `_stickers` 里的静态 PNG/JPG（文件名、`animated` 标记都来自 dsh-meme 图库），而微信只有 GIF 才会自己动——于是「让她发个动态表情」最终发出去一定是一张不动图。挑图策略本身没坏，缺的是**出站前把静态候选换成真 GIF**这一步。
2. **面板上看不出微信这条线到底通没通**。会话是否正确落进「鱼」工作区的「微信·嘉新（主人）」、有没有认出主人 canonical、上次挑图挑到了什么，全要翻日志；也不给关的地方——想让她别接管私聊，只能改配置文件。
3. **平台 → 微信设置页太长太吵**。选项说明每项都是整段话铺在页面上，一眼看不出哪个是关键开关；同页还混着「借 dsh-meme 表情库」这类本该一眼看到开没开的东西。

顺手把**跟随 DSH 启动的那套服务脚本**也收进仓库（`services/`）。之前它们只在本机 `.dsh` 里，重装或换机就丢了，而「DSH 起来才起服务、DSH 关掉 5 分钟内退场」这个行为全靠它们。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `assets/wechat-master-hunks.json`（新增，11 处） | `config-schema.js` 2 处：让 `wechat.masterTakeover`（默认开）与 `interject.masterQuiet` / `masterQuietMinutes` **真的存得住**（以前面板上开了、保存完就回落）；`gateway.js` 3 处：运行配置带上 `masterTakeover`、关掉后**主人私聊整条不进 soul**（不回复、不记记忆，交回 WechatAgent 自己回）、出站时把 `_stickers` 里的静态候选换成真动图；`gateway-media.js` 1 处：新增 `wechatAnimatedSwap()`，拿文件名当「感觉」去 dsh-meme 图库换一张真 GIF（`animatedStrict` 语义，挑不到就不发静态图，池里没 GIF 时按原样退回）；`routes.js` 5 处：`/state` 算出「微信·嘉新（主人）」会话状态（认没认出主人、落没落进「鱼」工作区、最后活跃时间）+ 表情体检（借库开没开、图库里有多少张 GIF、上次挑图结果），并把两项与 `masterTakeover` 一起回给面板、保存时接受该开关 |
| `assets/client.wechat.js`（整文件，20 处锚点） | 平台 → 微信页重排：**每个选项的说明收进 `title`（鼠标悬停才显示）**，页内只留「分组标题 + 开关名 + 当前值」；顶部新增**主人会话状态卡**（生效 / 未生效、落到哪个工作区、最后活跃）与**表情体检条**（借库状态 / GIF 张数 / 上次挑图），并把「借 dsh-meme 的表情库」从 QQ 页挪到本页（关掉即回到原版行为） |
| `assets/wechat-transport-hunks.json` | `gateway` 06 / 08 两处注入 `FS-WECHAT-MASTER-GATE`：开关读取 + 关掉后不进 soul 的判定（运输层与 P10 同一判据，避免两处各判一套） |
| `assets/meme-bridge.js`（整文件） | 同步为插件 `lib/` 最新版：加 `isGif` / `usable` 判定、返回值带 `animated` 标记——动图换图要按这两个字段筛 |
| `assets/wechat-pane-hunks.json` | 删掉 W39 / W41（内容已并进 `client.wechat.js` 整文件，留着只会重复插入） |
| `patch-fish-soul.mjs` | 注册 `patchWechatMaster()`（`--only wechat-master`）；新增 `sameText()` 整文件比对**忽略换行风格**——`wechat-inbound.js` / `channels/wechat.js` 当初是 CRLF 手写的，以前每次 `--check` 都被判「不一致」重写一遍 |
| `audit-upstream.mjs` / `tools/gen-patch-docs.mjs` | 两处 `GROUPS` / `rows` 补 P10（不补就等于这组没人跟上游对表、也不进逐处清单） |
| `services/`（新增，14 个文件） | 跟随 DSH 启动的服务栈整体入库：`app-triggered-boot.ps1/.vbs`（2 分钟去抖入口）、`install-boot-hook.ps1`（幂等修 `dsh-boot-hooks` 注册，DSH 更新会冲掉）、`boot-hooks/`（cordis 插件本体，住 node_modules 外）、`fish-stack-watchdog.ps1/.vbs`（17890 / 3001 / 8791）、`wechat-stack-watchdog.ps1/.vbs`（11229 + 11234 + 定时重打 bridge 接线）、`wechat-bridge-start.ps1/.vbs`、`README.md`（触发链 / 端口表 / 安装 / 验证 / 卸载 / 换机要改的硬编码路径）。**不含任何 token**：`SOCIAL_DSH_TOKEN` 是起服时从 `WechatAgent\data\workspace\state\social-dsh-token.txt` 现读的 |
| `README.md`、`docs/patches.md` | 组表补 P10、`--only` 列表补 `wechat-master`、仓库内容补 `services/` 与 P9/P10 资产；处数 112 → **121 处锚点**（`gen-patch-docs.mjs` 重生成，`--check` 一致） |

**怎么验证**（实跑结果）

```powershell
# 1) 逐处核对：本机这份插件是不是都已经打上了
node patch-fish-soul.mjs --check
# 结果：改了 0 处，已打过 135 处，上游已实现 / 自动退役 3 段，漂移 0 处，失败 0 处
#       （含「lib/client.wechat.js 已是最新，跳过」与 meme-bridge 两处 isGif / animated 判定）

# 2) 文档与 JSON 是否同步
node tools/gen-patch-docs.mjs --check
# 结果：一致（121 处锚点）

# 3) 语法
node --check audit-upstream.mjs   # ok
```

**重启之后怎么看生效**

1. 设置 → 平台 → 微信：顶部状态卡应显示**生效**、写清落在「鱼」工作区的「微信·嘉新（主人）」、带最后活跃时间；「借 dsh-meme 的表情库」显示**已开**、GIF **张数 > 0**。
2. 微信里让她发个动态表情：出站日志应出现换图（`wechatAnimatedSwap`），收到的应是会动的 GIF；若她反复发静态图，先看体检条的「GIF 张数」——为 0 说明图库里真没有动图，得先在 dsh-meme 那边补。
3. 把「主人私聊接管」关掉再发消息：微信仍由 WechatAgent 自己回，**不应**出现希希的第二条回复，也不该往记忆里写。

**回滚**：面板上把「主人私聊接管」关掉即可回到「微信不接管私聊」；要连动图换图一起去掉，`node patch-fish-soul.mjs --only wechat-master --check` 之后按需用打补丁前的自动备份（`~/.dsh/backup/fish-soul-patch-<时间戳>`）恢复 `lib/`。`services/` 与本仓库补丁互不依赖，停用见 `services/README.md` 第五节。

---

---

## 新增 P9：微信运输层入库（入站口 + 出站通道 + 网关挂载）

**为什么改**：0.15.36 的适配只恢复了「修改型」补丁，微信真正收发消息要用的运输层从来没进过仓库——`assets/` 里没有 `wechat-inbound.js`、`channels/wechat.js`，`wechat-hunks.json` 里也搜不到 `onWechatMessage` / `this.wechat` / `11233`。后果是重装或重打补丁之后，微信那侧虽然配置还在（`wechatagent.json` 的 `brain=fish-soul`、`bridge-config.json` 的 `inboundUrl=http://127.0.0.1:11233/...`），但 11233 / 11234 两个端口没人监听，微信消息直接掉回 WechatAgent 的「未分组」会话，希希不接话。这次把三件套补齐并纳入体检。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `assets/wechat-inbound.js`（新增） | 入站口整文件：本机回环 HTTP（默认 `127.0.0.1:11233`）收 WechatAgent 侧 `social-bridge` POST 过来的微信消息，token 鉴权 → 拆事件（私聊 / 群聊 / 自己发的）→ 交给 `gateway.onWechatMessage`，之后完全复用 QQ 那条判定 / 会话 / 记忆链路 |
| `assets/channels.wechat.js`（新增） | 出站通道整文件：`WechatChannel` 实现 `ChatGateway` 要的通道接口（`connected` / `send`），把 OneBot 风格的出站段转成 HTTP 交给 bridge，由 WechatAgent 用它自己那套链路（表情选图、回执、节流）真正发出去 |
| `assets/wechat-transport-hunks.json`（新增，20 处） | `gateway.js` 14 处：构造参数收 `wechat`、`this.wechat`、`wechatConfig()` / `channelFor()` / `isMasterOf()` / `trackMasterActivity()`、Outbox 选通道与 shim、`allSessions` 带上微信会话、`chatTitle` 微信分支、`onWechatMessage` + `wechatToMessage`、`decide` 三处（主人活跃 / 好友白名单 / 记忆标题）、`handleCommand` 两处 + `sendReply` 走 `channelFor`；`index.js` 6 处：引入两模块、`wechatCfg()`、建实例、注入 `ChatGateway`、启动通道与入站服务 + 卸载清理 |
| `patch-fish-soul.mjs` | 注册 `patchWechatTransport()`（`--only wechat-transport`），整文件走「已存在但与资产不一致就先备份再覆盖」的幂等写法 |
| `audit-upstream.mjs` | `rows` 加 P9：20 处锚点走 `auditHunks`，两个新文件走 `auditNewFile`（这两个文件**有意不加 `FS-` 标记**，否则产物与现装字节不一致；marker 用文件自带文案「微信入站口（本机回环）」「微信通道适配器（本机回环）」） |
| `tools/gen-patch-docs.mjs` | `GROUPS` 加 P9，`whole` 支持数组（一组挂两个新文件） |
| `README.md`、`AGENTS.md`、`docs/patches.md` | 组表补 P9、`--only` 列表补 `wechat-transport`、处数 92 → 112 锚点 / 4 → 6 个整文件；AGENTS 的体检基线改成「117 - P6 已接管 9 = 仍需 108」 |

**怎么验证**（实跑结果，不是估的）

```powershell
# 1) 上游裸包（npm 解包，gateway 1514 行 / index 1229 行 / 无 wechat 文件）从零打
node patch-fish-soul.mjs --root <裸包>
# 结果：改了 126 处，漂移 0，失败 0，冒烟 import 通过

# 2) 打完再 check 一次（幂等）
node patch-fish-soul.mjs --root <裸包> --check
# 结果：改了 0 处，已打过 126 处，漂移 0，失败 0

# 3) 与现装插件逐文件对比（确认仓库产物 = 线上一份）
# gateway.js / index.js：sha256 全一致
# wechat-inbound.js / channels/wechat.js：内容逐字节一致，仅换行不同（现装那两个文件是当初手工写的 CRLF，
# 仓库按 .gitattributes 的 eol=lf 以 LF 入库；Node 加载无差异）

# 4) 体检
node audit-upstream.mjs --brief
# 结果：仍需 108 / 可退役 9 / 漂移 0
```

**重启之后要确认的**：重启 DSH 后 `11233`（入站）与 `11234`（出站回执）两个端口在监听，微信侧发一条消息应落在「微信·嘉新（主人）」会话里、由希希接话；若仍掉回「未分组」，先看 `bridge-config.json` 的 `fishSoul.inboundUrl` 与 `wechatagent.json` 的 `wechat.brain` 是否被重装冲掉。

**回滚**：删掉 `lib/wechat-inbound.js`、`lib/channels/wechat.js`，再 `node patch-fish-soul.mjs --only wechat-transport --check` 确认无残留锚点；或直接用打补丁前自动备份的整份 `lib/`（`~/.dsh/backup/fish-soul-patch-<时间戳>`）覆盖回去。

---

## 适配上游 0.15.36：五处锚点重指、P6 整组退役、P8 补进体检（0.15.33 → 0.15.36）

**为什么改**：上游 0.15.36 动了五处——① 抖音私信自己会发卡片了（`sendReply` 里 `sendDouyin(row, text, images, convId)` 原生带图带会话 ID）；② 人格卡告警、③ 统一日志、④ 分平台限额（`platformOf` 从两档改三档，把 `douyin` 单列）；⑤ 抖音原生卡片分享（life.js 的 `share.intent.` 一套）。其中 ①⑤ 直接把我们两段补丁吸收掉了，④ 把 P7 的一处锚点整行改写，P8 还有 13 处锚点本来就是「前序补丁写进去的代码」，体检脚本一直把它们当漂移误报。这次一次性把锚点按 0.15.36 重指、把上游接管的拆掉，并让体检脚本能认出「链上前序」与「整文件新增」。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `assets/dm-hunks.json` · P5（22 处） | `gw-dm-session-methods / send / reply / silent` 四处锚点按 0.15.36 的 `sendReply` 重写（`convId` 在 1580 行、`forceDouyin` 1586、`row` 1587）；**删掉自建的 `sendDouyinDm`**，改走上游原生 `sendDouyin(row, text, images, convId)`；投递结果记到 `st.douyinSent`；新增 `gw-dm-session-quiet`（只发表情的那一轮静默处理） |
| `assets/share-hunks.json` · P6（9 处） | 上游已在 life.js 用 `share.intent.` + `douyinShareTarget` 自己做「刷到视频 → 抖音原生卡片私信」→ **整组退役**：9 处都写上 `upstreamFixed.present` + `upstreamFixedIn: lib/life.js`，`patch-fish-soul.mjs` 运行时直接跳过，不再维护、也不跟版本 |
| `assets/wechat-hunks.json` · P7（26 处） | `W14` 锚点改成 0.15.36 的三档 `platformOf` 单行（保留 `douyin` 分支）再插 `wechat` 分支，配额按平台分开算；`W23` 补 `dependsOn: W25/W26`（它的锚点本来就是那两处写进去的微信出站段，不该单独判漂移） |
| `assets/wechat-pane-hunks.json` · P8（22 处） | 13 处补 `dependsOn`：`W29` 挂 `W25`（微信出站段）、`W32–W38` 挂 `meme-bridge`（锚点在 P1 改造过的 `stickers.js` 里）、`W39–W42` 挂 `meme-bridge`（整个 `meme-bridge.js` 由 P1 新增）、`W46` 挂前序页签（`TAB_KEYS` 里 qq / bili / douyin 是补丁加的） |
| `patch-fish-soul.mjs` | 三段「上游已实现」运行时退役：QQ 页那块 dsh-meme 开关、抖音私信带图 / 带会话 ID 5 处、P6 整组；抖音私信改走上游 `sendDouyin`，`sendDouyinDm` 引用清零 |
| `assets/plugins-route.js` | `PATCH_GROUPS` 补上 **P8 组（22 项）**——之前设置页只显示 P1–P7，P8 的补丁在页面上看不见；`P6` 整组标 `upstream`（显示「上游已接管」而不是「没打」）；`P5` 补 `triggerDouyinProactive`；`P1` 开关项加 `absent` 判定；`P2 / P3 / P5` 多项判定串改成实装代码原样 |
| `audit-upstream.mjs` | 补上 P8（`wechat-pane-hunks.json`）——之前只跑 P1–P7，P8 的 22 处从来没跟上游对过表；文件级判定加一条：上游没有 `lib/meme-bridge.js` 这类「补丁新增的整文件」且该条有 `dependsOn` 时，判「跟着前序补丁走」，不再算漂移 |
| `docs/patches.md`、`README.md` | 重生成（92 处锚点 + P1 的 22 处内联 + 4 个整文件模块），标题补 P8，README 里 P5 21→22、P7 22→26、总数 86→92 一并校正 |
| `reports/upstream-compatibility.md` | 对 0.15.36 重生成：**86 处仍需、9 处可退役、漂移 0** |

**怎么验证**（都是实跑过的，不是估的）

```powershell
# 1) 干净 0.15.36 副本上从零打（不是 --check，链式补丁才会生效）
npm pack dsh-fish-soul@0.15.36 --pack-destination .	emp
node patch-fish-soul.mjs --root .	emp36-clean
# 期望：改了 104 处 / 已打过 0 处 / 上游已实现·自动退役 3 段 / 漂移 0 / 失败 0

# 2) 对上游体检（含 P8）
node audit-upstream.mjs --version 0.15.36
# 期望：P1–P8 全部漂移 0；P6 显示「整组可退役」，其余「继续用」

# 3) 设置页探针（打到 0.15.36 副本上跑）
# 期望：total 84 done 73 retired 11 todo 0；P7 23/23、P8 22/22
node tools/gen-patch-docs.mjs --check
# 期望：✓ docs/patches.md 与 JSON 一致（92 处锚点）
```

**没动的地方（省得后来人重复排查）**：P1 那 5 处「排在 P5 前面、用到后面才打进去的函数」的旧疑点，这次在 0.15.36 干净副本上实打是漂移 0、失败 0 —— 那是体检脚本静态看锚点的误报，不是顺序问题，所以没去调顺序；P2 与本次升级无关，一处没动。

**怎么回滚**：`git revert` 这一次提交即可（只动 `assets/*-hunks.json`、`patch-fish-soul.mjs`、`assets/plugins-route.js`、`audit-upstream.mjs`、文档与报告，不碰上游源码）。回滚后本机已打的补丁不用管——`node patch-fish-soul.mjs --check` 会按旧锚点报漂移，按报错那几处手动回退或重装 0.15.33 再打。

---

## 平台 → 微信设置页：说清哪些设置要 WechatAgent 侧配、哪些这边配就生效 + 微信表情只发动图（W27–W48）

**为什么改**：主人反馈两件事。① 设置里没有「微信」这一处能管的地方：微信侧的开关、地址、群聊、掉线重连全在 WechatAgent 那边，而人格 / 记忆 / 黑话 / 主动开口却在这边，实际用时根本分不清「我刚改的这个到底生效没有」，改了半天不生效也不知道该去哪儿改。② 希希发的表情包在 DSH 里是动的，一进微信就变成静态图：微信只认 GIF 动图，上游挑表情是「按感觉 / 按描述」挑第一张能用的，挑到 PNG / JPG 就只能当静态图发出去，看起来像「表情坏了」。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `assets/client.wechat.js` · 新文件 | 设置 → 平台 → 「微信」子页。页内把设置分成两组：**这边改就生效**（人格卡 / 别名认人、记忆与存档读写、黑话共桶、主动开口冷却与配额、表情动图两项）；**必须去 WechatAgent 侧改**（微信收发通道、登录态与重连、群聊开关、出站转发地址与端口、图片文件上行、朋友圈等微信独有能力），并注明 soul 侧不保存那部分配置 |
| `assets/wechat-pane-hunks.json` · W27–W48（22 处） | `config-schema.js` 加 `stickerAnimatedFirst`（默认 **开**）/ `stickerAnimatedStrict`（默认 **关**）；`gateway.js` 加 `wechatStickerPrefs()` 并在两条挑表情的出站路径上透传；`stickers.js` 的 `resolveFeelRefs` / `pickByFeel` / `resolveMemeTags` / `pickFromMeme` 收 `animatedFirst` / `animatedStrict`，动图排前面、严格模式挑不到就不发；`meme-bridge.js` 加 `isGif` / `usable`，要动图时多拉候选、GIF 优先、严格模式不回退，返回 `animated` 标记；`routes.js` 加 `wechatState()` + `POST /channels/wechat-config`，`/channels/state` 回显里带 `wechat`；`client.js` 页签短名 / 子页签 / 轮询 / 渲染接上微信页 |
| `tools/gen-patch-docs.mjs` | GROUPS 加 P8（`wechat-pane`），`docs/patches.md` 重新生成（90 处锚点） |

**怎么验证**

```powershell
node patch-fish-soul.mjs --only wechat-pane   # 期望：改了 23 处（含新文件）、失败 0；再跑一次应「已打过 23 处、改了 0 处」
node patch-fish-soul.mjs --check             # 期望：全部已打过、漂移 0、失败 0
```

重启 DSH 后：设置 → 平台 下出现「微信」，两组清单可对照着改；打开「先挑动图」后，微信里收到的表情应当是动的（`fish-soul-debug.log` 里挑图结果带 `animated: true`）。想彻底不发静态图，把「挑不到动图就不发」也打开。

**回滚**：从 `~/.dsh/backup/fish-soul-patch-<时间戳>/` 还原 6 个 `lib/*.js`，删掉 `lib/client.wechat.js`，重跑 `--check`。

---

## 微信「说的比收到的多」：一轮多条助手消息以前被覆盖，只剩最后一条（W26）

**为什么改**：主人在微信上反馈「DSH 里明明有好几条，微信实际收到的少了几条」。查会话记录（`sessions/.../session.v4.jsonl.zstd`）发现 DSH 一轮里 `assistant/message` 会出现不止一条（模型分步输出、续写重试），而上游 `ChatGateway.onSessionEvent` 收的是覆盖赋值 `st.text = text` —— 后一条一进来，前一条已经说出口的正文直接被顶掉。`turn/end` 只拿得到最后一条，于是 `sendReply` 只发了最后一句：微信 / QQ 端看起来就是「少了几条」，DSH 会话里却一条不少。

实测（本机 12 轮微信对话）：第 1、4、8、10、11 轮各有 2 条助手消息，「在呢在呢」「对呀」「你爹啊」「你是肥鱼啊」「我啊 / 我是希希啊」全部没发出去。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `assets/wechat-hunks.json` · 新增 W26 | `lib/gateway.js` 的 `assistant/message` 分支：改为按 `message.id` 累积到 `st.said`，再按顺序用空行拼成 `st.text`；`interrupted` 时连 `said` 一起清空（保持「被打断的这一轮不发」的原语义）；图片同样累积并限 10 张 |
| `docs/patches.md` | 由 `tools/gen-patch-docs.mjs` 重新生成（68 处锚点） |

**怎么验证**

```powershell
node patch-fish-soul.mjs --only wechat   # 期望：✓ 本处 + 已打过 25 处 + 失败 0
```

重启 DSH 后，微信里同一轮出现多条回复时应该一条不落；`fish-soul-debug.log` 里同一次 `turn/end` 下会出现 `seg=0 / seg=1 / seg=2…` 多行 `sent`（以前恒定只有 `seg=0`）。顺带 `turn/end` 的 `textLen` 会等于该轮所有助手消息拼接后的长度。

**回滚**：把 W26 从 `wechat-hunks.json` 删掉，从 `~/.dsh/backup/fish-soul-patch-<时间戳>/` 还原 `lib/gateway.js`（或重装插件），重跑 `--check`。

---

## 表情包设置页：借库开关从 QQ 页搬过来 + 修「永远显示关」的老 bug

**为什么改**：P1 的「借 dsh-meme 的表情库」开关原先挂在 QQ 设置页，可表情包本身的设置（B 站小表情、收藏、导入的图）都在「日常 → 表情包」页，开关落在 QQ 页既难找、也割裂。更实际的问题是那段读的是 `qq.stickers?.meme`——多套了一层 `qq`，真正落盘的是顶层 `stickers.meme`，于是取值恒为 `undefined`，界面永远显示关闭：用户以为没开，其实配置里可能早就开着。此外开着开关时，应当让人知道「表情包怎么挑」这套东西以 dsh-meme 那边为准。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `patch-fish-soul.mjs` · P1 第 13 处 | QQ 设置页那段 Row 整段替换为一行指路注释（`搬到「日常 → 表情包」页了`），不再渲染开关 |
| `patch-fish-soul.mjs` · 新增第 14 处 | `client.soul.js` 的 `StickerShelf` 里加 `const memeOn = cfg.meme === true;`——改读顶层 `stickers.meme`，上面那个「永远是关」的 bug 随之一并修掉 |
| `patch-fish-soul.mjs` · 新增第 15 处 | 表情包页 `Group({ title: "表情包" })` 内加借库开关 Row；`memeOn` 为真时多一行「表情包配置看 dsh-meme 设置」，关着时不出现，视觉与原版一致 |
| `assets/plugins-route.js` | P1 探针同步：原 `client.js` 条的判定串换成新的指路注释，另加 `client.soul.js` 一条 |
| `docs/patches.md` | P1 清单 13 处 → 15 处，补上 `client.soul.js` 两处与开关新位置 |

**怎么验证**

```powershell
node patch-fish-soul.mjs --check --root <本机插件>   # 期望：已打过 89、漂移 0、失败 0
```

重启 DSH 后看「日常 → 表情包」：应出现「借 dsh-meme 的表情库」；开启后下方多一行「表情包配置看 dsh-meme 设置」；QQ 设置页不再有这个开关。此前已实装的「`[表情: 描述]` 出站转真图」（`resolveMemeTags`）不受本次搬移影响，继续生效。

**回滚**：去掉新增的第 14、15 两处锚点替换，把第 13 处恢复成原 Row 串（脚本内保留原文），`client.soul.js` 从备份还原后重跑 `--check`。

---

## 补丁被「整包重装」冲掉之后：加一道启动前体检

**为什么改**：2026-11-11 凌晨把 0.15.32 换成 0.15.33 时，只把 profile `package.json` 里的版本号改成 `0.15.33`、直接把干净源码铺进 `node_modules`，**没有让 pnpm 重算 `pnpm-lock.yaml`**。之后重开 DSH，启动阶段的依赖安装发现「声明的 0.15.33」与「lock 里的 0.15.32」不一致，就把整个 `dsh-fish-soul` 按 registry tarball 重装了一遍 —— 80 处补丁被整包覆盖，`--check` 从「已打 80」掉到「已打 0」，界面不报错，只是功能静默消失。

排查时先排除了两个常见误判：`@chendaleiq/dsh-plugin-auto-update` 的 `packages` 白名单里**没有** `dsh-fish-soul`，它的 6 小时周期不会碰这个包；`profile` 的 `package.json` 也没有再被写入 BOM。真正的触发点是**三处版本不一致**（profile 声明 / pnpm-lock 锁定 / 装好的包里 `package.json`）。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `tools/verify-install.mjs` · 新增 | 一键体检：比对三处版本是否完全一致，并调用 `patch-fish-soul.mjs --check` 汇总补丁在位情况；不一致时直接给出「先统一版本 → 再重跑 patch」的两步处方。`--json` 供脚本消费，退出码 0 健康 / 1 有风险 / 2 体检失败 |
| `package.json` · scripts | 新增 `npm run verify` |
| `AGENTS.md` §2 | 「固定三步」扩为「固定四步」，加 ④ 体检命令与判读说明（本机文档，已在 `.gitignore`） |
| `AGENTS.md` §6 | 新增硬规则：手改版本号却不同步 lock，重开 DSH 必被整包重装；升版本必须走正常安装，装完再打补丁（本机文档，已在 `.gitignore`） |

**怎么验证**

```powershell
node tools/verify-install.mjs            # 期望：三行 ✓、结论「健康」、退出码 0
node tools/verify-install.mjs --json     # 机器可读
node patch-fish-soul.mjs --check --root <本机插件>   # 改 0 / 已打 80 / 漂移 0 / 失败 0
```

**回滚**：本次只新增体检脚本与文档，不改任何补丁锚点；回滚只需删掉 `tools/verify-install.mjs` 与对应文档段落。

---

## P7 微信互通进补丁仓 · 顺带修掉「CRLF 文件永远打不上」

**为什么改**：微信（WechatAgent）↔ 人格记忆互通这一整套改动原先只在**本机真身里**手改过，补丁仓里一处都没有 —— 重装、换机、上游发版都会**整块功能静默消失**（微信侧还会退化成把微信 id 当 QQ 号查人）。这一轮把它收成 P7 组 21 处锚点，并顺手揪出两处会让「全新安装打不上」的底层坑。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `assets/wechat-hunks.json` · 新增（22 处） | P7 组锚点：`chat-archive`（通道归一化 + `sample()` 同口径）3 处 / `db`（`person_wechat_alias` 表、老库补建、认人四函数）3 处 / `gateway-util`（微信通道判定、平台识别、中文名与群口径）3 处 / `gateway`（微信不并进 QQ 会话）1 处 / `index`（引入认人 API、取人取群、重启重建会话、入站认人）4 处 / `life`（主动开口配额算独立平台）1 处 / `routes-soul`（`/chat-archive/recent` 与 `/chat-archive/append`，白名单放行微信）1 处 / `slang`（认人 API、共桶选择、读取回退、两处写入）5 处 / `soul-memory`（通道种类识别认得出微信）1 处 |
| `patch-fish-soul.mjs` · `patchHunks()` | **换行自适应**：目标文件是 CRLF 时（`lib/slang.js` 这类被 Windows 编辑器动过换行的），模板里的 `\n` 直接 `includes` 永远不中 —— 全新安装会被判「锚点过期」直接停手，已打过也认不出来。现在按目标文件自己的换行风格把 `old` / `new` / `marker` / `upgradeOld` 现算一遍再比，判定与写入用同一份口径 |
| `patch-fish-soul.mjs` · 新增 `patchWechat()` | 注册 P7 组（`--only wechat` 可单跑），对着 `assets/wechat-hunks.json` 逐处替换，三条硬边界写进注释：不动 `person` 表结构、不让微信会话并入 QQ、不主动发消息 |
| `assets/plugins-route.js` | `PATCH_GROUPS` 增 P7 组（23 条探针，覆盖 9 个真身文件的微信改造），版本戳 `FS-PLUGINS-ROUTE v4` → `v5`；「设置 → 系统 → 个人插件」页会显示 P7 每组打了几处 |
| `tools/gen-patch-docs.mjs` · `GROUPS` | 登记 P7，标题与合计从「P1–P6 / 42 处」改为「P1–P7 / 63 处」 |

**marker 共用这个坑再补一刀**：`slang` 那两处「手动合并 / 外部导入」写的是同一行共桶语句，`keyAddedLine` 取出来的新增行一模一样 —— 兄弟那条打完，另一条会被判「已打过」**漏改一整块**。解决办法是让两条的 `marker` 各自带上**后面紧邻的那行差异**（`return d;` vs `return { terms: … }`），既能区分归属，又是单文件内唯一。

**怎么验证**

```powershell
node patch-fish-soul.mjs --check --root <本机插件>   # 改 0 / 已打 22 / 漂移 0 / 失败 0
node patch-fish-soul.mjs --root <0.15.32 干净源码>   # 全新安装 22 处，装完与本机逐字节一致（忽略换行）
node patch-fish-soul.mjs --check --root <同上>       # 幂等：改 0 / 已打 22
node tools/gen-patch-docs.mjs --check                # docs/patches.md 与 JSON 一致（64 处锚点）
```

**回滚**：`git -C <插件目录> checkout lib/`（本机是 `~/.dsh/profiles/desktop/node_modules/dsh-fish-soul`），或把 `~/.dsh/backup/fish-soul-patch-*` 里最近一次的备份覆盖回去；只撤 P7 就按 `docs/patches.md` 里 P7 那 8 个文件逐处反向替换。

---

## 锚点跟上 0.15.32 · 补丁仓重装也不漏打（新增 `sayViaSession` 两处）

**为什么改**：上游 0.15.32 把几段代码重写了排版，补丁仓里 3 处锚点对不上（`gw-dm-session-reply` / `share-social-import` / `share-social-method`）——**本机已经打过所以看不出来，一旦重装或换机就装不上**。顺带查出一个更隐蔽的问题：同一个文件里几条补丁**共用同一个 marker** 时，「兄弟那条打过了」会被当成「我这条也打过了」，全新安装会**悄悄漏打一整块功能**（`forceDouyin` 那轮、`douyinSilent` 标记就漏过）。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `assets/dm-hunks.json` · `gw-dm-session-reply` | `old` 换成 0.15.32 干净源码的现状（上游还在，只是换了排版）；`new` 补回开头 `const bound` / `if (bound === undefined)` 两行——旧 `new` 不含这两行，直接替换会把守卫删掉 |
| `assets/share-hunks.json` · `share-social-import` / `share-social-method` | 加 `dependsOn`：这两段的锚点是**前序补丁写进去的**（上游本来没有），不该拿去和上游源码比对 |
| `audit-upstream.mjs` | 判定链加一支：有 `dependsOn` 的直接判 `NEEDED`（锚点由前面的补丁写入，不参与漂移判定） |
| `patch-fish-soul.mjs` | 新增 `markerOwners`：统计同一文件里「这段文字被几条补丁的 old/new 用到」，只有**独占**才算打过；共用或被兄弟补丁蹭到的，改用这条补丁最长的一句新增内容（`keyAddedLine`）复核，对不上就继续打 |
| `assets/dm-hunks.json` · 新增 `dm-session-social-field` / `dm-session-wire` | 补上 `sayViaSession` 链路（`douyin-social.js` 存下来 + `index.js` 接到 `gateway.triggerDouyinProactive`）。这两处本机早就有、补丁仓里却**没有**，重装后「主动私信那句话由会话来说」会静默退回插件自己发 |
| `dm-http-social` | 构造参数顺手带上 `sayViaSession`（和 `http` 同一条补丁一次改完，避免两条补丁抢同一行锚点） |
| `docs/patches.md` / `README.md` / `reports/upstream-compatibility.md` | 由 `tools/gen-patch-docs.mjs` 重新生成，处数 40 → 42（dm 组 19 → 21） |

**怎么验证**

```powershell
node audit-upstream.mjs --brief --explain            # 0 可退役 / 45 仍需 / 0 漂移
node patch-fish-soul.mjs --check --root <本机插件>    # 改 0 / 已打 58 / 漂移 0 / 失败 0
node patch-fish-soul.mjs --root <0.15.32 干净源码>    # 全新安装 58 处，装完与本机逐字节一致
node patch-fish-soul.mjs --check --root <同上>        # 幂等：改 0 / 已打 58
```

---

## 工具与文档 · 判完兼容要能说人话（`audit --explain` + `AGENTS.md` §8）

**为什么改**：只看「漂移 3 处」等于没说——用户要知道的是**上游到底动了什么**才导致补丁不兼容。原来 `--explain` 不存在，Agent 只能自己啃 `-hunks.json` 和上游源码，或者干巴巴回一句「3 处锚点失配」，等于把问题又丢回去。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `audit-upstream.mjs --explain`（新增） | 把每个漂移锚点逐行对齐到上游文件，按命中比例翻译成人话（≥85% 只是前后被塞了新东西 / ≥50% 改了几行 / >0 基本重写 / 0 整段找不到），并成对列出 `-` 补丁原写法 / `+` 上游现状；配 `--brief` 时直接输出成人能读的几行 |
| 对齐细节 | 差异片段**从首个不同字符处开窗**（否则两行前 100 字符常常一样，看不出改了什么）；命中率 <60% 时不列逐行对比（滑窗会落错位置），改为提示搜函数名；两行毫无共同词时标「已对不上，多半整体挪位」 |
| `--from` 口径 | `--from` 比的是本机已装那份，不是上游源码，解释里明确加注「这是本机停在旧模板，补 `upgradeOld` 即可」，避免被误读成上游改版 |
| `AGENTS.md` §2 / §3 / §8 | 三步命令改为 `--brief --explain`；回报口径从三样变四样（多一段通俗解释）；§8 给出「上游改了什么」的三句写法（动了哪 → 原来/现在 → 所以怎么办）、禁用黑话、附真实口吻示例 |
| `README.md` | 上游体检命令表补 `--explain` 一行 |
| `--json` | `patches[]` 显式投影 `group/id/title/status/detail`，不再把 `file`/`old` 原文塞进 JSON（体积翻倍且 Agent 用不上） |

**怎么验证**

```powershell
node audit-upstream.mjs --brief --explain                     # 例：gw-dm-session-reply → 上游改动了这段里的几行（第 1395 行附近，6 行还剩 4 行）
node audit-upstream.mjs --explain --from <本机插件目录>        # 带「本机停在旧模板」注解
node audit-upstream.mjs --explain --out reports/upstream-compatibility.md   # 报告里多一节「上游改了什么（通俗版）」
node --check audit-upstream.mjs
```

---

## 工具与文档 · 上游更新时判兼容（`AGENTS.md` + `audit --brief`）

**为什么改**：上游一更新，需要一眼判出「哪些补丁还有用、哪些锚点过期、本机这份要不要动」。原来只能读脚本源码 + 40 行报告，判断成本高、结论口径还容易混。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `AGENTS.md`（新增） | 给 Agent 的作业单：触发语 → 固定三步命令 → 决策矩阵 → 六组判定来源 → DRIFT 修复 SOP → 硬规则与已知盲点 → 输出模板 |
| `audit-upstream.mjs --brief`（新增） | 只打「一句话结论 + 要处理的 id」，判兼容首选；有漂移时退出码 2 |
| `audit-upstream.mjs` 判定顺序 | 把「补丁已在位（`new` / `upgradeOld`）」提到 `upstreamFixed` 之前，避免 `--from` 已打补丁目录时被自身标记骗成「上游已实现」→ 整组假退役 |
| `README.md` | 上游体检节补 `--brief` 命令与 `AGENTS.md` 入口，仓库内容清单加一行 |

**怎么验证**

```powershell
node audit-upstream.mjs --brief                       # npm 那份：一句话结论
node audit-upstream.mjs --brief --from <本机插件目录> # 本机那份：能看出「补丁在位但模板旧」
node patch-fish-soul.mjs --check --root <本机插件目录> # 只读，末尾「结果：…」
```

三份结论口径不同是设计如此：判退役看 npm 干净源码，判本机在位看 `--check`，判「本机模板是否落后」看 `--from`。

---

## P6 · 刷到的视频改发「视频卡片」（新增，`assets/share-hunks.json` 9 处）

**为什么改**：原来「刷到有意思的就发给你」只是把 `https://...` 链接加一句感受甩到 QQ / 抖音会话里；
抖音自己有一套原生分享面板，能把视频做成**卡片**发出去，观感和在抖音里直接转发一致。

**改了什么**

| 位置 | 改动 |
| --- | --- |
| `life.js` `queueShare` | 除链接外多收 `videoId`；抖音目标时把这条视频的信息（id/标题/文案/作者/感受）序列化进 `reason`（`FS-SHARE-CARD`） |
| `life.js` `deliverOne` | 刷到的分享**先发卡片**（调 `douyinShareCard`），卡片不通才退回原来的「发链接」文案 |
| `life.js` `parseShareCard` | 新函数，认 `reason` 里存的卡片信息，并顺手拼出退回用链接文案 |
| `index.js` | 注入 `douyinShareCard: (card) => douyinSocial.dmShareBrowsed(card)` |
| `douyin-social.js` | 引入 `shareBrowsedVideo`，新增 `dmShareBrowsed(card)` 方法 |
| `douyin-browse.js` | 刷视频时把这条视频的 `id` 一起交上去（原来只交标题/作者/链接） |

**两条路径分工（用户明确要求）**

| 触发 | 发什么 | 挑视频方式 | 配额 |
| --- | --- | --- | --- |
| 刷视频时「刷到有意思的就发给你」 | **刚刷到的那一条**卡片 | 不按类型搜，也不去池子里另挑（`FS-SHARE-ONLY-BROWSED`） | 主动开口的分享上限：`proactive.shareMaxPerDay`，默认 **2 条/天**，计数存 `share.day` |
| 主动私信时顺手分享 | 一条别人的视频卡片 | 从设置里**你选的那几类**随机挑**一个**类型去搜（`FS-DM-SHARE-ONE-TYPE`），只搜这一类；挑不到就不发，不回落「不限」 | 主动私信自己的配额：`dm.perDay`（**同一个人**一天最多几次）/ `dm.coolHours`（同一个人隔几小时）/ `dm.minGapHours`（两条最短间隔），计数存 `douyin.dm.day` 的 `byName` |

两套配额互不占用：主动私信路径不调用 `queueShare`、不写 `share.day`；刷到分享也不占 dm 的按人次数。

**共同护栏**：都不发她自己发的作品（`FS-DM-SHARE-OTHERS`，三重剔除：作品 id / 视频作者 `sec_uid` = 本人 / 去重）。
刷到那条若是她自己的作品会跳过；读不到她的作品池时**照发**并记一条 warn 日志，不因拉不到池子把功能卡死。

**涉及的设置项**（设置 → 平台 → 抖音 / 主动开口）

- 主动私信：开关「她主动找这些人聊」、要发给谁（互关名单点选）、「默认分享哪类视频」、每人可单独选类型、自己写类型（`类型名=关键词`）
- 刷到分享：主动开口里的「分享视频」开关 + 每天最多几条

**验证**

```bash
node patch-fish-soul.mjs --check        # 应报 P6 已打 9 处、漂移 0
node patch-fish-soul.mjs --only share   # 重跑应 0 改动（幂等）+ 冒烟 import 通过
```

设置 → 系统 → 个人插件 → 「P6 刷到的视频发卡片」可逐处核对状态（已打 / 上游已接管 / 没打）。

---

## P5 · 主动性私信（`assets/dm-hunks.json` 19 处）

- `FS-DM-SESSION`：那一句改由「抖音·某某」会话说出去（`gateway.triggerDouyinProactive` / `sendDouyinDm`，`forceDouyin`），这样 DSH 的抖音对话里能看到这一轮，不再由插件自己点页面发送。
- `FS-DM-SHARE-OTHERS`：分享的视频只从「别人的视频」池取（按类型搜 > 收藏夹 `listcollection` > 推荐流），三重剔除自己作品。
- `FS-DM-SHARE-ONE-TYPE`：选了类型就随机挑**一个**去搜，挑不到这次不发（不回落「不限」）。
- `FS-DM-SHARE-MATCH`：挑之前用 `aweme/detail` 补文案 / 时长 / 点赞，按类型词命中再挑。
- `FS-DM-persona-soul`：补的那句话按她自己的性格写（递人格卡全文 + 锚点 + 最近发过的话），要求换角度、别复用说法。
- `FS-DM-ERR-CALM` / 群聊分组 / 视频类型词表 14 类等其余锚点见 `assets/dm-hunks.json`。

---

## P4 · 设置里列出「个人插件」（`assets/plugins-hunks.json` 5 处 + `assets/plugins-route.js`）

**为什么改**：补丁打在 `node_modules` 里，升级 / 重链会丢，装上之后没有任何地方能看到「现在到底哪几处还在、哪几处被上游接管了」。
所以在设置里加一页只读清单：**设置 → 系统 → 个人插件**，逐组（P1–P6）列出每处状态：已打 / 上游已接管 / 没打 / 文件不在。

| 锚点 | 文件 | 改了什么 |
| --- | --- | --- |
| `client-system-plugins-tab` | `lib/client.js` | 系统设置侧栏多一个「个人插件」子页 |
| `client-installed-plugins-pane` | `lib/client.js` | 清单组件：按组聚合、逐处显示判定结果 |
| `client-plugins-pane-route` | `lib/client.js` | 面板分发里把该子页接到清单组件 |
| `routes-import-plugins` / `routes-mount-plugins` | `lib/routes.js` | 引入并挂上 `/plugins/*` 路由 |

外加新文件 `assets/plugins-route.js` → 插件 `lib/routes-plugins.js`，提供 `GET /plugins/installed`：**纯只读**，不装不卸、不联网、不写任何文件，只把补丁器 `--json` 的结果读出来。
改这个文件必须同步升脚本里的 `PLUGINS_ROUTE_VER`（现 `FS-PLUGINS-ROUTE v4`），否则老文件会被「已存在」挡住。

> 术语：「个人插件」= 本仓库打给 `dsh-fish-soul` 的补丁，**不是** DSH 宿主里安装的那些插件；这一页只列补丁。

**验证**：`node patch-fish-soul.mjs --check` 报 P4 共 5 处已打；打开 设置 → 系统 → 个人插件 能看到 P1–P6 六组与逐处状态。

---

## P3 · 热更新后人格卡 + 记忆块掉线（`assets/index-hunks.json` 2 处）

**现象**：插件重载（升级、装别的插件触发 pnpm 重链、宿主重开插件实例）会把旧 ctx 上挂的人格段释放掉，而会话本体还活着 —— `gateway.ensureSession` 看见 live 就直接 `return`，不再走 setup，于是人格卡和「此刻状态 / Top5 记忆」永久消失，动态页每条都变成「记忆没进这轮」。

| 锚点 | 改了什么 |
| --- | --- |
| `index-remount-our-session` | `noteInteraction` 里每条消息补挂一次（`gateway.isOurSession(agentId)` 判定，只对自家会话生效） |
| `index-remount-map` | `sectionsMounted` 从 `Set` 改 `Map`：记的是 ctx 本身而不是 id，宿主换了 ctx 才重挂、同一 ctx 不重复注册 |

无开关（纯行为修正）。**验证**：`--check` 报 P3 两处已打；重载插件后打开动态页，人格卡与记忆块还在。

---

## P2 · douyin-social —— 回评论发不出 / 图文无 BGM（`assets/douyin-hunks.json` 5 处）

| 文件 | 锚点 | 改了什么 |
| --- | --- | --- |
| `douyin-social.js` | `douyin-comment-visible` | 评论区状态按可见性判定（折叠态不再误判为已打开） |
| `douyin-social.js` | `douyin-note-tab` | 作品详情页只走 note/video 直链 + 点右侧「评论(n)」Tab |
| `douyin-social.js` | `douyin-reply-visible` | 回复只在可见评论条目里找并用真实鼠标点击 |
| `douyin-social.js` | `douyin-music-trace` | BGM 挑歌先滤掉非歌曲条目（0.15.32：配乐不确认就不发布，不再硬兜底） |
| `douyin-social.js` | `douyin-social-header` | douyin-social.js 文件头加补丁标记 |

- 无开关，纯行为修正。
- 0.15.32 起 BGM 挑歌挪到新的 `chooseMusic`：只滤掉非歌曲条目，**配乐不确认就不发布**，不再硬兜底凑一条。
- 文件头那处只写一行 `FS-` 标记，用来让 `--check` 与 `audit-upstream.mjs` 一眼认出这是打过补丁的副本。
- **验证**：`--check` 报 P2 五处已打；`lib/douyin-social.js` 首部能看到标记行。

---

## P1 · 借 dsh-meme 的表情库（整文件 `assets/meme-bridge.js` + 脚本内联 13 处）

**改了什么**：新增 `lib/meme-bridge.js`，通过 `ctx.get('dshMeme')` 接上 dsh-meme 的**只读**取图服务（只读不写，不碰对方的数据）；文件已存在且内容一致时跳过（幂等）。这一组**没有 `*-hunks.json`**，另外 13 处接线直接写在 `patch-fish-soul.mjs` 的 `patchMeme()` 里（`stickers.js` 5 处 / `index.js` 4 处 / `gateway.js`、`config-schema.js`、`routes-v07.js`、`client.js` 各 1 处），逐处清单见 [`docs/patches.md`](docs/patches.md#p1--借-dsh-meme-的表情库--only-meme13-处--1-个新文件)。

- **开关**：设置 → 表情包 → 「用 dsh-meme 的表情库」。
- **上游状态**：🟡 仍需（上游未接入 dsh-meme）。
- **验证 / 回滚**：`--check` 报 P1 已落地；不想用就关开关，或删掉 `lib/meme-bridge.js` 后重跑补丁。

---

## 回滚

1. 单组回滚：把 `lib/` 下对应文件从 `C:\Users\Administrator\.dsh\backup\fish-soul-patch-<时间戳>\` 拷回。
2. 关功能而不用回滚代码：设置 → 平台 → 抖音 里关掉「她主动找这些人聊」/ 主动开口里关掉「分享视频」。
3. 插件自动更新后补丁会丢，重跑 `node patch-fish-soul.mjs` 即可（按锚点重新打，不会回退上游版本）。

---

## 提交索引

| 提交 | 内容 |
| --- | --- |
| `f958514` | 两条路径分工：刷到发刚刷那条（不按类型搜）；主动私信才按选的类型挑一个搜 |
| `c5f8225` | 刷到的分享改发视频卡片；个人插件页新增 P6 组；README 补说明 |
| `e9058a2` | 分享不发自她自己的作品（别人的视频池 + 三重剔除） |
| `da2327b` | 主动私信改走「抖音·某某」会话，DSH 里才看得到 |
| `83bd79f` | 补的那句话不再瞎编视频内容（递真实作品信息） |
| `0b3aa0d` | 分享面板判定 / 详情页重试 / 好友行直点分享 |
| `a20b4c9` / `0b657a4` | P4：系统设置列出已装插件（只读清单）；明确「个人插件」= 本插件补丁 |
| `02cb07c` | P3：热更新后人格卡 + 记忆块不再掉线（锚点化） |
| `0dadd6c` | P2：评论区状态按可见性判定，折叠态不再误报已展开 |
| `8b15209` / `05f4fca` | P2：BGM 改抓推荐列表；0.15.32 适配到 `chooseMusic`（不确认不发布） |
| `4a1d899` | P1：归档 0.15.31 的 `meme-bridge` 补丁与抖音修复，附兼容体检 |
