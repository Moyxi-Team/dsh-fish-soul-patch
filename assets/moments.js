// 朋友圈 B 方案：文案由 dsh 读 persona.json 生成，鲸鱼（WhaleLauncher）只当「手」发表。
//
// 链路：dsh（persona + soul.db 素材）→ 生成 {text, emotion}（希希口吻）
//       → POST 鲸鱼 /api/moments/publish-external
//       → 鲸鱼 momentsPublisher.queueExternal() 入队（跳过鲸鱼自己的 LLM）
//       → 桥接 moments_worker claim → moments_publish.publish_flow 操作微信 UI 发表
//
// 鲸鱼侧前提（本文件之外的步骤保证）：
//   moments.publishFeatureEnabled = true   发表总开关，关掉则接口直接拒绝
//   moments.publishEnabled        = false  原生定时生成关闭，鲸鱼不再自己写文案
// 这样对外可见的文案全部由 dsh 出，鲸鱼只执行，不出现「鲸鲸口吻」的第二人格。

import fs from 'node:fs';
import path from 'node:path';

const MINUTE = 60_000;
const TICK_MS = 5 * MINUTE;
const DEFAULT_URL = 'http://127.0.0.1:8787/api/moments/publish-external';
const EMOTIONS = ['happy', 'cute', 'angry'];
const BLOCK_NAMES = ['嘉新', '主人'];

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
}

