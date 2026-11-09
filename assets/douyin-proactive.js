/**
 * douyin-proactive.js —— 鱼主动给抖音上跟她「互相关注」的人发私信（v0.15.x 补丁，默认关）。
 *
 * [FS-DOUYIN-DM-PATCH]
 *
 * 为什么单独一个文件：抖音渠道（channels/douyin.js）那边只管「别人发来 → 她回」，
 * 主动开口原本只有 QQ / B站 私信（B站 有 bili.proactive），抖音这边缺。
 * 这里补的就是「她想起某个互关的朋友，主动发一句」：名单从关注页抓（页面上带「互相关注」
 * 标记的才算互关），发送走专用浏览器（已有会话直接发；没有会话的去对方主页点「私信」现开一个）。
 *
 * 三条红线（都在下面的 cfg 里卡着）：
 *  · 默认关闭，开关在 设置 → 平台 → 抖音 → 主动私信；
 *  · 一天最多几个人、同一个人隔几天才能再发，都有硬上限，宁可少发；
 *  · 深夜不发（activeHours 之外不发，且最早 9 点、最晚 23 点）。
 *
 * 记账：douyin.dm.day（今天发了几个）/ douyin.dm.sent（每个人上次发的真实时间）/
 *       douyin.dm.mutual（互关名单缓存）/ douyin.dm.recent（最近发过什么，设置页能看到）。
 */
import { getKv, setKv, findPersonByDouyin } from './db.js';
import { sleep } from './time-util.js';

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
/** 互关名单缓存多久（关注关系变得慢，不用每次都抓）。 */
const MUTUAL_TTL_MS = 6 * HOUR_MS;

const KV_DAY = 'douyin.dm.day';
const KV_SENT = 'douyin.dm.sent';
const KV_MUTUAL = 'douyin.dm.mutual';
const KV_RECENT = 'douyin.dm.recent';
const KV_ERROR = 'douyin.dm.error';

const FOLLOW_URL = 'https://www.douyin.com/user/self?showTab=follow';

const errText = (e) => String(e instanceof Error ? e.message : e);

/** 设置 → {enabled, perDay, coolDays, minGapMs, master}（总开关关着就都算关）。 */
export function dmCfg(d) {
	const num = (v, def, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.floor(Number(v)))) : def);
	const on = d?.enabled === true;
	const dm = d?.dm ?? {};
	return {
		enabled: on && dm.enabled === true,
		perDay: num(dm.perDay, 1, 0, 5),
		coolDays: num(dm.coolDays, 7, 1, 60),
		minGapMs: num(dm.minGapHours, 3, 1, 24) * HOUR_MS,
		master: String(d?.masterName ?? '').trim()
	};
}

function readDay(social, dateStr) {
	let st = null;
	try { st = getKv(social.db, KV_DAY, null); } catch { st = null; }
	return st && st.date === dateStr
		? { date: dateStr, count: Number(st.count) || 0, lastReal: Number(st.lastReal) || 0 }
		: { date: dateStr, count: 0, lastReal: 0 };
}

/** 设置页要看的：开关、今天发了几个、互关名单多大、最近发过什么、上次出错。 */
export function proactiveStatus(social) {
	let cfg = { enabled: false, perDay: 1, coolDays: 7, minGapMs: 3 * HOUR_MS, master: '' };
	let day = { count: 0, lastReal: 0 };
	let mutual = null;
	let recent = [];
	let error = '';
	try { cfg = dmCfg(social.getConfig() ?? {}); } catch { /* 配置读不到就用默认 */ }
	try { day = readDay(social, social.clock.getRoleDateParts().dateStr); } catch { /* 时钟读不到就当 0 */ }
	try { mutual = getKv(social.db, KV_MUTUAL, null); } catch { mutual = null; }
	try { recent = getKv(social.db, KV_RECENT, []) ?? []; } catch { recent = []; }
	try { error = String(getKv(social.db, KV_ERROR, '') ?? ''); } catch { error = ''; }
	return {
		enabled: cfg.enabled,
		perDay: cfg.perDay,
		coolDays: cfg.coolDays,
		todayCount: day.count,
		lastAt: day.lastReal,
		mutualCount: Array.isArray(mutual?.list) ? mutual.list.length : 0,
		mutualAt: Number(mutual?.at ?? 0),
		recent: Array.isArray(recent) ? recent.slice(0, 6) : [],
		lastError: error
	};
}

