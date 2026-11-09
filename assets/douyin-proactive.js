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
 *  · 「同一个人一天最多几次」「同一个人隔几小时才能再发」都有硬上限，宁可少发；
 *  · 深夜不发（activeHours 之外不发，且最早 9 点、最晚 23 点）。
 *
 * 记账：douyin.dm.day（今天总共几条 + 每个人各自几条）/ douyin.dm.sent（每个人上次发的真实时间）/
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
/** 她自己的作品池（id + 文案 + 话题，分享时按类型挑一条，别每次都翻主页）。 */
const KV_VIDEOS = 'douyin.dm.videos';
/** 已经分享给谁的哪几条（{人名: [aweme_id]}）—— 同一个人尽量别收到重复的视频。 */
const KV_SHARED = 'douyin.dm.shared';
/** 别人的视频池（按类型关键词搜来的 / 她的收藏 / 推荐流，缓存 12 小时）。[FS-DM-SHARE-OTHERS] */
const KV_OTHERS = 'douyin.dm.others';

/**
 * 视频类型词表（[FS-DM-SHARE-TYPE]）：类型名 → 命中词。
 *
 * 判断只看接口/页面上的**文字**（文案 desc + 话题 cha_list），不看画面、不做识别 ——
 * 跟 dsh-douyin-scroll 的 forward-pick 一个路子：字段驱动、可解释、跑得快。
 * 设置页可以按类型名覆盖词表（dm.shareTypes），也能加自定义类型。
 */
const DEFAULT_SHARE_TYPES = {
	搞笑: ['搞笑', '沙雕', '整活', '段子', '幽默', '笑死', '神回复', '搞笑视频', '喜剧', '抽象', '梗'],
	游戏: ['游戏', '王者', '原神', '蛋仔', '我的世界', 'mc', '和平精英', '电竞', '开黑', '手游', '单机', '吃鸡', 'lol', 'steam', 'switch', 'ps5', '实况', '上分'],
	美食: ['美食', '做饭', '菜', '探店', '甜品', '火锅', '小吃', '厨房', '烘焙', '食堂', '下饭', '夜宵', '奶茶'],
	宠物: ['猫', '狗', '宠物', '萌宠', '喵', '汪', '仓鼠', '铲屎', '撸猫', '撸狗', '毛孩子'],
	旅行: ['旅行', '旅游', '风景', '露营', '自驾', '出游', 'citywalk', 'city walk', '爬山', '海边', '打卡', '攻略', '出片'],
	音乐舞蹈: ['翻唱', '音乐', '唱歌', '舞蹈', '跳舞', '广场舞', '编舞', '街舞', '吉他', '钢琴', 'live', '舞台', '歌曲', '翻跳', '配音', 'remix', 'bgm'],
	颜值穿搭: ['穿搭', '化妆', '护肤', '颜值', '发型', '搭配', 'look', '口红', 'ootd', '妆容', '变美', '穿搭分享'],
	剧情影视: ['剧情', '短剧', '影视', '电影', '解说', '追剧', '片段', '演技', '反转', '悬疑', '动漫'],
	数码科技: ['数码', '科技', '手机', '电脑', 'ai', '评测', '开箱', '显卡', '软件', '硬件', 'deepseek', 'chatgpt', '大模型', '编程', '代码', '装机'],
	情感: ['情感', '恋爱', 'emo', '治愈', '遗憾', '分手', '孤独', '人生', '文案', '暗恋', '想念', '温柔'],
	日常: ['日常', 'vlog', '生活', '记录', '碎碎念', '随手拍', '打工', '上班', '上课', '摸鱼', '宿舍', '周末'],
	美女: ['美女', '小姐姐', '颜值', '女神', '漂亮', '好看', '身材', '清纯', '甜妹', '御姐'],
	动漫: ['动漫', '二次元', '番剧', '动画', 'amv', 'mad', '漫画', 'cos', '手绘', '新番'],
	学习: ['学习', '考研', '知识', '科普', '英语', '教程', '干货', '读书', '考公', '笔记', '自习', '期末'],
	运动: ['运动', '健身', '跑步', '篮球', '足球', '瑜伽', '减肥', '球场', '打球', '徒步', '骑行'],
};

/**
 * 把设置里的类型词表归一成 [{name, words}]：内置打底，用户写同名就覆盖，写新名字就新增。
 * 也接受只给类型名（没给词表）—— 那就拿类型名自己当唯一命中词。
 */
function normalizeShareTypes(raw) {
	const merge = new Map(Object.entries(DEFAULT_SHARE_TYPES).map(([k, v]) => [k, [...v]]));
	const put = (name, words) => {
		const key = String(name ?? '').trim();
		if (key === '' || /[，,]/.test(key)) return;
		const list = (Array.isArray(words) ? words : String(words ?? '').split(/[，,、\s]+/))
			.map((w) => String(w ?? '').trim().toLowerCase())
			.filter((w) => w !== '');
		merge.set(key, [...new Set([...(merge.get(key) ?? []), ...(list.length > 0 ? list : [key.toLowerCase()])])]);
	};
	if (Array.isArray(raw)) {
		for (const x of raw) {
			if (typeof x === 'string') put(x, []);
			else if (x !== null && typeof x === 'object') put(x.name ?? x.type ?? x.k ?? '', x.words ?? x.keys ?? x.词 ?? '');
		}
	} else if (raw !== null && typeof raw === 'object') {
		for (const [k, v] of Object.entries(raw)) put(k, v);
	}
	return [...merge.entries()].map(([name, words]) => ({ name, words }));
}

/** 一条作品属于哪几类（文案 + 话题里出现类型词就算这类；可能同时好几类，也可能一类都不是）。 */
function classifyVideo(item, types) {
	const hay = `${String(item?.desc ?? '')} ${(Array.isArray(item?.tags) ? item.tags : []).join(' ')}`.toLowerCase();
	if (hay.trim() === '') return [];
	return types.filter((t) => t.words.some((w) => hay.includes(w))).map((t) => t.name);
}

/** 「搞笑,游戏」/['搞笑','游戏'] → ['搞笑','游戏']（留空 = 不限）。 */
function parseTypeList(raw, types) {
	const names = types.map((t) => t.name);
	const picked = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[，,、\s]+/))
		.map((x) => String(x ?? '').trim())
		.filter((x) => x !== '' && names.includes(x));
	return [...new Set(picked)];
}

/** 希希自己的个人主页：从这里点「关注 N」进关注列表（用户要的就是这个页）。 */
const PROFILE_URL = 'https://www.douyin.com/user/self';
/** 兜底：点不开「关注」按钮时，直接开关注页 URL（同一个列表）。 */
const FOLLOW_URL = 'https://www.douyin.com/user/self?showTab=follow';

const errText = (e) => String(e instanceof Error ? e.message : e);

/** 设置 → {enabled, perDay, coolDays, minGapMs, master}（总开关关着就都算关）。 */
export function dmCfg(d) {
	const num = (v, def, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.floor(Number(v)))) : def);
	const on = d?.enabled === true;
	const dm = d?.dm ?? {};
	// 视频类型词表：内置打底，设置页写了就覆盖/新增
	const shareTypes = normalizeShareTypes(dm.shareTypes);
	// [FS-DM-SHARE-DEFAULT] 默认分享哪几类（没单独指定的人按这个；空 = 不限）
	const defaultShareTypes = String(dm.defaultShareTypes ?? '').trim().slice(0, 200);
	const defaultWantTypes = parseTypeList(defaultShareTypes, shareTypes);
	// 要发给谁：设置页自己勾的名单（[{name, uid, shareType}]），空着就是谁也不发
	// shareType 是这个人的「只看哪几类视频」，留空 = 跟默认（再空 = 不限，随便挑一条）
	const targets = (Array.isArray(dm.targets) ? dm.targets : [])
		.map((x) => {
			const shareType = String(x?.shareType ?? x?.types ?? '').trim().slice(0, 200);
			return {
				name: String(x?.name ?? '').trim(),
				uid: String(x?.uid ?? '').trim(),
				shareType,
				wantTypes: shareType === '' ? defaultWantTypes : parseTypeList(shareType, shareTypes),
			};
		})
		.filter((x) => x.name !== '');
	// 同一个人的冷却：新字段是小时；老配置里只写了 coolDays 的按天换算过来
	const coolHours = Number.isFinite(Number(dm.coolHours)) ? num(dm.coolHours, 24, 1, 720) : num(dm.coolDays, 1, 1, 60) * 24;
	return {
		enabled: on && dm.enabled === true,
		// perDay 是「同一个人一天最多几次」——每个人单独算，不是所有人加起来
		perDay: num(dm.perDay, 1, 0, 10),
		coolHours,
		coolMs: coolHours * HOUR_MS,
		minGapMs: num(dm.minGapHours, 3, 1, 24) * HOUR_MS,
		// 视频类型：词表 + 每人想收哪几类（targets[].wantTypes）
		shareTypes,
		shareTypeNames: shareTypes.map((t) => t.name),
		defaultShareTypes,
		defaultWantTypes,
		master: String(d?.masterName ?? '').trim(),
		targets
	};
}

