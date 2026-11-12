# dsh-fish-soul-patch

> **这是 DSH 插件 [`dsh-fish-soul`](https://github.com/Britneycode/dsh-fish-soul) 的补丁仓库，不是插件本体。**
> 本仓库**不包含上游任何源码**（没有 `lib/`、没有 `test/`、没有上游的构建与发布配置），只放补丁脚本、补丁数据和上游兼容性体检结果。
> 用之前请先按[上游 README](https://github.com/Britneycode/dsh-fish-soul#readme) 安装插件本体，再回来跑这里的脚本。

上游插件本身是完整的：人格、按人记忆、生活节奏、QQ / B站 / 抖音三端。这个仓库只负责「上游还没做、但我们需要」的几处改动（含系统设置里那份**个人插件**清单），用脚本打到你机器上**已安装的那一份**插件里。

> **注意区分**：设置页里说的「个人插件」指的是**这个仓库打给 dsh-fish-soul 的补丁**（P1–P10 逐处），不是 DSH 宿主里安装的那些插件；这一页只列补丁，不列宿主插件。

## 设计原则

| 原则 | 说明 |
| --- | --- |
| 不跟版本号 | 按代码锚点打，打的是你当前安装的那一版；上游小改不会整体冲突，也不会把插件回退成旧版本 |
| 幂等 | 每处补丁带 probe，重复跑只补没打过的，不会在同一锚点上叠第二遍 |
| 会退役 | 每个补丁声明了「上游做完了长什么样」，上游原生实现后自动跳过且不再维护 |
| 不硬来 | 锚点没了、上游也没做（改版挪了代码）时停手报错，交给 `audit-upstream.mjs` 更新锚点，不靠 `--force` 硬改 |
| 改前备份 | 每次改文件先备份到 `~/.dsh/backup/fish-soul-patch-<时间戳>/`，与原目录结构一致 |

补丁会丢：`node_modules` 下的第三方插件被 pnpm 整体重写，升级或重装后就没了——重装完再跑一遍脚本即可。

维护须知（改模板的时候）：

- 改了某个 hunk 的 `new`，要把它**上一版的 `new` 原文**写进该条的 `upgradeOld`。脚本遇到「旧版已打」时会按 `upgradeOld → new` 整段换掉（报 `↑ 旧版已打 → 升到新版`），否则老机器会被「已经打过」挡住、永远停在旧文案上。
- 改了 `assets/plugins-route.js` 的内容，要同步改脚本里的 `PLUGINS_ROUTE_VER`（现在是 `FS-PLUGINS-ROUTE v4`，文件头也带同一个戳）。老版本的 `lib/routes-plugins.js` 会被自动顶掉（先备份），不然新逻辑永远落不了地。
- **锚点有增删，文档要跟着走**：改完 `assets/*-hunks.json` 先跑 `node tools/gen-patch-docs.mjs` 重生成逐处清单，再同步本文件补丁清单里的处数（`--check` 会报不一致）。文档和 JSON 对不上时以 JSON 为准。

## 补丁清单

逐处清单见 [`docs/patches.md`](docs/patches.md)（P1–P10 全部 **121 处锚点 + P1 的 22 处内联改动 + 6 个整文件模块**，逐条写清改哪个文件、改了什么、上游接管怎么判）；本表只到组这一层。清单由 `node tools/gen-patch-docs.mjs` 从代码生成，不手写。

| 组 | `--only` | 补丁 | 锚点名 | 改了上游哪里 | 上游状态 |
| --- | --- | --- | --- | --- | --- |
| P1 | `meme` | 借 dsh-meme 的表情库 | 14 处（脚本内联 `patchMeme()`，不走 JSON）+ 新文件 `meme-bridge` | 接上 dsh-meme 的只读取图服务（`ctx.get('dshMeme')`）：新增 `lib/meme-bridge.js`，并在 `stickers.js` / `gateway.js` / `index.js` / `config-schema.js` / `routes-v07.js` / `client.js` 上改 13 处接线（含表情包设置里的开关、提示词里的借库说明），逐处见 `docs/patches.md` | 🟡 仍需（上游未接入 dsh-meme） |
| P2 | `douyin` | 评论区状态按可见性判定 | `douyin-comment-visible` | 折叠态不再被误判成「评论已打开」 | 🟡 仍需 |
| P2 |  | 详情页只走直链 + 点右侧「评论(n)」 | `douyin-note-tab` | 作品详情页只走 note / video 直链，再点右侧 Tab 进评论 | 🟡 仍需 |
| P2 |  | 回复只在可见评论条目里找 | `douyin-reply-visible` | 用真实鼠标点击可见条目，不再对隐藏节点下手 | 🟡 仍需 |
| P2 |  | BGM 抓取留痕 + 挑歌兜底 | `douyin-music-trace` | 抓不到 BGM 时留痕，挑歌时滤掉非歌曲条目 | 🟡 仍需 |
| P2 |  | douyin-social.js 文件头加补丁标记 | `douyin-social-header` | 文件头写一行 `FS-` 补丁标记，重跑补丁与 `--check` / `audit-upstream.mjs` 体检时能一眼认出「这份是打过补丁的副本」，也用于判「上游接管后本地还剩什么」 | 🟡 仍需 |
| P3 | `remount` | 热更新后人格卡 + 记忆块掉线 | `index-remount-our-session` | `noteInteraction` 里每条消息补挂一次人格段（会话还活着、`ensureSession` 见 live 直接 return 时不再永久掉线） | 🟡 仍需 |
| P3 |  | `sectionsMounted` 从 Set 改 Map | `index-remount-map` | 记的是 ctx 本身而不是 id，宿主换了 ctx 才重挂、同一 ctx 不重复注册 | 🟡 仍需 |
| P4 | `plugins` | 设置里列出个人插件 | `client-system-plugins-tab` / `client-installed-plugins-pane` / `client-plugins-pane-route` / `routes-import-plugins` / `routes-mount-plugins`（5 处） | 系统设置加「个人插件」页：逐处核对本仓库的补丁（P1–P10 每组几处打了几处、每处是已打 / 上游已接管 / 没打 / 文件不在）。新增 `lib/routes-plugins.js` + `GET /plugins/installed`，纯只读，不装不卸、不联网 | 🟡 仍需（上游无此页） |
| P5 | `dm` | 主动给抖音互关的人发私信 | `dm-*` 22 处 | 新增 `lib/douyin-proactive.js`（进她自己主页点「**关注**」按钮开关注列表，取名字后面标着「互相关注」的人 / 按她自己的人格卡写一句（递人格卡全文 + 性格锚点，并把最近发过的话一起给她看，要求换角度、别复用说法）/ 发送 / 记账）。发不发、发给谁由自己定：设置页先点「拉互相关注名单」，再勾选要发的那几个人；配额按**一天最多几次** + **同一个人隔几小时**才再发。自走层 15 分钟 tick 里按剩余次数随机发一条；开关在 设置 → 平台 → 抖音 → 主动私信（默认关），另有「现在试一次」按钮 | 🟡 仍需（上游无私信主动发起） |
| P5 |  | 顺手分享的视频**按人挑类型** | `dm-*`（`dm-schema` / `dm-save` / `dm-vars` / `dm-ui` / `dm-http-*`） | 主动私信时顺手分享她自己的作品，现在可以**按类型选**：13 类（搞笑 / 游戏 / 美食 / 宠物 / 旅行 / 音乐舞蹈 / 颜值穿搭 / 剧情影视 / 数码科技 / 情感 / 日常 / 学习 / 运动）。每人可单点类型；没单点的人跟「默认分享哪类」走；都不选 = 不限。挑之前用 `aweme/detail` 补全文案 / 时长 / 点赞（`aweme/post` 会 403，故只在需要时补），按类型命中 → 无命中回落 → 同类里热门优先。支撑端点 `selfProfile` / `userPosts` 打进 `lib/douyin-http.js`，`DouyinSocial` 接上 `http` 才有纯 HTTP 通路（没接就退回浏览器刮） | 🟡 仍需 |
| P6 | `share` | 刷到的视频发卡片（两条路径分工） | `share-*` 9 处 | 原来「刷到有意思的就发给你」只是把链接甩过去；现在改成**发视频卡片**：`life.queueShare` 除了链接还带上 `videoId`，`deliverOne` 优先交给抖音分享面板把那条视频的卡片发到「抖音·主人」会话，卡片不通才退回发链接。**两条路径分开**：① 刷到有意思的就发给你 = 就发**刚刷到的这一条**，不按类型搜（`FS-SHARE-ONLY-BROWSED`）；② 主动私信时顺手分享 = 从设置里**你自己选的那几类**里随机挑**一个**类型去搜（`FS-DM-SHARE-ONE-TYPE`，挑不到就不发，不回落「不限」）。两条都不发她自己发的作品（`FS-DM-SHARE-OTHERS`）。一天几条仍看原「分享」配额 | 🟡 仍需 |
| P7 | `wechat` | 微信（WechatAgent）↔ 人格记忆互通 | `wechat-*` 26 处 | 把人格 / 记忆接到微信侧：① 聊天存档按通道归一化（`wechat:private` / `wechat:group`），外部桥接可 `append` 写入、`recent` 读取；② 新增 `person_wechat_alias` 表做「微信 id → canonical_id」认人，`person` 表结构不动，老库启动自动补建表与唯一索引；③ `gateway-util` 认出微信平台、中文名与群聊口径；④ `gateway` 不把微信私聊 / 群并进 QQ 会话（两侧通道各自独立，只共享人格与记忆）；⑤ `index` 入站、群 id、重启重建会话都走别名表认人（兼容 `wechat-private:` 老写法，不再当 QQ 号查）；⑥ `life` 的主动开口冷却 / 配额把微信算独立平台；⑦ `slang` 让同一个人的微信私聊与 QQ 私聊共用黑话 / 表达桶（读写都走共桶，取不到回退原通道键）；⑧ `soul-memory` 的记忆卡片 / 联系人清单按通道种类归类时认得出微信（`wechat-private` / `wechat-group`，不再记成 `qq-private`）。微信侧宿主是 WechatAgent，本组只提供通道、认人与存档读写接口，不主动发消息 | 🟡 仍需（上游无微信通道） |
| P8 | `wechat-pane` | 平台 → 微信设置页（哪些要 WechatAgent 侧配、哪些在这边配就生效）+ 微信只发动图表情 | `wechat-pane` 20 处 + 新文件 `client.wechat.js` | 在 设置 → 平台 下新增「微信」子页（`lib/client.wechat.js`，由 `routes.js` 的 `wechatState()` / `POST /channels/wechat-config` 回显与保存），页内把设置分成两组清单：**① 在 soul 平台这边改就生效**（人格卡与别名认人、记忆 / 存档读写、黑话共桶、主动开口冷却与配额、表情动图两项）；**② 必须去 WechatAgent 侧改才生效**（微信收发通道本身、登录态与掉线重连、群聊开关、出站转发地址 / 端口、图片与文件上行、朋友圈等微信独有能力）——soul 侧只提供通道与人格，改 WechatAgent 的配置这边不会替你保存。同时修「希希发的表情在 DSH 里是动的、到微信就变静态图」：微信只认 GIF，配 `stickerAnimatedFirst`（先挑动图，默认开）/ `stickerAnimatedStrict`（挑不到动图就不发，默认关），`gateway` 的 `wechatStickerPrefs()` 把两项透传给 `stickers` 的 `resolveFeelRefs` / `pickByFeel` / `resolveMemeTags` / `pickFromMeme`，`meme-bridge` 借 dsh-meme 时也按 `.gif` 优先、要动图时多拉候选，挑图结果带 `animated` 标记 | 🟡 仍需（上游无平台-微信页、无动图优先） |
| P9 | `wechat-transport` | 微信运输层：出站通道 + 入站口 + 网关挂载 | `wechat-transport-*` 20 处 + 新文件 `wechat-inbound.js` / `channels/wechat.js` | 上游对微信**零原生支持**（`gateway.js` 里 `wechat` 出现 0 次），P7/P8 只做了认人、存档与设置页，消息真正进出还得有运输层。本组补两件事：**① 入站**——新增 `lib/wechat-inbound.js`，本机回环 HTTP（默认 11233）收 WechatAgent 侧 `social-bridge` POST 过来的微信消息，鉴权 + 拆包后交给 `gateway.onWechatMessage`，走和 QQ 完全相同的判定 / 会话 / 记忆链路；**② 出站**——新增 `lib/channels/wechat.js`，把 `ChatGateway` 的出站动作（OneBot 段）转成 HTTP 交给 bridge，由 WechatAgent 用它自己那套链路（表情选图 / 回执 / 节流）真正发出去。`gateway.js` 14 处：构造参数收 `wechat`、`this.wechat`、`channelFor()`（Outbox 按 `channel_id` 选通道）、`allSessions` 带上微信会话、`chatTitle` 显示「微信·昵称（主人）」/「微信群·群名」、`onWechatMessage` + `wechatToMessage`、`decide` 的主人活跃 / 好友白名单 / 记忆标题三处、`handleCommand` 两处 + `sendReply` 改走 `channelFor`；`index.js` 6 处：引入两模块、`wechatCfg()`、建实例、把通道注入 `ChatGateway`、启动入站服务并在卸载时清理 | 🟡 仍需（上游无微信运输层） |
| P10 | `wechat-master` | 微信主人接管开关 + 静态表情换动图 + 面板状态 | `wechat-master-*` 11 处 | 三件事，都是微信这条线「看得见 / 管得住 / 发得出」的缺口：**① 接管开关**——`config-schema.js` 让 `wechat.masterTakeover`（默认开）与 `interject.masterQuiet` / `masterQuietMinutes` 存得住（以前面板上开了保存完就回落），`gateway.js` 的出站前判定：关掉后**主人私聊整条不进 soul**（不回复、不记记忆，微信那边由 WechatAgent 自己回）；**② 静态表情换动图**——微信只认 GIF，模型挑中的 `_stickers` 常是静态 PNG/JPG，发过去一定不动。`gateway.js` 出站时把静态候选换成真动图，`gateway-media.js` 新增 `wechatAnimatedSwap()`：拿文件名当「感觉」去 dsh-meme 图库挑一张真 GIF（`animatedStrict` 语义，挑不到就不发静态图），池子里没有 GIF 时按原样退回；**③ 面板状态**——`routes.js` 的 `/state` 算出「微信·嘉新（主人）」这条会话到底通到哪儿（认没认出主人 canonical、落没落到「鱼」工作区、最后活跃时间），再带一份表情体检（借 dsh-meme 开没开、图库里有多少张 GIF、上一次挑图结果），保存时接受 `masterTakeover` | 🟡 仍需（上游无微信主人接管与动图换图） |

状态取自 [`reports/upstream-compatibility.md`](reports/upstream-compatibility.md)（对着 npm 最新版自动体检生成，每周更新一次）。带 `douyin-` / `index-` / `client-` / `routes-` 前缀的都是小块锚点：抖音五处看 [`assets/douyin-hunks.json`](assets/douyin-hunks.json)，人格段两处看 [`assets/index-hunks.json`](assets/index-hunks.json)，个人插件页五处看 [`assets/plugins-hunks.json`](assets/plugins-hunks.json)（外加新文件 [`assets/plugins-route.js`](assets/plugins-route.js)），刷到的分享改卡片九处看 [`assets/share-hunks.json`](assets/share-hunks.json)，微信互通二十二处看 [`assets/wechat-hunks.json`](assets/wechat-hunks.json)，平台 → 微信设置页二十二处看 [`assets/wechat-pane-hunks.json`](assets/wechat-pane-hunks.json)（外加新文件 [`assets/client.wechat.js`](assets/client.wechat.js)），微信运输层二十处看 [`assets/wechat-transport-hunks.json`](assets/wechat-transport-hunks.json)（外加新文件 [`assets/wechat-inbound.js`](assets/wechat-inbound.js) / [`assets/channels.wechat.js`](assets/channels.wechat.js)），逐处替换、不再整文件覆盖。每一处的 id / 目标文件 / 改了什么 / 锚点原文，见 [`docs/patches.md`](docs/patches.md)（`tools/gen-patch-docs.mjs` 从上述 JSON 生成，不手写）。

## 用法

```bash
node patch-fish-soul.mjs                    # 自动找 ~/.dsh/profiles/*/node_modules/dsh-fish-soul
node patch-fish-soul.mjs --root <插件目录>   # 指定插件目录（含 package.json 的那层）
node patch-fish-soul.mjs --check            # 只报告状态，不改文件
node patch-fish-soul.mjs --only meme        # 只跑一组（meme / douyin / remount / plugins / dm / share / wechat / wechat-pane / wechat-transport / wechat-master）
node patch-fish-soul.mjs --json             # 结尾多打一段机器可读汇总（CI / 体检用）
node patch-fish-soul.mjs --force            # 忽略「已打过」判断按内容重算（谨慎）
node tools/verify-install.mjs               # 体检：三处版本是否一致 + 补丁是否还在（防被整包重装冲掉）
```

每次运行对每处补丁给出四种判定之一：

| 判定 | 含义 | 动作 |
| --- | --- | --- |
| `PATCHED` | 锚点在、上游没做 | 打上 |
| `ALREADY` | 本补丁已打过 | 跳过 |
| `UPSTREAM` | 上游已原生实现 | **自动退役**，一行不改 |
| `DRIFT` | 锚点没了、上游也没做 | 停手报错，等人更新锚点 |

需要 Node ≥ 22.5。

## 上游体检

```bash
node audit-upstream.mjs
```

直接拉 npm 上最新版 `dsh-fish-soul`，逐处判断补丁是「可退役 / 仍需 / 漂移」，结果写进 `reports/upstream-compatibility.md`。GitHub Actions（[`upstream-audit.yml`](.github/workflows/upstream-audit.yml)）每周自动跑一次并提交结果，所以这个文件不用手动维护。

常用变体：

| 命令 | 用途 |
| --- | --- |
| `node audit-upstream.mjs --from <插件目录>` | 体检本机那份（指向已打补丁的目录时，靠 `h.new` / `upgradeOld` 反推「已在位」） |
| `node audit-upstream.mjs --brief` | 只打「一句话结论 + 要处理的 id」，判兼容首选（有漂移时退出码 2） |
| `node audit-upstream.mjs --explain` | 多打一节「上游改了什么（通俗版）」：把锚点与上游逐行对齐，成对列出对不上的行，并给一句人话结论（只是动了上下文 / 改了几行 / 基本重写 / 整段没了）。配 `--brief` 时直接输出成人能读的几行 |
| `node audit-upstream.mjs --json` | stdout 只出 JSON（含 `summary` / `groups` / `patches`），CI 与 Agent 直接解析 |
| `node audit-upstream.mjs --out <路径>` | 报告写文件，不写屏 |

> **Agent 动手前先看 [`AGENTS.md`](AGENTS.md)**：上游更新时怎么在 1 分钟内判完兼容性、`audit` 与 `--check` 两套结论为什么不一致、漂移了按什么顺序改锚点。人读到这里就够。

## 安装体检（防补丁被整包重装冲掉）

```bash
node tools/verify-install.mjs            # 默认体检 ~/.dsh/profiles/desktop
node tools/verify-install.mjs --root <插件目录>
node tools/verify-install.mjs --json     # 机器可读
```

DSH 启动时会按 profile 的 `package.json` + `pnpm-lock.yaml` 做依赖安装。只要 **profile 声明 / lock 锁定 / 装好的包里 `package.json` 版本** 三者有一处对不上，它就会把 `dsh-fish-soul` 按 registry tarball **整包重装**，补丁文件被覆盖、功能静默消失（不报错、不弹窗）。

| 输出 | 含义 |
| --- | --- |
| 三行 `✓` + 结论「健康」 | 版本三处一致、补丁在位，下次启动不会被覆盖 |
| 某行 `×` | 该处版本不一致 → 按提示先统一版本，再重跑 `patch` |
| 补丁行 `×` | 版本没问题但补丁不全 → 直接重跑 `patch-fish-soul.mjs --root <目录>` |

退出码：`0` 健康 / `1` 有风险 / `2` 体检本身失败（找不到目录等）。打完补丁后、以及每次重开 DSH 之后各跑一次即可。

> 顺带一个已经排除的误判：`@chendaleiq/dsh-plugin-auto-update` 的 `packages` 白名单里没有 `dsh-fish-soul`，它的周期检查不会动这个包 —— 会重装它的是上面这套「启动时依赖安装」。

## 仓库内容

```
patch-fish-soul.mjs    补丁器：版本无关、幂等、三态判定、可自动退役
audit-upstream.mjs     上游体检：对 npm 最新版判断每处补丁还有没有用
AGENTS.md              给 Agent 的作业单：上游更新时怎么最快判兼容 / 漂移了按什么顺序修
assets/
  douyin-hunks.json    抖音补丁（评论区可见性 / 详情页 Tab / 回复可见 / BGM 留痕 / 文件头标记）的锚点与替换内容
  dm-hunks.json        主动私信 + 按人挑类型分享视频的 22 处锚点与替换内容
  douyin-proactive.js  主动私信模块（落到插件 lib/douyin-proactive.js）
  index-hunks.json     人格段补挂两处的小块锚点与替换内容
  plugins-hunks.json   个人插件页五处（client.js 3 + routes.js 2）的锚点与替换内容
  plugins-route.js     「个人插件」只读路由模块（新文件，落到插件 lib/routes-plugins.js）
  share-hunks.json     刷到的视频改发视频卡片的 9 处锚点与替换内容
  wechat-hunks.json    微信（WechatAgent）↔ 人格记忆互通的 26 处锚点与替换内容
  wechat-pane-hunks.json  平台 → 微信设置页的 20 处锚点与替换内容
  wechat-transport-hunks.json  微信运输层（gateway 14 + index 6）的锚点与替换内容
  wechat-inbound.js    微信入站口（本机回环 11233，落到插件 lib/wechat-inbound.js）
  channels.wechat.js   微信出站通道适配器（落到插件 lib/channels/wechat.js）
  wechat-master-hunks.json  微信主人接管开关 + 静态表情换动图 + 面板状态的 11 处锚点与替换内容
  client.wechat.js     平台 → 微信设置页整篇（落到插件 lib/client.wechat.js）
  meme-bridge.js       dsh-meme 只读取图桥接模块（打进插件 lib/ 用）
CHANGELOG.md           每轮补丁的改动说明：改了什么 / 开关在哪 / 配额怎么算 / 怎么验证与回滚
docs/
  patches.md           逐处清单（P1–P10 全部 121 处锚点 + 6 个整文件模块），由 tools/gen-patch-docs.mjs 生成
tools/
  gen-patch-docs.mjs   由 assets/*-hunks.json 生成 docs/patches.md；--check 校验两者不一致
  verify-install.mjs   安装体检：profile 声明 / pnpm-lock / 实际版本三处是否一致 + 补丁是否在位
reports/
  upstream-compatibility.md   体检报告（自动生成）
.github/workflows/
  upstream-audit.yml   每周体检
services/
  README.md            跟随 DSH 启动的本地服务栈：触发链、端口表、安装 / 验证 / 卸载、换机要改的硬编码路径
  app-triggered-boot.* DSH 启动后拉起服务栈的入口（ps1 + 无窗口 vbs）
  install-boot-hook.ps1  幂等修复 dsh-boot-hooks 插件注册（DSH 更新会把它冲掉）
  boot-hooks/          cordis 插件本体（住在 node_modules 外，pnpm 更新删不掉）
  fish-stack-watchdog.*  常驻循环：voice-rotate-proxy 17890 / SnowLuma 3001（QQ 在才起）/ 抖音 sink 8791
  wechat-stack-watchdog.*  常驻循环：微信桥 11229 + 11234，并定时重打 WechatAgent 的 social-bridge 接线
  wechat-bridge-start.*  微信桥的隐藏启动器（挑能 require node:sqlite 的 node，读 token 文件）
```

## 上游与归属

- 插件本体、完整能力说明、配置项、数据目录（`~/.dsh/fish-soul-config.json`、`~/.dsh/fish-soul/soul.db` 等）、安装方式，全部**以上游为准**：[Britneycode/dsh-fish-soul](https://github.com/Britneycode/dsh-fish-soul)。本仓库不复制那套文档，避免两边版本对不上。
- 上游插件 MIT，本仓库的补丁代码同样 MIT。上游作者不为这里的改动负责；补丁出问题时先跑 `--check` 和 `audit-upstream.mjs` 分清是「锚点过期」还是「上游已实现」。

## 许可

MIT