function dayKey(ts) {
	const d = new Date(ts);
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 读 persona.json（chara_card_v2：{spec, data:{name, description, ...}}），取文案要用的几段。 */
export function personaSnapshot(personaPath) {
	const raw = readJson(personaPath);
	const d = raw?.data ?? raw ?? {};
	const str = (v) => (typeof v === 'string' ? v.trim() : '');
	return {
		name: str(d.name) || '希希',
		description: str(d.description),
		personality: str(d.personality),
		scenario: str(d.scenario),
		style: str(d.post_history_instructions),
	};
}

/** 生成提示词：以本人身份写一条可公开发的生活动态，输出 JSON。 */
export function buildPrompt(p, { hour = 12 } = {}) {
	const when = hour < 6 ? '深夜' : hour < 11 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 23 ? '晚上' : '深夜';
	const parts = [
		`以「${p.name}」的身份，写一条可以公开发给微信联系人的原创生活动态（朋友圈），第一人称，不是回复任何人。`,
		p.description ? `你是这样的人：${p.description}` : '',
		p.personality ? `性格：${p.personality}` : '',
		p.scenario ? `日常：${p.scenario}` : '',
		p.style ? `说话方式：${p.style}` : '',
		`现在是${when}。要求：`,
		'− 正文 15~60 字，像自己随手发的生活碎片，具体到一件小事，不要励志腔、不要总结陈词；',
		'− 不写链接、不写电话号码、不写住址、不提任何人的真实姓名；',
		'− 最多一个 emoji，也可以不用。',
		'只输出 JSON：{"text":"正文","emotion":"happy|cute|angry"}，不要代码块、不要解释。',
	].filter(Boolean);
	return parts.join('\n');
}

/** 清洗模型输出：兼容纯文本或 JSON，压成单行并去掉包裹符号。 */
export function cleanMoment(raw) {
	let s = '';
	let emotion = '';
	if (raw && typeof raw === 'object') {
		s = typeof raw.text === 'string' ? raw.text : '';
		emotion = typeof raw.emotion === 'string' ? raw.emotion : '';
	} else if (typeof raw === 'string' && raw.trim() !== '') {
		const match = raw.match(/\{[\s\S]*\}/);
		if (match) {
			try {
				const obj = JSON.parse(match[0]);
				s = typeof obj.text === 'string' ? obj.text : '';
				emotion = typeof obj.emotion === 'string' ? obj.emotion : '';
			} catch {
				s = raw;
			}
		} else {
			s = raw;
		}
	}
	s = String(s).replace(/```[\s\S]*?```/g, ' ').trim();
	s = s.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
	s = s.replace(/^(朋友圈|文案|正文)\s*[:：]\s*/, '');
	s = s.replace(/^["'“”‘’「」《》]+|["'“”‘’「」《》]+$/g, '').trim();
	s = s.replace(/\s+/g, ' ');
	if (s.length > 120) s = s.slice(0, 120);
	return { text: s, emotion: EMOTIONS.includes(emotion) ? emotion : '' };
}

/**
 * 预校验：鲸鱼侧会拦敏感词与身份名（SENSITIVE / 黑名单），
 * dsh 这边先生成阶段就挡掉，避免入队失败后静默。
 */
export function validateMoment(text) {
	const s = String(text ?? '').trim();
	if (s.length < 8) return { ok: false, reason: 'too_short' };
	if (s.length > 120) return { ok: false, reason: 'too_long' };
	if (/https?:\/\/|www\.|@|wxid_|\d{6,}/i.test(s)) return { ok: false, reason: 'sensitive' };
	if (BLOCK_NAMES.some((n) => s.includes(n))) return { ok: false, reason: 'identity_name' };
	return { ok: true };
}

export function createMoments({
	getConfig,
	saveConfig = () => {},
	callLlm = async () => null,
	personaPath,
	log = () => {},
	fetchImpl = (...args) => globalThis.fetch(...args),
	now = () => Date.now(),
} = {}) {
	let timer = null;
	let busy = false;

	// 落盘追踪：插件 log 只进 DSH 控制台，排障看不到，这里同步写一份到 fish-soul 目录。
	const trace = (msg) => {
		try {
			const base = pathOf();
			if (!base) return;
			fs.appendFileSync(path.join(path.dirname(base), 'moments.log'), `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
		} catch {}
	};

	const cfg = () => {
		const wechat = getConfig?.()?.wechat ?? {};
		const c = wechat.moments ?? getConfig?.()?.moments ?? {};
		const hours = Number(c.intervalHours);
		const gap = Number(c.minGapMinutes);
		const active = Array.isArray(c.activeHours) ? c.activeHours : [];
		const perDay = Number(c.perDay);
		return {
			enabled: c.enabled === true,
			url: typeof c.publishUrl === 'string' && c.publishUrl ? c.publishUrl : DEFAULT_URL,
			token: typeof wechat.inboundToken === 'string' ? wechat.inboundToken : '',
			perDay: Number.isFinite(perDay) && perDay > 0 ? Math.floor(perDay) : 1,
			minGapMinutes: Number.isFinite(gap) && gap >= 0
				? Math.floor(gap)
				: Number.isFinite(hours) && hours > 0 ? Math.floor(hours * 60) : 360,
			activeHours: active.length === 2 && active.every((h) => Number.isFinite(Number(h)))
				? [Number(active[0]), Number(active[1])]
				: [8, 24],
			withImage: c.withImage === true,
			emotion: EMOTIONS.includes(c.emotion) ? c.emotion : 'happy',
			state: c.state && typeof c.state === 'object' ? c.state : {},
		};
	};

	const pathOf = () => (typeof personaPath === 'function' ? personaPath() : personaPath);

	/** 生成一条文案（不发送）。 */
	async function compose() {
		const p = personaSnapshot(pathOf());
		const hour = new Date(now()).getHours();
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const raw = await callLlm(buildPrompt(p, { hour }), { feature: 'social', maxTokens: 220 });
			const { text, emotion } = cleanMoment(raw);
			if (text === '') continue;
			const check = validateMoment(text);
			if (check.ok) return { text, emotion };
			log('warn', `[fish-soul] 朋友圈文案预校验没过（${check.reason}），重试：${text}`);
		}
		log('warn', '[fish-soul] 朋友圈文案生成失败：模型没有返回可用文本');
		return null;
	}

	/** 生成并交给鲸鱼发表（手动/定时共用）。 */
	async function publishOnce({ text = '', withImage, emotion } = {}) {
		const c = cfg();
		let content = '';
		let picked = '';
		if (String(text || '').trim() !== '') {
			const given = cleanMoment({ text, emotion });
			const check = validateMoment(given.text);
			if (!check.ok) return { ok: false, error: `文案不合规（${check.reason}）` };
			content = given.text;
			picked = given.emotion;
		} else {
			const made = await compose();
			if (made === null) return { ok: false, error: '文案生成失败（LLM 未返回可用文本）' };
			content = made.text;
			picked = made.emotion;
		}
		const body = {
			text: content,
			emotion: picked || c.emotion,
			withImage: withImage === undefined ? c.withImage : withImage === true,
		};
		const headers = { 'Content-Type': 'application/json' };
		if (c.token) headers['x-bot-token'] = c.token;
		let res;
		try {
			res = await fetchImpl(c.url, {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(30_000),
			});
		} catch (error) {
			const msg = `鲸鱼接口不可达（${c.url}）：${error instanceof Error ? error.message : String(error)}`;
			log('warn', `[fish-soul] 朋友圈发表失败：${msg}`);
			return { ok: false, error: msg, text: content };
		}
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data?.ok !== true) {
			const msg = data?.error || `HTTP ${res.status}`;
			log('warn', `[fish-soul] 朋友圈发表失败：${msg}`);
			return { ok: false, error: msg, text: content, status: res.status };
		}
		const ts = now();
		const today = dayKey(ts);
		const prev = c.state ?? {};
		const count = prev.day === today ? (Number(prev.count) || 0) + 1 : 1;
		saveConfig({ wechat: { moments: { state: { day: today, count, lastAt: ts } } } });
		log('info', `[moments] 已提交：${content.slice(0, 10)}…（今日第 ${count} 条）`);
		return { ok: true, text: content, job: data?.job ?? null };
	}

	/** 节奏判定：开关、活跃时段、每日上限、最小间隔。 */
	function canRun(at = now()) {
		const c = cfg();
		if (!c.enabled) return { ok: false, reason: 'disabled' };
		const hour = new Date(at).getHours();
		const [from, to] = c.activeHours;
		const inside = from <= to ? hour >= from && hour < to : hour >= from || hour < to;
		if (!inside) return { ok: false, reason: 'inactive_hours' };
		const st = c.state ?? {};
		const today = dayKey(at);
		if (st.day === today && (Number(st.count) || 0) >= c.perDay) return { ok: false, reason: 'daily_limit' };
		const lastAt = Number(st.lastAt) || 0;
		if (lastAt > 0 && at - lastAt < c.minGapMinutes * MINUTE) return { ok: false, reason: 'gap' };
		return { ok: true };
	}

	async function tick() {
		if (busy) return;
		const verdict = canRun();
		trace(verdict.ok ? 'tick 通过节奏校验，开始生成文案' : `tick 跳过：${verdict.reason}`);
		if (!verdict.ok) return;
		busy = true;
		try {
			const sent = await publishOnce();
			trace(`publish → ok=${sent?.ok} error=${sent?.error ?? ''} status=${sent?.status ?? ''}`);
		} catch (error) {
			log('error', `[fish-soul] 朋友圈定时发表出错：${String(error instanceof Error ? error.message : error)}`);
		} finally {
			busy = false;
		}
	}

	function start() {
		trace(`start 已排定（每 ${TICK_MS / 60000} 分钟判断一次节奏）enabled=${cfg().enabled}`);
		if (timer !== null) return;
		timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
		if (typeof timer.unref === 'function') timer.unref();
	}

	function stop() {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	}

	return { compose, publishOnce, tick, canRun, start, stop, config: cfg };
}
