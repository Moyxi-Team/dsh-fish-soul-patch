---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: c3040d704551dfa25d47107616a7e32f_e2862adadfc511f19919525400638852
    ReservedCode1: n/RbVk6mkQ1BEYSeqtzgBmFExZYrjIuQTP92ne/D2lAutvsDufHJp+dVvgFknfX2B2wgcqJClYrseWfidXyQAsSYZSlS4DF8zzHyAmB8uqK0cbb8llIO9ZUf158ySDo1IPXAlG0kkYB37ALgPrEJt4dIkShhf5X1gYyoCxFGR20uWevMNpQVsgbNolY=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: c3040d704551dfa25d47107616a7e32f_e2862adadfc511f19919525400638852
    ReservedCode2: n/RbVk6mkQ1BEYSeqtzgBmFExZYrjIuQTP92ne/D2lAutvsDufHJp+dVvgFknfX2B2wgcqJClYrseWfidXyQAsSYZSlS4DF8zzHyAmB8uqK0cbb8llIO9ZUf158ySDo1IPXAlG0kkYB37ALgPrEJt4dIkShhf5X1gYyoCxFGR20uWevMNpQVsgbNolY=
---

# 上游兼容性核查（自动生成）

- 核查时间：2026-11-14
- 核查对象：`dsh-fish-soul@0.15.55`（npm 最新版）
- 生成方式：`node audit-upstream.mjs`（GitHub Actions 每周自动跑一次并提交本文件）

## 分组结论

| 组 | 处 | 可退役 | 仍需 | 漂移 | 结论 |
| --- | --- | --- | --- | --- | --- |
| P1 meme | 1 | 0 | 1 | 0 | 🟡 继续用 |
| P2 douyin | 5 | 0 | 5 | 0 | 🟡 继续用 |
| P3 remount | 3 | 1 | 2 | 0 | 🟡 继续用 |
| P4 plugins | 6 | 0 | 6 | 0 | 🟡 继续用 |
| P5 dm | 23 | 0 | 23 | 0 | 🟡 继续用 |
| P6 share | 9 | 9 | 0 | 0 | 🟢 整组可退役 |
| P7 wechat | 26 | 0 | 25 | 1 | 🔴 要更新锚点 |
| P8 wechat-pane | 23 | 0 | 23 | 0 | 🟡 继续用 |
| P9 wechat-transport | 22 | 0 | 22 | 0 | 🟡 继续用 |
| P10 wechat-master | 11 | 0 | 2 | 9 | 🔴 要更新锚点 |

## 上游改了什么（通俗版）

> 补丁锚点与上游现状逐行对齐后的结论；对不上的行以 `-`(补丁原写法) / `+`(上游现状) 成对列出。

### W05（P7 wechat · lib/db.js）
- 通俗说：**上游把这段基本重写了**（上游第 336 行附近，5 行里只剩 2 行原样）。补丁逻辑要按新写法重新落。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

### wechat-master-01（P10 wechat-master · lib/config-schema.js）
- 通俗说：**这段在上游里已经找不到对应代码** —— 函数改名、挪了位置或整体重构了。先在该文件里搜补丁依赖的函数名再定位。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

### wechat-master-02（P10 wechat-master · lib/config-schema.js）
- 通俗说：**上游改动了这段里的几行**（上游第 24 行附近，4 行里原样还剩 2 行）。照下面成对的对比改锚点。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

### wechat-master-03（P10 wechat-master · lib/gateway.js）
- 通俗说：**上游改动了这段里的几行**（上游第 224 行附近，4 行里原样还剩 2 行）。照下面成对的对比改锚点。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

### wechat-master-04（P10 wechat-master · lib/gateway.js）
- 通俗说：**上游把这段基本重写了**（上游第 832 行附近，6 行里只剩 2 行原样）。补丁逻辑要按新写法重新落。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

### wechat-master-07（P10 wechat-master · lib/routes.js）
- 通俗说：**上游把这段基本重写了**（上游第 43 行附近，5 行里只剩 2 行原样）。补丁逻辑要按新写法重新落。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