function readDay(social, dateStr) {
	let st = null;
	try { st = getKv(social.db, KV_DAY, null); } catch { st = null; }
	if (!st || st.date !== dateStr) return { date: dateStr, count: 0, lastReal: 0, byName: {} };
	// byName 是「今天这个人发了几条」——配额按人算，所以必须分开记
	const byName = st.byName && typeof st.byName === 'object' ? st.byName : {};
	return { date: dateStr, count: Number(st.count) || 0, lastReal: Number(st.lastReal) || 0, byName };
}

/** 某个人今天已经发了几条（old 配置里没 byName，就当 0）。 */
function sentToday(day, name) {
	const k = String(name ?? '');
	return Number(day?.byName?.[k] ?? 0) || 0;
}

/**
 * 今天还能发几条：每个人各自剩多少，加起来就是总数。
 * perDay 是「同一个人一天最多几次」，不是全体合计 —— 勾的人越多，理论上总条数越大。
 */
function quotaLeft(cfg, sent, day) {
	const now = Date.now();
	let left = 0;
	for (const x of cfg.targets) {
		// [FS-DM-ALLOW-MASTER] 主人也算可发对象（名单是显式勾选的），不再在这里剔掉
		const last = Number(sent[x.name] ?? 0);
		if (last > 0 && now - last < cfg.coolMs) continue; // 这个人还在冷却期
		if (sentToday(day, x.name) >= cfg.perDay) continue; // 这个人今天发满了
		left += cfg.perDay - sentToday(day, x.name);
	}
	return left;
}

/** 设置页要看的：开关、今天发了几个、互关名单多大、最近发过什么、上次出错。 */
export function proactiveStatus(social) {
	let cfg = { enabled: false, perDay: 1, coolHours: 24, coolMs: DAY_MS, minGapMs: 3 * HOUR_MS, master: '', targets: [] };
	let day = { count: 0, lastReal: 0 };
	let mutual = null;
	let recent = [];
	let error = '';
	try { cfg = dmCfg(social.getConfig() ?? {}); } catch { /* 配置读不到就用默认 */ }
	try { day = readDay(social, social.clock.getRoleDateParts().dateStr); } catch { /* 时钟读不到就当 0 */ }
	try { mutual = getKv(social.db, KV_MUTUAL, null); } catch { mutual = null; }
	try { recent = getKv(social.db, KV_RECENT, []) ?? []; } catch { recent = []; }
	try { error = String(getKv(social.db, KV_ERROR, '') ?? ''); } catch { error = ''; }
	// 还没选人的时候，把上次拉到（或上次自动抓的）互关名单当候选回显给设置页
	const cached = Array.isArray(mutual?.list) ? mutual.list : [];
	const picked = cfg.targets.map((x) => x.name);
	return {
		enabled: cfg.enabled,
		perDay: cfg.perDay,
		coolHours: cfg.coolHours,
		minGapHours: Math.round(cfg.minGapMs / HOUR_MS),
		todayCount: day.count,
		// 每人今天发了几条（设置页能看到「今天 3 条：张三 2、李四 1」这种）
		todayByName: day.byName ?? {},
		lastAt: day.lastReal,
		targets: cfg.targets,
		// 视频类型：给设置页做候选提示（每人一行按名字选，可多人不同）
		shareTypes: cfg.shareTypes.map((t) => ({ name: t.name, words: t.words })),
		shareTypeNames: cfg.shareTypeNames,
		defaultShareTypes: cfg.defaultShareTypes,
		defaultWantTypes: cfg.defaultWantTypes,
		pickedNames: picked,
		mutualCount: cached.length,
		mutualAt: Number(mutual?.at ?? 0),
		mutualList: cached.slice(0, 200),
		recent: Array.isArray(recent) ? recent.slice(0, 6) : [],
		lastError: error
	};
}

/**
 * 关注列表里挑「互相关注」的人。页面上的真实形态（用户截图确认过）：
 * 每个条目右边一个灰色圆角小按钮，按钮上写「相互关注」（老文案是「互相关注」），
 * 名字本身不带任何标记 —— 所以不能按「名字后面跟着互相关注」去找，
 * 要按「这一条里有没有那个互关小按钮」判定，名字从这一条的主页链接里取。
 */
const MUTUAL_JS = String.raw`(() => {
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  // 互关按钮的文案：现在页面写的是「相互关注」，兼容老文案「互相关注」/「互关」
  const MARK = /^(相互关注|互相关注|互关)$/;
  const PLAIN = /^(已关注|关注|取消关注|回关|私信|发消息|粉丝|获赞|作品|喜欢|收藏|关注你)$/;
  const numLike = /^\d+(\.\d+)?\s*[万wW]?$/;
  const okName = (s) => {
    const t = clean(s);
    if (t === '' || t.length > 30) return '';
    if (MARK.test(t) || PLAIN.test(t) || numLike.test(t)) return '';
    return t;
  };
  const visBox = (el) => { const r = el.getBoundingClientRect(); const a = r.width * r.height; return a > 600 && a < 400000; };
  // ① 先找所有「互关小按钮」：文案正好是 MARK 的最内层元素
  const marks = [...document.querySelectorAll('button,span,div,p')].filter((el) => {
    if (!MARK.test(clean(el.textContent))) return false;
    return ![...el.children].some((c) => MARK.test(clean(c.textContent)));
  });
  const out = new Map();
  for (const mk of marks) {
    // ② 从这个按钮往上找「这一条」：最近一个包含主页链接、尺寸像一行的祖先
    let el = mk.parentElement;
    let card = null;
    for (let i = 0; i < 8 && el; i++) {
      if (el.querySelector('a[href*="/user/"]') && visBox(el)) { card = el; break; }
      el = el.parentElement;
    }
    if (!card) continue;
    const a = card.querySelector('a[href*="/user/"]');
    const m = /\/user\/([A-Za-z0-9_-]{4,})/.exec(String(a.getAttribute('href') || ''));
    if (!m || out.has(m[1])) continue;
    // ③ 名字就从主页链接取（链接里的文字就是昵称），取不到再退到这一条的第一行文字
    const lines = String(card.innerText || '').split('\n').map(clean);
    const firstText = lines.find((x) => okName(x) !== '') || '';
    const name = okName(a.innerText) || okName(a.getAttribute('title')) || okName(a.getAttribute('aria-label')) || okName(firstText);
    if (!name) continue;
    out.set(m[1], { name, uid: m[1] });
  }
  return { list: [...out.values()], users: document.querySelectorAll('a[href*="/user/"]').length, marks: marks.length };
})()`;

/** 个人主页顶部那个「关注 123」/「123 关注」——点它才是进关注列表的正路。 */
const CLICK_FOLLOW_JS = String.raw`(() => {
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const re = /^(\d+(\.\d+)?\s*[万wW]?\s*关注|关注\s*\d+(\.\d+)?\s*[万wW]?|关注)$/;
  const users = () => document.querySelectorAll('a[href*="/user/"]').length;
  const cands = [...document.querySelectorAll('div,span,a,button,p')]
    .filter((el) => {
      const t = clean(el.innerText);
      if (!re.test(t)) return false;
      if (/互相关注|已关注|关注你|取消关注/.test(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.top > -5 && r.top < window.innerHeight;
    })
    .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
  const el = cands[0];
  if (!el) return { ok: false, users: users() };
  try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* 滚不动就算了 */ }
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  for (const type of ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
  }
  try { el.click(); } catch (e) { /* 上面的事件已经发过了 */ }
  return { ok: true, text: clean(el.innerText), users: users() };
})()`;

