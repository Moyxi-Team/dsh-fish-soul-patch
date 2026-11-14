/**
 * meme-bridge.js —— 借 dsh-meme 的「只读取图服务」（`ctx.get('dshMeme')`）给自己的表情包兜底。
 *
 * [FS-MEME-BRIDGE-PATCH] 本文件由 dsh-fish-soul-patch 的补丁脚本生成，插件升级后重跑脚本即可。
 *
 * 为什么需要：她自己的表情都放在会话工作区的 `_stickers/` 里，刚装好时是空的，
 * 或者只是想发某种感觉而库里没有合适的——这时候她只能干发文字。而本机的 dsh-meme
 * 已经维护着几百张带情绪标签的图，并在 README 里明确给了同进程插件可用的只读接口
 * （packs / search / pick，契约 version 1）。
 *
 * 只读：绝不写 dsh-meme 的图库、不改它的配置、不占它的收藏额度、不发图。
 * 唯一的写盘动作是把挑中的那张复制一份到 `~/.dsh/fish-soul/meme-cache/`：
 * ① 网关只允许发「工作区 / fish-soul 数据目录」里的图（见 gateway-media.resolveImageFile），
 *    直接拿图库路径会被拒；② 图库文件名里带空格时，`![x](路径)` 的 markdown 解析会把路径截断，
 *    缓存文件名是 sha1，不会有这个问题。
 *
 * [FS-WECHAT-STICKER-ANIM] 微信只认 GIF 动图，而 dsh-meme 的 GIF 占比不到 2%（11/624），
 * 契约里的 search 又把 limit 卡在 30 条、按相关度取——想靠「搜出来的前 30 条里碰上一张 GIF」
 * 基本等于不发动图。所以这里补两件事：
 *   ① gifPool()：只读扫一遍各图库的 memes/<tag>/ 目录，把 .gif 单独编成一份小池子（5 分钟缓存）；
 *   ② 要动图时先搜（语义优先），搜不到再从 gifPool 里按情绪桶 + 词面重叠挑一张真的动图。
 * 剩下唯一会退回静态图的情况是：图库里一张 GIF 都没有（这时 strict 就干脆不发）。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fishSoulDir } from './db.js';

// ─────────────────────── [FS-MEME-PARITY] 与 dsh-meme 前端同一套配图规则 ───────────────────────
// 要解决的问题：同一句回复里带 `[表情: 描述]`，DSH 会话里显示的那张是 dsh-meme **前端**配的，
// 真正发到 QQ / 微信 / 抖音的那张是这里挑的 —— 两套规则各挑各的，主人就会看到「显示的」和
// 「对方收到的」不是同一张。这里改成：出站也走前端那一套（caption 精确 → 关键词精确 → 分词包含），
// 同一批 row、同一个顺序、不随机、不掺本地收藏，于是两端必然同图。
// 语料来源：直接只读各图库的 index.db（和前端 `/dsh-memes-api?packId=all` 是同一份数据）。
// 读不到（没装 dsh-meme / 运行时没有 node:sqlite / 图库还没建索引）就返回 unavailable，
// 由调用方退回原来的语义检索，不至于因为一致性改造把表情功能整个弄挂。
const nodeRequire = createRequire(import.meta.url);
const PARITY_TTL_MS = 5 * 60_000;
const PARITY_ROWS_SQL = "SELECT path, tag, file_name, caption, COALESCE(keywords, '') AS keywords FROM memes";

// 下面这 7 个函数逐字照抄 dsh-meme 的 client.js（foldCaption / looseCaption / splitDescTokens /
// addIndexKey / buildMemeIndex / buildMemeSearch / matchDesc），只把「行 → URL」换成「行 → 磁盘绝对路径」。
// 上游改版时这几个函数可能跟着变，那时两端就会重新不一致 —— 所以升级 dsh-meme 后要回来对一遍。
const foldCaption = (s) => String(s || '').trim()
	.replace(/[\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f«»]/g, '"')
	.replace(/\s+/g, ' ');
const looseCaption = (s) => foldCaption(s).replace(/["'\s]/g, '');
const splitDescTokens = (s) => foldCaption(s).split(/[\s,.!?;:、，。！？；：""''()（）\[\]【】《》…·～~\-]+/)
	.map((t) => t.replace(/["']/g, ''))
	.filter((t) => t.length >= 2)
	.sort((a, b) => b.length - a.length);
const addIndexKey = (map, key, abs) => {
	const raw = String(key || '').trim();
	if (!raw) return;
	for (const form of new Set([raw, foldCaption(raw), looseCaption(raw)])) {
		if (form && !map.has(form)) map.set(form, abs);
	}
};
const buildMemeIndex = (rows) => {
	const captions = new Map();
	const keywords = new Map();
	for (const row of rows || []) {
		const abs = row.abs;
		addIndexKey(captions, row.caption, abs);
		addIndexKey(captions, row.file_name, abs);
		addIndexKey(captions, String(row.caption || '').slice(0, 80), abs);
		addIndexKey(captions, String(row.caption || '').slice(0, 100), abs);
		const kw = String(row.keywords || '');
		addIndexKey(keywords, kw, abs);
		for (const word of kw.split(/\s+/)) addIndexKey(keywords, word, abs);
	}
	return { caption: captions, keyword: keywords };
};
const buildMemeSearch = (rows) => (rows || []).map((row) => {
	const hay = [];
	const parts = [];
	for (const s of [row.caption, row.keywords, row.file_name]) {
		const f = foldCaption(s);
		if (!f) continue;
		const l = looseCaption(s);
		hay.push(f, ...(l && l !== f ? [l] : []));
		parts.push(s);
	}
	const tokens = [...new Set(splitDescTokens(parts.join(' ')))];
	return { hay, tokens, abs: row.abs };
});
const matchDesc = (desc, index, search) => {
	const captionIndex = index && typeof index.get === 'function'
		? index
		: (index && index.caption && typeof index.caption.get === 'function' ? index.caption : null);
	const keywordIndex = index && index.keyword && typeof index.keyword.get === 'function' ? index.keyword : null;
	const raw = String(desc || '').trim();
	const forms = [raw, foldCaption(raw), looseCaption(raw)];
	for (const map of [captionIndex, keywordIndex]) {
		if (!map) continue;
		for (const form of forms) {
			const exact = map.get(form);
			if (exact) return exact;
		}
	}
	const needles = [...new Set(splitDescTokens(desc).map(looseCaption).filter(Boolean))];
	let best = null;
	let bestLength = 0;
	let bestCount = 0;
	for (const row of search || []) {
		let longest = 0;
		let count = 0;
		for (const needle of needles) {
			let length = row.hay.some((hay) => hay.includes(needle)) ? needle.length : 0;
			for (const token of row.tokens || []) {
				const t = looseCaption(token);
				if (t && (needle.includes(t) || t.includes(needle))) length = Math.max(length, Math.min(needle.length, t.length));
			}
			if (length) { longest = Math.max(longest, length); count++; }
		}
		if (longest > bestLength || (longest === bestLength && count > bestCount)) {
			best = row.abs;
			bestLength = longest;
			bestCount = count;
		}
	}
	return best;
};

let parityCache = { at: 0, sig: '', corpus: null };

/** dsh-meme 的安装目录（拿它的内置图库）。装成插件时就是 node_modules/dsh-meme。 */
function memePackageDir() {
	try { return dirname(nodeRequire.resolve('dsh-meme/package.json')); } catch { return ''; }
}

