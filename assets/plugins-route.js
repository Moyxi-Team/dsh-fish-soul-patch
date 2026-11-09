/**
 * routes-plugins.js —— 系统设置 → 个人插件：
 *   GET /plugins/installed
 *     ① personal：这个插件（dsh-fish-soul）身上自己打的补丁打没打上（读 lib 下文件里的标记，不联网）
 *     ② plugins ：本机这个 profile 里装着的 DSH 插件（名字 / 版本 / 来源 / 是否启用），只作对照
 * 只读：不装、不卸、不发网络请求，也不改任何插件的配置。
 *
 * [FS-PLUGINS-ROUTE v2] ← 这个版本戳给 patch-fish-soul.mjs 认：老版本的这份文件会被自动顶掉
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
      { t: "client：表情包设置页加开关", f: "client.js", p: "借 dsh-meme 的表情库", u: null },
    ]
  },
  {
    key: "P2",
    name: "抖音：回评论发不出 / 图文无 BGM",
    items: [
      { t: "评论区状态按可见性判定（折叠态不再误判为已打开）", f: "douyin-social.js", p: "const vis = (x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; };", u: {"present": "itemsVisible"} },
      { t: "作品详情页只走 note/video 直链 + 点右侧「评论(n)」Tab", f: "douyin-social.js", p: "return r.width && r.height && r.top >= 0 && r.bottom <= innerHeight ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;", u: {"absent": "modal_id"} },
      { t: "回复只在可见评论条目里找并用真实鼠标点击", f: "douyin-social.js", p: "await br.eval(`(() => { for (const el of document.querySelectorAll('[data-fish-reply]')) el.removeAttribute('data-fish-reply'); return true; })()`).catch(() => {});", u: {"present": "const pool = shown.length ? shown : all;"} },
      { t: "BGM 抓取留痕 + 挑歌兜底（滤掉非歌曲条目）", f: "douyin-social.js", p: "setKv(this.db, 'douyin.music.last', { at: Date.now(), songs: songs.slice(0, 5), song: song || '', picked: res?.musicPicked === true });", u: {"present": "douyin.music.last"} },
    ]
  },
  {
    key: "P3",
    name: "热更新后人格卡 + 记忆块掉线",
    items: [
      { t: "自家会话每条消息补挂人格段（热更新后人格卡 + 记忆块不再掉线）", f: "index.js", p: "if (gateway?.isOurSession(agentId) === true) mountSectionsFor(payload?.agent);", u: {"present": "gateway?.isOurSession(agentId) === true) mountSectionsFor"} },
      { t: "sectionsMounted 从 Set 改 Map（换 ctx 才重挂，同一 ctx 不重复注册）", f: "index.js", p: "if (id === '' || agent?.ctx === undefined || sectionsMounted.get(id) === agent.ctx) return;", u: {"present": "sectionsMounted.get(id) === agent.ctx"} },
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
      { t: "import 主动私信模块", f: "douyin-social.js", p: "import { dmCfg, maybeSendProactive, proactiveStatus, sendProactiveNow } from './douyin-proactive.js';", u: null },
      { t: "加 maybeDm / dmNow，status 带 dm", f: "douyin-social.js", p: "return { ...super.status(), blockedUntil: this.blockedUntil > Date.now() ? this.blockedUntil : 0, dm: proactiveStatus(this) };", u: null },
      { t: "自走层 tick 里问一次要不要主动发", f: "index.js", p: "social: (x) => { biliSocial.maybePost(x); douyinSocial.maybePost(x); if (typeof douyinSocial.maybeDm === 'function') douyinSocial.maybeDm(x); }, // FS-DM-tick 顺手问她要不要主动给互关的人发一句", u: null },
      { t: "配置 schema 加 dm", f: "config-platforms.js", p: "// FS-DM-schema：主动给「互相关注」的人发私信（默认关；一天最多几个 + 同一个人隔几天 + 最快几小时一条）", u: null },
      { t: "设置页状态回显 dm", f: "routes-douyin.js", p: "dm: { enabled: d.dm?.enabled === true, perDay: d.dm?.perDay ?? 1, coolDays: d.dm?.coolDays ?? 7, minGapHours: d.dm?.minGapHours ?? 3, ...(douyinSocial?.status()?.dm ?? {}) },", u: null },
      { t: "保存设置带 dm", f: "routes-douyin.js", p: "enabled: body.dm?.enabled === undefined ? cur.dm?.enabled === true : body.dm.enabled === true,", u: null },
      { t: "新路由 /douyin/dm-now", f: "routes-douyin.js", p: "if (typeof douyinSocial.dmNow !== 'function') { send(200, { ok: false, error: '抖音模块里没有主动私信（补丁没打全）' }); return true; }", u: null },
      { t: "表单初值加 dmPerDay/dmCoolDays", f: "client.douyin.js", p: "postPerDay: d.post?.perDay ?? 1, commentsPerHour: d.comments?.perHour ?? 4,", u: null },
      { t: "取出 dm 状态", f: "client.douyin.js", p: "const dmc = d.dm ?? {}; // FS-DM-var", u: null },
      { t: "保存时带上 dm", f: "client.douyin.js", p: "dm: { perDay: Number(form.dmPerDay), coolDays: Number(form.dmCoolDays), ...(p.dm ?? {}) } // FS-DM-saveui", u: null },
      { t: "设置页加「主动私信」分组", f: "client.douyin.js", p: "dmc.enabled ? Row({ title: \"互关的人\", desc: dmSo.mutualCount ? `${dmSo.mutualCount} 个，名单是 ${relTime(dmSo.mutualAt || Date.now(), Date.now())}抓的` : \"还没抓过名单，发第一条时会自己去关注页读（读完缓存 6 小时）\" }) : null,", u: null },
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
		const items = g.items.map((h) => {
			if (!cache.has(h.f)) cache.set(h.f, readText(join(LIB_DIR, h.f)));
			const text = cache.get(h.f);
			let state;
			if (text === null) state = 'missing';
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