### wechat-master-08（P10 wechat-master · lib/routes.js）
- 通俗说：**这段在上游里已经找不到对应代码** —— 函数改名、挪了位置或整体重构了。先在该文件里搜补丁依赖的函数名再定位。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

### wechat-master-09（P10 wechat-master · lib/routes.js）
- 通俗说：**这段在上游里已经找不到对应代码** —— 函数改名、挪了位置或整体重构了。先在该文件里搜补丁依赖的函数名再定位。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

### wechat-master-10（P10 wechat-master · lib/routes.js）
- 通俗说：**这段在上游里已经找不到对应代码** —— 函数改名、挪了位置或整体重构了。先在该文件里搜补丁依赖的函数名再定位。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

### wechat-master-11（P10 wechat-master · lib/routes.js）
- 通俗说：**这段在上游里已经找不到对应代码** —— 函数改名、挪了位置或整体重构了。先在该文件里搜补丁依赖的函数名再定位。
- 这段与锚点差异太大，逐行对比不可靠 → 直接在该文件里搜锚点里的函数名 / 中文字样来定位新写法。

## 逐处明细

| 组 | 补丁 | 处 | 上游状态 | 说明 |
| --- | --- | --- | --- | --- |
| P1 meme | 借 dsh-meme 的只读取图服务 | `meme-bridge` | 🟡 仍需 | 上游仍未接入 dsh-meme |
| P2 douyin | 评论区状态按可见性判定（折叠态不再误判为已打开） | `douyin-comment-visible` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P2 douyin | 作品详情页只走 note/video 直链 + 点右侧「评论(n)」Tab | `douyin-note-tab` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P2 douyin | 回复只在可见评论条目里找并用真实鼠标点击 | `douyin-reply-visible` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P2 douyin | BGM 挑歌先滤掉非歌曲条目（0.15.32：配乐不确认就不发布，不再硬兜底） | `douyin-music-trace` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P2 douyin | douyin-social.js 文件头加补丁标记 | `douyin-social-header` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P3 remount | 自家会话每条消息补挂人格段（热更新后人格卡 + 记忆块不再掉线） | `index-remount-our-session` | 🟢 可退役 | 上游已自己修好（{"present":"所有会话都在 inbox 时补挂一次做保险"}） |
| P3 remount | sectionsMounted 从 Set 改 Map（换 ctx 才重挂，同一 ctx 不重复注册） | `index-remount-map` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P3 remount | sectionsMounted 换成 Map 后，登记改成 set(id, ctx)（原来 Set 的 add 在 Map 上会 TypeError） | `index-remount-set` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P4 plugins | 系统设置多一个「个人插件」子页 | `client-system-plugins-tab` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P4 plugins | 个人插件（dsh-fish-soul 补丁）清单 | `client-installed-plugins-pane` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P4 plugins | 面板分发里把「个人插件」子页接到清单组件 | `client-plugins-pane-route` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P4 plugins | routes.js 引入 plugins 路由 | `routes-import-plugins` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P4 plugins | 路由分派里挂上 /plugins/* | `routes-mount-plugins` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P4 plugins | 个人插件清单（整文件 routes-plugins.js） | `plugins-route-file` | 🟡 仍需 | 上游无 lib/routes-plugins.js，本仓库新增文件仍需要 |
| P5 dm | import 主动私信模块 | `dm-social-import` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 加 maybeDm / dmNow / dmCandidates，status 带 dm | `dm-social-methods` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 自走层 tick 里问一次要不要主动发 | `dm-index-tick` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 抖音主动私信：把人格卡全文递给 DouyinSocial | `dm-persona-soul` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | config-platforms.js：配置 schema 加 dm（同一个人一天几次 / 同一个人隔几小时 / 选中的名单） | `dm-schema` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 设置页状态回显 dm（含候选名单与已选人） | `dm-state` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 保存设置带 dm（含 targets 校验） | `dm-save` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 新路由 /douyin/dm-candidates 与 /douyin/dm-now | `dm-now-route` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 表单初值加 dmPerDay/dmCoolHours | `dm-form` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 取出 dm 状态 + 勾选名单的本地状态 | `dm-vars` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 保存时带上 dm（含 targets） | `dm-saveui` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 设置页加「主动私信」分组（拉名单 / 点选人 / 一天几次 / 隔几小时） | `dm-ui` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 纯 HTTP 客户端补 selfProfile / collection / userPosts（分享视频按类型挑作品要用） | `dm-http-client` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | DouyinSocial 接纯 HTTP 客户端（分享视频按类型挑作品） | `dm-http-social` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | 实例化 DouyinSocial 时传入 douyinHttp | `dm-http-index` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | gateway：加 triggerDouyinProactive（主动私信走会话，发送交给上游 sendDouyin） | `gw-dm-session-methods` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | sendReply：主动私信那一轮允许回抖音（forceDouyin） | `gw-dm-session-reply` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | sendReply：她这轮不说话时回置 douyinSilent | `gw-dm-session-silent` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | sendReply：她只发了表情没说话时，主动私信那轮记成静默 | `gw-dm-session-quiet` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | sendReply：抖音分支把「发出去没」记到 st（主动私信要判断） | `gw-dm-session-send` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | DouyinSocial 记住 sayViaSession（没接上就退回插件自己发） | `dm-session-social-field` | 🟡 仍需 | 锚点是前序补丁 dm-http-social 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P5 dm | index.js 把 gateway.triggerDouyinProactive 接到 DouyinSocial.sayViaSession | `dm-session-wire` | 🟡 仍需 | 锚点是前序补丁 dm-persona-soul 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P5 dm | 主动私信实现（整文件 douyin-proactive.js） | `dm-proactive-file` | 🟡 仍需 | 上游无 lib/douyin-proactive.js，本仓库新增文件仍需要 |
| P6 share | douyin-social.js：引入 shareBrowsedVideo（刷到的视频也发卡片） | `share-social-import` | 🟢 可退役 | 上游已自己修好（{"present":"share.intent."} @ lib/life.js） |
| P6 share | douyin-social.js：加 dmShareBrowsed（把刷到的视频用卡片发给主人） | `share-social-method` | 🟢 可退役 | 上游已自己修好（{"present":"share.intent."} @ lib/life.js） |
| P6 share | index.js：抖音刷到的分享改发抖音私信卡片（douyinShareTarget + douyinShareCard） | `share-index-target` | 🟢 可退役 | 上游已自己修好（{"present":"share.intent."} @ lib/life.js） |
| P6 share | life.js：LifeEngine 接 douyinShareCard（发视频卡片） | `share-life-dep` | 🟢 可退役 | 上游已自己修好（{"present":"share.intent."}） |
| P6 share | life.js：queueShare 收下 videoId（刷到的那条视频） | `share-life-queuesig` | 🟢 可退役 | 上游已自己修好（{"present":"share.intent."}） |
| P6 share | life.js：抖音刷到的分享存成卡片信息（不再存「链接 + 感受」那句） | `share-life-reason` | 🟢 可退役 | 上游已自己修好（{"present":"share.intent."}） |
| P6 share | life.js：加 parseShareCard（认 reason 里存的卡片信息，顺手拼出退回用的链接文案） | `share-life-parse` | 🟢 可退役 | 上游已自己修好（{"present":"share.intent."}） |
| P6 share | life.js：deliverOne 先发视频卡片，卡片不通才退回发链接（QQ） | `share-life-deliver` | 🟢 可退役 | 上游已自己修好（{"present":"share.intent."}） |
| P6 share | douyin-browse.js：把刷到的那条视频的 id 一起交上去（发卡片要用） | `share-browse-videoid` | 🟢 可退役 | 上游已自己修好（{"present":"share.intent."} @ lib/life.js） |
| P7 wechat | 聊天存档：通道归一化（wechat:private / wechat:group）+ 外部桥接写入 append / recent 读取 | `W01` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | 聊天存档：取样 sample() 也按归一化通道查 | `W02` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | db：新增 person_wechat_alias 表（微信 id → canonical_id），person 表结构不动 | `W03` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | db：老库启动时补建微信别名表 + 唯一索引 | `W04` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | db：微信认人（canonicalOfWechat / findPersonByWechat / setWechatAlias / resolveOrCreateWechatPerson） | `W05` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |
| P7 wechat | gateway-util：微信通道判定（wechatKindOf / isWechatChannelId），platformOf 认出 wechat | `W06` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | gateway-util：通道种类识别加微信（wechat-private / wechat-group） | `W07` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | gateway-util：微信私聊 / 微信群的中文名、群聊判定、群主归一口径 | `W08` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | gateway：微信私聊 / 微信群不并进 QQ 会话（两侧通道各自独立，只共享人格与记忆） | `W09` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | index.js：引入微信认人 API | `W10` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | index.js：微信通道取人 / 群 id（兼容 wechat-private: 老写法） | `W11` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | index.js：插件重启重建会话时按平台认人（微信走别名表，不再当 QQ 号查） | `W12` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | index.js：入站消息按微信渠道认人（没登记就建 person + 补登记别名） | `W13` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | life：主动开口的冷却 / 配额把微信算独立平台 | `W14` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | 聊天存档接口：新增 /chat-archive/recent 与 /chat-archive/append，白名单放行微信通道 | `W15` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | slang：引入微信 / QQ 认人 API | `W16` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | slang：私聊跨渠道共桶（同一个人的微信私聊与 QQ 私聊共用黑话 / 表达） | `W17` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | slang：读取时按共桶取，取不到再回退原通道键 | `W18` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | slang：学到的东西写进共桶 | `W19` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | slang：手动合并写进共桶 | `W20` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | slang：外部导入写进共桶 | `W21` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | soul-memory：记忆卡片 / 联系人清单的通道种类认得出微信（wechat-private / wechat-group，不再记成 qq-private） | `W22` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | 微信出站表情挑选结果落日志（[表情:] 到底挑到没挑到，对着日志能看见） | `W23` | 🟡 仍需 | 锚点是前序补丁 W25、W26 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P7 wechat | 微信回复规则变量（replyIsWechat） | `W24` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | 微信回复规则整段（分条 / [表情:] 走 dsh-meme 图库 / 防被带跑 / 上网） | `W25` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | 微信出站不再丢段：一轮里多条 assistant/message 按 id 累积（以前是覆盖，只剩最后一条） | `W26` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | config-schema：新增 wechat 配置块（含表情动图两项） | `W27` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | gateway：新增 wechatStickerPrefs()（读微信表情动图偏好） | `W28` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | gateway：微信出站按描述挑表情时透传动图偏好 | `W29` | 🟡 仍需 | 锚点是前序补丁 W25 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | gateway：微信出站按感觉挑表情时也透传动图偏好 | `W30` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | stickers：resolveFeelRefs 收 animatedFirst / animatedStrict | `W31` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | stickers：resolveFeelRefs 把动图偏好传给 pickByFeel | `W32` | 🟡 仍需 | 锚点是前序补丁 meme-bridge 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | stickers：pickByFeel 收 animatedFirst / animatedStrict | `W33` | 🟡 仍需 | 锚点是前序补丁 meme-bridge 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | stickers：pickByFeel 动图排前面 + 严格模式挑不到就不发 | `W34` | 🟡 仍需 | 锚点是前序补丁 meme-bridge 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | stickers：resolveMemeTags 收 animatedFirst / animatedStrict | `W35` | 🟡 仍需 | 锚点是前序补丁 meme-bridge 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | stickers：resolveMemeTags 按描述挑图时带上动图偏好 | `W36` | 🟡 仍需 | 锚点是前序补丁 meme-bridge 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | stickers：pickFromMeme 借 dsh-meme 时也先挑 GIF | `W37` | 🟡 仍需 | 锚点是前序补丁 meme-bridge 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | stickers：挑图结果带 animated 标记 | `W38` | 🟡 仍需 | 锚点是前序补丁 meme-bridge 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | meme-bridge：加 isGif / usable 判定 | `W40` | 🟡 仍需 | 上游没有 lib/meme-bridge.js（整个文件由前序补丁 meme-bridge 新增），跟着前序补丁走 |
| P8 wechat-pane | meme-bridge：返回 animated 标记 | `W42` | 🟡 仍需 | 上游没有 lib/meme-bridge.js（整个文件由前序补丁 meme-bridge 新增），跟着前序补丁走 |
| P8 wechat-pane | routes：新增 wechatState()（微信配置回显） | `W43` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | /channels/state 回显里加 wechat | `W44` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | routes：新增 POST /channels/wechat-config（只存 soul 侧微信设置） | `W45` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | client：页签短名与子页签加「微信」 | `W46` | 🟡 仍需 | 锚点是前序补丁 W46-prev-tabs 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | client：微信子页签也走 channels 轮询 | `W47` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | client：微信子页签渲染 WechatPane | `W48` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | stickers：微信要动图时直接借 dsh-meme 图库（不再先挑本地收藏） | `W49` | 🟡 仍需 | 锚点是前序补丁 meme-bridge 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P8 wechat-pane | stickers：加 stageMemeGif（图库 gif 落一份到 _stickers） | `W50` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P8 wechat-pane | stickers：面板清单忽略 meme-*.gif | `W51` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | ChatGateway 构造参数加 wechat 通道 | `wechat-transport-gateway-01` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | this.wechat 存下微信通道 | `wechat-transport-gateway-02` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | Outbox 选通道：声明 self 并按 channel_id 取通道 | `wechat-transport-gateway-03` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | Outbox 通道 shim：connected / send 走 channelFor | `wechat-transport-gateway-04` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | allSessions 带上微信会话 | `wechat-transport-gateway-05` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | wechatConfig / channelFor / isMasterOf / trackMasterActivity 四个微信方法 | `wechat-transport-gateway-06` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | chatTitle 微信分支（微信·昵称（主人） / 微信群·群名） | `wechat-transport-gateway-07` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | onWechatMessage + wechatToMessage 微信入站方法 | `wechat-transport-gateway-08` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | decide：主人活跃时间改走 trackMasterActivity | `wechat-transport-gateway-09` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | decide：好友判定微信走白名单 | `wechat-transport-gateway-10` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | decide：memorize 标题带微信前缀 | `wechat-transport-gateway-11` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | handleCommand：回复（第一处）走 channelFor | `wechat-transport-gateway-12` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | handleCommand：回复（第二处）走 channelFor | `wechat-transport-gateway-13` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | 出站 sendReply 走 channelFor（微信必须） | `wechat-transport-gateway-14` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | index 引入 WechatChannel / WechatInboundServer | `wechat-transport-index-01` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | index 加 wechatCfg() | `wechat-transport-index-02` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | index 加 wechatChannel / wechatInbound 变量 | `wechat-transport-index-03` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | index 建 WechatChannel 实例 | `wechat-transport-index-04` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | index 把 wechat 通道注入 ChatGateway 参数 | `wechat-transport-index-05` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | index 启动微信通道 + 入站服务 + 卸载清理 | `wechat-transport-index-06` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P9 wechat-transport | 微信入站服务（整文件 wechat-inbound.js） | `wechat-inbound-file` | 🟡 仍需 | 上游无 lib/wechat-inbound.js，本仓库新增文件仍需要 |
| P9 wechat-transport | 微信出站通道（整文件 channels/wechat.js） | `wechat-channel-file` | 🟡 仍需 | 上游无 lib/channels/wechat.js，本仓库新增文件仍需要 |
| P10 wechat-master | 微信配置：主人私聊接管开关要能存住（否则面板上开了保存完就回落） | `wechat-master-01` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |
| P10 wechat-master | 微信插话：让着你（masterQuiet）要能存住 | `wechat-master-02` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |
| P10 wechat-master | 微信运行配置里带上 masterTakeover | `wechat-master-03` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |
| P10 wechat-master | 主人私聊接管关掉时整条不进 soul（不回复、不记记忆） | `wechat-master-04` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |
| P10 wechat-master | 微信出站：任何静态图（含 dsh-meme 缓存的 webp）发之前先换成真动图 | `wechat-master-05` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P10 wechat-master | 新增 wechatAnimatedSwap：拿文件名当"感觉"去图库换一张真 GIF | `wechat-master-06` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P10 wechat-master | /state 里算出「微信·嘉新（主人）」这条会话通到哪儿（认人、工作区、活跃） | `wechat-master-07` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |
| P10 wechat-master | 微信表情体检：借库开没开、图库有没有 GIF、上一次挑图结果 | `wechat-master-08` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |
| P10 wechat-master | /state 回给面板：接管开关 + 主人会话状态 | `wechat-master-09` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |
| P10 wechat-master | /state 回给面板：表情体检结果 | `wechat-master-10` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |
| P10 wechat-master | 保存微信配置时接受 masterTakeover | `wechat-master-11` | 🔴 漂移 | 锚点找不到、上游也没修 → 需要按新版更新锚点 |

**结论**：需要更新锚点：10 处的上游代码改版了，补丁本身没被上游吸收。

> 说明：`可退役` = 上游自己已经做完了，这类补丁不必再维护、也不必跟版本；`仍需` = 上游还没有，补丁继续用；`漂移` = 上游改了这段代码但没实现同样功能，需要按新版更新锚点。
*（内容由AI生成，仅供参考）*

## 实打复核（2026-11-14，人工复核 audit 结论）

上表由 `audit-upstream.mjs` 静态比对生成，会把「链式依赖未模拟」的情况虚报成漂移。本次按补丁**实跑**结果复核：

| audit 结论 | 实打结论 | 说明 |
| --- | --- | --- |
| W05（P7 · lib/db.js）漂移 | **真漂，已修** | 上游 0.15.55 在 `findPersonByDouyin` 与 `PLATFORM_COLUMN` 之间插入了 `normalizeDouyinIdentity` 等身份归一新函数，原 `old` 锚点（含 `findPersonByDouyin` 块的连续段）被截断。已把 W05 的 `old` 收窄为单行 `const PLATFORM_COLUMN = ...`、`new` 改为「微信认人函数块 + 该行」，两版通用且随上游插函数不再漂 |
| wechat-master-01~11（P10）九处漂移 | **假漂，实打全上** | 这九处 hunk 依赖同文件内前一处补丁的产物，audit 未模拟链式依赖，故报「锚点找不到」；实打时全部命中，无需改 |
| P6 share 整组 9 处 | 已退役 | 上游 0.15.55 原生实现「刷到视频 → 抖音原生卡片私信」，`upstreamFixed.present` 自动跳过 |
| P3 remount 1 处 / lib/index.js 人格段 1 处 / gateway.js 抖音私信 4 处 | 已退役 | 上游已自行实现，同样走自动退役 |

验证结论（同一份 assets 实打两版干净包）：

| 版本 | 改了 | 已打过 | 退役 | 漂移 | 失败 | 冒烟 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.15.49 | 132 | 5 | 3 段 | **0** | 0 | 通过 |
| 0.15.55 | 132 | 5 | 3 段 | **0** | 0 | 通过 |

运行库部署（0.15.55 纯净包 + 同一份 assets）：改 132 处，漂移 0，失败 0；`lib` 全目录 `node --check` 0 失败；`canonicalOfWechat` / `resolveOrCreateWechatPerson` / `person_wechat_alias` 均已落位（lib/db.js 441 / 480 行）。