/** 关注列表可能是整页、也可能是弹层：滚动所有能滚的容器（弹层优先），再看下一屏。 */
const SCROLL_LIST_JS = String.raw`(() => {
  const canScroll = (e) => {
    if (!e || e.scrollHeight <= e.clientHeight + 120) return false;
    if (e.clientHeight < 160) return false;
    const st = getComputedStyle(e);
    return st.overflowY === 'auto' || st.overflowY === 'scroll';
  };
  const boxes = [...document.querySelectorAll('div,section,ul')].filter(canScroll)
    .sort((a, b) => b.clientHeight - a.clientHeight);
  let moved = false;
  for (const e of boxes.slice(0, 3)) {
    const before = e.scrollTop;
    e.scrollTop = before + Math.max(240, Math.floor(e.clientHeight * 0.85));
    if (e.scrollTop > before) moved = true;
  }
  if (!moved) {
    const before = window.scrollY;
    window.scrollBy(0, 900);
    moved = window.scrollY > before;
  }
  return { moved, boxes: boxes.length };
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
 * 拉互关名单：进希希自己的个人主页 → 点「关注」按钮 → 关注列表里挑右侧带「相互关注」小按钮的人。
 * 调用方必须已经在 host.exclusive 里。
 * @returns {Promise<{ok: boolean, list: Array<{name: string, uid: string}>, error?: string, via?: string}>}
 */
export async function listMutualFriends(host) {
	const browser = host.browser;
	// ① 个人主页（点关注按钮的正路）
	try {
		await browser.goto(PROFILE_URL, { settleMs: 7000 });
	} catch (e) {
		return { ok: false, list: [], error: errText(e) };
	}
	await sleep(1400);
	let via = 'profile';
	const hit = await browser.eval(CLICK_FOLLOW_JS).catch(() => null);
	const before = Number(hit?.users ?? 0);
	if (hit?.ok === true) {
		await sleep(2800);
		// ② 点完看列表有没有真的出来（用户链接变多才算），没出来就换关注页 URL 兜底
		const after = Number(await browser.eval('document.querySelectorAll(\'a[href*="/user/"]\').length').catch(() => 0)) || 0;
		if (!(after > before + 1)) {
			try { await browser.goto(FOLLOW_URL, { settleMs: 6000 }); } catch { /* 兜底也打不开就按空处理 */ }
			await sleep(1800);
			via = 'url';
		}
	} else {
		try { await browser.goto(FOLLOW_URL, { settleMs: 6000 }); } catch { /* 兜底也打不开就按空处理 */ }
		await sleep(1800);
		via = 'url';
	}

	// ③ 边滚边抓（列表可能是弹层，SCROLL_LIST_JS 会滚弹层而不是整页）
	const seen = new Map();
	for (let i = 0; i < 8; i++) {
		const r = await browser.eval(MUTUAL_JS).catch(() => null);
		for (const x of Array.isArray(r?.list) ? r.list : []) {
			if (x?.name && x?.uid && !seen.has(x.uid)) seen.set(x.uid, x);
		}
		const moved = await browser.eval(SCROLL_LIST_JS).catch(() => null);
		await sleep(1200);
		if (moved && moved.moved === false && seen.size > 0) break; // 已经滚到底了
	}
	if (seen.size === 0) {
		return {
			ok: false,
			list: [],
			via,
			error: '关注列表里没读到标着「相互关注」的人（可能列表没加载出来，或者现在还没有人跟她互关）'
		};
	}
	return { ok: true, list: [...seen.values()], via };
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

/* ── 分享她的视频（走抖音自带的「分享 → 私信」，不是贴链接） ───── */

/** 她主页上能看到的作品（id + 尽量取到文案）。文案是「按类型挑」的依据，取不到就只按 id 记。 */
const MY_VIDEOS_JS = String.raw`(() => {
  const out = [];
  const seen = new Set();
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  for (const a of document.querySelectorAll('a[href*="/video/"]')) {
    const m = /\/video\/(\d{8,})/.exec(String(a.getAttribute('href') || ''));
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const card = a.closest('li') || a.parentElement || a;
    const img = a.querySelector('img') || card.querySelector('img');
    const desc = clean(
      (img && (img.getAttribute('alt') || img.getAttribute('aria-label'))) ||
      a.getAttribute('aria-label') || a.getAttribute('title') ||
      (card.innerText || '')
    );
    out.push({ id: m[1], desc: desc.slice(0, 200) });
    if (out.length >= 40) break;
  }
  return out;
})()`;

/** 点视频页上那个「分享」按钮（图标按钮，文案可能只有「分享」，也可能只有 data-e2e）。 */
const CLICK_SHARE_BTN_JS = String.raw`(() => {
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.top > -60 && r.top < window.innerHeight + 60; };
  const hit = (el) => {
    if (!vis(el)) return false;
    const t = clean(el.innerText);
    const aria = clean(el.getAttribute('aria-label') || el.getAttribute('title') || '');
    const e2e = String(el.getAttribute('data-e2e') || '');
    if (/share/i.test(e2e)) return true;
    if (aria === '分享' || /^分享[（(]?\d*[)）]?$/.test(aria)) return true;
    return t === '分享' || /^分享[（(]?\d*[)）]?$/.test(t);
  };
  const cands = [...document.querySelectorAll('button,div,span,a')].filter(hit)
    .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height - rb.width * rb.height; });
  const el = cands[0];
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window })); } catch (e) { /* 忽略 */ }
  }
  try { el.click(); } catch (e) { /* 忽略 */ }
  return true;
})()`;

/** 视频页上分享图标的屏幕坐标。抖音这个按钮是 hover 才出面板的，纯 click 唤不出来。 */
const SHARE_ICON_POS_JS = String.raw`(() => {
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 10 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  };
  const cands = [];
  const icon = document.querySelector('[data-e2e="video-share-icon-container"]');
  if (icon) cands.push(icon);
  cands.push(...document.querySelectorAll('[data-e2e="video-player-share"]'));
  let el = cands.find(inView);
  if (!el) {
    el = [...document.querySelectorAll('div,span,button,a')].find((e) => {
      if (!inView(e)) return false;
      const t = clean(e.innerText);
      if (t !== '分享' && !/^分享[（(]?\d*[)）]?$/.test(t)) return false;
      return ![...e.children].some((c) => clean(c.innerText) === t);
    });
  }
  if (!el) return JSON.stringify({ ok: false });
  try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* 忽略 */ }
  const r = el.getBoundingClientRect();
  return JSON.stringify({ ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
})()`;

/**
 * 分享面板开没开。
 *
 * 踩过的坑：`[data-e2e="video-share-container"]` 这个节点常驻、且**自身渲染尺寸是 0×0**
 * （真正的面板挂在它内部的子节点上），早先拿「容器 > 40×40 且可见」当判据，
 * 结果面板明明弹出来了也一律判成「没弹出来」——主动分享一直卡在这一步。
 * 现在只看文本：容器里出现「分享给朋友 / 好友名 + 分享 / 复制链接」才算开。
 */
const SHARE_PANEL_JS = String.raw`(() => {
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const q = (sel) => document.querySelector(sel);
  const host = q('[data-e2e="video-share-icon-container"]');
  const sc = q('[data-e2e="video-share-container"]');
  if (!host && !sc) return JSON.stringify({ open: false, text: '' });
  const text = clean((host ? host.innerText : '') + ' ' + (sc ? sc.innerText : ''));
  const has = /分享给朋友|捎句话|复制链接/.test(text);
  const rows = (text.match(/分享/g) || []).length;
  const open = has && rows >= 2;
  return JSON.stringify({ open: open, text: text.slice(0, 240) });
})()`;

/**
 * 分享面板里她那一行的「分享」按钮坐标。
 * 原生面板对每个好友是行内「分享」按钮（不是「私信 / 发送给朋友」那种入口），
 * 点成功后该行会变成「捎句话」——正好用来判定发送成功。
 */
const shareRowJs = (name) => `(() => {
  const clean = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  const NAME = ${JSON.stringify(String(name ?? ''))};
  const KEY = NAME.replace(/[^\\u4e00-\\u9fa5A-Za-z0-9_.-]/g, '');
  const sc = document.querySelector('[data-e2e="video-share-container"]') || document.querySelector('[data-e2e="video-share-icon-container"]');
  if (!sc) return JSON.stringify({ err: 'no-panel' });
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.width > 6 && r.height > 6 && r.bottom > 0 && r.top < window.innerHeight; };
  const nameNodes = [...sc.querySelectorAll('div,span,p,a')].filter((e) => {
    if (!inView(e)) return false;
    const t = clean(e.innerText);
    if (t === '' || t.length > 40) return false;
    if (t !== NAME && !t.startsWith(NAME) && !(KEY.length >= 2 && t.includes(KEY))) return false;
    return ![...e.children].some((c) => clean(c.innerText) === t);
  }).sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height - rb.width * rb.height; });
  const out = [];
  for (const n of nameNodes) {
    let row = n;
    for (let i = 0; i < 6 && row && row !== sc; i += 1) {
      const rt = clean(row.innerText);
      if (rt.includes('捎句话')) { out.push({ state: 'sent' }); break; }
      if (rt.length > 240) break;
      const btn = [...row.querySelectorAll('div,span,button,a')].find((e) => {
        if (!inView(e)) return false;
        if (clean(e.innerText) !== '分享') return false;
        return ![...e.children].some((c) => clean(c.innerText) === '分享');
      });
      if (btn) {
        const r = btn.getBoundingClientRect();
        if (r.width >= 16 && r.height >= 12) out.push({ state: 'ready', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
        break;
      }
      row = row.parentElement;
    }
  }
  const ready = out.find((x) => x.state === 'ready');
  return JSON.stringify({
    ok: !!ready || out.some((x) => x.state === 'sent'),
    sent: out.some((x) => x.state === 'sent'),
    ready: ready ? { x: ready.x, y: ready.y } : null,
    text: clean(sc.innerText).slice(0, 160)
  });
})()`;

/** 她不在面板的「最近分享」里时，用面板搜索框搜一下。 */
const shareSearchJs = (name) => `(() => {
  const sc = document.querySelector('[data-e2e="video-share-container"]') || document.querySelector('[data-e2e="video-share-icon-container"]');
  if (!sc) return JSON.stringify({ ok: false });
  const box = [...sc.querySelectorAll('input')].find((i) => { const r = i.getBoundingClientRect(); return r.width > 20 && r.height > 10; });
  if (!box) return JSON.stringify({ ok: false });
  const val = ${JSON.stringify(String(name ?? ''))};
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  box.focus();
  try { setter.set.call(box, val); } catch (e) { box.value = val; }
  box.dispatchEvent(new Event('input', { bubbles: true }));
  return JSON.stringify({ ok: true });
})()`;

/** 真实鼠标移动：分享面板是 hover 出来的，JS 里 dispatching 事件唤不出来。 */
async function cdpMove(browser, x, y) {
	try {
		await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }, browser.sessionId);
	} catch { /* 忽略 */ }
}

/** 分几步滑到目标上再停住（一步跳过去有时不触发 hover）。 */
async function cdpHover(browser, x, y) {
	const x0 = Math.max(20, Math.round(x * 0.35));
	const y0 = Math.max(40, Math.round(y * 0.4));
	await cdpMove(browser, x0, y0);
	await sleep(150);
	for (let i = 1; i <= 8; i += 1) {
		await cdpMove(browser, Math.round(x0 + ((x - x0) * i) / 8), Math.round(y0 + ((y - y0) * i) / 8));
		await sleep(60);
	}
	await cdpMove(browser, x, y);
}

/** 真实鼠标点击。中途不绕路，免得把 hover 出来的面板弄没了。 */
async function cdpClick(browser, x, y) {
	await cdpMove(browser, x, y);
	await sleep(120);
	await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, browser.sessionId).catch(() => {});
	await sleep(70);
	await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, browser.sessionId).catch(() => {});
}

/** 页面 JS 统一返回 JSON 字符串，这里兜一层。 */
function parseJson(raw) {
	if (typeof raw !== 'string') return raw ?? null;
	try { return JSON.parse(raw); } catch { return null; }
}

/** 把一条接口里的作品归一成「挑类型」要用的形状；页面兜底时只有 id/desc，其余留空。 */
function toVideoItem(a) {
	const tags = [];
	for (const c of (Array.isArray(a?.cha_list) ? a.cha_list : [])) {
		const t = String(c?.cha_name ?? c?.chaName ?? c?.name ?? '').trim();
		if (t !== '') tags.push(t);
	}
	for (const t of (Array.isArray(a?.text_extra) ? a.text_extra : [])) {
		const h = String(t?.hashtag_name ?? '').trim();
		if (h !== '') tags.push(h);
	}
	if (Array.isArray(a?.tag_list)) {
		for (const t of a.tag_list) {
			const s = String(t?.tag_name ?? t ?? '').trim();
			if (s !== '') tags.push(s);
		}
	}
	const durMs = Number(a?.duration ?? a?.video?.duration ?? 0) || 0;
	return {
		id: String(a?.aweme_id ?? a?.awemeId ?? '').trim(),
		desc: String(a?.desc ?? '').trim().slice(0, 300),
		tags: [...new Set(tags)].slice(0, 20),
		durS: Math.round(durMs / 1000),
		digg: Number(a?.statistics?.digg_count ?? 0) || 0,
		at: Number(a?.create_time ?? 0) || 0,
	};
}

/**
 * 她的作品池：[{id, desc, tags, durS, digg, at}]，缓存 12 小时。
 *
 * 优先走纯 HTTP（aweme/post 一次给全文案 + 话题 + 时长 + 互动数 —— 按类型挑就靠这些字段）；
 * HTTP 不可用（没 cookie / 接口变了 / 不是 http 模式）就退回浏览器主页，抓 id + 卡片上的文案。
 */
async function videoPool(social) {
	let cached = null;
	try { cached = getKv(social.db, KV_VIDEOS, null); } catch { cached = null; }
	const norm = (x) => (typeof x === 'string'
		? { id: x, desc: '', tags: [] }
		: { id: String(x?.id ?? ''), desc: String(x?.desc ?? ''), tags: Array.isArray(x?.tags) ? x.tags : [], durS: Number(x?.durS) || 0, digg: Number(x?.digg) || 0, at: Number(x?.at) || 0 });
	const kept = (Array.isArray(cached?.items) ? cached.items : Array.isArray(cached?.ids) ? cached.ids : [])
		.map(norm)
		.filter((x) => /^\d{8,}$/.test(x.id));
	if (kept.length > 0 && Date.now() - Number(cached?.at ?? 0) < 12 * HOUR_MS) return kept;
	const http = social.http ?? null;
	let items = [];
	if (http && typeof http.selfProfile === 'function' && http.isLoggedIn?.() === true) {
		try {
			const me = await http.selfProfile();
			const secUid = String(me?.user?.sec_uid ?? '');
			if (secUid !== '') {
				const posts = await http.userPosts(secUid, { count: 30 });
				if (posts.ok) items = posts.list.map(toVideoItem).filter((x) => /^\d{8,}$/.test(x.id));
			}
		} catch { items = []; }
	}
	if (items.length === 0) {
		const browser = social.host?.browser;
		if (!browser) return kept;
		await browser.goto(PROFILE_URL, { settleMs: 6500 }).catch(() => {});
		await sleep(1600);
		const found = await browser.eval(MY_VIDEOS_JS).catch(() => []);
		items = (Array.isArray(found) ? found : [])
			.map((x) => (typeof x === 'string' ? { id: x, desc: '', tags: [] } : { id: String(x?.id ?? ''), desc: String(x?.desc ?? ''), tags: [] }))
			.filter((x) => /^\d{8,}$/.test(x.id));
	}
	// [FS-DM-SHARE-ENRICH] 页面兜底多半只抓到 id / 半句文案 → 用 detail 补全文案、话题、时长、点赞，
	// 按类型才挑得准（userPosts 端点 403 拿不到列表，这个端点实测可用）
	if (items.length > 0) items = await enrichWithDetail(http, items, { limit: 15, concurrency: 3 });
	const merged = items.length > 0 ? items : kept;
	if (merged.length > 0) { try { setKv(social.db, KV_VIDEOS, { at: Date.now(), items: merged }); } catch { /* 存不下不影响这次 */ } }
	return merged;
}

/** 搜索页上能看到的视频（id + 卡片文案）。[FS-DM-SHARE-OTHERS] */
const SEARCH_VIDEOS_JS = String.raw`(() => {
  const out = [];
  const seen = new Set();
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  for (const a of document.querySelectorAll('a[href*="/video/"]')) {
    const m = /\/video\/(\d{8,})/.exec(String(a.getAttribute('href') || ''));
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const card = a.closest('li') || a.parentElement || a;
    const img = a.querySelector('img') || card.querySelector('img');
    const desc = clean(
      (img && (img.getAttribute('alt') || img.getAttribute('aria-label'))) ||
      a.getAttribute('aria-label') || a.getAttribute('title') || (card.innerText || '')
    );
    out.push({ id: m[1], desc: desc.slice(0, 200) });
    if (out.length >= 30) break;
  }
  return out;
})()`;

/**
 * [FS-DM-SHARE-OTHERS] 在搜索页按关键词抓一批视频（别人的），滚几次多拿一些。
 * 搜索本身就是「按类型筛」—— 搜什么类型拿到的就是什么类型，不用再猜文案。
 */
async function searchPool(social, keyword) {
	const browser = social.host?.browser;
	const kw = String(keyword ?? '').trim();
	if (!browser || kw === '') return [];
	const url = `https://www.douyin.com/search/${encodeURIComponent(kw)}?type=video`;
	await browser.goto(url, { settleMs: 6500, retries: 0 }).catch(() => {});
	await sleep(1600);
	const out = [];
	const seen = new Set();
	for (let i = 0; i < 3; i += 1) {
		const found = await browser.eval(SEARCH_VIDEOS_JS).catch(() => []);
		for (const x of (Array.isArray(found) ? found : [])) {
			const id = String(x?.id ?? '');
			if (!/^\d{8,}$/.test(id) || seen.has(id)) continue;
			seen.add(id);
			out.push({ id, desc: String(x?.desc ?? ''), tags: [] });
		}
		if (out.length >= 20) break;
		await browser.eval('window.scrollBy(0, 2400)').catch(() => {});
		await sleep(1500 + i * 400);
	}
	return out;
}