/* ── 页面小脚本 ──────────────────────────────────────────────────── */

/** 关注页上「互相关注」那一撮卡片 → [{name, uid}]（取最内层卡片，按 sec_uid 去重）。 */
const MUTUAL_JS = String.raw`(() => {
  const STOP = /^(互相关注|已关注|关注|私信|作品|喜欢|收藏|粉丝|获赞|回关)$/;
  const out = new Map();
  const cards = [...document.querySelectorAll('div,li,a')]
    .map((el) => {
      const t = el.innerText || '';
      if (!t.includes('互相关注')) return null;
      const a = el.querySelector('a[href*="/user/"]');
      if (!a) return null;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 1500 || area > 500000) return null;
      return { el, a, area, t };
    })
    .filter(Boolean)
    .sort((x, y) => x.area - y.area);
  for (const c of cards) {
    const href = String(c.a.getAttribute('href') || '');
    const m = /\/user\/([A-Za-z0-9_-]{4,})/.exec(href);
    if (!m) continue;
    const lines = c.t.split('\n').map((s) => s.trim()).filter((s) => s !== '');
    const name = lines.find((s) => s !== '' && !STOP.test(s) && !/^\d+$/.test(s) && !/^\d+(\.\d+)?[万wW]?$/.test(s));
    if (!name || name.length > 24) continue;
    if (!out.has(m[1])) out.set(m[1], { name, uid: m[1] });
  }
  return { list: [...out.values()] };
})()`;

/** 个人主页上点「私信」（文本匹配，取最内层那个可点的）。 */
const CLICK_DM_JS = String.raw`(() => {
  const wanted = ['私信', '发私信', '发消息'];
  const cands = [...document.querySelectorAll('button,div,span,a')]
    .filter((el) => {
      const t = (el.innerText || '').trim();
      if (!wanted.includes(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 10 && r.height > 10 && r.top >= 0 && r.top < window.innerHeight;
    })
    .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
  const el = cands[0];
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) { /* 忽略 */ }
  }
  try { el.click(); } catch (e) { /* 忽略 */ }
  return true;
})()`;

/** 聊天输入框在不在（浮层 / 独立页都算）。 */
const HAS_INPUT_JS = String.raw`(() => {
  const ta = document.querySelector('textarea');
  const ce = [...document.querySelectorAll('[contenteditable="true"]')].find((x) => x.getBoundingClientRect().width > 100);
  return Boolean(ta || ce);
})()`;

