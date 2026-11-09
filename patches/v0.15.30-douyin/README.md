# dsh-fish-soul 补丁包（两处独立故障）

补丁对象：`dsh-fish-soul@0.15.31`（安装路径 `…\node_modules\dsh-fish-soul`）
生成时间：2026-11-09
适用平台：Windows，DSH（DeepSeek Harness）桌面版 profile `C:\Users\Administrator\.dsh\profiles\desktop`

| 补丁 | 文件 | 修的毛病 | 落点 |
|---|---|---|---|
| A | `lib/douyin-social.js` | 抖音回评论发不出去、发图文没 BGM | 4 处 |
| B | `lib/index.js` | 插件热更新后人格卡 + 记忆块永久掉线，动态每条显示「记忆没进这轮」 | 2 处 |

两个补丁互不相干，可以只打一个。

---

# 补丁 A：抖音「不回评论 / 发图文没 BGM」

## A1. 问题表现

1. **回评论发不出去**：soul.db 的 `social_reply` 表里，抖音记录几乎全是 `status='failed'`，回复文本已生成但没有真正发到抖音上；33 条里只 1 条 `replied`。
2. **发出去的图文没有 BGM**：作品确实发布了，但没有配背景音乐，而且事后完全查不到原因（没有任何日志或数据库记录）。

## A2. 根因（2026-11-09 真机复现，Chrome/151.0.7922.109，CDP 端口 47890）

### 1) 作品页 URL 已失效 —— 每个作品白等 12 秒

`openWork()` 先访问 `https://www.douyin.com/?modal_id=<作品ID>`，实测该 URL 现在 302 跳到 `https://www.douyin.com/jingxuan?modal_id=…`（精选信息流）：`items: 0`、`boxInDom: false`，点 `[data-e2e="feed-comment-icon"]` 也打不开评论区 → 只能空转到 12 次重试结束，再退回第二条 URL。

### 2) 评论区可见性判断用错元素 —— 整轮读到 0 条评论

`COMMENT_STATE_JS` 用 `document.querySelector` 只取第一个输入框：

```js
const box = document.querySelector('.comment-input-inner-container');
box: Boolean(r && r.width > 0 && r.height > 0)
```

但 `/note/<id>` 页点开评论后 DOM 里有两个：`[ [0,0], [298,44] ]` —— 第一个是隐藏副本（SSR 残留），第二个才是真输入框。`querySelector` 永远返回 0×0 那个，`box` 恒 `false` → `openWork()` 判定「评论区没打开」→ `pollComments()` 里 `if (!o.ok) return []` → 整轮一条评论都不处理。

### 3) 回复动作点在隐藏副本上 —— 必然 NO_BOX

`reply()` 同样用 `[...querySelectorAll('[data-e2e="comment-item"]')].find(...)`，命中的是隐藏那 6 条（rect 全 0×0，`innerText` 却可读）。隐藏节点上 `leaf.click()` 不产生效果，随后 `all.length > before ? all[last] : null` 得到 `null`：

```js
// before=1, after=1 → null
```

→ 返回 `{code:'NO_BOX', error:'点了「回复」没出来输入框'}`，写 `status='failed'`，**失败原因只进内存 `lastError`，不入库**。

对照实验（在**可见**条目上点「回复」）：回复框 `298×44 @(1706,891)` 正常出现，`editor:true, focused:true`，发送按钮 svg path 以 `M17.5 30` 开头（命中 `SEND_PATH`）—— 页面没坏，坏在选择器挑错副本。

### 4) BGM：页面动作全通，但「挑歌」这步会静默空手而归

真机验证全链路可用：编辑页「选择音乐」→ 面板打开（`input[placeholder="搜索音乐"]`）→「推荐」Tab → 抓到 10 首 → 搜索「匆匆又一年」→ 悬停 →「使用」→ 编辑页显示「选择音乐 匆匆又一年到了冬天 00:30 修改音乐」。

问题在 JS：

```js
if (!list.length) return '';                    // 歌单一首没抓到 → 空
const picked = pickRecommendedSong(raw, list);  // 模型没挑 / 名字对不上 → ''
```

`song` 为空时连提示都没有；而 `note()`（`gateway.js:263-270`）只 `decisions.unshift(...)` 进内存，不落库 → 重启即失。