/**
 * [FS-DM-SHARE-OTHERS] 「别人的视频」池 —— 用户明确要求：分享视频不许再发希希自己发的。
 *
 * 来源三条，按可靠度排：① 按她给这个人选的类型去搜索页抓（这类内容才对得上）；
 * ② 她的收藏夹（listcollection，实测可直接拿）；③ 首页推荐流（每次都是新的一批）。
 * 全部剔掉她自己作品的 id；缓存 12 小时（key 里带类型，换类型就重抓）。
 */
async function othersPool(social, { wantTypes = [], types = [] } = {}) {
	const want = (Array.isArray(wantTypes) ? wantTypes : []).map((t) => String(t ?? '').trim()).filter((t) => t !== '');
	const key = want.join('|');
	let cached = null;
	try { cached = getKv(social.db, KV_OTHERS, null); } catch { cached = null; }
	const norm = (x) => ({
		id: String(x?.id ?? ''),
		desc: String(x?.desc ?? ''),
		tags: Array.isArray(x?.tags) ? x.tags : [],
		durS: Number(x?.durS) || 0,
		digg: Number(x?.digg) || 0,
		at: Number(x?.at) || 0,
		srcType: String(x?.srcType ?? ''),
	});
	if (cached?.key === key && Array.isArray(cached?.items) && cached.items.length > 0 && Date.now() - Number(cached?.at ?? 0) < 12 * HOUR_MS) {
		return cached.items.map(norm).filter((x) => /^\d{8,}$/.test(x.id));
	}
	// 她自己的作品 id + 她的 sec_uid —— 一个都不许进池
	const selfIds = new Set((await videoPool(social).catch(() => [])).map((x) => String(x?.id ?? '')));
	const http = social.http ?? null;
	let selfSec = '';
	if (http && typeof http.selfProfile === 'function' && http.isLoggedIn?.() === true) {
		const me = await http.selfProfile().catch(() => null);
		selfSec = String(me?.user?.sec_uid ?? '');
	}
	const notMine = (a) => !(selfSec !== '' && String(a?.author?.sec_uid ?? '') === selfSec);
	const out = [];
	const seen = new Set();
	const put = (list, srcType) => {
		for (const x of (Array.isArray(list) ? list : [])) {
			const id = String(x?.id ?? '');
			if (!/^\d{8,}$/.test(id) || selfIds.has(id) || seen.has(id)) continue;
			seen.add(id);
			out.push({ ...norm(x), srcType: srcType ?? String(x?.srcType ?? '') });
		}
	};

	// ① 按类型搜（第一个词搜不到就换第二个词再试，词表没配就拿类型名）
	for (const t of want) {
		const def = types.find((x) => x.name === t);
		const kws = (Array.isArray(def?.words) ? def.words : []).map((w) => String(w ?? '').trim()).filter((w) => w !== '').slice(0, 2);
		if (kws.length === 0) kws.push(t);
		let got = [];
		for (const kw of kws) {
			got = await searchPool(social, kw).catch(() => []);
			if (got.length > 0) break;
		}
		put(got, t);
	}
	// ② 她的收藏夹 + ③ 推荐流（都是别人的，兜底用；类型只能按文案判）
	if (http && typeof http.collection === 'function' && http.isLoggedIn?.() === true) {
		const col = await http.collection({ count: 20 }).catch(() => null);
		if (col?.ok) put(col.list.filter(notMine).map(toVideoItem), '');
	}
	if (http && typeof http.feed === 'function' && http.isLoggedIn?.() === true) {
		for (let i = 0; i < 2; i += 1) {
			const f = await http.feed(20).catch(() => null);
			if (f?.ok) put(f.list.filter(notMine).map(toVideoItem), '');
			await sleep(600);
		}
	}
	// 搜索页抓到的多是卡片上那半句文案 → detail 补全文案/话题，挑类型才准
	if (out.length > 0) {
		const enriched = await enrichWithDetail(http, out, { limit: 12, concurrency: 3 }).catch(() => out);
		out.length = 0;
		for (const x of (Array.isArray(enriched) ? enriched : [])) {
			if (selfIds.has(String(x?.id ?? ''))) continue;
			out.push({ ...norm(x), srcType: String(x?.srcType ?? '') });
		}
	}
	if (out.length > 0) { try { setKv(social.db, KV_OTHERS, { at: Date.now(), key, items: out }); } catch { /* 存不下不影响这次 */ } }
	return out;
}