/** 聚焦输入框并返回中心坐标（坐标可能落在视口外，所以还要 JS focus 兜底）。 */
const FOCUS_INPUT_JS = String.raw`(() => {
  const ta = document.querySelector('textarea');
  const ce = [...document.querySelectorAll('[contenteditable="true"]')]
    .filter((x) => { const r = x.getBoundingClientRect(); return r.width > 50 && r.height > 10; })
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  const el = (ta && ta.getBoundingClientRect().width > 100) ? ta : ce;
  if (!el) return null;
  el.focus();
  const inner = el.querySelector('[contenteditable="true"]');
  if (inner && inner !== el) inner.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(inner || el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const READ_INPUT_JS = String.raw`(() => {
  const ta = document.querySelector('textarea');
  const ce = [...document.querySelectorAll('[contenteditable="true"]')].find((x) => x.getBoundingClientRect().width > 100);
  const el = (ta && ta.getBoundingClientRect().width > 100) ? ta : ce;
  return el ? String(el.value || el.innerText || '').replace(/\u200b/g, '').trim() : '';
})()`;

/* ── 抓名单 ──────────────────────────────────────────────────────── */

/**
 * 关注页上抓「互相关注」的人。调用方必须已经在 host.exclusive 里。
 * @returns {Promise<{ok: boolean, list: Array<{name: string, uid: string}>, error?: string}>}
 */
export async function listMutualFriends(host) {
	const browser = host.browser;
	try { await browser.goto(FOLLOW_URL, { settleMs: 7000 }); } catch (e) { return { ok: false, list: [], error: errText(e) }; }
	await sleep(1200);
	let list = [];
	for (let i = 0; i < 4; i++) {
		const r = await browser.eval(MUTUAL_JS).catch(() => null);
		if (Array.isArray(r?.list) && r.list.length > 0) list = r.list;
		await browser.eval('window.scrollBy(0, 900); true').catch(() => false);
		await sleep(1100);
	}
	if (list.length === 0) list = (await browser.eval(MUTUAL_JS).catch(() => null))?.list ?? [];
	if (!Array.isArray(list) || list.length === 0) {
		return { ok: false, list: [], error: '关注页上没读到「互相关注」的人（可能没加载出来，或者现在还没人跟她互关）' };
	}
	return { ok: true, list };
}

/* ── 发送 ────────────────────────────────────────────────────────── */

/** 在当前已经打开的会话里打字 + Enter + 回读确认。调用方必须已在 host.exclusive 里。 */
async function typeAndSend(browser, text) {
	const body = String(text ?? '').trim();
	if (body === '') return { ok: false, error: '正文是空的' };
	const pos = await browser.eval(FOCUS_INPUT_JS).catch(() => null);
	if (!pos || typeof pos.x !== 'number') return { ok: false, error: '找不到输入框' };
	await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 }, browser.sessionId);
	await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 }, browser.sessionId);
	await sleep(250);
	// 坐标可能在视口外，再 JS focus 一次（双保险，跟 bridge 那边一致）
	await browser.eval(FOCUS_INPUT_JS).catch(() => null);
	await sleep(150);
	await browser.send('Input.insertText', { text: body }, browser.sessionId);
	await sleep(800);
	let typed = String(await browser.eval(READ_INPUT_JS).catch(() => '') ?? '');
	if (typed === '' || !typed.includes(body.slice(0, 10))) {
		await browser.eval(`(() => {
  const ce = [...document.querySelectorAll('[contenteditable="true"]')]
    .filter((x) => { const r = x.getBoundingClientRect(); return r.width > 50 && r.height > 10; })
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!ce) return false;
  ce.focus();
  document.execCommand('insertText', false, ${JSON.stringify(body)});
  return true;
})()`).catch(() => false);
		await sleep(700);
		typed = String(await browser.eval(READ_INPUT_JS).catch(() => '') ?? '');
	}
	if (typed === '') return { ok: false, error: '输入没生效（输入框还是空的）' };
	await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, browser.sessionId);
	await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, browser.sessionId);
	await sleep(2200);
	const after = String(await browser.eval(READ_INPUT_JS).catch(() => '') ?? '');
	if (after !== '') return { ok: false, error: '输入框还有内容，可能没发出去' };
	const probe = body.slice(0, Math.min(18, body.length));
	for (let i = 0; i < 4; i++) {
		const seen = await browser.eval(`(() => (document.body.innerText || '').includes(${JSON.stringify(probe)}))()`).catch(() => false);
		if (seen === true) return { ok: true, verified: true };
		await sleep(1000);
	}
	return { ok: false, error: '发了，但聊天里没看到这条（可能还在发 / Enter 没触发）' };
}

/** 去对方主页点「私信」，现开一个会话。调用方必须已在 host.exclusive 里。 */
async function openChatFromProfile(browser, friend) {
	if (!friend?.uid) return { ok: false, error: '没有她主页的地址，开不了新会话' };
	await browser.goto(`https://www.douyin.com/user/${friend.uid}`, { settleMs: 6500 }).catch(() => {});
	await sleep(900);
	const clicked = await browser.eval(CLICK_DM_JS).catch(() => false);
	if (clicked !== true) return { ok: false, error: `「${friend.name}」主页上没找到「私信」按钮（对方可能设了只允许互关私信，或页面还没加载完）` };
	for (let i = 0; i < 12; i++) {
		await sleep(700);
		const has = await browser.eval(HAS_INPUT_JS).catch(() => false);
		if (has === true) return { ok: true };
	}
	return { ok: false, error: '点了「私信」但没打开聊天框' };
}

