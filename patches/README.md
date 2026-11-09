# dsh-fish-soul-patch

`dsh-fish-soul` 的补丁归档。上游：<https://github.com/britneycode/dsh-fish-soul>

> **本仓库定位**：补丁归档 + 使用说明。根目录下的源码树是本仓库 fork 时留下的 **v0.15.8** 快照，**不要整包覆盖到新版插件**（见下方「整包冲突」）。要用的是 `patches/` 里的东西。

| 目录 | 适配版本 | 内容 |
|---|---|---|
| [`patches/v0.15.31-meme-bridge/`](patches/v0.15.31-meme-bridge/) | 0.15.31 | 借 dsh-meme 只读图库 + 设置页开关（幂等脚本，15 处） |
| [`patches/v0.15.30-douyin/`](patches/v0.15.30-douyin/) | 0.15.30 / 0.15.31 | 抖音回评论 4 项修复（整文件替换） |

---

## 一、已有补丁与现版本（0.15.31）的兼容性核查

本仓库源码停在 0.15.8，但额外带 4 个本地补丁 commit（2026-11-06）。逐条比对上游 CHANGELOG 与 0.15.31 的实际代码：

| 补丁 | 上游状态 | 0.15.31 实际代码 | 结论 |
|---|---|---|---|
| **QQ 出站兜底**（剥 `</think>` 这类模板标签、同轮整段复读只留一份、超长无空行单段按空格拆条、同频道 2 分钟内一字不差拦截） | ✅ **已修**，v0.15.9 条目明写「QQ 出站兜底（来源 moonie-starlight，本地合并时带审查修复）」 | `gateway.js` 仍有 `dropRepeats()`、`noteSent`、`findRepeatedParagraphs`，相似度门槛 12 字 | **不必再打**。整包覆盖反而会把 0.15.31 的 13 个版本改动一起回退 |
| **抖音评论正文读成「...」**（正文改取 `.comment-item-info-wrap` 的下一个兄弟节点、`[data-e2e="video-comment-more"]` 的「更多」按钮文本就是「...」） | ✅ **已修**，v0.15.9 条目明写「实测 19/20 条被读成『...』」 | `douyin-social.js` 仍有 `comment-item-info-wrap`、`nextElementSibling` 取正文 | 已含，无需再打 |
| **回评论时 `reply()` 把「...」当内容**（截断残渣退化按作者名定位） | ✅ **已修**，同 v0.15.9 | 同上 | 已含，无需再打 |
| **抖音评论区没真的展开**（`COMMENT_STATE_JS` 只判元素存在，`display:none` 的隐藏副本会被误判成「已打开」） | ⚠️ **v0.15.9 修过，0.15.30 重构 douyin-social.js 后丢掉了（回归）** | 0.15.31 原版又退回 `document.querySelector(SEL.input)` 单元素判定 | **仍需打**，见 `patches/v0.15.30-douyin/` |

**整包冲突（重要）**：本仓库 `lib/` 是 0.15.8 的形状，与 0.15.31 差距很大——`lib/douyin-social.js` 39,458B → 49,492B，新增 `routes-v07.js`、`douyin-social.js` 等模块，`client.js`、`config-schema.js` 也都重写过。**禁止把本仓库 `lib/` 整体覆盖到新版插件**，那样会同时回退十几个版本的功能。补丁只能按目录单独取用。

## 二、`D:\重要文件\桌面\dsh-fish-soul-patch` 的核查结论

那份抖音补丁基准是 **0.15.30**，本次逐字节比对：

- 0.15.30 与 0.15.31 的 `lib/douyin-social.js` **SHA-256 完全相同** → 补丁对 0.15.31 直接可用，**没有版本冲突**。
- 它修的 4 项在 0.15.31 原版**全部仍然存在**，上游**一个都没修**：
  1. `COMMENT_STATE_JS` 仍是 `querySelector(SEL.input)` 单元素判定（隐藏副本 → 恒判「未展开」）；
  2. `openWork()` 的 URL 列表第一项仍是 `https://www.douyin.com/?modal_id=<id>`（该地址下评论接口返回空列表，白等 7 秒 settle + 12 轮轮询）；
  3. 回评论仍用 `leaf.click()`（抖音对合成 click 不响应，要 `realClick`）；
  4. `chooseMusic()` 拿不到推荐歌单时直接 `return ''`，没有 `douyin.music.last` 落库兜底。
- 上游 CHANGELOG 里「评论区 / 折叠 / 可见」的命中全部落在 ≤ v0.15.9 的旧条目，0.15.9 之后没有任何对应修复记录。

结论：**这份补丁没有被原版修复，仍然需要**，已原样归档到 `patches/v0.15.30-douyin/`，并作为 P2 并入 `patches/v0.15.31-meme-bridge/patch-fish-soul.mjs`（可一条命令同时打）。

## 三、通用注意事项

1. 所有补丁**改前自动备份**到 `~/.dsh/backup/`；插件升级（pnpm 重装）会整体覆盖目录，改动必然丢失，升级后重跑脚本即可。
2. 打完后**必须重启 DeepSeek Harness**，`require` 缓存不会重读文件。
3. 打补丁期间最好先退出 DSH，避免宿主把内存态回写覆盖改动。
4. 每个补丁都有唯一标记串，重跑是幂等的（检测到标记就跳过），可以放心重复执行。

## 四、许可

上游 MIT。补丁代码同样 MIT；`assets/douyin-social-fixed.js` 是上游 `dsh-fish-soul@0.15.30` 文件的修改版，版权归上游作者。
