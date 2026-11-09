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
/** 拿不到服务时，一分钟内不再试（免得日志刷屏）。 */
const RETRY_MS = 60_000;
const CACHE_DIR = () => join(fishSoulDir(), 'meme-cache');

/** 感觉词 → dsh-meme 的 6 个情绪桶（和它的 MOOD_WORDS 大致对齐；认不出来就只传关键词让它自己搜）。 */
const MOOD_WORDS = {
	happy: ['开心', '高兴', '兴奋', '喜欢', '卖萌', '可爱', '比心', '哈哈', '欢迎', '得意', '好耶', '满意', '笑', '赞', '喜欢'],
	angry: ['生气', '愤怒', '暴躁', '嫌弃', '凶', '哼', '不爽'],
	sad: ['难过', '哭', '委屈', '叹气', '无语', '可怜', '失落', '伤心'],
	shy: ['害羞', '脸红', '腼腆', '不好意思', '羞'],
	confused: ['困惑', '疑惑', '惊讶', '问号', '懵', '震惊', '啊这', '好奇'],
	daily: ['困', '睡觉', '早上好', '你好', '上班', '下班', '摸鱼', '熬夜', '吃饭', '饿', '日常', '无聊', '加油']
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

	/** 这个插件能不能借图库：`{ ok, packs, total, reason }`（一分钟缓存）。 */
	function status() {
		const now = Date.now();
		if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.value;
		let value;
		const svc = service();
		if (!svc) {
			value = { ok: false, packs: [], total: 0, reason: '这台机器上没装 / 没启用 dsh-meme' };
		} else {
			try {
				const packs = (svc.packs() ?? []).map((p) => ({ id: p.id, name: p.name, count: Number(p.count) || 0 }));
				const total = packs.reduce((n, p) => n + p.count, 0);
				value = { ok: total > 0, packs, total, reason: total > 0 ? '' : 'dsh-meme 的图库都关着（去 dsh-meme 的设置页把图库开关打开）' };
			} catch {
				value = { ok: false, packs: [], total: 0, reason: 'dsh-meme 的取图服务报错了' };
			}
		}
		statusCache = { at: now, value };
		return value;
	}

	/**
	 * 按感觉挑一张：先按「感觉词 + 情绪桶」搜，再按情绪桶随机，最后只按关键词搜。
	 * 只读图库；返回的 path 是 fish-soul 自己缓存目录里的副本（可以直接发）。
	 * @param {{feel?: string, avoid?: string[]}} [opts]
	 * @returns {Promise<{ok: boolean, path?: string, sourcePath?: string, tag?: string, caption?: string, packName?: string, label?: string, reason?: string}>}
	 */
	async function pick({ feel = '', avoid = [] } = {}) {
		const want = String(feel ?? '').trim();
		if (want === '') return { ok: false, reason: '没说要什么感觉' };
		const svc = service();
		if (!svc) return { ok: false, reason: '这台机器上没装 / 没启用 dsh-meme' };
		const tag = moodOfFeel(want);
		const skip = new Set((Array.isArray(avoid) ? avoid : []).map((x) => String(x)));
		const tried = new Set();
		for (const q of [{ query: want, tag }, { query: '', tag }, { query: want, tag: '' }]) {
			const query = String(q.query ?? '');
			const mood = String(q.tag ?? '');
			if (query === '' && mood === '') continue;
			const key = `${query}|${mood}`;
			if (tried.has(key)) continue;
			tried.add(key);
			let memes = [];
			try { memes = svc.search({ query, tag: mood, limit: 12 })?.memes ?? []; } catch { memes = []; }
			const hit = memes.find((m) => {
				const p = String(m?.path ?? '');
				if (p === '' || !existsSync(p) || skip.has(p)) return false;
				const ext = extname(p).toLowerCase();
				if (!IMAGE_EXT.has(ext)) return false;
				return ext !== '.webp' || canConvertWebp() === true;
			});
			if (!hit) continue;
			const cached = cacheCopy(hit.path);
			if (cached === '') continue;
			const packName = String(hit.packName ?? '');
			const caption = String(hit.caption ?? '');
			return {
				ok: true,
				path: cached,
				sourcePath: hit.path,
				tag: String(hit.tag ?? mood ?? ''),
				caption,
				packName,
				label: ['dsh-meme', packName, caption || hit.tag || want].filter((x) => x !== '').join(' / ')
			};
		}
		return { ok: false, reason: `dsh-meme 里没找到「${want}」相关的图` };
	}

	return { pick, status, moodOfFeel };
}