/** 拉出私信发送能力（bridge 是 .mjs，动态 import，拉不到就当没有）。 */
let dmBridge = null;
async function getDmBridge() {
	if (dmBridge !== null) return dmBridge;
	try {
		dmBridge = await import('./channels/vendor/douyin-bridge/douyin-dm.mjs');
	} catch {
		dmBridge = false;
	}
	return dmBridge;
}

/**
 * 给一个人发一条：先当已有会话发；不行就去主页开新会话、当场打字发。
 * 调用方必须已在 host.exclusive 里。
 */
export async function sendToFriend(host, friend, text) {
	const browser = host.browser;
	const name = String(friend?.name ?? '').trim();
	const bridge = await getDmBridge();
	if (bridge && typeof bridge.sendDM === 'function') {
		const r = await bridge.sendDM({ browser, text, uname: name }).catch((e) => ({ ok: false, error: errText(e) }));
		if (r?.ok === true) return { ok: true, via: '已有会话' };
	}
	const opened = await openChatFromProfile(browser, friend);
	if (!opened.ok) return { ok: false, error: opened.error };
	await sleep(1000);
	const sent = await typeAndSend(browser, text);
	return sent.ok ? { ok: true, via: '主页私信' } : { ok: false, error: sent.error };
}

/* ── 说什么 ──────────────────────────────────────────────────────── */