/**
 * [FS-DM-SHARE-ENRICH] 给缺字段的作品补 desc / 话题 / 时长 / 点赞（detail 端点）。
 * 只补缺的，单条失败不影响其它条，最多补 limit 条。
 */
export async function enrichWithDetail(http, items, { limit = 15, concurrency = 3 } = {}) {
	if (!http || typeof http.detail !== 'function' || !Array.isArray(items) || items.length === 0) return items;
	const todo = items
		.map((x, i) => ({ x, i }))
		.filter(({ x }) => String(x?.desc ?? '') === '' || !(Number(x?.durS) > 0))
		.slice(0, limit);
	if (todo.length === 0) return items;
	const out = items.slice();
	let cursor = 0;
	const worker = async () => {
		while (cursor < todo.length) {
			const cur = todo[cursor++];
			try {
				const r = await http.detail(cur.x.id);
				const detail = r?.detail ?? r?.raw?.json?.aweme_detail ?? null;
				if (detail) {
					const got = toVideoItem(detail);
					out[cur.i] = {
						id: cur.x.id,
						desc: got.desc || String(cur.x?.desc ?? ''),
						tags: got.tags.length > 0 ? got.tags : (Array.isArray(cur.x?.tags) ? cur.x.tags : []),
						durS: got.durS || Number(cur.x?.durS) || 0,
						digg: got.digg || Number(cur.x?.digg) || 0,
						at: got.at || Number(cur.x?.at) || 0,
						srcType: String(cur.x?.srcType ?? '') // [FS-DM-SHARE-OTHERS] 搜索来的类型标记别丢
					};
				}
			} catch { /* 单条失败就算了 */ }
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, () => worker()));
	return out;
}

/** 已经给这个人分享过哪几条（同一个人尽量不重复收到同一条）。 */
function sharedIds(social, name) {
	try {
		const all = getKv(social.db, KV_SHARED, {}) ?? {};
		const list = Array.isArray(all[String(name)]) ? all[String(name)] : [];
		return list.map(String).filter((x) => /^\d{8,}$/.test(x));
	} catch { return []; }
}