## A3. 改动清单（4 处，全在 `lib/douyin-social.js`）

| # | 位置（原版行号） | 改动 |
|---|---|---|
| 1 | `COMMENT_STATE_JS`（:139） | 遍历所有输入框，`box: boxes.some(可见)`，新增 `itemsVisible` 便于排查 |
| 2 | `openWork()`（:470） | 删掉 `?modal_id=` 那条 URL，只走 `/note/<id>`、`/video/<id>`；先点可见的「评论(n)」Tab，没有 Tab 再退回左侧评论气泡；每次点击前 `scrollIntoView` 并校验在视口内 |
| 3 | `reply()`（:587 起） | 只在**可见条目**里找目标（`shown.length ? shown : all`），取「回复」叶子坐标后改用 `realClick`（CDP 真实鼠标事件）；回复框优先取条目内可见输入框 |
| 4 | `publish()` / `chooseMusic()`（:737 起） | 发布后写 kv `douyin.music.last = {at, songs(前5), song, picked}`；`song` 为空时也 `note('post', '这次没配 BGM…')`；歌单为空时明确提示，模型没挑时兜底用推荐第一首「正经歌」（过滤 `创作的原声/自带流量/纯音乐/伴奏/BGM`） |

文件体积：`49492 B → 52166 B`；`node --check` 通过。

> 注：现在的安装包里这个文件是 52343 B，多出来的 177 B 是另一个补丁脚本加的 `[FS-DOUYIN-SOCIAL-PATCH]` 文件头注释（不是表情包桥那套），四处改动都在。

---

# 补丁 B：人格卡 + 记忆块「热更新后掉线」

## B1. 问题表现

插件「日常 → 最近动态」里，每条记录的徽标都显示 **「记忆没进这轮」**（`client.soul.js:750`：`!d.recallAt ? "记忆没进这轮" : …`）。聊天表面正常，但每一轮都是「裸聊」：不记得以前说过的事，连人设都没进提示词。记忆库本身完好（`memory` 3701 条、active 3688、`person` 418）。

## B2. 根因：段挂在 per-agent 的 ctx 上，插件一重载就永久丢失

1. 人格卡与「此刻状态 + Top5 记忆」不是全局注入，而是注册在**单个 agent 的 ctx** 上（`lib/routes.js:889 registerAgentSections`：`fish-soul-persona` order 89000、瞬态块 `fish-soul` order 900）。这是有意的（#40/#41：全局段会漏进用户的技术对话）。
2. 只有插件自己 `agents.create/resume` 时会挂（`lib/gateway.js:568 setupAgent`，`createSession` :741 / `ensureSession` 里的 `agents.resume` :691 传 `setup`）。
3. 每轮组装 prompt 时 `buildContextBlock` 才跑，跑的时候才写 `session.recalledAt`；`gateway.js:1398` 读 `recallInfo` 拿到 `at`，`gateway.js:267-274` 只有 `at > 0` 才把 `recallAt` 塞进动态 → 否则 UI 回落到「记忆没进这轮」。
4. **`ensureSession` 看到 agent 还 live 就直接 `return live`，不再走 setup**。插件实例被重载（升级、装别的插件触发 pnpm 重链、重装 44 个包）后，旧 ctx 上的两个段随实例释放，而会话本体还活着 → 永远不会重新挂上。
5. `index.js:828 noteInteraction` 对自家来源（`SOURCE_QQ/PROACTIVE/BILI/DOUYIN`）**首行就 return**，`mountSectionsFor` 那行在 early-return 之后且只在 `person !== null` 时调用 → 没有任何补挂路径。

## B3. 证据（会话日志逐轮对比）

QQ 主会话 `fish-soul-10508df1-4a71-465f-9b15-…`（`chat_session` id=37，20:47:03 建），解压 `session.v4.jsonl.zstd` 逐轮看 runtime-context：

| 轮次 | 时间 | runtime-context |
|---|---|---|
| #1–#7 | 20:47–20:51 | 含 `[此刻状态]`、`[当前说话人]`，约 10.5 KB |
| #8 起 | 20:52:16 之后 | 只剩 ~2.1 KB，两个标记全消失，system 里的「希希」也一并没了 |

