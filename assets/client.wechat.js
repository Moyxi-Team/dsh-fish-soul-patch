/**
 * dsh-fish-soul — 设置面板「微信」页（client.wechat.js，按需加载的包内分块）
 * [FS-WECHAT-PANE]
 *
 * 微信的登录和收发都在 WechatAgent 的 social-bridge 里，soul 这边只管人格 / 记忆 / 认人 /
 * 接话节奏 / 挑表情。所以这一页只干两件事：
 *   1) 把 soul 侧真正生效的选项摆出来，改了就生效（少数要重启 DSH）；
 *   2) 明确列出「哪些必须去 WechatAgent 改」，免得在这边改半天发现没反应。
 *
 * 主面板 client.js 用 require.async("./client.wechat.js") 拿 WechatPane；分块不能同步 require
 * 主文件，api / 控件（props.ui）都由主面板传进来。
 */
window.__ModuleLoader__.load({
	id: "dsh-fish-soul",
	chunk: "client.wechat.js",
	factory: (require) => {
		const react = require("react");
		const lines = (v) => String(v).split(/\n+/).map((x) => x.trim()).filter(Boolean);

		/** 改了也必须去 WechatAgent 那边动手才算数的（这边存了也不生效） */
		const AGENT_SIDE = [
			["微信登录 / 掉线重登", "WechatAgent 客户端扫码登录；soul 看不到二维码，也不该管"],
			["收发通道（bridge 地址、端口、token）", "WechatAgent 的 social-bridge 决定往哪发、听哪个端口；这边只回显，必须和它的 bridge-config.json 一致"],
			["表情导入（GIF 转码）", "WechatAgent 的 reader /api/v1/stickers/import 收图：GIF 原样保留，PNG / JPEG / WEBP 一律转成 GIF（静态图转出来还是一帧，所以不动）"],
			["发图 / 发文件 / 引用回复", "这些能力由 WechatAgent 提供，soul 只把内容交给它"],
			["好友、群、群名", "名单都是 WechatAgent 从微信里读出来的，soul 只按 id 认人"]
		];

		/** 在这一页或 soul 其它页改完就生效的 */
		const SOUL_SIDE = [
			["她是谁、怎么叫她、别名", "「人物与关系」里那份；微信按 wechat:private:xx 认人，认到了就共用同一份记忆"],
			["哪些人算主人", "本页「谁说话算数」：主人说话按主人的语气回，别人按普通朋友"],
			["私聊 / 群聊放不放行", "本页白名单；不放行的会话她完全不看"],
			["接话节奏、连发几条、多久内算同一轮", "本页「接话节奏」，跟 QQ 那套是同一份逻辑"],
			["群里怎么插话", "本页「群里插话」：概率、冷却、每小时上限"],
			["挑哪张表情", "本页「表情」；微信只认 GIF，所以这边默认只在动图里挑"],
			["记忆、说话风格、人格", "「人格」「日常」「记忆」那些页，三条通道共用"]
		];

		function WechatPane({ data, refresh, notify, api, relTime, ui }) {
			const { h, Switch, Button, State, Tag, Muted, Row, Group, Num, Area, Item, useForm } = ui;
			const w = data?.wechat ?? {};
			const ij = w.interject ?? {};
			const [busy, setBusy] = react.useState(false);
			const [form, , patch] = useForm(data, () => ({
				masterUserIds: (w.masterUserIds ?? []).join("\n"),
				privateAllowList: (w.privateAllowList ?? []).join("\n"),
				groupAllowList: (w.groupAllowList ?? []).join("\n"),
				callNames: (w.callNames ?? []).join("\n"),
				followUpCount: w.followUpCount ?? 3,
				followUpSeconds: w.followUpSeconds ?? 120,
				batchMs: w.batchMs ?? 800,
				replyWindowMinutes: w.replyWindowMinutes ?? 10,
				chance: Math.round(Number(ij.chance ?? 0.05) * 100),
				cooldownMinutes: ij.cooldownMinutes ?? 15,
				maxPerHour: ij.maxPerHour ?? 3
			}));
			if (!data || !form) return null;

			const act = async (path, body, okMsg, failMsg) => {
				setBusy(true);
				const r = await api("POST", path, body);
				setBusy(false);
				if (!r?.ok) notify(r?.error ?? failMsg ?? "保存失败");
				else { if (okMsg) notify(okMsg); refresh(); }
				return r;
			};
			// 每次保存都把整份微信配置发过去（服务端只收 soul 侧的部分，收发那几项只回显）
			const save = (p = {}) => act("/channels/wechat-config", {
				enabled: w.enabled === true,
				bridgeUrl: w.bridgeUrl,
				inboundPort: w.inboundPort,
				inboundPath: w.inboundPath,
				masterUserIds: lines(form.masterUserIds),
				privateAllowList: lines(form.privateAllowList),
				groupAllowList: lines(form.groupAllowList),
				callNames: lines(form.callNames),
				allGroups: w.allGroups === true,
				followUpCount: Number(form.followUpCount),
				followUpSeconds: Number(form.followUpSeconds),
				followUpSmart: w.followUpSmart === true,
				batchMs: Number(form.batchMs),
				replyWindowMinutes: Number(form.replyWindowMinutes),
				stickerAnimatedFirst: w.stickerAnimatedFirst !== false,
				stickerAnimatedStrict: w.stickerAnimatedStrict === true,
				interject: {
					enabled: ij.enabled === true,
					chance: Number(form.chance) / 100,
					cooldownMinutes: Number(form.cooldownMinutes),
					maxPerHour: Number(form.maxPerHour),
					keywords: ij.keywords ?? [],
					masterQuiet: ij.masterQuiet !== false,
					masterQuietMinutes: ij.masterQuietMinutes ?? 5
				},
				...p
			});
			const bind = (name) => ({ value: form[name], onChange: (e) => patch({ [name]: e.target.value }), onBlur: () => save() });
			const sw = (label, checked, onChange, disabled) => h(Switch, { label, checked, onChange, disabled });

			// 表情三档：动图优先 / 只发动图 / 不过滤（老行为）
			const mode = w.stickerAnimatedStrict === true ? "strict" : w.stickerAnimatedFirst !== false ? "first" : "any";
			const setMode = (next) => {
				if (next === mode) return;
				save(next === "strict"
					? { stickerAnimatedFirst: true, stickerAnimatedStrict: true }
					: next === "first"
						? { stickerAnimatedFirst: true, stickerAnimatedStrict: false }
						: { stickerAnimatedFirst: false, stickerAnimatedStrict: false });
			};
			const modeBtn = (key, label) => Button({ key, variant: mode === key ? "secondary" : "ghost", disabled: busy, onClick: () => setMode(key) }, label);

			return h(react.Fragment, null,
				// ── 先讲清楚「在哪儿改」──
				Group({ title: "先看这里：哪些在哪儿改", aside: Tag(w.enabled === true ? "已开" : "没开", w.enabled === true ? undefined : "outline") },
					Row({ title: "soul 这个插件的总开关", desc: "关掉 = 她在微信里完全不说话（消息照收，人不接）。收发通道本身不受这个开关影响" },
						sw("在微信里说话", w.enabled === true, (v) => save({ enabled: v }))),
					Row({ title: "在 soul 平台设置里改就生效", stack: true },
						h("div", { className: "fs-list" }, SOUL_SIDE.map(([title, desc], i) => Item({
							key: `s${i}`, lead: Tag("soul", "outline"), text: title, title: `${title}\n${desc}`, meta: [h("span", { key: "d" }, desc)]
						})))),
					Row({ title: "必须去 WechatAgent 改才生效", stack: true, desc: "这一页没有这些选项，是因为 soul 这边存了也不算数" },
						h("div", { className: "fs-list" }, AGENT_SIDE.map(([title, desc], i) => Item({
							key: `a${i}`, lead: Tag("WechatAgent", "danger"), text: title, title: `${title}\n${desc}`, meta: [h("span", { key: "d" }, desc)]
						}))))),

				// ── 表情（用户最关心的问题）──
				Group({ title: "表情：为什么微信里不动", aside: Tag(mode === "strict" ? "只发动图" : mode === "first" ? "先挑动图" : "不过滤", "outline") },
					Row({ title: "原因", stack: true },
						Muted("微信个人号的表情只认 GIF。同一个表情包在 DSH 里能动，是因为这边直接显示 webp / APNG；到了微信，WechatAgent 的导入接口只把 GIF 原样保留，PNG / JPEG / WEBP 都是转成 GIF，静态图转出来还是 1 帧，就成了一动不动的图片。"),
						Muted("所以多数情况不是微信那边坏了，而是 soul 挑给它的那张本来就是静态图（她的收藏和借来的图库里静态图更多）。让挑图只在 .gif 里挑，才是这边能治的地方。")),
					Row({ title: "挑图策略", desc: "先挑动图 = 优先找 GIF，实在没有才发静图；只发动图 = 没有 GIF 就不发这张（宁可没表情，也不发张不动的）" },
						modeBtn("first", "先挑动图"),
						modeBtn("strict", "只发动图"),
						modeBtn("any", "不过滤")),
					Row({ title: "这条链路的走法", stack: true },
						Muted("她写 [表情: 得意] → soul 在图库里按本页策略挑一张（这一步归这里）→ 交给 WechatAgent 的 reader 导入成微信表情（GIF 原样保留，这一步归它）→ 发出去。"))),

				// ── 连接（只读回显）──
				Group({ title: "连接（这里只回显，改了不生效）", aside: Tag(w.bridge === true ? "bridge 在线" : "bridge 没连上", w.bridge === true ? undefined : "outline") },
					Row({ title: "发给 WechatAgent", stack: true },
						Muted(String(w.bridgeUrl ?? "（没配）")),
						Muted(`token：${w.hasBridgeToken ? w.bridgeTokenMasked : "没配"}`)),
					Row({ title: "接 WechatAgent 的入站", stack: true },
						Muted(`端口 ${w.inboundPort ?? 11233}，路径 ${w.inboundPath ?? "/fish-soul/wechat/inbound"}`),
						Muted(`token：${w.hasInboundToken ? "已配" : "没配"}`)),
					Row({ title: "要对齐的地方", desc: "WechatAgent 的 bridge-config.json 里 platforms.wechat.inboundUrl / outboundPort 必须和上面这两行对上，对不上就是单向哑巴" },
						w.selfId ? Tag("自己 " + w.selfId, "outline") : Muted("还没读到自己的微信 id")),
					Row({ title: "改完这些要重启 DSH", stack: true },
						Muted("端口、路径、token 是启动时读的；白名单、接话节奏那些存完就生效，不用重启。"))),

				// ── 谁说话算数 ──
				Group({ title: "谁说话算数" },
					Row({ title: "主人", stack: true, desc: "填微信 id（wxid 或备注 id），每行一个；主人说话按主人的语气，别人按普通朋友" },
						Area({ ...bind("masterUserIds"), placeholder: "wxid_xxxxxxxx" })),
					Row({ title: "私聊只回这些人", stack: true, desc: "留空 = 谁私聊都回；填了就只有名单里的人能聊" },
						Area({ ...bind("privateAllowList"), placeholder: "留空 = 都回" })),
					Row({ title: "群里只回这些群", stack: true, desc: "配合下面的「所有群」用；填群 id 或群名都行" },
						Area({ ...bind("groupAllowList"), placeholder: "留空 = 看下面的开关" })),
					Row({ title: "所有群都回", desc: "打开 = 不挑群，被叫到就接话" },
						sw("所有群都回", w.allGroups === true, (v) => save({ allGroups: v }))),
					Row({ title: "叫她的名字", stack: true, desc: "群里没 @ 她时，喊到这些名字也算在叫她" },
						Area({ ...bind("callNames"), placeholder: "希希 / 鼠鼠 / 大肥鱼，每行一个" }))),

				// ── 接话节奏 ──
				Group({ title: "接话节奏" },
					Row({ title: "一轮最多连发" }, Num({ min: 0, max: 20, "aria-label": "一轮最多连发几条", ...bind("followUpCount") }), Muted("条（0 = 只回一条）")),
					Row({ title: "隔" }, Num({ min: 0, max: 1800, "aria-label": "连发间隔秒数", ...bind("followUpSeconds") }), Muted("秒发一条")),
					Row({ title: "智能化连发", desc: "按她的情绪决定要不要追一条，而不是死板地数条数" },
						sw("智能化连发", w.followUpSmart === true, (v) => save({ followUpSmart: v }))),
					Row({ title: "等你打完字" }, Num({ min: 0, max: 15000, "aria-label": "攒消息毫秒", ...bind("batchMs") }), Muted("毫秒内的几条消息合成一轮，当一句话回")),
					Row({ title: "过期就不回" }, Num({ min: 0, max: 1440, "aria-label": "过期分钟", ...bind("replyWindowMinutes") }), Muted("分钟前的消息当成翻篇了（0 = 不限制）"))),

				// ── 群里插话 ──
				Group({ title: "群里插话" },
					Row({ title: "没叫她也可以插一句", desc: "群里聊得起劲时她偶尔自己冒一句，不用等 @ " },
						sw("允许插话", ij.enabled === true, (v) => save({ interject: { ...ij, enabled: v } }))),
					Row({ title: "概率" }, Num({ min: 0, max: 100, "aria-label": "插话概率百分比", ...bind("chance") }), Muted("%（每条群消息）")),
					Row({ title: "冷却" }, Num({ min: 0, max: 1440, "aria-label": "插话冷却分钟", ...bind("cooldownMinutes") }), Muted("分钟内不再插")),
					Row({ title: "每小时最多" }, Num({ min: 0, max: 30, "aria-label": "每小时最多插几次", ...bind("maxPerHour") }), Muted("次")),
					Row({ title: "我在聊的时候少插", stack: true, desc: "你最近几分钟跟她说过话，就当这轮有人接话了，她少插嘴" },
						Muted(`当前：${ij.masterQuiet !== false ? "开" : "关"}，${ij.masterQuietMinutes ?? 5} 分钟内算你在聊`),
						Button({ variant: "ghost", disabled: busy, onClick: () => save({ interject: { ...ij, masterQuiet: ij.masterQuiet === false } }) }, ij.masterQuiet !== false ? "改成不管" : "改成让着她"))),

				// ── 排错 ──
				Group({ title: "发不出去先看这几条" },
					Row({ title: "她完全不回", stack: true },
						Muted("① 上一组「总开关」开没开；② bridge 是不是「没连上」；③ 这个会话在不在白名单；④ WechatAgent 那边登录还在不在。")),
					Row({ title: "表情还是不动", stack: true },
						Muted("① 先看这里是哪一档（默认「先挑动图」，会优先找 .gif）；② 她的收藏里如果本来就没几张 GIF，改成「只发动图」会明显减少表情；③ 已经只在发 GIF 还不动，那就去 WechatAgent 的 reader 日志里看这张有没有被当成普通图片发、或者转码失败——soul 这边看不到那一段。"))));
		}

		return { WechatPane };
	}
});