function noteShared(social, name, id) {
	try {
		const all = getKv(social.db, KV_SHARED, {}) ?? {};
		const list = [String(id), ...(Array.isArray(all[String(name)]) ? all[String(name)].map(String) : [])];
		all[String(name)] = [...new Set(list)].slice(0, 40);
		setKv(social.db, KV_SHARED, all);
	} catch { /* 记不上就算了 */ }
}

/**
 * 按「这个人想收哪几类」从候选池里挑一条（纯函数，方便单测）。
 * - wantTypes 空 = 不限，全池随机；
 * - [FS-DM-SHARE-OTHERS] excludeIds = 她自己作品的 id（用户要求：分享视频不要分享希希自己发的）——
 *   在**最早一步**就剔掉，后面的分类/回退都不会再把它捞回来；
 * - 候选带 srcType（搜索来的，本身就是那个类型）时直接算命中，不再靠文案猜；
 * - 过滤后一条都没有 → 退回全池并标 fellBack（只退到「别人的」池，不会再退到她自己的作品）；
 *   strictTypes=true 时不退（宁可这次不发，也不发不对类型的内容）；
 * - 同类里优先挑没发给过这个人的。
 */
export function pickShareVideo(items, { wantTypes = [], types = [], sentIds = [], excludeIds = [], strictTypes = false, random = Math.random } = {}) {
	const skip = new Set((Array.isArray(excludeIds) ? excludeIds : []).map((x) => String(x ?? '')));
	const raw = (Array.isArray(items) ? items : [])
		.filter((x) => /^\d{8,}$/.test(String(x?.id ?? '')) && !skip.has(String(x?.id ?? '')));
	// [FS-DM-SHARE-QUALITY] 质量过滤（参考 dsh-douyin-scroll 的 forward-pick）：<12s 多是模板/广告，
	// 有话可说才值得分享 —— 只在「有时长信息」时丢，页面兜底拿不到时长的不受影响。
	const pool = raw.filter((x) => !(Number(x?.durS) > 0 && Number(x?.durS) < 12));
	const base = pool.length > 0 ? pool : raw;
	if (base.length === 0) return { item: null, types: [], fellBack: false, matched: 0 };
	const want = (Array.isArray(wantTypes) ? wantTypes : []).filter((t) => String(t ?? '') !== '');
	let cands = base;
	let fellBack = false;
	if (want.length > 0) {
		cands = base.filter((x) => want.includes(String(x?.srcType ?? '')) || classifyVideo(x, types).some((t) => want.includes(t)));
		if (cands.length === 0) {
			if (strictTypes) return { item: null, types: [], fellBack: true, matched: 0 };
			cands = base;
			fellBack = true;
		}
	}
	const fresh = cands.filter((x) => !sentIds.includes(String(x.id)));
	const use = fresh.length > 0 ? fresh : cands;
	// 同类里优先热门的（按点赞降序取前 60% 再随机），避免一直挑到最冷的那几条
	const ranked = [...use].sort((a, b) => (Number(b?.digg ?? 0) || 0) - (Number(a?.digg ?? 0) || 0));
	const head = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.6)));
	const idx = Math.min(head.length - 1, Math.max(0, Math.floor(random() * head.length)));
	const item = head[idx];
	return { item, types: classifyVideo(item, types), fellBack, matched: cands.length };
}

/**
 * 把她的一条作品用抖音自带的「分享 → 私信」发给某个好友：对方收到的是视频卡片，不是链接。
 * 调用方必须已在 host.exclusive 里。
 *
 * @param {object} opts
 * @param {string[]} [opts.wantTypes] 这个只想收哪几类（空 = 不限）；没作品命中会退回「不限」
 * @param {Array<{name: string, words: string[]}>} [opts.types] 类型词表（不传就从配置里取）
 * @returns {Promise<{ok: boolean, videoId?: string, picked?: string, videoDesc?: string, videoTypes?: string[], fellBack?: boolean, error?: string}>}
 */
export async function shareVideoToFriend(social, friend, opts = {}) {
	const browser = social.host?.browser;
	if (!browser) return { ok: false, error: '浏览器没在运行' };
	const name = String(friend?.name ?? '').trim();
	if (name === '') return { ok: false, error: '没有好友名字，分享不了' };
	const types = Array.isArray(opts.types) && opts.types.length > 0
		? opts.types
		: (() => { try { return dmCfg(social.getConfig() ?? {}).shareTypes; } catch { return normalizeShareTypes(null); } })();
	const wantTypes = Array.isArray(opts.wantTypes) ? opts.wantTypes : [];
	// [FS-DM-SHARE-OTHERS] 用户要求：分享视频不要分享希希自己发的 —— 只从「别人的视频」里挑，
	// 她自己作品的 id 一路剔掉，连兜底都不许回到她自己发的；挑不到就不发（宁可不发，也不发错来源）。
	const selfIds = (await videoPool(social).catch(() => []))
		.map((x) => String(x?.id ?? ''))
		.filter((x) => /^\d{8,}$/.test(x));
	const others = await othersPool(social, { wantTypes, types }).catch(() => []);
	const items = others.filter((x) => !selfIds.includes(String(x?.id ?? '')));
	if (items.length === 0) return { ok: false, error: '没找到可分享的「别人的」视频（她自己的作品按设置不再分享）' };
	const strictTypes = wantTypes.length > 0;
	const pickedVideo = pickShareVideo(items, {
		wantTypes,
		types,
		sentIds: sharedIds(social, name),
		excludeIds: selfIds,
		strictTypes,
		random: () => (typeof social.random === 'function' ? social.random() : Math.random()),
	});
	const item = pickedVideo.item;
	if (!item) {
		return {
			ok: false,
			error: strictTypes
				? `没抓到「${wantTypes.join('/')}」这类的视频，这次不发（宁愿不发也不发不对类型的）`
				: '没找到可分享的「别人的」视频',
		};
	}
	const id = String(item.id);
	if (pickedVideo.fellBack) {
		social.log?.('info', `[fish-soul] 抖音：${name} 只看「${wantTypes.join('/')}」，别人的池里没这类的，这次退回不限（仍不发她自己发的）`);
	}
	// 详情页偶发被抖音弹回首页（风控 / 视频受限），确认地址真落到视频页再动手
	let onVideo = false;
	for (let i = 0; i < 2 && !onVideo; i += 1) {
		if (i > 0) await sleep(1200);
		await browser.goto(`https://www.douyin.com/video/${id}`, { settleMs: 6500, retries: 0 }).catch(() => {});
		await sleep(1600);
		const href = String(await browser.eval('location.href').catch(() => '') ?? '');
		onVideo = href.includes(`/video/${id}`);
	}
	if (!onVideo) return { ok: false, error: `视频详情页打不开（${id} 被弹回首页了）` };
	// 1) 真实鼠标 hover 分享图标唤出面板（纯 click 唤不出来 —— 这就是之前一直失败的原因）
	let panel = null;
	for (let i = 0; i < 3 && !panel?.open; i += 1) {
		const pos = parseJson(await browser.eval(SHARE_ICON_POS_JS).catch(() => null));
		if (pos?.ok === true) {
			await cdpHover(browser, pos.x, pos.y);
			await sleep(1800);
			panel = parseJson(await browser.eval(SHARE_PANEL_JS).catch(() => null));
		}
		if (panel?.open !== true) {
			// 兜底：万一这一版面板是点击展开的
			const clicked = (await browser.eval(CLICK_SHARE_BTN_JS).catch(() => false)) === true;
			if (clicked) {
				await sleep(1600);
				panel = parseJson(await browser.eval(SHARE_PANEL_JS).catch(() => null));
			}
		}
		if (panel?.open !== true) await sleep(1200);
	}
	if (panel?.open !== true) {
		const seen = String(panel?.text ?? '').slice(0, 40);
		return { ok: false, error: `视频页的分享面板没弹出来${seen !== '' ? `（面板里只有：${seen}）` : '（页面里没找到分享图标）'}` };
	}

	// 2) 面板里直接点她那一行的「分享」按钮
	let row = parseJson(await browser.eval(shareRowJs(name)).catch(() => null));
	if (row?.sent === true) return { ok: false, error: `这条视频她已经收过了（面板显示「捎句话」）` };
	if (row?.ready == null) {
		const searched = parseJson(await browser.eval(shareSearchJs(name)).catch(() => null));
		if (searched?.ok === true) {
			await sleep(1800);
			row = parseJson(await browser.eval(shareRowJs(name)).catch(() => null));
			if (row?.ready == null && row?.sent !== true) {
				await browser.eval(shareSearchJs('')).catch(() => {});
				await sleep(900);
				row = parseJson(await browser.eval(shareRowJs(name)).catch(() => null));
			}
		}
	}
	if (row?.ready == null) return { ok: false, error: `分享面板里没找到「${name}」` };
	// 排障用：只走到「按钮已就位」这一步，不真发（测试 / 冒烟时传 dryRun）
	if (opts.dryRun === true) {
		return { ok: true, dryRun: true, videoId: id, picked: name, ready: row.ready, videoDesc: String(item.desc ?? '').slice(0, 60) };
	}

	// 3) 点「分享」→ 该行变成「捎句话」就算发出去了
	await cdpClick(browser, row.ready.x, row.ready.y);
	await sleep(2600);
	const done = parseJson(await browser.eval(shareRowJs(name)).catch(() => null));
	if (done?.sent !== true) {
		const now = parseJson(await browser.eval(SHARE_PANEL_JS).catch(() => null));
		const toast = /已发送|发送成功|分享成功/.test(String(now?.text ?? ''));
		if (!toast) return { ok: false, error: '点了「分享」但没发出去（面板没变成「捎句话」）' };
	}
	noteShared(social, name, id);
	return {
		ok: true,
		videoId: id,
		picked: name,
		videoDesc: String(item.desc ?? '').slice(0, 120),
		videoTags: (Array.isArray(item.tags) ? item.tags : []).map((t) => String(t ?? '').trim()).filter((t) => t !== '').slice(0, 6),
		videoDurS: Number(item.durS) > 0 ? Number(item.durS) : 0,
		videoTypes: pickedVideo.types,
		fellBack: pickedVideo.fellBack,
	};
}

