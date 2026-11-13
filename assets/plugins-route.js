/**
 * routes-plugins.js —— 系统设置 → 个人插件：
 *   GET /plugins/installed
 *     ① personal：这个插件（dsh-fish-soul）身上自己打的补丁打没打上（读 lib 下文件里的标记，不联网）
 *     ② plugins ：本机这个 profile 里装着的 DSH 插件（名字 / 版本 / 来源 / 是否启用），只作对照
 * 只读：不装、不卸、不发网络请求，也不改任何插件的配置。
 *
 * [FS-PLUGINS-ROUTE v5] ← 这个版本戳给 patch-fish-soul.mjs 认：老版本的这份文件会被自动顶掉
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const SELF_DIR = dirname(LIB_DIR);

/**
 * 「个人插件」= 在 dsh-fish-soul 上自己打的补丁，不是 DSH 里装的插件。
 * 每一条都是从 assets/*-hunks.json（以及 patch-fish-soul.mjs 里内联的那几处）抽出来的
 * 一段只出现在「已经打过」的文件里的代码，用来判断这处补丁还在不在。
 */
const PATCH_GROUPS = [
  {
    key: "P1",
    name: "借 dsh-meme 的只读取图服务",
    items: [
      { t: "新增 lib/meme-bridge.js（只读取图桥）", f: "meme-bridge.js", p: "FS-MEME-BRIDGE-PATCH", u: null },
      { t: "stickers：图片引用按绝对路径写 markdown", f: "stickers.js", p: "const imageRef = (path)", u: null },
      { t: "表情包设置里加 meme 开关", f: "stickers.js", p: "meme: v.meme === true", u: null },
      { t: "routes-v07：/stickers/config 收 meme", f: "routes-v07.js", p: "if (b.meme !== undefined) s.meme = b.meme === true;", u: null },
      { t: "client：借库开关已从 QQ 页搬走（只留指路注释）", f: "client.js", p: "这个开关搬到「日常 → 表情包」页了", u: {"absent": "dsh-meme"} },
      { t: "表情包页：读 meme 状态 + 借库开关 + 「配置看 dsh-meme」提示", f: "client.soul.js", p: "表情包配置看 dsh-meme 设置", u: null },
    ]
  },
  {
    key: "P2",
    name: "抖音：回评论发不出 / 图文无 BGM",
    items: [
      { t: "评论区状态按可见性判定（折叠态不再误判为已打开）", f: "douyin-social.js", p: "const vis = (x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; };", u: {"present": "itemsVisible"} },
      { t: "作品详情页只走 note/video 直链 + 点右侧「评论(n)」Tab", f: "douyin-social.js", p: "return r.width && r.height && r.top >= 0 && r.bottom <= innerHeight ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;", u: {"absent": "modal_id"} },
      { t: "回复只在可见评论条目里找并用真实鼠标点击", f: "douyin-social.js", p: "await br.eval(`(() => { for (const el of document.querySelectorAll('[data-fish-reply]')) el.removeAttribute('data-fish-reply'); return true; })()`).catch(() => {});", u: {"present": "const pool = shown.length ? shown : all;"} },
      { t: "BGM 挑歌先滤掉非歌曲条目（原声 / 自带流量这类）", f: "douyin-social.js", p: "FS-MUSIC-TRACE", u: null },
    ]
  },
  {
    key: "P3",
    name: "热更新后人格卡 + 记忆块掉线",
    items: [
      { t: "自家会话每条消息补挂人格段（热更新后人格卡 + 记忆块不再掉线）", f: "index.js", p: "if (person !== null) mountSectionsFor(payload?.agent);", u: {"present": "gateway?.isOurSession(agentId) === true) mountSectionsFor"} },
      { t: "sectionsMounted 从 Set 改 Map（换 ctx 才重挂，同一 ctx 不重复注册）", f: "index.js", p: "if (id === '' || (agent?.ctx !== undefined && sectionsMounted.get(id) === agent.ctx)) return;", u: {"present": "sectionsMounted.get(id) === agent.ctx"} },
    ]
  },
  {
    key: "P4",
    name: "设置里的「个人插件」清单",
    items: [
      { t: "系统设置多一个「个人插件」子页", f: "client.js", p: "[\"system\", \"系统\", [[\"interface\", \"界面\"], [\"plugins\", \"个人插件\"], [\"version\", \"版本更新\"]]]", u: {"present": "[\"plugins\", \"个人插件\"]"} },
      { t: "个人插件（dsh-fish-soul 补丁）清单：先把补丁逐处核对，再对照 DSH 侧插件", f: "client.js", p: "const patches = personal ? Group({ title: \"个人插件（dsh-fish-soul 的补丁）\", aside: h(\"span\", { className: \"fs-group-aside\" }, `${personal.done}/${personal.total} 处已打${personal.todo > 0 ? ` · ${personal.todo} 处没打` : \"\"}${personal.version ? ` · v${personal.version}` : \"\"}`, Button({ variant: \"ghost\", onClick: load, disabled: busy }, busy ? \"读取中…\" : \"刷新\")) },", u: {"present": "function InstalledPlugins()"} },
      { t: "面板分发里把「个人插件」子页接到清单组件", f: "client.js", p: ": subtab === \"plugins\" ? h(Boundary, { name: \"个人插件\" }, h(InstalledPlugins))", u: {"present": "subtab === \"plugins\" ? h(Boundary, { name: \"已装插件\" }"} },
      { t: "routes.js 引入 plugins 路由", f: "routes.js", p: "import { handlePluginsRoute } from './routes-plugins.js'; // [FS-PLUGINS-PANEL-PATCH]", u: {"present": "handlePluginsRoute"} },
      { t: "路由分派里挂上 /plugins/*", f: "routes.js", p: "if (await handlePluginsRoute({ method, path, req, send, sameOrigin })) return;", u: {"present": "handlePluginsRoute({ method, path, req, send, sameOrigin })"} },
    ]
  },
  {
    key: "P5",
    name: "主动给抖音互关好友发私信",
    items: [
      { t: "import 主动私信模块", f: "douyin-social.js", p: "import { dmCfg, listCandidates, maybeSendProactive, proactiveStatus, sendProactiveNow } from './douyin-proactive.js';", u: null },
      { t: "加 maybeDm / dmNow / dmCandidates，status 带 dm", f: "douyin-social.js", p: "maybeDm(ctx) {", u: null },
      { t: "自走层 tick 里问一次要不要主动发", f: "index.js", p: "social: (x) => { biliSocial.maybePost(x); douyinSocial.maybePost(x); if (typeof douyinSocial.maybeDm === 'function') douyinSocial.maybeDm(x); }, // FS-DM-tick 顺手问她要不要主动给互关的人发一句", u: null },
      { t: "配置 schema 加 dm", f: "config-platforms.js", p: "FS-DM-schema", u: null },
      { t: "设置页状态回显 dm（含候选名单与已选人）", f: "routes-douyin.js", p: "dm: { enabled: d.dm?.enabled === true,", u: null },
      { t: "保存设置带 dm（含 targets 校验）", f: "routes-douyin.js", p: "enabled: body.dm?.enabled === undefined ? cur.dm?.enabled === true : body.dm.enabled === true,", u: null },
      { t: "新路由 /douyin/dm-now", f: "routes-douyin.js", p: "if (typeof douyinSocial.dmNow !== 'function') { send(200, { ok: false, error: '抖音模块里没有主动私信（补丁没打全）' }); return true; }", u: null },
      { t: "表单初值加 dmPerDay/dmCoolDays", f: "client.douyin.js", p: "postPerDay: d.post?.perDay ?? 1, commentsPerHour: d.comments?.perHour ?? 4,", u: null },
      { t: "取出 dm 状态", f: "client.douyin.js", p: "const dmc = d.dm ?? {}; // FS-DM-var", u: null },
      { t: "保存时带上 dm", f: "client.douyin.js", p: "FS-DM-saveui", u: null },
      { t: "主动私信走会话：triggerDouyinProactive + 这一轮发出没记到 st", f: "gateway.js", p: "async triggerDouyinProactive(name, hint)", u: null },
      { t: "设置页加「主动私信」分组（拉名单 / 点选人 / 一天几次 / 隔几小时）", f: "client.douyin.js", p: "dmc.enabled ? Row({ title: \"要发给谁\"", u: null },
    ]
  },
  {
    key: "P6",
    name: "刷到的视频发卡片（不是发链接）",
    // 上游 0.15.36 自己做了「刷到的视频 → 抖音原生卡片私信」：life.js 里出现 share.intent 就整组退役
    upstream: { f: "life.js", p: "share.intent." },
    items: [
      { t: "douyin-social 引入 shareBrowsedVideo", f: "douyin-social.js", p: "shareBrowsedVideo } from './douyin-proactive.js';", u: null },
      { t: "douyin-social 加 dmShareBrowsed", f: "douyin-social.js", p: "dmShareBrowsed(opts) {", u: null },
      { t: "index.js：刷到的分享改发抖音私信卡片", f: "index.js", p: "douyinShareCard: (card) => (typeof douyinSocial.dmShareBrowsed", u: null },
      { t: "life.js 接 douyinShareCard", f: "life.js", p: "this.douyinShareCard = typeof opts.douyinShareCard", u: null },
      { t: "queueShare 收下 videoId", f: "life.js", p: "queueShare({ platform, title, author, url, impression, videoId }) {", u: null },
      { t: "刷到的分享存成卡片信息", f: "life.js", p: "function parseShareCard(reason) {", u: null },
      { t: "deliverOne 先发卡片，卡片不通退回发链接", f: "life.js", p: "[FS-SHARE-CARD] 刷到的分享先发视频卡片", u: null },
      { t: "douyin-browse 把视频 id 一起交上去", f: "douyin-browse.js", p: "afterRound(this, '抖音', watched, (w) => ({ title: w.title, author: w.author, videoId: w.id }))", u: null },
      { t: "主动私信分享：从她选的几类里挑一个来搜", f: "douyin-proactive.js", p: "[FS-DM-SHARE-ONE-TYPE]", u: null },
      { t: "刷到的分享：只发刚刷到的那条，不按类型搜", f: "douyin-proactive.js", p: "[FS-SHARE-ONLY-BROWSED]", u: null },
    ]
  },
  {
    key: "P7",
    name: "微信（WechatAgent）↔ 人格记忆互通",
    items: [
      { t: "chat-archive：通道归一化（wechat:private / wechat:group）", f: "chat-archive.js", p: "function normalizeArchiveChannel(channel) {", u: null },
      { t: "chat-archive：外部桥接写入 append()", f: "chat-archive.js", p: "append({ channel = '', who = '', self = false, content = '', at = 0 } = {}) {", u: null },
      { t: "chat-archive：跨渠道读取 recent()", f: "chat-archive.js", p: "recent({ channel = '', limit = 20, before = 0 } = {}) {", u: null },
      { t: "chat-archive：取样 sample() 也按归一化通道查", f: "chat-archive.js", p: "const rows = ch !== ''", u: null },
      { t: "db：新增 person_wechat_alias 表（微信 id → canonical_id）", f: "db.js", p: "CREATE TABLE IF NOT EXISTS person_wechat_alias (", u: null },
      { t: "db：老库启动补建微信别名表 + 唯一索引", f: "db.js", p: "老库靠这里补表", u: null },
      { t: "db：微信认人（canonicalOfWechat / findPersonByWechat / resolveOrCreateWechatPerson）", f: "db.js", p: "export function resolveOrCreateWechatPerson", u: null },
      { t: "gateway-util：微信通道判定 wechatKindOf / isWechatChannelId", f: "gateway-util.js", p: "export function wechatKindOf", u: null },
      { t: "gateway-util：通道种类识别加微信（wechat-private / wechat-group）", f: "gateway-util.js", p: "wechatKindOf(channelId) === 'group' ? 'wechat-group' : 'wechat-private'", u: null },
      { t: "gateway-util：微信私聊 / 微信群中文名与群主归一口径", f: "gateway-util.js", p: "if (kind === 'wechat-private') return '微信私聊';", u: null },
      { t: "gateway：微信私聊 / 微信群不并进 QQ 会话（只共享人格与记忆）", f: "gateway.js", p: "if (platformOf(chat?.channelId) === 'wechat') return chat;", u: null },
      { t: "index.js：引入微信认人 API", f: "index.js", p: "resolveOrCreateBiliPerson, resolveOrCreateWechatPerson,", u: null },
      { t: "index.js：微信通道取人 / 群 id", f: "index.js", p: "function wechatIdOfChannel(channelId) {", u: null },
      { t: "index.js：重启重建会话时按平台认人", f: "index.js", p: "const personId = platform === 'wechat' ? wechatIdOfChannel(row.channel_id) : id;", u: null },
      { t: "index.js：入站消息按微信渠道认人（没登记就建 person + 补别名）", f: "index.js", p: "if (platformOf(m?.channelId) === 'wechat') {", u: null },
      { t: "life：主动开口的冷却 / 配额把微信算独立平台", f: "life.js", p: "s.startsWith('wechat-group:')) return 'wechat';", u: null },
      { t: "聊天存档接口：新增 /chat-archive/recent", f: "routes-soul.js", p: "if(path === '/chat-archive/recent' && method === 'GET') {", u: null },
      { t: "聊天存档接口：新增 /chat-archive/append", f: "routes-soul.js", p: "if(path === '/chat-archive/append' && post) {", u: null },
      { t: "聊天存档设置：通道白名单认微信写法", f: "routes-soul.js", p: "wechat:(?:private|group)", u: null },
      { t: "slang：引入微信 / QQ 认人 API", f: "slang.js", p: "canonicalOfWechat, findPersonByQq } from './db.js';", u: null },
      { t: "slang：私聊跨渠道共桶 slangBucket()", f: "slang.js", p: "export function slangBucket(db, channelId) {", u: null },
      { t: "slang：学到 / 合并 / 导入都写进共桶", f: "slang.js", p: "slangBucket(this.db, channelId)}`, d);", u: null },
      { t: "soul-memory：记忆卡片 / 联系人清单的通道种类认得出微信", f: "soul-memory.js", p: "const isWechat = channelId.startsWith('wechat:')", u: null },
    ]
  },
  {
    key: "P8",
    name: "微信表情动图（微信只认 GIF，静态图发过去一定不动）",
    items: [
      { t: "config-schema：新增 wechat 配置块（含表情动图两项）", f: "config-schema.js", p: "\t\t\tstickerAnimatedStrict: z.boolean().default(false), // 挑不到动图就不发这张（宁可没有也不发静态）", u: null },
      { t: "gateway：新增 wechatStickerPrefs()（读微信表情动图偏好）", f: "gateway.js", p: "\t/** 微信表情偏好：微信只认 GIF 动图，静态图发过去一定不动（平台 → 微信 → 表情）[FS-WECHAT-PANE] */", u: null },
      { t: "gateway：微信出站按描述挑表情时透传动图偏好", f: "gateway.js", p: "\t\t\t\tconst tagged = await this.stickers?.resolveMemeTags(feelText, row.workspace_path, this.embedder, { model: this.embeddingModel(), ...stickerPrefs })", u: null },
      { t: "gateway：微信出站按感觉挑表情时也透传动图偏好", f: "gateway.js", p: "\t\t\t\tconst r = await this.stickers?.resolveFeelRefs(feelText, row.workspace_path, this.embedder, { model: this.embeddingModel(), ...stickerPrefs }) ?? { text: feelText, resolved: [] };", u: null },
      { t: "stickers：resolveFeelRefs 收 animatedFirst / animatedStrict", f: "stickers.js", p: "\tasync resolveFeelRefs(text, workspacePath, embedder, { model = '', animatedFirst = false, animatedStrict = false } = {}) {", u: null },
      { t: "stickers：resolveFeelRefs 把动图偏好传给 pickByFeel", f: "stickers.js", p: "\t\t\tconst r = await this.pickByFeel(workspacePath, one.feel, embedder, { model, top: 5, animatedFirst, animatedStrict });", u: null },
      { t: "stickers：pickByFeel 收 animatedFirst / animatedStrict", f: "stickers.js", p: "\tasync pickByFeel(workspacePath, feel, embedder, { model = '', avoid = [], top = 5, animatedFirst = false, animatedStrict = false } = {}) {", u: null },
      { t: "stickers：pickByFeel 动图排前面 + 严格模式挑不到就不发", f: "stickers.js", p: "\t\t\t\t\tconst ordered = wantAnim ? [...ranked].sort((a, b) => (isGif(b.file) ? 1 : 0) - (isGif(a.file) ? 1 : 0)) : ranked;", u: null },
      { t: "stickers：resolveMemeTags 收 animatedFirst / animatedStrict", f: "stickers.js", p: "\tasync resolveMemeTags(text, workspacePath, embedder, { model = '', max = 2, animatedFirst = false, animatedStrict = false } = {}) {", u: null },
      { t: "stickers：resolveMemeTags 按描述挑图时带上动图偏好", f: "stickers.js", p: "\t\t\tresolved.push({ desc, file: r.ok ? r.file : null, fromMeme: r.fromMeme === true, animated: r.animated === true, reason: r.ok ? null : (r.reason ?? null) });", u: null },
      { t: "stickers：pickFromMeme 借 dsh-meme 时也先挑 GIF", f: "stickers.js", p: "\tasync pickFromMeme(feel, avoid = [], { animatedFirst = false, animatedStrict = false } = {}) {", u: null },
      { t: "stickers：挑图结果带 animated 标记", f: "stickers.js", p: "\t\t\t\tanimated: r.animated === true,", u: null },
      { t: "meme-bridge：入参说明补动图两项", f: "meme-bridge.js", p: "\t * @returns {Promise<{ok: boolean, path?: string, sourcePath?: string, tag?: string, caption?: string, packName?: string, label?: string, animated?: boolean, viaPool?: boolean, reason?: string}>}", u: null },
      { t: "meme-bridge：加 isGif / usable 判定", f: "meme-bridge.js", p: "\t\tconst isGif = (p) => extname(String(p ?? '')).toLowerCase() === '.gif';", u: null },
      { t: "meme-bridge：要动图时多拉候选，GIF 优先、严格模式不回退", f: "meme-bridge.js", p: "const gif = memes.find((m) => usable(m) && isGif(m.path));", u: null },
      { t: "meme-bridge：返回 animated 标记", f: "meme-bridge.js", p: "\t\t\t\tanimated: isGif(hit.path),", u: null },
      { t: "routes：新增 wechatState()（微信配置回显）", f: "routes.js", p: "\t\tconst list = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);", u: null },
      { t: "/channels/state 回显里加 wechat", f: "routes.js", p: "\t\t\t\t\t\twechat: wechatState(),", u: null },
      { t: "routes：新增 POST /channels/wechat-config（只存 soul 侧微信设置）", f: "routes.js", p: "\t\t\t\t\tconst list = (v, fallback) => (v === undefined ? (Array.isArray(fallback) ? fallback : []) : (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean));", u: null },
      { t: "client：页签短名与子页签加「微信」", f: "client.js", p: "\t\tconst TAB_KEYS = { memory: \"忆\", character: \"角\", daily: \"常\", channels: \"台\", models: \"模\", system: \"统\", guide: \"引\", retrieval: \"索\", persona: \"人\", life: \"自\", inspector: \"忆\", activity: \"动\", behavior: \"习\", qq: \"Q\", bili: \"B\", douyin: \"抖\", wechat: \"微\", version: \"版\", diag: \"志\" };", u: null },
      { t: "client：微信子页签也走 channels 轮询", f: "client.js", p: "\t\t\t\tconst fn = subtab === \"retrieval\" ? loadRetrieval : subtab === \"qq\" || subtab === \"bili\" || subtab === \"douyin\" || subtab === \"wechat\" ? loadChannels : null;", u: null },
      { t: "client：微信子页签渲染 WechatPane", f: "client.js", p: "\t\t\t\t: subtab === \"wechat\" ? h(ChunkTab, { file: \"client.wechat.js\", pick: (m) => m.WechatPane, failText: \"微信页加载失败\", data: channels, refresh: loadChannels, notify })", u: null },
    ]
  },
];


