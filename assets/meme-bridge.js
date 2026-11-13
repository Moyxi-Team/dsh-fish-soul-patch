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
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fishSoulDir } from './db.js';

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
