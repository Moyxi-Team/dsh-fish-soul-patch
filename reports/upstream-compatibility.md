# 上游兼容性核查（自动生成）

- 核查时间：2026-11-11
- 核查对象：`dsh-fish-soul@0.15.33`（npm 最新版）
- 生成方式：`node audit-upstream.mjs`（GitHub Actions 每周自动跑一次并提交本文件）

## 分组结论

| 组 | 处 | 可退役 | 仍需 | 漂移 | 结论 |
| --- | --- | --- | --- | --- | --- |
| P1 meme | 1 | 0 | 1 | 0 | 🟡 继续用 |
| P2 douyin | 5 | 0 | 5 | 0 | 🟡 继续用 |
| P3 remount | 2 | 0 | 2 | 0 | 🟡 继续用 |
| P4 plugins | 6 | 0 | 6 | 0 | 🟡 继续用 |
| P5 dm | 22 | 0 | 22 | 0 | 🟡 继续用 |
| P6 share | 9 | 0 | 9 | 0 | 🟡 继续用 |
| P7 wechat | 22 | 0 | 22 | 0 | 🟡 继续用 |

## 逐处明细

| 组 | 补丁 | 处 | 上游状态 | 说明 |
| --- | --- | --- | --- | --- |
| P1 meme | 借 dsh-meme 的只读取图服务 | `meme-bridge` | 🟡 仍需 | 上游仍未接入 dsh-meme |
| P2 douyin | 评论区状态按可见性判定（折叠态不再误判为已打开） | `douyin-comment-visible` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P2 douyin | 作品详情页只走 note/video 直链 + 点右侧「评论(n)」Tab | `douyin-note-tab` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P2 douyin | 回复只在可见评论条目里找并用真实鼠标点击 | `douyin-reply-visible` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P2 douyin | BGM 挑歌先滤掉非歌曲条目（0.15.32：配乐不确认就不发布，不再硬兜底） | `douyin-music-trace` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P2 douyin | douyin-social.js 文件头加补丁标记 | `douyin-social-header` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P3 remount | 自家会话每条消息补挂人格段（热更新后人格卡 + 记忆块不再掉线） | `index-remount-our-session` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P3 remount | sectionsMounted 从 Set 改 Map（换 ctx 才重挂，同一 ctx 不重复注册） | `index-remount-map` | 🟡 仍需 | 锚点在，补丁仍有效 |
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
| P5 dm | gateway：加 triggerDouyinProactive / sendDouyinDm（主动私信走会话） | `gw-dm-session-methods` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | sendReply：主动私信那一轮允许回抖音（forceDouyin） | `gw-dm-session-reply` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | sendReply：她这轮不说话时回置 douyinSilent | `gw-dm-session-silent` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | sendReply：抖音单独一条、只发文字（sendDouyinDm） | `gw-dm-session-send` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P5 dm | DouyinSocial 记住 sayViaSession（没接上就退回插件自己发） | `dm-session-social-field` | 🟡 仍需 | 锚点是前序补丁 dm-http-social 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P5 dm | index.js 把 gateway.triggerDouyinProactive 接到 DouyinSocial.sayViaSession | `dm-session-wire` | 🟡 仍需 | 锚点是前序补丁 dm-persona-soul 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P5 dm | 主动私信实现（整文件 douyin-proactive.js） | `dm-proactive-file` | 🟡 仍需 | 上游无 lib/douyin-proactive.js，本仓库新增文件仍需要 |
| P6 share | douyin-social.js：引入 shareBrowsedVideo（刷到的视频也发卡片） | `share-social-import` | 🟡 仍需 | 锚点是前序补丁 dm-social-import 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P6 share | douyin-social.js：加 dmShareBrowsed（把刷到的视频用卡片发给主人） | `share-social-method` | 🟡 仍需 | 锚点是前序补丁 dm-social-methods 写进去的（上游本无这段），跟着前序补丁走，不单独判漂移 |
| P6 share | index.js：抖音刷到的分享改发抖音私信卡片（douyinShareTarget + douyinShareCard） | `share-index-target` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P6 share | life.js：LifeEngine 接 douyinShareCard（发视频卡片） | `share-life-dep` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P6 share | life.js：queueShare 收下 videoId（刷到的那条视频） | `share-life-queuesig` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P6 share | life.js：抖音刷到的分享存成卡片信息（不再存「链接 + 感受」那句） | `share-life-reason` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P6 share | life.js：加 parseShareCard（认 reason 里存的卡片信息，顺手拼出退回用的链接文案） | `share-life-parse` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P6 share | life.js：deliverOne 先发视频卡片，卡片不通才退回发链接（QQ） | `share-life-deliver` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P6 share | douyin-browse.js：把刷到的那条视频的 id 一起交上去（发卡片要用） | `share-browse-videoid` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | 聊天存档：通道归一化（wechat:private / wechat:group）+ 外部桥接写入 append / recent 读取 | `W01` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | 聊天存档：取样 sample() 也按归一化通道查 | `W02` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | db：新增 person_wechat_alias 表（微信 id → canonical_id），person 表结构不动 | `W03` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | db：老库启动时补建微信别名表 + 唯一索引 | `W04` | 🟡 仍需 | 锚点在，补丁仍有效 |
| P7 wechat | db：微信认人（canonicalOfWechat / findPersonByWechat / setWechatAlias / resolveOrCreateWechatPerson） | `W05` | 🟡 仍需 | 锚点在，补丁仍有效 |
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

**结论**：仍有 67 处补丁有效、0 处已可退役。补丁继续适配上游最新版（0.15.33）即可。

> 说明：`可退役` = 上游自己已经做完了，这类补丁不必再维护、也不必跟版本；`仍需` = 上游还没有，补丁继续用；`漂移` = 上游改了这段代码但没实现同样功能，需要按新版更新锚点。
