/**
 * dsh-fish-soul — 设置面板「微信」页（client.wechat.js，按需加载的包内分块）
 * [FS-WECHAT-PANE]
 *
 * 微信的登录和收发都在鲸鱼桥（WhaleLauncher）里，soul 这边只管人格 / 记忆 / 认人 /
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

		/** 改了也必须去鲸鱼那边动手才算数的（这边存了也不生效）——整段只在悬停里出现 */
		const AGENT_SIDE = "微信登录 / 掉线重登：在鲸鱼（WhaleLauncher）里扫码登录，soul 看不到二维码，也不该管。"
			+ "\n收发通道（bridge 地址、端口、token）：鲸鱼桥决定往哪发、听哪个端口；这边只回显，改完要两边一致才对得上。"
			+ "\n表情导入（GIF 转码）：收图、转码都在鲸鱼桥那边完成 —— GIF 原样保留，静态图会被转成 1 帧的 GIF，发出去就是不动。"
			+ "\n发图 / 发文件 / 引用回复：这些能力由鲸鱼桥提供，soul 只把内容交给它。"
			+ "\n好友、群、群名：名单都是鲸鱼从微信里读出来的，soul 只按 id 认人。";

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
			// [FS-WECHAT-HOOKS-ORDER] 所有 hook 必须在最早一次 return 之前声明，否则首帧（data 还没到）与数据帧 hook 数量不一致，React 会报 #310。
			const [moFlip, setMoFlip] = react.useState(null);
			// [FS-WECHAT-BUSY-GUARD] 保存期间会把控件全置灰；请求异常或页面切走时若没复位，整页开关就「按不动」了。
			// 这里用 ref 兜住重入，再用超时兜底解锁，保证任何情况下按钮/开关都会回到可点状态。
			const busyRef = react.useRef(false);
			react.useEffect(() => {
				if (!busy) return undefined;
				const t = setTimeout(() => { busyRef.current = false; setBusy(false); }, 10000);
				return () => clearTimeout(t);
			}, [busy]);
			// [FS-WECHAT-GROUPS] 群名单可视化：群从鲸鱼联系人缓存来，点开关就等于改 groupAllowList
			const [grps, setGrps] = react.useState(null);
			const [grpLoading, setGrpLoading] = react.useState(false);
			// [FS-WECHAT-GROUPS-ERR] 群列表读失败时原来只把列表清空，页面上就只剩「共 0 个群」，看起来像点重读没用。
			// 这里把接口的错误原样留在页面上，能一眼看出是没鉴权、没这个接口（旧后台没重启）还是真没群。
			const [grpErr, setGrpErr] = react.useState(null);
			// [FS-WECHAT-GROUPS-ERR] 再记一个「上一次到底什么时候读的」，否则点重读后界面没变化，用户没法判断到底读没读。
			const [grpAt, setGrpAt] = react.useState(null);
			// [FS-WECHAT-SERVICES] 服务状态单独拉一次，别拖慢整页（要探三个端口 + 翻进程表）
			const [svc, setSvc] = react.useState(null);
			const [svcBusy, setSvcBusy] = react.useState(false);
			const loadSvc = async () => {
				setSvcBusy(true);
				try {
					const r = await api("GET", "/channels/wechat-services");
					setSvc(r && typeof r === "object" ? r : { ok: false, error: "状态接口没返回内容" });
				} catch (error) {
					setSvc({ ok: false, error: String(error instanceof Error ? error.message : error) });
				}
				setSvcBusy(false);
			};
			react.useEffect(() => { void loadSvc(); }, []);
			const loadGroups = async () => {
				setGrpLoading(true);
				try {
					const r = await api("GET", "/channels/wechat-groups");
					const ok = r?.ok === true && Array.isArray(r.groups);
					setGrps(ok ? r.groups : []);
					setGrpErr(ok ? null : String(r?.error ?? "群列表接口没返回内容"));
				} catch (error) { setGrps([]); setGrpErr(String(error instanceof Error ? error.message : error)); }
				setGrpAt(new Date());
				setGrpLoading(false);
			};
			react.useEffect(() => { void loadGroups(); }, []);
			const groupKey = (v) => String(v ?? "").replace(/^wechat[-:]?group:/i, "").replace(/^group:/i, "").replace(/@chatroom$/i, "").trim().toLowerCase();
			const toggleGroup = async (g, on) => {
				const key = groupKey(g.id);
				const cur = Array.isArray(w.groupAllowList) ? w.groupAllowList : [];
				const next = cur.filter((x) => groupKey(x) !== key);
				if (on) next.push(key);
				patch({ groupAllowList: next.join("\n") });
				// 先按点的结果把开关推到目标位置，失败时再由 refresh/loadGroups 拉回真值，避免点了像没点
				setGrps((prev) => (Array.isArray(prev) ? prev.map((x) => (groupKey(x.id) === key ? { ...x, allowed: on } : x)) : prev));
				await act("/channels/wechat-config", { groupAllowList: next }, null, "群名单保存失败");
				void loadGroups();
			};
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
				if (busyRef.current) return null;
				busyRef.current = true;
				setBusy(true);
				let r = null;
				let err = null;
				try {
					r = await api("POST", path, body);
				} catch (e) {
					err = e?.message ?? String(e);
				} finally {
					busyRef.current = false;
					setBusy(false);
				}
				if (err) notify((failMsg ?? "保存失败") + "（请求没发出去：" + err + "）");
				else if (!r?.ok) notify(r?.error ?? failMsg ?? "保存失败");
				else {
					if (okMsg) notify(okMsg);
					try { await refresh?.(); } catch { /* 刷新失败不该把开关一起带掉 */ }
				}
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

			// ── 朋友圈：什么时候会发，直接在这一页算清楚 ──
			const mo = w.moments ?? {};
			const mh = Array.isArray(mo.activeHours) ? mo.activeHours : [9, 23];
			const mFrom = Number(mh[0] ?? 9);
			const mTo = Number(mh[1] ?? 23);
			const moPerDay = Math.max(1, Number(mo.perDay ?? 1));
			const moGapMin = Math.max(0, Number(mo.minGapMinutes ?? 360));
			const moOn = moFlip === null ? mo.enabled === true : moFlip;
			const sameDay = (ts) => {
				const n = Number(ts ?? 0);
				if (!Number.isFinite(n) || n <= 0) return false;
				const a = new Date(n);
				const b = new Date();
				return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
			};
			const moLastAt = Number(mo.state?.lastAt ?? 0);
			const moCount = sameDay(moLastAt) ? Number(mo.state?.count ?? 0) : 0;
			const hhmm = (ts) => {
				try { return new Date(ts).toTimeString().slice(0, 5); } catch { return "—"; }
			};
			const moWhen = (() => {
				if (!moOn) return "关着：一条都不会发";
				if (moCount >= moPerDay) return "今天已经发满 " + moCount + "/" + moPerDay + " 条，明天 " + mFrom + ":00 之后才会再发";
				const now = Date.now();
				const hour = new Date().getHours();
				if (hour < mFrom) return "还没到时段：今天 " + mFrom + ":00 之后才开始判断（每 5 分钟看一次）";
				if (hour >= mTo) return "今天时段已过（" + mFrom + ":00–" + mTo + ":00），明天再发";
				const gapLeft = moLastAt > 0 ? moLastAt + moGapMin * 60000 - now : 0;
				if (gapLeft > 0) return "间隔没到：最早 " + hhmm(now + gapLeft) + " 之后才会发下一条";
				return "条件都满足：下一次判断（5 分钟内）就会发一条";
			})();
			const moSave = (v) => {
				if (busy) { notify("上一步还在保存，稍等一下再点"); return; }
				setMoFlip(v);
				void save({ moments: { ...mo, enabled: v } }).then(() => setMoFlip(null));
			};
			const grpOn = (grps ?? []).filter((g) => g.allowed === true).length;
			// [FS-WECHAT-GROUPS-ERR] 读取时刻，让「重读」按下去有可验证的痕迹。
			const grpStamp = grpAt ? grpAt.toLocaleTimeString("zh-CN", { hour12: false }) : "";

			const paneHead = Group({
				title: "现在能不能用",
				aside: Tag(w.enabled === true ? "她在说话" : "她闭嘴了", w.enabled === true ? undefined : "outline"),
				tip: "微信这套是两半拼起来的：soul 管人格 / 认人 / 节奏 / 挑图 / 发圈文案，鲸鱼（WhaleLauncher）管登录、收发、导入表情、真去点发表。两个都开着才通 —— 只开 DSH 她能想不能发，只开鲸鱼没人替她想。"
			},
				Row({
					title: "她在微信里说话",
					desc: "总开关。关掉 = 微信里一句都不回（消息照收，人不接），群里、私聊都不接；鲸鱼的收发通道本身不受影响。存完立刻生效。",
					meta: Tag(w.enabled === true ? "说话中" : "闭嘴", w.enabled === true ? undefined : "outline")
				}, sw("在微信里说话", w.enabled === true, (v) => save({ enabled: v }))),
				Row({
					title: "链路：soul → 鲸鱼桥 → 微信",
					desc: "左边 soul 出内容，中间鲸鱼桥送出去，右边才是微信里真的发出来。任何一环没起来，结果都是「能想不能发」。",
					meta: Tag(w.bridge === true ? "bridge 在线" : "bridge 没连上", w.bridge === true ? undefined : "outline")
				}, Muted("最近来信：" + when(ms.lastInboundAt, relTime))),
				Row({
					title: "改完什么时候生效",
					desc: "① 本页的开关、名单、数字：存完立刻生效，不用重启。"
						+ "\n② 端口 / 路径 / token：启动时读的，改完要重启 DSH。"
						+ "\n③ 微信登录、收发通道、表情导入转码、朋友圈发表权限：都在鲸鱼那边改，这边只回显。"
				}, Muted("三类分清楚就不会白改")),
				Row({
					title: "接管我的私聊",
					desc: "打开 = 你在微信私聊里说话，她按鱼的记忆和人格回（走「鱼」工作区）；关掉 = 私聊她完全不接（消息照收，一句不回），群里照旧。改完立刻生效。",
					meta: Tag(takeover ? "接管中" : "已关", takeover ? undefined : "outline")
				}, sw("接管我的私聊", takeover, (v) => save({ masterTakeover: v }), w.enabled !== true)),
				Row({
					title: "这条会话通到哪儿",
					desc: tipText(linkTip),
					meta: Tag(linkText, linked ? undefined : "outline")
				},
					ms.workspacePath ? Muted(`→ ${ms.workspaceTitle || ""}${ms.workspaceTitle ? " · " : ""}${ms.workspacePath}`) : Muted("还没有会话记录"),
					Button({ variant: "ghost", disabled: busy, onClick: () => refresh() }, "刷新")));

			const paneWho = Group({
				title: "谁说话算数",
				tip: "名单都是微信 id（wxid 或备注 id），一行一个。主人说话按主人的语气回，别人按普通朋友。改完立刻生效。"
			},
				Row({ title: "主人" }, Area({ ...bind("masterUserIds"), placeholder: "wxid_xxxxxxxx" })),
				Row({ title: "私聊只回这些人", desc: "留空 = 谁都不放行；想谁都回就打开下面『所有私聊都回』，填了只放名单里的人" },
					Area({ ...bind("privateAllowList"), placeholder: "留空 = 谁都不回" })),
				Row({ title: "所有私聊都回", desc: "打开 = 谁私聊都理（跟 QQ 的「所有好友」一个意思）；关掉 = 只看上面那份名单。主人不受名单限制", meta: Tag(w.allFriends === true ? "都回" : "看名单", w.allFriends === true ? undefined : "outline") },
					sw("所有私聊都回", w.allFriends === true, (v) => save({ allFriends: v }))),
				Row({ title: "叫她的名字", desc: "群里没 @ 她时，喊到这些名字也算在叫她；一行一个" },
					Area({ ...bind("callNames"), placeholder: "希希 / 鼠鼠 / 大肥鱼，每行一个" })));

			const paneGroup = Group({
				title: "群聊怎么接话",
				aside: Tag(w.allGroups === true ? "所有群" : grpOn > 0 ? String(grpOn) + " 个群" : "都不回", "outline"),
				tip: "群消息和私聊走同一套 soul 决策。群名单留空 + 关掉「所有群都能接话」= 任何群都不接话。注意：打开「所有群都能接话」时，下面每个群的开关不起作用。"
			},
				Row({
					title: "所有群都能接话",
					desc: "打开 = 群里被叫到名字就回，下面单个群的开关不再区分；关掉 = 只回打开开关的那几个群",
					meta: Tag(w.allGroups === true ? "开" : "关", w.allGroups === true ? undefined : "outline")
				}, sw("所有群都能接话", w.allGroups === true, (v) => save({ allGroups: v }))),
				Row({
					title: "只在叫名字时才回",
					desc: "打开 = 得叫「" + (w.callNames ?? []).join(" / ") + "」她才接（群里没 @ 也算）；关掉 = 正常聊天也可能插一句",
					meta: Tag(w.mentionOnly === true ? "点名才回" : "可能随时插话", "outline")
				}, sw("只在叫名字时才回", w.mentionOnly === true, (v) => save({ mentionOnly: v }))),
				Row({
					title: "哪些群说、哪些不说",
					desc: "按鲸鱼里真实存在的群列出来：打开 = 这个群她接话，关掉 = 这个群她不吭声。开关点了立刻生效，不用再点保存。"
				}, Muted(grpLoading ? "正在读群列表…" : (grpErr ? "读群列表失败（" + (grpStamp || "刚刚") + "）：" + grpErr + "（后台还没跑新接口时点几次都没用，重启 DSH 再试）" : (grps === null ? "群列表还没读到" : "共 " + grps.length + " 个群 · 已放行 " + grpOn + " 个 · 上次读取 " + grpStamp)))),
				Row({
					title: "重新读一遍群列表",
					desc: "鲸鱼里新拉的群、改过群名的，点这里刷新"
				}, Button({ variant: "ghost", disabled: busy || grpLoading, onClick: () => void loadGroups() }, grpLoading ? "读取中" : "重读")),
				...((grps ?? []).slice(0, 60).map((g) => Row({
					title: (String(g.name ?? "") === "" ? "（没名字的群）" : String(g.name)) + (g.chatted === true ? " · 聊过" : ""),
					desc: "群 id " + g.id
				}, sw(String(g.name || g.id), g.allowed === true, (v) => void toggleGroup(g, v))))),
				((grps ?? []).length > 60 ? Muted("群太多，只列前 60 个；剩下的用下面的群名单框手填群 id") : Muted(grps === null ? "群列表没读到：检查鲸鱼 contacts-cache.json 在不在" : "点开关即时生效")),
				Row({ title: "群里只回这些群（手填）", desc: "填群 id 或群名都行，一行一个；和上面的开关是同一份名单，两边会互相对上" },
					Area({ ...bind("groupAllowList"), placeholder: "留空 = 看上面的开关" })));

			const paneRhythm = Group({ title: "接话节奏", tip: "跟 QQ 那套是同一份逻辑：一轮聊几句、隔多久发一条、多快算同一轮。数字框改完按回车或点别处生效。" },
				Row({ title: "一轮最多连发", desc: "0 = 只回一条" }, Num({ min: 0, max: 20, "aria-label": "一轮最多连发几条", ...bind("followUpCount") }), Muted("条")),
				Row({ title: "隔" }, Num({ min: 0, max: 1800, "aria-label": "连发间隔秒数", ...bind("followUpSeconds") }), Muted("秒发一条")),
				Row({ title: "智能化连发", desc: "按她的情绪决定要不要追一条，而不是死板地数条数" },
					sw("智能化连发", w.followUpSmart === true, (v) => save({ followUpSmart: v }))),
				Row({ title: "等你打完字", desc: "这么多毫秒内的几条消息合成一轮，当成一句话回" }, Num({ min: 0, max: 15000, "aria-label": "攒消息毫秒", ...bind("batchMs") }), Muted("毫秒")),
				Row({ title: "过期就不回", desc: "0 = 不限制" }, Num({ min: 0, max: 1440, "aria-label": "过期分钟", ...bind("replyWindowMinutes") }), Muted("分钟前的消息当翻篇")));

			const paneInterject = Group({ title: "群里插话", tip: "群里聊得起劲时她偶尔自己冒一句，不用等 @。这几个数只影响「没叫她时她主动插话」。" },
				Row({ title: "没叫她也可以插一句", desc: "关掉 = 只有被叫到才说话" },
					sw("允许插话", ij.enabled === true, (v) => save({ interject: { ...ij, enabled: v } }))),
				Row({ title: "概率" }, Num({ min: 0, max: 100, "aria-label": "插话概率百分比", ...bind("chance") }), Muted("%（每条群消息）")),
				Row({ title: "冷却" }, Num({ min: 0, max: 1440, "aria-label": "插话冷却分钟", ...bind("cooldownMinutes") }), Muted("分钟内不再插")),
				Row({ title: "每小时最多" }, Num({ min: 0, max: 30, "aria-label": "每小时最多插几次", ...bind("maxPerHour") }), Muted("次")),
				Row({
					title: "我在聊的时候少插",
					desc: "你最近几分钟跟她说过话，就当这轮有人接话了，她少插嘴（当前就是下面这个状态，点按钮切换）",
					meta: Tag(ij.masterQuiet !== false ? "让着你" : "不管这个", ij.masterQuiet !== false ? undefined : "outline")
				}, Button({ variant: "ghost", disabled: busy, onClick: () => save({ interject: { ...ij, masterQuiet: ij.masterQuiet === false } }) }, ij.masterQuiet !== false ? "改成不管" : "改成让着我")));

			const paneSticker = Group({
				title: "表情",
				aside: Tag(mode === "strict" ? "只发动图" : mode === "first" ? "先挑动图" : "不过滤", "outline"),
				tip: "微信个人号只认 GIF：GIF 原样保留，PNG / JPEG / WEBP 都会被转成只有一帧的 GIF，也就是「一动不动的表情」。挑图在这页管，导入和转码在鲸鱼那边管。"
			},
				Row({
					title: "挑图策略",
					desc: "先挑动图 = 优先找 GIF，实在没有才发静图（默认）；只发动图 = 挑不到 GIF 就不发这张（宁可没表情，也不发张不动的）；不过滤 = 老行为，静态图照样发。"
						+ "\n链路：她写 [表情: 得意] → soul 按本页策略挑一张 → 交给鲸鱼桥导入成微信表情（GIF 原样保留，这一步归它）→ 发出去。"
						+ "\n她自己直接贴的 _stickers 静态图，出站前也会按这个策略先换成同感觉的动图。",
					meta: Muted(mode === "strict" ? "宁可不发" : mode === "first" ? "优先 GIF" : "静图也发")
				},
					modeBtn("first", "先挑动图"),
					modeBtn("strict", "只发动图"),
					modeBtn("any", "不过滤")),
				Row({
					title: "出站强制换动图",
					desc: "打开 = 发之前换成一张真 GIF，代价是跟 dsh 会话里看到的更容易不是同一张；关掉 = 尽量原样发（静图到微信里一定不动）。",
					meta: Tag(w.stickerOutboundSwap === true ? "换图" : "原样", "outline")
				}, sw("出站换动图", w.stickerOutboundSwap === true, (v) => save({ stickerOutboundSwap: v }))),
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
				}, Button({ variant: "ghost", disabled: busy, onClick: () => refresh() }, "重新体检")),
				Row({
					title: "上一张挑的",
					desc: tipText(lastTip),
					meta: Tag(lastText, last !== null && last.animated === true ? undefined : "outline")
				}, last !== null && last.file !== "" ? Muted(String(last.file).split(/[\\/]/).pop()) : Muted("—")));

			const paneMoments = Group({
				title: "朋友圈",
				aside: Tag(moOn ? "开" : "关", moOn ? undefined : "outline"),
				tip: "文案由 soul 出，交给本机鲸鱼桥去操作微信 UI 发表，不是模拟点朋友圈。鲸鱼那边的「发表总开关」必须开着（moments.publishFeatureEnabled），而且鲸鱼自己的每日上限也算一份，两边取更严的那个。"
			},
				Row({
					title: "自己发朋友圈",
					desc: "关掉 = 一条都不发；打开 = 按下面的节奏自动发。注意：打开后不会立刻发一条，要等下一次判断（5 分钟一次）并且满足时段和间隔。",
					meta: Tag(moOn ? "开" : "关", moOn ? undefined : "outline")
				}, sw("自己发朋友圈", moOn, (v) => moSave(v))),
				Row({
					title: "什么时候会发",
					desc: "这一行是按当前配置实时算的：额度、间隔、时段任何一个不满足都会被跳过。",
					meta: Muted("今天 " + moCount + "/" + moPerDay + " 条")
				}, Muted(moWhen)),
				Row({
					title: "发布节奏",
					desc: "每天最多 " + moPerDay + " 条，两次之间至少隔 " + Math.round(moGapMin / 60) + " 小时，只在 " + mFrom + " 点到 " + mTo + " 点之间发。数值想改就去配置文件 wechat.moments 里改：perDay / minGapMinutes / activeHours。",
					meta: Tag(mFrom + ":00–" + mTo + ":00", "outline")
				}, Muted("每 5 分钟判断一次")),
				Row({
					title: "发的时候带图",
					desc: "打开 = 从表情/图库里挑一张配着发；关掉 = 只发文字。带不带图由这里决定，鲸鱼那边的同名开关只管它自己生成的朋友圈。",
					meta: Tag(mo.withImage === true ? "带图" : "纯文字", "outline")
				}, sw("带图", mo.withImage === true, (v) => save({ moments: { ...mo, withImage: v } }))),
				Row({
					title: "发表权限在鲸鱼那边",
					desc: "鲸鱼设置里 moments.publishFeatureEnabled 必须为 true（发表总开关），moments.publishEnabled 应为 false（关掉它自己写文案，否则会出现第二个人的口吻），publishMaxPerDay 不要设得比这里小。这三项在鲸鱼里改，soul 看不到也改不了。"
				}, Muted("对不上就会静默跳过")));

			// [FS-WECHAT-SERVICES] 微信服务：这几个进程以前要自己去命令行拉，现在面板上点一下
			const startSvc = async () => {
				if (svcBusy) return;
				setSvcBusy(true);
				let r = null;
				try {
					r = await api("POST", "/channels/wechat-services/start", {});
				} catch (error) {
					notify("启动请求没发出去：" + String(error instanceof Error ? error.message : error));
					setSvcBusy(false);
					return;
				}
				if (r?.ok === true) notify("微信服务已拉起来");
				else notify(String(r?.error ?? "启动没全成，看下面每行状态"));
				if (r?.state) setSvc(r.state);
				else await loadSvc();
				setSvcBusy(false);
				}
			const svcPort = svc?.ports ?? {};
			const svcActions = Array.isArray(svc?.actions) ? svc.actions : [];
			const svcLine = (title, up, desc) => Row({
				title,
				desc,
				meta: Tag(up === true ? "在跑" : "没起来", up === true ? undefined : "outline")
			}, Muted(up === true ? "已就绪" : "点下面「一键启动」"));
			const paneServices = Group({
				title: "微信服务",
				aside: Tag(svc === null ? "读取中" : (svc.allUp === true ? "全部在跑" : "有服务没起来"), svc?.allUp === true ? undefined : "outline"),
				tip: "这一页只管「进程和端口在不在」。DSH 重启之后鲸鱼那边不会自己回来：8787 是鲸鱼 web（桥从这儿拿登录态），8899 是希希往微信发，11233 是微信往希希送。三个都在才算通；哪一行写着「没起来」，点「一键启动」，它会按启动器 → server.js → 桥的顺序把缺的补上，已经在跑的不动。"
			},
			svcLine("鲸鱼启动器 WhaleLauncher", svc?.launcher, "微信登录和收发都靠它，它没跑，后面两个也起不来。"),
			svcLine("鲸鱼服务 8787", svcPort.web, "桥从这里拿登录态；没它桥会一直报连不上鲸鲸服务。"),
			svcLine("出站通道 8899", svcPort.outbound, "希希的话从这儿交给鲸鱼发出去；没它就是能想不能发。"),
			svcLine("入站端口 11233", svcPort.inbound, "微信消息从这儿进 DSH；没它就是收不到消息，自然也不会回话。"),
			Row({
				title: "最后一次收到微信消息",
				desc: "桥日志里最后一条「收到」。你刚发完消息这里没动，说明消息根本没进来（入站或桥断了），别去怀疑人格和记忆。",
				meta: Tag(svc?.lastInbound?.at ?? "今天还没有", svc?.lastInbound ? undefined : "outline")
			}, Muted(svc?.lastInbound ? "（" + svc.lastInbound.ago + "）" + svc.lastInbound.line : "日志里没有今天的记录")),
			Row({
				title: "最后一次发到微信",
				desc: "桥日志里最后一条「后台通道发送成功」。上面那行动了、这行没动，问题就在 DSH 这边（她不接话），不在鲸鱼。",
				meta: Tag(svc?.lastOutbound?.at ?? "还没有", svc?.lastOutbound ? undefined : "outline")
			}, Muted(svc?.lastOutbound ? "（" + svc.lastOutbound.ago + "）" + svc.lastOutbound.line : "日志里没有今天的记录")),
			Row({
				title: "启动 / 刷新",
				desc: svc?.error ? "上一次启动没全成：" + svc.error : "「一键启动」只补没起来的那些，起完自己重读一遍状态，不用手动刷新。",
				meta: Muted(svc?.root ?? "")
			}, Button({ disabled: svcBusy, onClick: () => void startSvc() }, svcBusy ? "处理中…" : "一键启动"),
				Button({ variant: "ghost", disabled: svcBusy, onClick: () => void loadSvc() }, "刷新状态")),
			svcActions.length
				? Row({
					title: "上一次点了什么",
					desc: svcActions.map((a) => a.step + "：" + (a.state === "started" ? "已拉起" : a.state === "skip" ? "本来就在跑" : a.state === "fail" ? "失败" : a.state) + (a.detail ? "（" + a.detail + "）" : "")).join("；")
				}, Muted("顺序：启动器 → server.js → 桥"))
				: null
			);
			const paneLink = Group({
				title: "连接",
				aside: Tag(w.bridge === true ? "bridge 在线" : "bridge 没连上", w.bridge === true ? undefined : "outline"),
				tip: "这一组只回显，改了不生效：收发通道归鲸鱼桥，soul 只把内容交给它。端口、路径、token 都是启动时读的，改完要重启 DSH；白名单、接话节奏那些存完就生效。"
			},
				Row({
					title: "发给鲸鱼桥",
					desc: "soul 把要发的话 POST 到这里，由鲸鱼桥送到微信",
					meta: Muted(String(w.bridgeUrl ?? "（没配）"))
				}, Muted(`token：${w.hasBridgeToken ? w.bridgeTokenMasked : "没配"}`)),
				Row({
					title: "接鲸鱼桥的入站",
					desc: "鲸鱼桥把微信新消息 POST 到这里的本地端口",
					meta: Muted(`端口 ${w.inboundPort ?? 11233} · ${w.inboundPath ?? "/fish-soul/wechat/inbound"}`)
				}, Muted(`token：${w.hasInboundToken ? "已配" : "没配"}`)),
				Row({
					title: "要对齐的地方",
					desc: "鲸鱼桥那头填的入站地址 / 出站端口必须和上面两行对上，对不上就是单向哑巴：能收不能发，或者能发收不到。",
					meta: w.selfId ? Tag("自己 " + w.selfId, "outline") : Muted("还没读到自己的微信 id")
				}, Muted("两边一致才通话")));

			const paneHelp = Group({ title: "哪儿改 / 排错", tip: "分不清哪边该改的时候看前两行；出问题按后三行顺序排查，基本都能在上面几组里对上号。" },
				Row({ title: "本页 / soul 其它页改了就生效", desc: tipText(SOUL_SIDE) }, Tag("soul", "outline")),
				Row({ title: "必须去鲸鱼那边改才生效", desc: tipText(AGENT_SIDE) }, Tag("鲸鱼桥", "danger")),
				Row({ title: "她完全不回", desc: "① 最上面「她在微信里说话」开没开；② 「连接」是不是 bridge 没连上；③ 这个会话在不在私聊白名单；④ 鲸鱼那边登录还在不在。" }, Muted("查 ①②③④")),
				Row({ title: "朋友圈没动静", desc: "① 看「什么时候会发」那行写的拦在哪；② 今天额度满了就只能等明天；③ 鲸鱼里 moments.publishFeatureEnabled 是不是 false。" }, Muted("看 ①②③")),
				Row({ title: "表情还是不动", desc: "① 先看「上一张挑的」是不是静图；② 「图库体检」里动图是 0 的话，把「借 dsh-meme 的表情库」打开或者往 dsh-meme 里加几张 GIF；③ 已经只在发 GIF 还不动，就去鲸鱼桥的日志里看这张有没有被当成普通图片发、或者转码失败 —— 那一段 soul 看不到。" }, Muted("看 ①②③")),
				Row({ title: "她没走到「鱼」工作区", desc: "① 上面「接管我的私聊」是不是被关了；② 「这条会话通到哪儿」的悬停里写了原因；③ 工作区对不上时，去 DSH 的会话列表把这条微信私聊指到「鱼」。" }, Muted("看 ①②③")));

			return h(react.Fragment, null, paneHead, paneServices, paneWho, paneGroup, paneRhythm, paneInterject, paneSticker, paneMoments, paneLink, paneHelp);
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