/* ── 说什么 ──────────────────────────────────────────────────────── */

/**
 * 让模型按她自己的性格写一句（可以 [不发]）。
 * 关键：人格卡全文递进去（persona.brief 只有 300 字，谁写出来都一个味），
 * 再把她最近发过的话一起给她看，明确要求换角度、换开头、别复用说法。
 */
export async function draft(social, friend, history, { withVideo = false, video = null } = {}) {
	const p = social.persona?.() ?? { name: '鱼', brief: '' };
	// 性格优先：full 是人格卡全文；老版本插件没提供 full 就退回 brief，不至于写不出话。
	const soulRaw = String(p.full ?? '').trim() !== '' ? String(p.full) : String(p.brief ?? '');
	const soul = soulRaw.replace(/\s+\n/g, '\n').trim().slice(0, 1800);
	const person = (() => { try { return findPersonByDouyin(social.db, friend.name); } catch { return null; } })();
	const parts = (() => { try { return social.clock.getRoleDateParts(); } catch { return {}; } })();
	const who = person
		? `这个人你认识：${String(person.display_name || friend.name).slice(0, 20)}${person.impression ? `（你心里对 ta 的印象：${String(person.impression).slice(0, 60)}）` : ''}`
		: '你们互相关注，但你其实还不太了解 ta';
	const historyLine = Array.isArray(history) && history.length > 0
		? `你们最近聊过：\n${history.slice(-6).map((m) => `${m.fromMe ? '你' : 'ta'}：${String(m.text ?? '').replace(/\s+/g, ' ').slice(0, 40)}`).join('\n')}`
		: '你们还没聊过（这是你第一次主动找 ta）';
	// 最近给别的人发过的话：连着用同一句、同一开头就露馅了
	const recentTexts = (() => {
		let list = [];
		try { list = getKv(social.db, KV_RECENT, []) ?? []; } catch { list = []; }
		return (Array.isArray(list) ? list : [])
			.map((x) => String(x?.text ?? '').replace(/\s+/g, ' ').trim())
			.filter((x) => x !== '')
			.slice(0, 6);
	})();
	const recentLine = recentTexts.length > 0
		? `你最近给别的人发过这些（别重复同样的说法、开头、句式）：\n${recentTexts.map((x) => `- ${x.slice(0, 40)}`).join('\n')}`
		: '';
	const anchorLine = String(p.anchor ?? '').trim() !== '' ? `最要紧的是这一点：${String(p.anchor).slice(0, 120)}` : '';
	// [FS-DM-SHARE-MATCH] 这次要发的那条视频，真实信息必须递给模型 ——
	// 不然它会照着以前聊过的由头瞎编（曾经把广场舞说成「刚翻到个泳装的」）。
	const videoLine = (() => {
		if (withVideo !== true) return '';
		const desc = String(video?.desc ?? '').replace(/\s+/g, ' ').trim();
		const tags = (Array.isArray(video?.tags) ? video.tags : []).map((t) => String(t ?? '').trim()).filter((t) => t !== '');
		const dur = Number(video?.durS) > 0 ? `${Number(video.durS)} 秒` : '';
		const facts = [
			desc !== '' ? `作品文案：「${desc.slice(0, 90)}」` : '这条作品没有文案',
			tags.length > 0 ? `话题：#${tags.slice(0, 6).join(' #')}` : '',
			dur !== '' ? `时长：${dur}` : '',
		].filter((x) => x !== '').join('；');
		return [
			`这次会顺手把你自己的一个视频单独发过去（先卡片、后这句话）。这条视频的真实信息只有这些：${facts}。`,
			'- 这句话就配在视频旁边，可以顺着它说一句，也可以只是随口一句闲话、只问她一句。',
			'- 硬规矩：凡是提到视频内容的，必须和上面这几项对得上。视频里没有的东西一个字都不许编 —— 别为了接以前聊过的由头，硬说「刚翻到个××的」；拿不准就不提视频。',
			'- 别报菜名式复述文案，别解释这是分享，别带话题标签。',
		].join('\n');
	})();
	const prompt = [
		`你是「${p.name}」。下面是你自己的设定，写出来的每个字都得是这个人：\n${soul}`,
		anchorLine,
		`现在是 ${parts.hour ?? 12} 点 ${parts.minute ?? 0} 分。`,
		`你要在抖音私信里，主动给一个互相关注的人发一条消息。${who}。`,
		historyLine,
		recentLine,
		'',
		'要求：',
		'- 一到两句，一共 10～60 个字，口语，是你此刻随口说的，不是客服、不是模板、也不像群发。',
		'- 语气、用词、断句、标点都要照你自己设定里的说法来，别端着、别写成书面语。',
		'- 说什么你自己挑：吐个槽、说件你此刻在干的小事、问她一句、接上次聊的话头——选最像你会做的那个。',
		'- 每条都得和上一条不一样：换角度、换开头、换句式，最近发过的说法别再用。',
		'- 不要提「互关」「关注」「看到你」这类平台关系，不要自我介绍，不要说自己是谁，也不要说「我发你个视频」。',
		'- 不要推销、不要索要联系方式、不要带链接、话题标签、@ 任何人和表情码。',
		withVideo ? videoLine : '',
		'- 实在没什么想说的，就只输出：[不发]',
		'- 只输出要发的那句话本身，不要加引号、不要解释。'
	].filter((x) => x !== '').join('\n');
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

function remember(social, { name, text, ok, error = '', shared = false }) {
	pushRecent(social, { name, text: String(text ?? ''), ok: ok === true, error: String(error ?? '').slice(0, 120), shared: shared === true, at: Date.now() });
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
/**
 * 拉一份「互相关注」候选名单（设置页「重新拉名单」用）。抓到就顺手写缓存。
 * 只在 host.exclusive 里跑，最多两分半。
 */
export async function listCandidates(social, { refresh = true } = {}) {
	const host = social.host;
	if (!host || host.running !== true) return { ok: false, list: [], error: '抖音浏览器没在运行' };
	if (host.loggedIn !== true) return { ok: false, list: [], error: '抖音还没登录' };
	if (!refresh) {
		let cached = null;
		try { cached = getKv(social.db, KV_MUTUAL, null); } catch { cached = null; }
		if (Array.isArray(cached?.list) && cached.list.length > 0) return { ok: true, list: cached.list, at: Number(cached.at ?? 0) };
	}
	const grabbed = await host.exclusive('读抖音互关名单', () => listMutualFriends(host), { maxMs: 150_000 })
		.catch((e) => ({ ok: false, list: [], error: errText(e) }));
	if (grabbed.ok !== true) {
		const why = grabbed.error ?? '没读到互关名单';
		try { setKv(social.db, KV_ERROR, why); } catch { /* 同上 */ }
		social.log('warn', `[fish-soul] 抖音主动私信：${why}`);
		return { ok: false, list: [], error: why };
	}
	const at = Date.now();
	try { setKv(social.db, KV_MUTUAL, { at, list: grabbed.list }); } catch { /* 存不下不影响这次 */ }
	return { ok: true, list: grabbed.list, at };
}

export async function runProactive(social, { manual = false } = {}) {
	const c = dmCfg(social.getConfig() ?? {});
	const host = social.host;
	if (!host || host.running !== true) return { ok: false, error: '抖音浏览器没在运行' };
	if (host.loggedIn !== true) return { ok: false, error: '抖音还没登录' };

	// ① 只发给她在设置页勾过的那几个人（不再自己抓名单、不再自己挑）
	if (c.targets.length === 0) {
		return { ok: false, error: '还没选要发给谁（设置 → 平台 → 抖音 → 主动私信，先拉互相关注名单再点选）' };
	}

	// ② 挑人：排除还在冷却期里的、排除「今天已经发到上限」的
	//    [FS-DM-ALLOW-MASTER] 名单是设置页里显式勾选的，勾了主人就照发。
	//    以前这里会先把主人名字剔掉，导致只勾了一个人（就是主人自己）时池子直接空，
	//    还会误报成「选中的人都在冷却期」。
	let sent = {};
	try { sent = getKv(social.db, KV_SENT, {}) ?? {}; } catch { sent = {}; }
	const dateStr = social.clock.getRoleDateParts().dateStr;
	const day = readDay(social, dateStr);
	const picked = c.targets;
	// [FS-DM-NOW-FORCE] 设置页「现在试一次」是手动验证：无视这个人的冷却期，也无视「同一个人一天最多几次」。
	const cooled = manual === true ? picked : picked.filter((x) => {
		const last = Number(sent[x.name] ?? 0);
		return !(last > 0 && Date.now() - last < c.coolMs);
	});
	const pool = manual === true ? picked : cooled.filter((x) => sentToday(day, x.name) < c.perDay);
	if (pool.length === 0) {
		if (cooled.length === 0) {
			return { ok: false, error: `选中的 ${c.targets.length} 个人都在冷却期（同一个人要隔 ${c.coolHours} 小时）` };
		}
		return { ok: false, error: `选中的每个人今天都发到上限了（同一个人一天最多 ${c.perDay} 次）` };
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

	// ④ 先分享一条「别人的」视频（用户要求：不许再发她自己发的）：走抖音自带的「分享 → 私信」，
	//    对方先收到视频卡片，不是链接。挑哪条按这个人在设置里选定的类型（friend.wantTypes，空 = 不限）；
	//    该类没有可发的就这次不发，绝不拿不对类型 / 她自己的作品凑数。
	//    [FS-DM-ALWAYS-SHARE] 主动私信只有这一种形态：视频卡片 + 一句话。
	//    分享没成 → 这次什么都不发（连那句文字也不发），免得对方收到的东西跟设置页说的不一致。
	const shared = await host.exclusive('把她的一条视频分享给好友', () => shareVideoToFriend(social, friend, {
		wantTypes: Array.isArray(friend.wantTypes) ? friend.wantTypes : [],
		types: c.shareTypes,
	}), { maxMs: 200_000 })
		.catch((e) => ({ ok: false, error: errText(e) }));
	if (shared?.ok !== true) {
		const why = shared?.error ?? '未知';
		remember(social, { name: friend.name, text: '', ok: false, error: `分享视频没成：${why}` });
		social.log('warn', `[fish-soul] 抖音主动私信：分享视频没成（${friend.name}）：${why}，这次什么都不发`);
		return { ok: false, error: `分享视频没成：${why}` };
	}

	// ⑤ 再补一句话（卡片后面跟一句「你看这个」，不描述画面）；这次不想说话就只留卡片
	//    [FS-DM-SESSION] 优先让「抖音·某某」这个会话里的她来说这句 —— 宿主接着把这一轮回给抖音，
	//    DSH 的抖音对话里才有她发出去的那句（以前插件直接在页面上点发送，只进了抖音、没进会话，界面里看不到）。
	//    会话没接上 / 她这次不想说 / 没落到抖音，才退回插件自己写、自己发。
	const video = { desc: shared?.videoDesc ?? '', tags: shared?.videoTags ?? [], durS: shared?.videoDurS ?? 0 };
	const videoInfo = [
		video.desc,
		Array.isArray(video.tags) && video.tags.length > 0 ? `话题：${video.tags.join(' ')}` : '',
		video.durS ? `约${Math.round(video.durS)}秒` : ''
	].filter((x) => String(x ?? '').trim() !== '').join('；') || '（读不到这条视频的信息）';
	let text = '';
	let via = '';
	let textErr = '';
	let skipFallback = false; // 她这轮明说了不说话 —— 别拿插件兜底的话硬塞给她
	if (typeof social.sayViaSession === 'function') {
		const say = await social.sayViaSession(friend.name, videoInfo)
			.catch((e) => ({ ok: false, sent: false, text: '', error: errText(e) }));
		if (String(say?.text ?? '').trim() !== '') {
			text = String(say.text).trim();
			if (say?.sent === true) via = 'session';
			else social.log('warn', `[fish-soul] 抖音主动私信：会话里写了话但没落到抖音（${friend.name}）：${say?.error ?? ''}，改由页面补发同一句`);
		} else if (say?.silent === true) {
			skipFallback = true;
			social.log('info', `[fish-soul] 抖音主动私信：她这轮不想说话，只留视频卡片（${friend.name}）`);
		} else {
			social.log('warn', `[fish-soul] 抖音主动私信：会话这次没写出话来（${friend.name}）：${say?.error ?? ''}，退回插件自己写`);
		}
	}
	if (text === '' && !skipFallback) text = await draft(social, friend, history, { withVideo: true, video });
	// via === 'session'：这句已经由会话发到抖音了，别再重发一遍
	if (text !== '' && via !== 'session') {
		const r = await host.exclusive('主动给互关好友发私信', () => sendToFriend(host, friend, text), { maxMs: 240_000 })
			.catch((e) => ({ ok: false, error: errText(e) }));
		if (typeof r?.via === 'string' && r.via !== '') via = via === '' ? r.via : `${via}+${r.via}`;
		if (r?.ok !== true) {
			textErr = r?.error ?? '没发出去';
			social.log('warn', `[fish-soul] 抖音主动私信：视频卡片已经发了，这句话没发成（${friend.name}）：${textErr}`);
		}
	}
	// 卡片已经发出去了，这一条就算发过：记下来（文字没跟上只算小瑕疵，不吞掉这次的记录）
	remember(social, {
		name: friend.name, text, ok: true, shared: true,
		error: textErr === '' ? '' : `视频卡片已发，文字没发成：${textErr}`
	});

	// ⑥ 记账：今天总共几条 + 这个人今天第几条、下次什么时候才能再发
	try {
		const byName = { ...(day.byName ?? {}) };
		byName[friend.name] = sentToday(day, friend.name) + 1;
		setKv(social.db, KV_DAY, { date: dateStr, count: day.count + 1, lastReal: Date.now(), byName });
		sent[friend.name] = Date.now();
		setKv(social.db, KV_SENT, sent);
	} catch { /* 记账失败不影响已经发出去的消息 */ }
	social.note?.('dm', { title: '抖音主动私信', reason: `给选中的 ${friend.name} 分享了一条她的视频`, text });
	return { ok: true, name: friend.name, text, via, shared: true, videoId: shared?.videoId ?? '', textError: textErr };
}

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
	let sent = {};
	try { sent = getKv(social.db, KV_SENT, {}) ?? {}; } catch { sent = {}; }
	// 名额按人算：只要还有「今天没发满、又不在冷却期」的人，就还有得发
	const left = quotaLeft(c, sent, st);
	if (left <= 0) return false;
	// 但两条之间还是要隔一会儿，别连着轰炸
	if (st.lastReal > 0 && Date.now() - st.lastReal < c.minGapMs) return false;
	// 把剩下的名额摊到剩下的 tick 上（自走层 15 分钟一次）
	const ticksLeft = Math.max(1, (hi - hour) * 4 - Math.floor((Number(parts.minute) || 0) / 15));
	if (social.random() >= Math.min(1, left / ticksLeft)) return false;
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