/**
 * 图库根目录清单，顺序对齐前端 listAllPacks()：内置图库 → 用户导入的 → memeRoot。
 * 只认「目录里真有 index.db」的，坏库/空目录直接跳过。
 */
function parityPackRoots() {
	const roots = [];
	const push = (dir) => {
		try {
			if (dir !== '' && statSync(dir).isDirectory() && existsSync(join(dir, 'index.db')) && !roots.includes(dir)) roots.push(dir);
		} catch { /* 读不到就当没这个库 */ }
	};
	const pkg = memePackageDir();
	const bundled = pkg === '' ? '' : join(pkg, 'memes');
	if (bundled !== '') {
		try { for (const name of readdirSync(bundled).sort()) push(join(bundled, name)); } catch { /* 没有内置图库 */ }
	}
	const home = process.env.DSH_MEME_HOME || homedir();
	let settings = {};
	try { settings = JSON.parse(readFileSync(join(home, '.dsh', 'dsh-expression.json'), 'utf8')) || {}; } catch { settings = {}; }
	const packsDir = typeof settings.packsDir === 'string' && settings.packsDir !== '' ? settings.packsDir : join(home, '.dsh', 'meme-packs');
	try {
		for (const name of readdirSync(packsDir).sort()) {
			if (name.startsWith('.')) continue;
			push(join(packsDir, name));
		}
	} catch { /* 主人没导入过图库 */ }
	if (typeof settings.memeRoot === 'string' && settings.memeRoot !== '') push(settings.memeRoot);
	else if (bundled !== '') push(join(bundled, 'dafeiyu-001'));
	return roots;
}