const readText = (path) => {
	try { return readFileSync(path, 'utf8'); } catch { return null; }
};

/** 上游自己把这处做掉之后，补丁就该退役：present=出现即算上游已做；absent=消失即算上游已做。 */
function upstreamTook(h, text) {
	const u = h.u;
	if (!u || text === null) return false;
	if (typeof u.present === 'string' && text.includes(u.present)) return true;
	if (typeof u.absent === 'string' && !text.includes(u.absent)) return true;
	return false;
}

/** 逐处核对补丁：patched 已打 / upstream 上游已接管 / todo 没打 / missing 文件不在。 */
export function patchedGroups() {
	const cache = new Map();
	const groups = PATCH_GROUPS.map((g) => {
		// 整组退役：上游自己把这套活干完了（g.upstream 指的那个文件里出现了这段），组内每处都算「上游已接管」
		const groupUpstream = g.upstream
			? (() => {
				if (!cache.has(g.upstream.f)) cache.set(g.upstream.f, readText(join(LIB_DIR, g.upstream.f)));
				const gt = cache.get(g.upstream.f);
				return gt !== null && gt.includes(g.upstream.p);
			})()
			: false;
		const items = g.items.map((h) => {
			if (!cache.has(h.f)) cache.set(h.f, readText(join(LIB_DIR, h.f)));
			const text = cache.get(h.f);
			let state;
			if (text === null) state = 'missing';
			else if (groupUpstream) state = 'upstream';
			else if (text.includes(h.p)) state = 'patched';
			else if (upstreamTook(h, text)) state = 'upstream';
			else state = 'todo';
			return { title: h.t, file: h.f, state };
		});
		return {
			key: g.key,
			name: g.name,
			done: items.filter((x) => x.state === 'patched').length,
			retired: items.filter((x) => x.state === 'upstream').length,
			total: items.length,
			items
		};
	});
	const all = groups.flatMap((g) => g.items);
	const self = readJson(join(SELF_DIR, 'package.json')) ?? {};
	return {
		plugin: self.name ?? 'dsh-fish-soul',
		version: self.version ?? '',
		groups,
		done: all.filter((x) => x.state === 'patched').length,
		retired: all.filter((x) => x.state === 'upstream').length,
		todo: all.filter((x) => x.state === 'todo').length,
		total: all.length
	};
}