/** 让模型按人格写一句（可以 [不发]）。 */
async function draft(social, friend, history) {
	const p = social.persona?.() ?? { name: '鱼', brief: '' };
	const person = (() => { try { return findPersonByDouyin(social.db, friend.name); } catch { return null; } })();
	const parts = (() => { try { return social.clock.getRoleDateParts(); } catch { return {}; } })();
	const who = person
		? `这个人你认识：${String(person.display_name || friend.name).slice(0, 20)}${person.impression ? `（你心里对 ta 的印象：${String(person.impression).slice(0, 60)}）` : ''}`
		: '你们互相关注，但你其实还不太了解 ta';
	const historyLine = Array.isArray(history) && history.length > 0
		? `你们最近聊过：\n${history.slice(-6).map((m) => `${m.fromMe ? '你' : 'ta'}：${String(m.text ?? '').replace(/\s+/g, ' ').slice(0, 40)}`).join('\n')}`
		: '你们还没聊过（这是你第一次主动找 ta）';
	const prompt = [
		`你是「${p.name}」，一个人。${String(p.brief ?? '').slice(0, 600)}`,
		`现在是 ${parts.hour ?? 12} 点 ${parts.minute ?? 0} 分。`,
		`你要在抖音私信里，主动给一个互相关注的人发一条消息。${who}。`,
		historyLine,
		'',
		'要求：',
		'- 一到两句，一共 10～60 个字，口语，像忽然想起对方随手发的一条，不像群发。',
		'- 可以问一句、说个此刻的小事、接上次聊的话头；别硬套模板。',
		'- 不要提「互关」「关注」「看到你」这类平台关系，不要自我介绍，不要说自己是谁。',
		'- 不要推销、不要索要联系方式、不要带链接、话题标签、@ 任何人和表情码。',
		'- 实在没什么想说的，就只输出：[不发]',
		'- 只输出要发的那句话本身，不要加引号、不要解释。'
	].join('\n');
	let raw = null;
	try { raw = await social.callLlm(prompt); } catch { raw = null; }
	let text = String(raw ?? '').trim();
	if (text === '' || text.includes('[不发]')) return '';
	return text
		.replace(/^(私信|消息|正文|内容)[:：]\s*/, '')
		.replace(/^["“「『](.*)["”」』]$/s, '$1')
		.replace(/#[^#\s]{1,30}#/g, '')
		.replace(/@\S+/g, '')
		.replace(/https?:\/\/\S+/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80);
}

/* ── 主流程 ──────────────────────────────────────────────────────── */

function pushRecent(social, item) {
	let list = [];
	try { list = getKv(social.db, KV_RECENT, []) ?? []; } catch { list = []; }
	const next = [item, ...(Array.isArray(list) ? list : [])].slice(0, 12);
	try { setKv(social.db, KV_RECENT, next); } catch { /* 记不上就算了 */ }
}

function remember(social, { name, text, ok, error = '' }) {
	pushRecent(social, { name, text: String(text ?? ''), ok: ok === true, error: String(error ?? '').slice(0, 120), at: Date.now() });
	if (ok) {
		try { setKv(social.db, KV_ERROR, ''); } catch { /* 同上 */ }
	} else if (error) {
		try { setKv(social.db, KV_ERROR, `给 ${name} 发：${String(error).slice(0, 100)}`); } catch { /* 同上 */ }
	}
}

/**
 * 走一次：抓名单 → 挑一个没聊过的 → 让模型写一句 → 发出去 → 记账。
 * 调用方：自走层 tick（maybeSendProactive）/ 设置页「现在试一次」（manual=true，不吃配额）。
 */
export async function runProactive(social, { manual = false } = {}) {
	const c = dmCfg(social.getConfig() ?? {});
	const host = social.host;
	if (!host || host.running !== true) return { ok: false, error: '抖音浏览器没在运行' };
	if (host.loggedIn !== true) return { ok: false, error: '抖音还没登录' };

	// ① 互关名单（缓存 6 小时；手动试一次就重抓）
	let mutual = null;
	try { mutual = getKv(social.db, KV_MUTUAL, null); } catch { mutual = null; }
	const stale = !mutual || !Array.isArray(mutual.list) || mutual.list.length === 0 || Date.now() - Number(mutual.at ?? 0) > MUTUAL_TTL_MS;
	if (manual || stale) {
		const grabbed = await host.exclusive('读抖音互关名单', () => listMutualFriends(host), { maxMs: 150_000 })
			.catch((e) => ({ ok: false, list: [], error: errText(e) }));
		if (grabbed.ok !== true) {
			const why = grabbed.error ?? '没读到互关名单';
			try { setKv(social.db, KV_ERROR, why); } catch { /* 同上 */ }
			social.log('warn', `[fish-soul] 抖音主动私信：${why}`);
			return { ok: false, error: why };
		}
		mutual = { at: Date.now(), list: grabbed.list };
		try { setKv(social.db, KV_MUTUAL, mutual); } catch { /* 同上 */ }
	}

	// ② 挑人：排除主人、排除冷却期内已经聊过的
	let sent = {};
	try { sent = getKv(social.db, KV_SENT, {}) ?? {}; } catch { sent = {}; }
	const coolMs = c.coolDays * DAY_MS;
	const pool = (mutual.list ?? []).filter((x) => {
		const name = String(x?.name ?? '').trim();
		if (name === '') return false;
		if (c.master !== '' && name === c.master) return false;
		const last = Number(sent[name] ?? 0);
		return !(last > 0 && Date.now() - last < coolMs);
	});
	if (pool.length === 0) {
		return { ok: false, error: `互关的人里没有还能聊的（每人都要隔 ${c.coolDays} 天）` };
	}
	const friend = pool[Math.floor(social.random() * pool.length) % pool.length];

	// ③ 有会话的话，先看看最近聊过什么（读不到就算了，不影响发）
	let history = [];
	const bridge = await getDmBridge();
	if (bridge && typeof bridge.readDM === 'function') {
		history = await host.exclusive('看她跟这个人的私信', async () => {
			const r = await bridge.readDM({ browser: host.browser, uname: friend.name, limit: 10 }).catch(() => null);
			return Array.isArray(r?.messages) ? r.messages : [];
		}, { maxMs: 90_000 }).catch(() => []) ?? [];
	}

	// ④ 写一句
	const text = await draft(social, friend, history);
	if (text === '') {
		remember(social, { name: friend.name, text: '', ok: false, error: '这次没想说的' });
		return { ok: false, error: '这次没想说的（模型选了不发）' };
	}

	// ⑤ 发出去
	const r = await host.exclusive('主动给互关好友发私信', () => sendToFriend(host, friend, text), { maxMs: 240_000 })
		.catch((e) => ({ ok: false, error: errText(e) }));
	remember(social, { name: friend.name, text, ok: r?.ok === true, error: r?.ok === true ? '' : (r?.error ?? '没发出去') });

	if (r?.ok !== true) {
		social.log('warn', `[fish-soul] 抖音主动私信失败（${friend.name}）：${r?.error ?? '未知'}`);
		return { ok: false, error: r?.error ?? '没发出去' };
	}

	// ⑥ 记账：今天几个、这个人下次什么时候才能再发
	const dateStr = social.clock.getRoleDateParts().dateStr;
	const day = readDay(social, dateStr);
	try {
		setKv(social.db, KV_DAY, { date: dateStr, count: day.count + 1, lastReal: Date.now() });
		sent[friend.name] = Date.now();
		setKv(social.db, KV_SENT, sent);
	} catch { /* 记账失败不影响已经发出去的消息 */ }
	social.note?.('dm', { title: '抖音主动私信', reason: `给互关的 ${friend.name} 发了一条`, text });
	return { ok: true, name: friend.name, text, via: r.via ?? '' };
}

/** 自走层每 tick 问一次：现在该不该主动发一条（概率摊到剩下的时段里）。 */
export function maybeSendProactive(social, ctx = {}) {
	const c = dmCfg(social.getConfig() ?? {});
	if (!c.enabled || c.perDay === 0) return false;
	if (social.ready !== true) return false;
	if (social.proactiveBusy === true) return false;
	const parts = ctx.parts ?? (() => { try { return social.clock.getRoleDateParts(); } catch { return {}; } })();
	const [start, end] = ctx.activeHours ?? [8, 24];
	// 深夜不主动找人：最早 9 点、最晚 23 点（activeHours 更窄就按更窄的）
	const lo = Math.max(Number(start) || 0, 9);
	const hi = Math.min(Number(end) || 24, 23);
	const hour = Number(parts.hour ?? 0);
	if (hour < lo || hour >= hi) return false;
	if (ctx.slot?.availability === 'sleeping') return false;
	const dateStr = parts.dateStr ?? (() => { try { return social.clock.getRoleDateParts().dateStr; } catch { return ''; } })();
	const st = readDay(social, dateStr);
	if (st.count >= c.perDay) return false;
	if (st.lastReal > 0 && Date.now() - st.lastReal < c.minGapMs) return false;
	// 把今天剩下的名额摊到剩下的 tick 上（自走层 15 分钟一次）
	const ticksLeft = Math.max(1, (hi - hour) * 4 - Math.floor((Number(parts.minute) || 0) / 15));
	if (social.random() >= (c.perDay - st.count) / ticksLeft) return false;
	social.proactiveBusy = true;
	void runProactive(social)
		.catch((error) => social.log('warn', `[fish-soul] 抖音主动私信失败：${errText(error)}`))
		.finally(() => { social.proactiveBusy = false; });
	return true;
}

/** 设置页「现在试一次」：立刻挑一个，不等配额。 */
export function sendProactiveNow(social) {
	const host = social.host;
	if (!host || host.running !== true) return { ok: false, error: '抖音浏览器没在运行' };
	if (social.proactiveBusy === true) return { ok: false, error: '正在发，稍等' };
	social.proactiveBusy = true;
	return runProactive(social, { manual: true })
		.catch((error) => ({ ok: false, error: errText(error) }))
		.finally(() => { social.proactiveBusy = false; });
}