/** 读全部图库的索引行 → 建两份索引（和前端同一个 buildMemeIndex / buildMemeSearch）。5 分钟缓存。 */
function parityCorpus() {
	const roots = parityPackRoots();
	if (roots.length === 0) return null;
	const sig = roots.join('|');
	if (parityCache.corpus && parityCache.sig === sig && Date.now() - parityCache.at < PARITY_TTL_MS) return parityCache.corpus;
	let DatabaseSync = null;
	try { ({ DatabaseSync } = nodeRequire('node:sqlite')); } catch { return null; }
	const rows = [];
	for (const root of roots) {
		let db = null;
		try {
			try { db = new DatabaseSync(join(root, 'index.db'), { readOnly: true }); } catch { db = new DatabaseSync(join(root, 'index.db')); }
			for (const row of db.prepare(PARITY_ROWS_SQL).all()) {
				const abs = join(root, String(row.path ?? ''));
				if (existsSync(abs)) rows.push({ ...row, abs, root });
			}
		} catch { /* 坏库跳过 */ } finally { try { if (db) db.close(); } catch { /* 已经关了 */ } }
	}
	if (rows.length === 0) return null;
	const corpus = { index: buildMemeIndex(rows), search: buildMemeSearch(rows), total: rows.length };
	parityCache = { at: Date.now(), sig, corpus };
	return corpus;
}

/**
 * 前端同款匹配：给一句描述，回它在 DSH 会话里会被配上的是哪张。
 * @returns {{ok: boolean, path?: string, animated?: boolean, unavailable?: boolean, reason?: string}}
 */