const readJson = (path) => {
	try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
};

/**
 * 本插件所在的 profile 目录（含 package.json 的那层）。
 * 正常是 <profile>/node_modules/dsh-fish-soul/lib → 上两级；pnpm 之类把插件落在别处时，
 * 退回到 ~/.dsh/profiles 下按「谁的依赖里有我」认领。
 */
function findProfile() {
	const near = resolve(SELF_DIR, '..', '..');
	if (readJson(join(near, 'package.json')) !== null) return near;
	const self = readJson(join(SELF_DIR, 'package.json')) ?? {};
	const base = join(homedir(), '.dsh', 'profiles');
	let dirs = [];
	try { dirs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(base, d.name)); } catch { return null; }
	const owners = [];
	for (const dir of dirs) {
		const pkg = readJson(join(dir, 'package.json'));
		if (!pkg?.dependencies || typeof pkg.dependencies[self.name] !== 'string') continue;
		owners.push({ dir, exact: pkg.dependencies[self.name] === self.version });
	}
	owners.sort((a, b) => Number(b.exact) - Number(a.exact));
	return owners[0]?.dir ?? null;
}

/** 装的来源：官方内置 / 本地链接（自己写的、打包进 profile 的）/ 社区 npm 包。 */
function kindOf(name, declared) {
	if (String(declared).startsWith('link:') || String(declared).startsWith('file:')) return 'local';
	if (name.startsWith('@deepseek-ai/')) return 'official';
	return 'third';
}

