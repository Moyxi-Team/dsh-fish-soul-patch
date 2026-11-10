# 变更说明（补丁仓，非插件本体）

本文件记录本仓库每次打给 `dsh-fish-soul`（已安装那一份）的补丁改动：改了什么、开关在哪、配额怎么算、怎么验证、怎么回滚。
不含上游源码，也不改上游版本号。

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