function pickByFrontendDesc(desc) {
	const want = String(desc ?? '').trim();
	if (want === '') return { ok: false, reason: '没写要什么表情' };
	const corpus = parityCorpus();
	if (!corpus) return { ok: false, unavailable: true, reason: '读不到 dsh-meme 的图库索引' };
	const hit = matchDesc(want, corpus.index, corpus.search);
	if (!hit) return { ok: false, reason: '图库里没有对得上「' + want + '」的表情' };
	return { ok: true, path: hit, animated: extname(hit).toLowerCase() === '.gif' };
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
/** 缓存目录最多留多少张（超过就按最后访问时间删最旧的）。 */
const CACHE_MAX = 300;
/** 图库有多少张、能不能用：问一次缓存一分钟，别每轮都去翻磁盘。 */
const STATUS_TTL_MS = 60_000;
/** 动图池扫盘代价比问接口大，缓存五分钟。 */
const GIF_POOL_TTL_MS = 5 * 60_000;
/** 拿不到服务时，一分钟内不再试（免得日志刷屏）。 */
const RETRY_MS = 60_000;
const CACHE_DIR = () => join(fishSoulDir(), 'meme-cache');

/** 感觉词 → dsh-meme 的 6 个情绪桶（和它的 MOOD_WORDS 大致对齐；认不出来就只传关键词让它自己搜）。 */
const MOOD_WORDS = {
	happy: ['开心', '高兴', '兴奋', '喜欢', '卖萌', '可爱', '比心', '哈哈', '欢迎', '得意', '好耶', '满意', '笑', '赞', '喜欢', '爱心', '啵', '亲亲'],
	angry: ['生气', '愤怒', '暴躁', '嫌弃', '凶', '哼', '不爽', '气'],
	sad: ['难过', '哭', '委屈', '叹气', '无语', '可怜', '失落', '伤心', '眼泪'],
	shy: ['害羞', '脸红', '腼腆', '不好意思', '羞', '撒娇'],
	confused: ['困惑', '疑惑', '惊讶', '问号', '懵', '震惊', '啊这', '好奇', '吃惊', '震惊'],
	daily: ['困', '睡觉', '早上好', '你好', '上班', '下班', '摸鱼', '熬夜', '吃饭', '饿', '日常', '无聊', '加油', '晚安']
};

/**
 * 情绪桶 → dsh-meme 磁盘上的细 tag（和它 memes.js 里的 MOODS 一致）。
 * 动图池是按目录名（细 tag）扫出来的，挑的时候要先摊平到细 tag 才排得上用。
 */
const MOOD_FINE = {
	happy: ['happy', 'like', 'meow', 'givemoney', 'color'],
	angry: ['angry', 'fool', 'baka'],
	sad: ['sad', 'sigh'],
	shy: ['shy'],
	confused: ['confused', 'surprised', 'see'],
	daily: ['daily', 'sleep', 'morning', 'work', 'cpu', 'reply']
};

/**
 * 「得意」→ happy，「无语」→ sad…… 认不出来返回 ''（那就只按关键词搜）。
 * @returns {string} happy | angry | sad | shy | confused | daily | ''
 */
export function moodOfFeel(feel) {
	const text = String(feel ?? '').trim();
	if (text === '') return '';
	const lower = text.toLowerCase();
	if (MOOD_WORDS[lower]) return lower;
	for (const [mood, words] of Object.entries(MOOD_WORDS)) {
		if (words.some((w) => text.includes(w))) return mood;
	}
	return '';
}

/**
 * @param {object} deps
 * @param {any} deps.ctx 插件的 ctx（用它 `get('dshMeme')` 拿服务；拿不到就整个降级）
 * @param {(level: string, msg: string) => void} [deps.log]
 * @param {() => boolean} [deps.canConvertWebp] webp 发不出去时（没 sharp / 没抖音浏览器）跳过 webp 图
 */
export function createMemeBridge({ ctx, log = () => {}, canConvertWebp = () => true } = {}) {
	let serviceCache = null;
	let failedAt = 0;
	let statusCache = null;
	let gifCache = null;
	const warns = new Set();

	const warn = (msg) => {
		if (warns.has(msg)) return;
		warns.add(msg);
		try { log('warn', msg); } catch { /* 日志失败不影响发图 */ }
	};

	/** 同进程的 dsh-meme 服务（它可能在 fish-soul 之后才 provide，所以每次都要现取一次）。 */
	function service() {
		if (serviceCache) return serviceCache;
		if (Date.now() - failedAt < RETRY_MS) return null;
		let svc = null;
		try { svc = ctx?.get?.('dshMeme') ?? null; } catch { svc = null; }
		if (!svc || typeof svc.search !== 'function' || typeof svc.packs !== 'function') {
			failedAt = Date.now();
			return null;
		}
		serviceCache = svc;
		return svc;
	}

	/** 图库的缓存目录里存一份（按源路径 sha1 命名，同一张不会重复写）。 */
	function cacheCopy(src) {
		try {
			const dir = CACHE_DIR();
			mkdirSync(dir, { recursive: true });
			const dst = join(dir, 'meme-' + createHash('sha1').update(src).digest('hex').slice(0, 12) + extname(src).toLowerCase());
			if (!existsSync(dst) || statSync(dst).size === 0) copyFileSync(src, dst);
			trimCache(dir);
			return dst;
		} catch (error) {
			warn(`[fish-soul] 把 dsh-meme 的图复制到缓存目录失败：${String(error instanceof Error ? error.message : error)}`);
			return '';
		}
	}

	/** 缓存目录满了就删最旧的（每次最多删 20 个，别在发消息这条路上耗时间）。 */
	function trimCache(dir) {
		try {
			const rows = readdirSync(dir)
				.map((name) => ({ path: join(dir, name), at: statSync(join(dir, name)).mtimeMs }))
				.sort((a, b) => a.at - b.at);
			for (const row of rows.slice(0, Math.max(0, rows.length - CACHE_MAX))) {
				try { unlinkSync(row.path); } catch { /* 删不掉就算了 */ }
			}
		} catch { /* 目录读不到就算了 */ }
	}

	/** 递归扒一个目录下的 .gif（图库结构是 <pack>/memes/<tag>/<file>）。 */
	function scanGifs(root, packName, out, depth = 0) {
		if (depth > 4) return;
		let rows = [];
		try { rows = readdirSync(root, { withFileTypes: true }); } catch { return; }
		for (const row of rows) {
			const full = join(root, row.name);
			if (row.isDirectory()) {
				scanGifs(full, packName, out, depth + 1);
				continue;
			}
			if (extname(row.name).toLowerCase() !== '.gif') continue;
			// tag 就是 <pack>/memes/<tag>/ 这层目录名（dsh-meme 的细 tag，如 shy / like / daily）
			const tagName = String(root.split(/[\\/]/).pop() ?? '');
			out.push({
				path: full,
				tag: tagName === '' || tagName === 'memes' ? 'daily' : tagName,
				packName,
				name: row.name.replace(/\.gif$/i, '')
			});
		}
	}

	/**
	 * 动图池：只读扫各图库目录，把 .gif 单独列出来（5 分钟缓存）。
	 * 契约里的 search 拿不到「全部 gif」，但 packs() 给了每个图库的根目录，扫一遍就够。
	 * @returns {{at: number, items: Array<{path: string, tag: string, packName: string, name: string}>}}
	 */
	function gifPool() {
		const now = Date.now();
		if (gifCache && now - gifCache.at < GIF_POOL_TTL_MS) return gifCache;
		const items = [];
		const svc = service();
		if (svc) {
			let packs = [];
			try { packs = svc.packs() ?? []; } catch { packs = []; }
			for (const pack of packs) {
				const base = String(pack?.path ?? '');
				if (base === '' || !existsSync(base)) continue;
				const memesDir = join(base, 'memes');
				scanGifs(existsSync(memesDir) ? memesDir : base, String(pack?.name ?? pack?.id ?? ''), items);
			}
		}
		gifCache = { at: now, items };
		return gifCache;
	}

	/** 这个插件能不能借图库：`{ ok, packs, total, animated, reason }`（一分钟缓存）。 */
	function status() {
		const now = Date.now();
		if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.value;
		let value;
		const svc = service();
		if (!svc) {
			value = { ok: false, packs: [], total: 0, animated: 0, reason: '这台机器上没装 / 没启用 dsh-meme' };
		} else {
			try {
				const packs = (svc.packs() ?? []).map((p) => ({ id: p.id, name: p.name, count: Number(p.count) || 0 }));
				const total = packs.reduce((n, p) => n + p.count, 0);
				const animated = gifPool().items.length;
				// count 是宿主自己数的，个别版本不给这个字段（或算成 0）。图库目录里能扫到真图（GIF）也算能用：
				// 否则 status().ok 一 false，微信那边连「[表情: 感觉]」这条规则都不会给她，表情功能就静默没了 ——
				// 而这时图库里明明躺着几百张现成的动图（[FS-WECHAT-STICKER-ONLYMEME]）。
				const usable = total > 0 || animated > 0;
				value = {
					ok: usable,
					packs,
					total,
					animated,
					reason: usable ? '' : 'dsh-meme 的图库都关着（去 dsh-meme 的设置页把图库开关打开）'
				};
			} catch {
				value = { ok: false, packs: [], total: 0, animated: 0, reason: 'dsh-meme 的取图服务报错了' };
			}
		}
		statusCache = { at: now, value };
		return value;
	}

	/** 从动图池里挑：情绪桶内的优先，再看词面重叠（文件名 / 细 tag 对得上几个字），最后随机打散。 */
	function pickFromGifPool(want, mood, skip) {
		const pool = gifPool().items.filter((x) => existsSync(x.path) && !skip.has(x.path));
		if (pool.length === 0) return null;
		const fine = MOOD_FINE[mood] ?? [];
		const scored = pool.map((item) => {
			let score = 0;
			if (fine.length > 0 && fine.includes(item.tag)) score += 4;
			if (mood !== '' && item.tag === mood) score += 2;
			for (const ch of String(want)) {
				if (ch.trim() === '') continue;
				if (item.name.includes(ch) || item.tag.includes(ch)) score += 1;
			}
			return { item, score: score + Math.random() * 0.9 };
		}).sort((a, b) => b.score - a.score);
		return scored[0]?.item ?? null;
	}

	/**
	 * 按感觉挑一张：先按「感觉词 + 情绪桶」搜，再按情绪桶随机，最后只按关键词搜。
	 * 只读图库；返回的 path 是 fish-soul 自己缓存目录里的副本（可以直接发）。
	 * @param {{feel?: string, avoid?: string[], animatedFirst?: boolean, animatedStrict?: boolean}} [opts]
	 *   animatedFirst / animatedStrict：微信只认 GIF 动图，静态图发过去一定不动。
	 *   first = 先只在 .gif 里挑，挑不到再退回普通图；strict = 只在 .gif 里挑，挑不到就报没找到。
	 * @returns {Promise<{ok: boolean, path?: string, sourcePath?: string, tag?: string, caption?: string, packName?: string, label?: string, animated?: boolean, viaPool?: boolean, reason?: string}>}
	 */
	async function pick({ feel = '', avoid = [], animatedFirst = false, animatedStrict = false } = {}) {
		const want = String(feel ?? '').trim();
		if (want === '') return { ok: false, reason: '没说要什么感觉' };
		const svc = service();
		if (!svc) return { ok: false, reason: '这台机器上没装 / 没启用 dsh-meme' };
		const tag = moodOfFeel(want);
		const skip = new Set((Array.isArray(avoid) ? avoid : []).map((x) => String(x)));
		const tried = new Set();
		const isGif = (p) => extname(String(p ?? '')).toLowerCase() === '.gif';
		const usable = (m) => {
			const p = String(m?.path ?? '');
			if (p === '' || !existsSync(p) || skip.has(p)) return false;
			const ext = extname(p).toLowerCase();
			if (!IMAGE_EXT.has(ext)) return false;
			return ext !== '.webp' || canConvertWebp() === true;
		};
		const wantAnim = animatedFirst === true || animatedStrict === true;
		const finish = (hit, viaPool) => {
			const cached = cacheCopy(hit.path);
			if (cached === '') return null;
			const packName = String(hit.packName ?? '');
			const caption = String(hit.caption ?? hit.name ?? '');
			return {
				ok: true,
				path: cached,
				sourcePath: hit.path,
				animated: isGif(hit.path),
				viaPool: viaPool === true,
				tag: String(hit.tag ?? tag ?? ''),
				caption,
				packName,
				label: ['dsh-meme', packName, caption || hit.tag || want].filter((x) => x !== '').join(' / ')
			};
		};
		// [FS-MEME-PARITY] 先走前端同一套规则：DSH 会话里配的是哪张，出站就发哪张。
		// 注意这里连「前端没配上图」也照抄 —— 那时前端只显示描述文字，出站就不该偷偷发别的图。
		// [FS-WECHAT-STICKER-ANIM] 例外：微信只认 GIF，要动图的时候别照抄前端那张（多半是静态图），
		// 直接下去挑真 GIF —— 前端配的那张静态图发到微信上根本不会动。
		const parity = wantAnim ? { ok: false, unavailable: true } : pickByFrontendDesc(want);
		if (parity.ok === true) {
			const same = finish({ path: parity.path, tag, caption: '', packName: '' }, false);
			if (same) return { ...same, viaFrontend: true, animated: parity.animated === true };
			return { ok: false, reason: '挑中的那张缓存不出可发的副本' };
		}
		if (parity.unavailable !== true) return { ok: false, reason: parity.reason };
		// 索引读不到（没装 dsh-meme / 运行时没 node:sqlite / 图库没建索引）→ 退回语义检索。
		// 三轮检索：① 感觉词 + 情绪桶（最准）② 只按情绪桶（认得出情绪但没这词）③ 只按感觉词
		let fallback = null;
		for (const q of [{ query: want, tag }, { query: '', tag }, { query: want, tag: '' }]) {
			const query = String(q.query ?? '');
			const mood = String(q.tag ?? '');
			if (query === '' && mood === '') continue;
			const key = `${query}|${mood}`;
			if (tried.has(key)) continue;
			tried.add(key);
			let memes = [];
			// 要动图就多拉一点，图库里 GIF 占比低，12 条很容易全被静态图占满（契约上限 30）
			try { memes = svc.search({ query, tag: mood, limit: wantAnim ? 30 : 12 })?.memes ?? []; } catch { memes = []; }
			const hit = memes.find(usable);
			if (!hit) continue;
			if (!wantAnim) {
				const done = finish(hit, false);
				if (done) return done;
				continue;
			}
			// 要动图：这一轮命中的是 GIF 就直接用，是静态图先记着（严格模式下永远不用）
			const gif = memes.find((m) => usable(m) && isGif(m.path));
			if (gif) {
				const done = finish(gif, false);
				if (done) return done;
				continue;
			}
			if (!fallback) fallback = hit;
		}
		// [FS-WECHAT-STICKER-ANIM] 搜索没捞到动图：直接在动图池里挑一张真 GIF（语义退其次，先保证「动的」）
		if (wantAnim) {
			const fromPool = pickFromGifPool(want, tag, skip);
			if (fromPool) {
				const done = finish({ ...fromPool, caption: fromPool.name }, true);
				if (done) return done;
			}
			if (animatedStrict === true) {
				const poolSize = status().animated;
				return { ok: false, reason: poolSize === 0 ? '图库里一张 GIF 都没有' : `图库里没有对得上「${want}」的动图` };
			}
		}
		// 「先挑动图」模式兜底：图库确实一张 GIF 都没有时，退回静态图（总比干发文字强）
		if (fallback) {
			const done = finish(fallback, false);
			if (done) return done;
		}
		return { ok: false, reason: `dsh-meme 里没找到「${want}」相关的图` };
	}

	return { pick, status, moodOfFeel, gifPool };
}
