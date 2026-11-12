/**
 * dsh-fish-soul — 设置面板「微信」页（client.wechat.js，按需加载的包内分块）
 * [FS-WECHAT-PANE]
 *
 * 微信的登录和收发都在 WechatAgent 的 social-bridge 里，soul 这边只管人格 / 记忆 / 认人 /
 * 接话节奏 / 挑表情。所以这一页只干三件事：
 *   1) 「微信·嘉新（主人）」这条会话到底通没通到「鱼」工作区，一眼看得见，还有总开关；
 *   2) 表情为什么不动，页面上直接给出体检结果（上一张挑中的是不是 GIF、图库里有多少动图）；
 *   3) 把 soul 侧真正生效的选项按组摆出来，说明一律走悬停（跟抖音、B站那些页一样），不占版面。
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
		/** ui.Row 只把 string 型 desc 挂成悬停 tip；数组要先拼成多行文本，否则说明会整段消失 */
		const tipText = (v) => (Array.isArray(v) ? v.filter((x) => x !== undefined && x !== null && x !== "").join("\n") : v);

		/** 改了也必须去 WechatAgent 那边动手才算数的（这边存了也不生效）——整段只在悬停里出现 */
		const AGENT_SIDE = "微信登录 / 掉线重登：WechatAgent 客户端扫码登录，soul 看不到二维码，也不该管。"
			+ "\n收发通道（bridge 地址、端口、token）：WechatAgent 的 social-bridge 决定往哪发、听哪个端口；这边只回显，必须和它的 bridge-config.json 一致。"
			+ "\n表情导入（GIF 转码）：WechatAgent 的 reader /api/v1/stickers/import 收图 —— GIF 原样保留，PNG / JPEG / WEBP 一律转成 GIF（静态图转出来还是 1 帧）。"
			+ "\n发图 / 发文件 / 引用回复：这些能力由 WechatAgent 提供，soul 只把内容交给它。"
			+ "\n好友、群、群名：名单都是 WechatAgent 从微信里读出来的，soul 只按 id 认人。";

		/** 在这一页或 soul 其它页改完就生效的——同样只在悬停里出现 */
		const SOUL_SIDE = "她是谁、怎么叫她、别名：「人物与关系」里那份；微信按 wechat:private:xx 认人，认到了就共用同一份记忆。"
			+ "\n哪些人算主人：本页「谁说话算数」；主人说话按主人的语气回，别人按普通朋友。"
			+ "\n私聊 / 群聊放不放行：本页白名单；不放行的会话她完全不看。"
			+ "\n接话节奏、连发几条、多久内算同一轮：本页「接话节奏」，跟 QQ 那套是同一份逻辑。"
			+ "\n群里怎么插话：本页「群里插话」：概率、冷却、每小时上限。"
			+ "\n挑哪张表情：本页「表情」；微信只认 GIF，所以这边默认只在动图里挑。"
			+ "\n记忆、说话风格、人格：「人格」「日常」「记忆」那些页，三条通道共用。";

		/** 时间：0 / 空 → 「—」 */
		const when = (ts, relTime) => {
			const n = Number(ts ?? 0);
			if (!Number.isFinite(n) || n <= 0) return "—";
			try {
				const t = typeof relTime === "function" ? relTime(n) : "";
				if (t) return String(t);
			} catch { /* relTime 不给就算了 */ }
			try { return new Date(n).toLocaleString(); } catch { return "—"; }
		};

		function WechatPane({ data, refresh, notify, api, relTime, ui }) {
			const { h, Switch, Button, State, Tag, Muted, Row, Group, Num, Area, Item, useForm } = ui;
			const w = data?.wechat ?? {};
			const ij = w.interject ?? {};
			const ms = w.masterSession ?? {};
			const sk = w.sticker ?? {};
			const last = sk.last ?? null;
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
				masterTakeover: w.masterTakeover !== false,
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

			// ── 主人那条会话的体检结论（一段短话 + 一段悬停长解释）──
			const takeover = w.masterTakeover !== false;
			const linked = ms.linked === true;
			const linkText = linked
				? `已联通 · ${ms.workspaceTitle || "鱼"}`
				: (ms.title ? "没通到「鱼」" : "还没有这条会话");
			const linkTip = [
				linked ? "这条私聊已经接在「鱼」工作区上，她对你在微信里说的话用的是同一个工作区、同一份记忆。" : "这条私聊没接在「鱼」工作区上：可能还没建会话、被归档了，或者挂到了别的工作区。",
				ms.title ? `会话：${ms.title}（${ms.channelId}）` : "",
				ms.workspacePath ? `工作区：${ms.workspaceTitle || ""}${ms.workspaceTitle ? " · " : ""}${ms.workspacePath}` : "",
				ms.expectedWorkspace ? `应该在：${ms.expectedWorkspace}` : "",
				ms.status ? `会话状态：${ms.status}` : "",
				ms.lastInboundAt ? `最近来信：${when(ms.lastInboundAt, relTime)}` : "",
				ms.reason ? `为什么没通：${ms.reason}` : ""
			].filter(Boolean).join("\n");

			// ── 表情体检结论 ──
			const libText = sk.libraryOk === true
				? `图库 ${sk.libraryTotal ?? 0} 张 · 动图 ${sk.libraryAnimated ?? 0} 张`
				: (sk.libraryReason ? `图库没起来：${sk.libraryReason}` : "图库没起来");
			const lastText = last === null
				? "还没挑过"
				: (String(last.file ?? "") === ""
					? `上张没发（${last.reason || "没挑到"}）`
					: `上张 ${last.animated === true ? "是动图" : "是静图"}`);
			const lastTip = last === null
				? "她在微信里还没挑过表情。挑一次之后这里会写清楚：挑中的是哪张、是不是真 GIF、从哪儿来的。"
				: [
					`时间：${when(last.at, relTime)}`,
					`方式：${last.kind === "desc" ? "[表情: 描述]" : last.kind === "image" ? "她自己贴的图（出站前换过动图）" : "按感觉挑"}`,
					`描述：${last.desc || "—"}`,
					`文件：${last.file || "（没发）"}`,
					`是不是 GIF：${last.animated === true ? "是" : "不是（微信里一定不动）"}`,
					`来源：${last.fromMeme === true ? "dsh-meme 图库" : "她自己的收藏"}`,
					last.reason ? `没发出去的原因：${last.reason}` : ""
				].filter(Boolean).join("\n");

			return h(react.Fragment, null,
				// ── ① 主人这条会话：状态 + 开关 ──
				Group({
					title: "微信 · 嘉新（主人）",
					aside: Tag(linked ? "已联通" : "没联通", linked ? undefined : "outline"),
					tip: "你自己（主人）在微信私聊里跟她说话时，走的是不是「鱼」工作区、有没有真的被接管。这条通了，才会用鱼的记忆和人格回你。"
				},
					Row({
						title: "接管我的私聊",
						desc: "打开 = 你在微信私聊里说话，她按鱼的记忆和人格回（走到「鱼」工作区）；关掉 = 私聊她完全不接（消息照收，但一句都不回），群里照旧。改完立刻生效。",
						meta: Tag(takeover ? "接管中" : "已关", takeover ? undefined : "outline")
					}, sw("接管我的私聊", takeover, (v) => save({ masterTakeover: v }),
						w.enabled !== true)),
					Row({
						title: "这条会话通到哪儿",
						desc: tipText(linkTip),
						meta: Tag(linkText, linked ? undefined : "outline")
					},
						ms.workspacePath ? Muted(`→ ${ms.workspaceTitle || ""}${ms.workspaceTitle ? " · " : ""}${ms.workspacePath}`) : Muted("还没有会话记录"),
						Button({ variant: "ghost", disabled: busy, onClick: () => refresh() }, "刷新")),
					Row({
						title: "最近来信",
						desc: "微信那边最近一次把消息交过来的时间。一直停在很早以前，说明 WechatAgent 那边掉线了或者 bridge 没连上。",
						meta: Muted(when(ms.lastInboundAt, relTime))
					},
						metaLine(h, Muted, ms.reason || "", linked ? "" : "再看下面「连接」那组")),
					Row({
						title: "她在微信里说话",
						desc: "soul 插件在微信通道的总开关。关掉 = 微信里完全不说话（消息照收，人不接），群里、私聊都不接；收发通道本身不受影响。",
						meta: Tag(w.enabled === true ? "说话中" : "闭嘴", w.enabled === true ? undefined : "outline")
					}, sw("在微信里说话", w.enabled === true, (v) => save({ enabled: v })))),

				// ── ② 表情：为什么不动 ──
				Group({
					title: "表情",
					aside: Tag(mode === "strict" ? "只发动图" : mode === "first" ? "先挑动图" : "不过滤", "outline"),
					tip: "微信个人号的表情只认 GIF：GIF 原样保留，PNG / JPEG / WEBP 都会被转成只有一帧的 GIF，也就是「一动不动的表情」。所以这一组只管一件事 —— 让她在微信里挑图时尽量挑到真 GIF。"
				},
					Row({
						title: "挑图策略",
						desc: "先挑动图 = 优先找 GIF，实在没有才发静图（默认）；只发动图 = 挑不到 GIF 就不发这张（宁可没表情，也不发张不动的）；不过滤 = 老行为，静态图照样发。"
							+ "\n这条链路的走法：她写 [表情: 得意] → soul 在图库里按本页策略挑一张（这一步归这里）→ 交给 WechatAgent 的 reader 导入成微信表情（GIF 原样保留，这一步归它）→ 发出去。"
							+ "\n她自己直接贴的 _stickers 静态图，出站前也会按这个策略先换成同感觉的动图。",
						meta: Muted(mode === "strict" ? "宁可不发" : mode === "first" ? "优先 GIF" : "静图也发")
					},
						modeBtn("first", "先挑动图"),
						modeBtn("strict", "只发动图"),
						modeBtn("any", "不过滤")),
					Row({
						title: "借 dsh-meme 的表情库",
						desc: "打开 = 她自己的表情包里没有合适的，就去 dsh-meme 的图库里挑一张（只读取图：不改动它的图库、不占收藏额度；图会复制一份到 fish-soul 自己的缓存目录再发）。"
							+ "\n微信里静态图发过去一定不动，图库里 GIF 的多少直接决定她能不能发出动图；表情包怎么挑（分类、权重）以 dsh-meme 那边设置为准。",
						meta: Tag(sk.memeEnabled === true ? "开着" : "只用自带的", sk.memeEnabled === true ? undefined : "outline")
					}, sw("借 dsh-meme 的表情库", sk.memeEnabled === true,
						(v) => act("/stickers/config", { meme: v }, v ? "没有合适的会去 dsh-meme 挑表情" : "只用自己的表情包"), busy)),
					Row({
						title: "图库体检",
						desc: "她挑图能看到的范围：dsh-meme 图库里一共多少张、其中多少张是 GIF。动图那栏是 0，那不管策略怎么调，微信里都不会动。",
						meta: Muted(libText)
					},
						Button({ variant: "ghost", disabled: busy, onClick: () => refresh() }, "重新体检")),
					Row({
						title: "上一张挑的",
						desc: tipText(lastTip),
						meta: Tag(lastText, last !== null && last.animated === true ? undefined : "outline")
					},
						last !== null && last.file !== "" ? Muted(String(last.file).split(/[\\/]/).pop()) : Muted("—"))),

				// ── ③ 谁说话算数 ──
				Group({ title: "谁说话算数", tip: "名单都是微信 id（wxid 或备注 id），一行一个。主人说话按主人的语气回，别人按普通朋友。" },
					Row({ title: "主人" }, Area({ ...bind("masterUserIds"), placeholder: "wxid_xxxxxxxx" })),
					Row({ title: "私聊只回这些人", desc: "留空 = 谁私聊都回；填了就只有名单里的人能聊" },
						Area({ ...bind("privateAllowList"), placeholder: "留空 = 都回" })),
					Row({ title: "群里只回这些群", desc: "填群 id 或群名都行；留空 = 看下面「所有群都回」" },
						Area({ ...bind("groupAllowList"), placeholder: "留空 = 看下面的开关" })),
					Row({ title: "所有群都回", desc: "打开 = 不挑群，被叫到就接话" },
						sw("所有群都回", w.allGroups === true, (v) => save({ allGroups: v }))),
					Row({ title: "叫她的名字", desc: "群里没 @ 她时，喊到这些名字也算在叫她；一行一个" },
						Area({ ...bind("callNames"), placeholder: "希希 / 鼠鼠 / 大肥鱼，每行一个" }))),

				// ── ④ 接话节奏 ──
				Group({ title: "接话节奏", tip: "跟 QQ 那套是同一份逻辑：一轮聊几句、隔多久发一条、多快算同一轮。数字框改完按回车或点别处生效。" },
					Row({ title: "一轮最多连发", desc: "0 = 只回一条" }, Num({ min: 0, max: 20, "aria-label": "一轮最多连发几条", ...bind("followUpCount") }), Muted("条")),
					Row({ title: "隔" }, Num({ min: 0, max: 1800, "aria-label": "连发间隔秒数", ...bind("followUpSeconds") }), Muted("秒发一条")),
					Row({ title: "智能化连发", desc: "按她的情绪决定要不要追一条，而不是死板地数条数" },
						sw("智能化连发", w.followUpSmart === true, (v) => save({ followUpSmart: v }))),
					Row({ title: "等你打完字", desc: "这么多毫秒内的几条消息合成一轮，当成一句话回" }, Num({ min: 0, max: 15000, "aria-label": "攒消息毫秒", ...bind("batchMs") }), Muted("毫秒")),
					Row({ title: "过期就不回", desc: "0 = 不限制" }, Num({ min: 0, max: 1440, "aria-label": "过期分钟", ...bind("replyWindowMinutes") }), Muted("分钟前的消息当翻篇"))),

				// ── ⑤ 群里插话 ──
				Group({ title: "群里插话", tip: "群里聊得起劲时她偶尔自己冒一句，不用等 @。这几个数只影响「没叫她时她主动插话」。" },
					Row({ title: "没叫她也可以插一句", desc: "关掉 = 只有被叫到才说话" },
						sw("允许插话", ij.enabled === true, (v) => save({ interject: { ...ij, enabled: v } }))),
					Row({ title: "概率" }, Num({ min: 0, max: 100, "aria-label": "插话概率百分比", ...bind("chance") }), Muted("%（每条群消息）")),
					Row({ title: "冷却" }, Num({ min: 0, max: 1440, "aria-label": "插话冷却分钟", ...bind("cooldownMinutes") }), Muted("分钟内不再插")),
					Row({ title: "每小时最多" }, Num({ min: 0, max: 30, "aria-label": "每小时最多插几次", ...bind("maxPerHour") }), Muted("次")),
					Row({
						title: "我在聊的时候少插",
						desc: "你最近几分钟跟她说过话，就当这轮有人接话了，她少插嘴（当前就是下面这个状态，点按钮切换）",
						meta: Tag(ij.masterQuiet !== false ? "让着你" : "不管这个", ij.masterQuiet !== false ? undefined : "outline")
					}, Button({ variant: "ghost", disabled: busy, onClick: () => save({ interject: { ...ij, masterQuiet: ij.masterQuiet === false } }) }, ij.masterQuiet !== false ? "改成不管" : "改成让着我"))),

				// ── ⑥ 连接（只读回显）──
				Group({
					title: "连接",
					aside: Tag(w.bridge === true ? "bridge 在线" : "bridge 没连上", w.bridge === true ? undefined : "outline"),
					tip: "这一组只回显，改了不生效：收发通道归 WechatAgent 的 social-bridge，soul 只把内容交给它。端口、路径、token 都是启动时读的，改完要重启 DSH；白名单、接话节奏那些存完就生效。"
				},
					Row({
						title: "发给 WechatAgent",
						desc: "soul 把要发的话 POST 到这里，由 WechatAgent 送到微信",
						meta: Muted(String(w.bridgeUrl ?? "（没配）"))
					}, Muted(`token：${w.hasBridgeToken ? w.bridgeTokenMasked : "没配"}`)),
					Row({
						title: "接 WechatAgent 的入站",
						desc: "WechatAgent 把微信新消息 POST 到这里的本地端口",
						meta: Muted(`端口 ${w.inboundPort ?? 11233} · ${w.inboundPath ?? "/fish-soul/wechat/inbound"}`)
					}, Muted(`token：${w.hasInboundToken ? "已配" : "没配"}`)),
					Row({
						title: "要对齐的地方",
						desc: "WechatAgent 的 bridge-config.json 里 platforms.wechat.inboundUrl / outboundPort 必须和上面两行对上，对不上就是单向哑巴：能收不能发，或者能发收不到。",
						meta: w.selfId ? Tag("自己 " + w.selfId, "outline") : Muted("还没读到自己的微信 id")
					}, Muted("两边一致才通话"))),

				// ── ⑦ 去哪儿改（信息不减，全在悬停里）──
				Group({ title: "去哪儿改", tip: "微信这套是两半拼起来的：soul 管人格 / 认人 / 节奏 / 挑图，WechatAgent 管登录和收发。分不清哪边的时候看这两行。" },
					Row({ title: "本页 / soul 其它页改了就生效", desc: tipText(SOUL_SIDE) },
						Tag("soul", "outline")),
					Row({ title: "必须去 WechatAgent 改才生效", desc: tipText(AGENT_SIDE) },
						Tag("WechatAgent", "danger"))),

				// ── ⑧ 排错 ──
				Group({ title: "不对劲先看这里", tip: "按顺序排查，基本都在上面几组里能对上号。" },
					Row({
						title: "她完全不回",
						desc: "① 上面「她在微信里说话」开没开；② 「连接」是不是 bridge 没连上；③ 这个会话在不在私聊白名单；④ WechatAgent 那边登录还在不在。"
					}, Muted("查 ①②③④")),
					Row({
						title: "表情还是不动",
						desc: "① 先看「上一张挑的」是不是静图；② 「图库体检」里动图是 0 的话，把「借 dsh-meme 的表情库」打开或者往 dsh-meme 里加几张 GIF；③ 已经只在发 GIF 还不动，就去 WechatAgent 的 reader 日志里看这张有没有被当成普通图片发、或者转码失败 —— soul 这边看不到那一段。"
					}, Muted("看 ①②③")),
					Row({
						title: "她没走到「鱼」工作区",
						desc: "① 上面「接管我的私聊」是不是被关了；② 「这条会话通到哪儿」的悬停里写了原因（没建会话 / 被归档 / 挂到别的工作区）；③ 工作区对不上时，去 DSH 的会话列表把这条微信私聊指到「鱼」。"
					}, Muted("看 ①②③"))));
		}

		/** 一行脚注：为空就不渲染，省版面 */
		function metaLine(h, Muted, text, fallback) {
			const one = String(text ?? "").trim();
			if (one === "") return fallback ? Muted(String(fallback)) : null;
			return Muted(one);
		}

		return { WechatPane };
	}
});
