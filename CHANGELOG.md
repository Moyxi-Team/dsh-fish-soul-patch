# 变更说明（补丁仓，非插件本体）

本文件记录本仓库每次打给 `dsh-fish-soul`（已安装那一份）的补丁改动：改了什么、开关在哪、配额怎么算、怎么验证、怎么回滚。
不含上游源码，也不改上游版本号。

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