人格卡和瞬态块同时掉线，时间点正好落在 20:5x 那轮插件重装。同时 `/api/plugins/fish-soul/activity` 返回的 11 条 decisions **`recallAt` 全为 `null`**，包括 QQ 私聊的 reply / sent / proactive / digest —— 不是「认不出是谁」，是整块没跑。

## B4. 改动清单（2 处，全在 `lib/index.js`）

| # | 位置（0.15.31 行号） | 改动 |
|---|---|---|
| 1 | `noteInteraction()` 开头（:832 前） | 自家会话（`gateway.isOurSession(agentId) === true`）在 early-return **之前**先 `mountSectionsFor(payload?.agent)` —— 每条 inbox 消息都补挂一次，自愈 |
| 2 | `sectionsMounted` / `mountSectionsFor()`（:857 起） | `Set` 改 `Map`（agent id → ctx）：`sectionsMounted.get(id) === agent.ctx` 时跳过，ctx 换了就重挂，同一 ctx 不重复注册（否则宿主会报 already registered in this scope） |

文件体积：`80978 B → 81525 B`（干净原版 + 本补丁）；`node --check` 通过。

## B5. 效果

- 冷启动 / 重启：`resume → setup` 正常挂上，本来就该好。
- 插件热更新、pnpm 重链、整包重装：段掉了，下一条消息进来立刻补挂 —— 不再需要重启宿主才能恢复记忆。
- 动态面板从下一轮起显示「想起 N」，而不是「记忆没进这轮」。

---

# 文件说明

| 文件 | 说明 |
|---|---|
| `douyin-social-fixed.js` | 补丁 A 的**完整源码**（52166 B），直接覆盖 `lib/douyin-social.js` |
| `douyin-social-original.js` | 补丁 A 的原版（0.15.29/0.15.30 字节相同，49492 B），用于回滚 |
| `douyin-social.patch` | 补丁 A 的统一 diff（154 行），`git apply` / `patch -p1` 打在包根目录 |
| `index-0.15.31-remount-fixed.js` | 补丁 B 的**完整源码**（干净 0.15.31 + 本补丁，81525 B） |
| `index-0.15.31-original.js` | 补丁 B 的干净原版（80978 B），用于回滚 / 重生成 diff |
| `index-0.15.31-remount.patch` | 补丁 B 的统一 diff（2 个 hunk，33 行） |
| `fish-soul-repatch.ps1` | 补丁 A 的一键检查/重打脚本，`-Restart` 顺带重启 DSH |
| `repatch-remount.ps1` | 补丁 B 的一键检查/重打脚本（**幂等**，按字符串插入、不整文件覆盖，能保住别的补丁），`-Restart` 顺带重启 |
| `README.md` | 本说明 |
| `dsh-fish-soul-补丁说明.docx` | 同一份说明的 Word 版 |

校验值：

```
补丁 A 原版  49492 B  SHA256 5ae0b8936704b3b88f2b66e8ea5e49f213aa928d255234fce8c44611bb307561
补丁 A 补丁  52166 B  SHA256 a4fee25836ef6973b55acb1c8f872a83e11d0cd168e1bf4e712e4afa472dd9f2
补丁 B 原版  80978 B  SHA256 1bdcfa573f82863b9e1b4cf20ab5f7d7bf4954207ca0f9fd82c82e9563521ed0
补丁 B 补丁  81525 B  SHA256 70dbefcc4d53f1e817edc8c600c463db75de8b5b7e4bd4e9182ac8af3b160013
```

---

# 怎么应用

## 方式 A：脚本（推荐）

```powershell
# 补丁 A（抖音）
pwsh -File "C:\Users\Administrator\.dsh\fish-soul\patches\fish-soul-repatch.ps1"
# 补丁 B（记忆块）
pwsh -File "C:\Users\Administrator\.dsh\fish-soul\patches\repatch-remount.ps1"

# 两个都打完，重启一次宿主
pwsh -File "C:\Users\Administrator\.dsh\fish-soul\patches\repatch-remount.ps1" -Restart
```

补丁 B 的脚本是**幂等**的：已经在位就什么都不做；它按字符串插入而非整文件覆盖，所以不会把别的补丁（比如 `[FS-MEME-BRIDGE-PATCH]` 表情包桥）冲掉，跑完还会自动 `node --check` 自检。

## 方式 B：手工