/** DSH 侧插件：只读汇总，不联网，只读 profile 的 package.json 与各插件自己的 package.json。 */
export function installedPlugins() {
	const profileDir = findProfile();
	if (profileDir === null) return { ok: false, error: '找不到 DSH 的 profile 目录' };
	const profilePkg = readJson(join(profileDir, 'package.json')) ?? {};
	const self = readJson(join(SELF_DIR, 'package.json')) ?? {};
	const deps = profilePkg.dependencies && typeof profilePkg.dependencies === 'object' ? profilePkg.dependencies : {};
	const bundles = Array.isArray(profilePkg?.dsh?.profile?.bundles) ? profilePkg.dsh.profile.bundles : [];
	const pluginsRoot = join(profileDir, 'node_modules');
	const list = [];
	for (const [name, declared] of Object.entries(deps)) {
		const pkgPath = join(pluginsRoot, ...String(name).split('/'), 'package.json');
		const pkg = existsSync(pkgPath) ? readJson(pkgPath) : null;
		list.push({
			name,
			version: pkg?.version ?? '',
			declared: String(declared),
			kind: kindOf(name, declared),
			// bundles 里列着才算真被宿主加载；只写进 dependencies 的是装了没启用
			enabled: bundles.includes(name),
			self: name === (self.name ?? 'dsh-fish-soul'),
			description: typeof pkg?.description === 'string' ? pkg.description : ''
		});
	}
	list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
	const enabled = list.filter((x) => x.enabled).length;
	return {
		ok: true,
		profile: basename(profileDir),
		self: self.name ?? 'dsh-fish-soul',
		total: list.length,
		enabled,
		plugins: list,
		// 「个人插件」指的是本插件上自己打的补丁，不是上面这份 DSH 插件清单
		personal: patchedGroups()
	};
}

/**
 * GET /plugins/installed
 */
export async function handlePluginsRoute({ method, path, req, send, sameOrigin }) {
	if (!String(path).startsWith('/plugins/')) return false;
	if (method === 'GET' && path === '/plugins/installed') {
		if (!sameOrigin(req)) { send(403, { ok: false, error: 'forbidden' }); return true; }
		try { send(200, installedPlugins()); }
		catch (error) { send(500, { ok: false, error: String(error instanceof Error ? error.message : error) }); }
		return true;
	}
	return false;
}