1. 结束 `DeepSeek Harness.exe`。
2. 覆盖：`douyin-social-fixed.js` → `lib\douyin-social.js`；`index-0.15.31-remount-fixed.js` → `lib\index.js`。
3. 启动 `E:\ruanjian\DeepSeekHarness\DeepSeek Harness.exe`。

> **必须重启进程**：只启用/禁用插件（`set_plugin`）不会重新 `require` 文件，插件实例重建了但代码还是旧的 —— 实测仍走 `?modal_id=`、`replied=0`。

## 回滚

把对应的 `*-original.js` 覆盖回同名文件并重启。

---

# 验证记录

补丁 A（2026-11-09 20:10 起）：

| 项 | 结果 |
|---|---|
| 页面访问路径 | `/user/self?showTab=post` → `/note/7706106230728658185` → `/note/7705730907247824178` → `/note/7705356965483941154` → `/jingxuan`，**全程无 `?modal_id`** |
| 评论区 | 轮询过程中出现 `box:true`（原版永远 false） |
| 触发接口 | `POST /api/plugins/fish-soul/douyin/comments-now` → `{"ok":true,"replied":1,"skipped":0}`，36.8 秒 |
| DB 新行 | `notify_id=7706106230728658185:aa613697e9a401ec`、`from_name=鼠鼠想飙车`、`content=耶`、`reply=你别幸灾乐祸啊！`、`status=replied` |
| 页面取证 | 作品页评论区可见：`鼠鼠想飙车 … 耶` 下方 `希希 作者 … 你别幸灾乐祸啊！` |
| 统计 | 抖音 `social_reply`：`replied=2`、`skipped=9`（重试前 replied=1 + failed=23） |

BGM 侧：音乐面板可打开、可抓 10 首推荐、可搜索、可点「使用」并回到编辑页显示「选择音乐 匆匆又一年到了冬天 00:30 修改音乐」。补丁后的痕迹落在 kv `douyin.music.last`，下次发图文可在 `/api/plugins/fish-soul/channels/state` 直接看到。

补丁 B：

| 项 | 结果 |
|---|---|
| 语法 | `node --check lib/index.js` 通过 |
| 幂等性 | `repatch-remount.ps1` 连跑两次：第二次输出 `[ok] 补挂那一行已在位` / `[ok] sectionsMounted 已是 Map` / `[ok] 无需改动` |
| 预期表现 | 插件热更新后，下一条消息那一轮动态出现「想起 N」；不再需要重启宿主 |
| 待观察 | 需要一次真实的 QQ 对话轮次落库后才能在上表之外再补一条实测记录 |

---

# 注意事项

1. **插件更新会覆盖**：`node_modules` 由 pnpm 管理，重装/升级 `dsh-fish-soul` 会把两个文件都换回原版（实测 2026-11-09 20:0x 与 22:57 各被覆盖/重写过一次）。更新后把两个 repatch 脚本各跑一次再重启。
2. **还有别的补丁在改同一个包**：`lib\index.js`、`lib\config-schema.js`、`lib\gateway.js`、`lib\routes-v07.js`、`lib\stickers.js`、`lib\meme-bridge.js` 里带 `[FS-MEME-BRIDGE-PATCH]` 标记的是表情包桥，另有脚本维护。**别用整文件覆盖的方式打补丁 B**（会冲掉它），用 `repatch-remount.ps1`。
3. **插件可能被整包卸载**：11-09 19:40 那轮「更新」把 `dsh-fish-soul` 从 profile 依赖里删掉且没装回来（`plugin-manager\logs\operation-pJpwed\pnpm.log`），需要用 `plugin_manager` 重新 `install_bundle dsh-fish-soul@<版本>`。
4. **本地 API 需要 sameOrigin**：`POST /api/plugins/fish-soul/...` 要带 `Origin`/`Referer` 头（GUI 端口每次重启会变）。
5. **标签页要前台**：新建 `background:true` 的标签页里 CDP 鼠标点击不生效；脚本化验证时用 `Target.createTarget`（不带 background）+ `Target.activateTarget`。
6. **`Page.navigate` 前必须 `Page.enable`**，否则 URL 不跳转。
7. 两个补丁上游都未合并：0.15.30 的 `douyin-social.js` 与 0.15.29 字节相同；0.15.31 的 `index.js` 里 `ensureSession` 的 live 短路和 `noteInteraction` 的 early-return 都还在。
