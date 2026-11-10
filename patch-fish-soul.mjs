#!/usr/bin/env node
/**
 * patch-fish-soul.mjs —— dsh-fish-soul 的本地补丁，**版本无关**、幂等、可自动退役。
 *
 * 设计前提：补丁是有寿命的。上游把同一件事做好之后，补丁就该自己退出，而不是继续粘在旧版本上。
 * 所以每个补丁都声明了「上游做完了长什么样」（upstreamFixed），每次运行按三态判定：
 *
 *   PATCHED  锚点在、上游没做 → 打上
 *   ALREADY  本补丁已经打过   → 跳过
 *   UPSTREAM 上游已原生实现   → **自动退役**，一行代码都不改
 *   DRIFT    锚点没了、上游也没做（改版挪了代码）→ 停手并报错，交给人（或 CI）来更新锚点
 *
 *   P1 meme-bridge  ：接上 dsh-meme 的只读取图服务（ctx.get('dshMeme')），
 *                     新增 lib/meme-bridge.js、表情包设置里一个带说明的开关。
 *   P2 douyin-social：抖音「回评论发不出 / 图文无 BGM」，按 assets/douyin-hunks.json 的
 *                     小块锚点逐处替换（不再整文件覆盖，上游小改不会整体冲突）。
 *   P3 index        ：插件热更新后人格卡 + 「此刻状态 / Top5 记忆」掉线（会话还活着，
 *                     ensureSession 见 live 直接 return 不再 setup），按 assets/index-hunks.json
 *                     补挂人格段；同样是小块锚点，不整文件覆盖。
 *   P4 plugins      ：系统设置里加「已装插件」只读清单（装了什么、从哪装的、启用没启用），
 *                     新增 lib/routes-plugins.js + 4 处锚点（client.js 3 处、routes.js 2 处），
 *                     见 assets/plugins-hunks.json。只读，不装不卸、不联网。
 *   P5 dm           ：让她主动给抖音上「互相关注」的人发私信（默认关，开关在 设置 → 平台 → 抖音 →
 *                     主动私信）：新增 lib/douyin-proactive.js（抓互关名单 / 挑人 / 写话 / 发送 / 记账），
 *                     再打 12 处锚点（douyin-social 2、index 2、config-platforms 1、routes-douyin 3、
 *                     client.douyin 4），见 assets/dm-hunks.json。
 *
 * 为什么会丢：node_modules 下的第三方插件被 pnpm 整体重写，升级 / 重装就没了。
 * 改之前把原文件备份到 ~/.dsh/backup/。
 *
 * 用法：
 *   node patch-fish-soul.mjs                       # 自动找 ~/.dsh/profiles/<profile>/node_modules/dsh-fish-soul
 *   node patch-fish-soul.mjs --root <插件目录>      # 指定插件目录（含 package.json 的那层）
 *   node patch-fish-soul.mjs --check               # 只报告状态，不改文件
 *   node patch-fish-soul.mjs --only meme           # 只跑某一个补丁（meme / douyin / remount / plugins / dm）
 *   node patch-fish-soul.mjs --json                # 结尾额外打印一段机器可读汇总（CI / audit 用）
 *   node patch-fish-soul.mjs --force               # 忽略「已打过」判断，按文件内容重算（谨慎）
 *   node patch-fish-soul.mjs --smoke               # 额外冒烟：真 import 一次插件入口（改了就会自动跑）
 *
 * 上游是否还需要这些补丁，用配套的 audit-upstream.mjs 判断（直接对 npm 最新版体检）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARK_MEME = 'FS-MEME-BRIDGE-PATCH';
const MARK_DOUYIN = 'FS-DOUYIN-SOCIAL-PATCH';

const args = process.argv.slice(2);
const opt = (name, fallback = '') => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);
const CHECK = has('--check');
const FORCE = has('--force');
const ONLY = opt('--only', '');

/** 找插件目录：显式 --root 优先，否则扫 ~/.dsh/profiles/*。 */
function findRoot() {
	const explicit = opt('--root', '');
	if (explicit !== '') {
		const root = resolve(explicit);
		if (!existsSync(join(root, 'package.json'))) throw new Error(`${root} 里没有 package.json`);
		return root;
	}
	const base = join(homedir(), '.dsh', 'profiles');
	const roots = [];
	if (existsSync(base)) {
		for (const name of readdirSync(base)) {
			const root = join(base, name, 'node_modules', 'dsh-fish-soul');
			if (existsSync(join(root, 'package.json'))) roots.push(root);
		}
	}
	if (roots.length === 0) throw new Error('没找到 dsh-fish-soul，请用 --root 指定插件目录');
	if (roots.length > 1) throw new Error(`找到多个 dsh-fish-soul，用 --root 指定一个：\n  ${roots.join('\n  ')}`);
	return roots[0];
}

const root = findRoot();
// 有人用记事本 / PowerShell 改过 package.json 的话会带 BOM，JSON.parse 直接炸，先剔掉
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
const lib = join(root, 'lib');
const backupDir = join(homedir(), '.dsh', 'backup', 'fish-soul-patch-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));

const log = (msg) => console.log(msg);
let changed = 0;
let skipped = 0;
let failed = 0;
let retired = 0;
let drifted = 0;
/** 每个补丁点的判定结果，供 --json 汇总。 */
const report = [];
const note = (patchId, status, detail) => report.push({ patch: patchId, status, detail });

/**
 * 「上游自己已经做完了」的统一判定。
 * @param {{present?: string, absent?: string}} spec present=出现这段就算做完了；absent=这段消失了才算做完
 * @param {string} text
 */
const upstreamDone = (spec, text) => {
	if (!spec) return false;
	if (typeof spec.present === 'string' && spec.present !== '') return text.includes(spec.present);
	if (typeof spec.absent === 'string' && spec.absent !== '') return !text.includes(spec.absent);
	return false;
};

/** 读成字符串（保留原换行符）。 */
const read = (rel) => readFileSync(join(lib, rel), 'utf8');
const crlf = (rel) => read(rel).includes('\r\n');

/** 把模板里的 \n 换成跟目标文件一致的换行符。 */
const fit = (text, useCrlf) => (useCrlf ? text.replace(/\n/g, '\r\n') : text);

/** 备份 + 写回。 */
function write(rel, text) {
	if (CHECK) {
		log(`  [check] 会改 ${rel}`);
		return;
	}
	const src = join(lib, rel);
	const bak = join(backupDir, rel);
	mkdirSync(dirname(bak), { recursive: true });
	// 同一个文件本次会被改多处：只在第一次备份，留下的是「本次改动前」的原文
	if (!existsSync(bak)) copyFileSync(src, bak);
	writeFileSync(src, text, 'utf8');
}

/**
 * 单点替换（唯一匹配才算成功）。
 * @returns {'patched'|'skipped'|'failed'}
 */
function replaceOnce(rel, oldStr, newStr, title, probe = '') {
	const text = read(rel);
	// probe：打完之后才会出现的短串。给「锚点替换后依然保留」的那几处用，避免重跑时在同一锚点上叠第二遍
	if (probe !== '' && text.includes(probe)) {
		log(`  ＝ ${rel}：${title} 已经打过`);
		skipped += 1;
		return 'skipped';
	}
	if (!text.includes(oldStr)) {
		if (text.includes(newStr)) {
			log(`  ＝ ${rel}：${title} 已经打过`);
			skipped += 1;
			return 'skipped';
		}
		log(`  × ${rel}：${title} 找不到锚点（上游改版挪了这段代码）；本补丁没有退役，是锚点过期了`);
		log('     → 用 audit-upstream.mjs 对着上游新版看这段改成了什么，更新锚点后重跑；不要直接 --force');
		drifted += 1;
		return 'drift';
	}
	if (text.split(oldStr).length > 2) {
		log(`  × ${rel}：${title} 的锚点出现多次，不敢改`);
		failed += 1;
		return 'failed';
	}
	write(rel, text.replace(oldStr, newStr));
	log(`  ✓ ${rel}：${title}`);
	changed += 1;
	return 'patched';
}

/** 整段函数替换：从 startPattern 起到第一个「一级缩进的 }」为止。 */
function replaceFunction(rel, startPattern, build, title) {
	const text = read(rel);
	const crlfFile = text.includes('\r\n');
	const norm = crlfFile ? text.replace(/\r\n/g, '\n') : text;
	const start = norm.indexOf(startPattern);
	if (start < 0) {
		if (norm.includes(build('__PROBE__')).toString() && norm.includes(MARK_MEME)) { /* 占位，不会走到 */ }
		log(`  × ${rel}：${title} 找不到函数起点`);
		failed += 1;
		return 'failed';
	}
	const end = norm.indexOf('\n\t}\n', start);
	if (end < 0) {
		log(`  × ${rel}：${title} 找不到函数结尾`);
		failed += 1;
		return 'failed';
	}
	const body = norm.slice(start, end + 4);
	if (body.includes(MARK_MEME)) {
		log(`  ＝ ${rel}：${title} 已经打过`);
		skipped += 1;
		return 'skipped';
	}
	const next = norm.slice(0, start) + build(body) + norm.slice(end + 4);
	write(rel, fit(next, crlfFile));
	log(`  ✓ ${rel}：${title}`);
	changed += 1;
	return 'patched';
}

// ───────────────────────────── P1：借 dsh-meme 的图库 ─────────────────────────────

const MEME_BRIDGE_SRC = join(HERE, 'assets', 'meme-bridge.js');

/**
 * 上游自己接上 dsh-meme 了吗：lib 下任意 js（不含我们自己铺的 meme-bridge.js）里出现 dshMeme。
 * 出现即代表 P1 已经被上游原生吸收，整个补丁退役。
 * 注意：本补丁自己会往 index.js 里写一行带 dshMeme 的注释，所以先剔掉带 FS-MEME-BRIDGE-PATCH 标记的行，
 * 否则「自己写的注释」会被当成「上游已经做了」。
 */
function memeUpstreamDone() {
	const files = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			let st;
			try { st = statSync(p); } catch { continue; }
			if (st.isDirectory()) walk(p);
			else if (name.endsWith('.js') && name !== 'meme-bridge.js') files.push(p);
		}
	};
	try { walk(lib); } catch { return false; }
	const strip = (s) => s.split('\n').filter((line) => !line.includes(MARK_MEME)).join('\n');
	return files.some((p) => {
		try { return strip(readFileSync(p, 'utf8')).includes('dshMeme'); } catch { return false; }
	});
}

function patchMeme() {
	log('\n[P1] fish-soul-meme-bridge —— 借 dsh-meme 的只读取图服务');
	if (memeUpstreamDone()) {
		log('  ↷ 上游已原生接入 dsh-meme（lib 下已有 dshMeme 调用）→ 本补丁自动退役，不改任何文件');
		note('meme-bridge', 'UPSTREAM', '插件源码已自带 dshMeme 取图服务');
		retired += 1;
		return;
	}
	const bridgePath = join(lib, 'meme-bridge.js');
	if (existsSync(bridgePath) && readFileSync(bridgePath, 'utf8').includes(MARK_MEME)) {
		log('  ＝ lib/meme-bridge.js 已经存在');
		skipped += 1;
	} else {
		if (!existsSync(MEME_BRIDGE_SRC)) {
			log(`  × 缺 assets/meme-bridge.js（应该在补丁包根目录下）`);
			failed += 1;
			return;
		}
		if (!CHECK) {
			mkdirSync(dirname(bridgePath), { recursive: true });
			writeFileSync(bridgePath, readFileSync(MEME_BRIDGE_SRC, 'utf8'), 'utf8');
		}
		log('  ✓ lib/meme-bridge.js（新文件）');
		changed += 1;
	}

	// 0) 绝对路径 → markdown 图片引用（路径里有空格 / 括号时网关的图片正则抽不出来，得包 file://）
	replaceOnce('stickers.js',
		'const EMPTY_TAGS = Object.freeze([]);',
		`/** 绝对路径 → markdown 图片引用：有空格 / 括号就包一层 file://，否则网关的图片正则会把路径截断。 [${MARK_MEME}] */\n` +
		'const imageRef = (path) => {\n' +
		"\tconst one = String(path ?? '').replace(/\\\\/g, '/');\n" +
		"\treturn /[\\s()<>]/.test(one) ? 'file:///' + encodeURI(one) : one;\n" +
		'};\n' +
		'const EMPTY_TAGS = Object.freeze([]);',
		'加 imageRef 帮助函数', 'const imageRef = (path)');

	// 1) 配置：stickerConfig 多一个 meme 开关
	replaceOnce('stickers.js',
		"\t\tbiliPanelListed: Number.isFinite(listed) ? Math.min(60, Math.max(0, Math.floor(listed))) : 30\n\t};",
		"\t\tbiliPanelListed: Number.isFinite(listed) ? Math.min(60, Math.max(0, Math.floor(listed))) : 30,\n" +
		`\t\t// 借 dsh-meme 的只读图库（默认关）：自己的表情包里没有合适的就借它的 [${MARK_MEME}]\n` +
		"\t\tmeme: v.meme === true\n\t};",
		'stickerConfig 加 meme 开关');

	// 2) StickerBox 收下桥
	replaceOnce('stickers.js',
		"\tconstructor({ db, getConfig, log }) {\n\t\tObject.assign(this, { db, getConfig });",
		"\tconstructor({ db, getConfig, log, meme = null }) {\n" +
		`\t\t// meme：dsh-meme 的只读取图桥（meme-bridge.js）；没装 / 没开就一直是 null [${MARK_MEME}]\n` +
		"\t\tObject.assign(this, { db, getConfig, meme });",
		'StickerBox 构造参数加 meme');

	// 3) 按感觉挑表情：借到的图是绝对路径，得按绝对路径写进 markdown
	replaceFunction('stickers.js', '\tasync resolveFeelRefs(', () =>
		[
			'\tasync resolveFeelRefs(text, workspacePath, embedder, { model = \'\' } = {}) {',
			'\t\tconst parsed = parseFeelRefs(text);',
			'\t\tif (parsed.feels.length === 0) return { text: parsed.text, resolved: [] };',
			'\t\tlet out = parsed.text;',
			'\t\tconst resolved = [];',
			'\t\tfor (const one of parsed.feels.slice(0, 2)) {',
			'\t\t\tconst r = await this.pickByFeel(workspacePath, one.feel, embedder, { model, top: 5 });',
			`\t\t\t// 借 dsh-meme 挑到的是磁盘绝对路径（已经在 fish-soul 自己的缓存目录里），自己的表情仍是 _stickers/ 文件名 [${MARK_MEME}]`,
			"\t\t\tconst ref = r.ok ? (r.absolute === true ? imageRef(r.file) : `_stickers/${r.file}`) : '';",
			'\t\t\tresolved.push({',
			'\t\t\t\tfeel: one.feel,',
			'\t\t\t\tfile: r.ok ? r.file : null,',
			'\t\t\t\tlabel: r.ok ? (r.label ?? r.file) : null,',
			'\t\t\t\tfromMeme: r.fromMeme === true,',
			'\t\t\t\treason: r.ok ? null : (r.reason ?? null)',
			'\t\t\t});',
			'\t\t\tout = out.split(one.whole).join(r.ok ? `![${one.feel}](${ref})` : \'\');',
			'\t\t}',
			"\t\treturn { text: out.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim(), resolved };",
			'\t}',
			''
		].join('\n'), 'resolveFeelRefs 支持绝对路径');

	// 4) pickByFeel：自己的库里没有 → 借 dsh-meme
	replaceFunction('stickers.js', '\tasync pickByFeel(', () =>
		[
			'\tasync pickByFeel(workspacePath, feel, embedder, { model = \'\', avoid = [], top = 5 } = {}) {',
			"\t\tconst want = String(feel ?? '').trim();",
			"\t\tif (want === '') return { ok: false, reason: '没说要什么感觉' };",
			`\t\t// 先在自己的表情包里按标签向量找；没有 / 算不出来，才去借 dsh-meme 的图库 [${MARK_MEME}]`,
			"\t\tlet localReason = '';",
			'\t\tif (!embedder) {',
			"\t\t\tlocalReason = '没配嵌入模型';",
			'\t\t} else {',
			'\t\t\tconst pool = this.collected()',
			'\t\t\t\t.filter((x) => sameWs(x.workspacePath, workspacePath) && typeof x.vec === \'string\' && x.vec !== \'\')',
			"\t\t\t\t.map((x) => ({ file: x.file, vec: blobToF32(Buffer.from(x.vec, 'base64')) }));",
			"\t\t\tif (pool.length === 0) localReason = '还没有表情打过标签';",
			'\t\t\telse {',
			'\t\t\t\tconst r = await embedder.embed([want]);',
			"\t\t\t\tif (!r) localReason = '算相似度失败';",
			'\t\t\t\telse {',
			'\t\t\t\t\tconst q = new Float32Array(normalizeToBlob(r.vectors[0]).buffer.slice(0));',
			'\t\t\t\t\tconst ranked = rankByFeel({ vec: q, pool, top: Math.max(top, 1) });',
			'\t\t\t\t\tconst fresh = ranked.filter((x) => !avoid.includes(x.file));',
			'\t\t\t\t\tconst pick = (fresh.length > 0 ? fresh : ranked)[0];',
			"\t\t\t\t\tif (!pick) localReason = '没找到像的';",
			'\t\t\t\t\telse return { ok: true, file: pick.file, candidates: ranked.map((x) => x.file) };',
			'\t\t\t\t}',
			'\t\t\t}',
			'\t\t}',
			'\t\tconst borrowed = await this.pickFromMeme(want, avoid);',
			'\t\tif (borrowed.ok) return borrowed;',
			"\t\treturn { ok: false, reason: localReason || borrowed.reason || '没找到像的', memeReason: borrowed.reason };",
			'\t}',
			'',
			'\t/**',
			'\t * 借 dsh-meme 的只读取图服务挑一张（只读它的图库；挑中的图复制进 fish-soul 自己的缓存目录再发）。',
			'\t * 开关没开 / 没装 dsh-meme / 那边也没图，都只是返回 ok:false，不影响别的地方。',
			'\t * @returns {Promise<{ok: boolean, file?: string, absolute?: boolean, fromMeme?: boolean, label?: string, reason?: string}>}',
			'\t */',
			'\tasync pickFromMeme(feel, avoid = []) {',
			'\t\tconst cfg = this.getConfig();',
			"\t\tif (cfg.meme !== true) return { ok: false, reason: '没开「借 dsh-meme 的表情库」' };",
			"\t\tif (!this.meme || typeof this.meme.pick !== 'function') return { ok: false, reason: '没找到 dsh-meme 的取图服务' };",
			'\t\ttry {',
			'\t\t\tconst r = await this.meme.pick({ feel, avoid });',
			"\t\t\tif (!r?.ok) return { ok: false, reason: r?.reason ?? 'dsh-meme 那边没挑到' };",
			'\t\t\treturn {',
			'\t\t\t\tok: true,',
			'\t\t\t\tfile: r.path,',
			'\t\t\t\tabsolute: true,',
			'\t\t\t\tfromMeme: true,',
			'\t\t\t\tlabel: r.label ?? r.caption ?? r.tag ?? \'\',',
			'\t\t\t\tcaption: r.caption ?? \'\',',
			'\t\t\t\ttag: r.tag ?? \'\',',
			'\t\t\t\tpackName: r.packName ?? \'\'',
			'\t\t\t};',
			'\t\t} catch (error) {',
			"\t\t\tthis.log('warn', `[fish-soul] 借 dsh-meme 挑表情失败：${String(error instanceof Error ? error.message : error)}`);",
			"\t\t\treturn { ok: false, reason: 'dsh-meme 那边出错了' };",
			'\t\t}',
			'\t}',
			''
		].join('\n'), 'pickByFeel 借库兜底');

	// 5) 日志里别把绝对路径糊到界面上
	replaceOnce('gateway.js',
		'reason: one.file ? `按感觉挑中了 ${one.file}`',
		`reason: one.file ? \`按感觉挑中了 \${one.label ?? one.file}\` /* [${MARK_MEME}] */`,
		'挑表情日志改成友好名字');

	// 6) index.js：造桥 + 传下去
	replaceOnce('index.js',
		"import { StickerBox, stickerConfig } from './stickers.js';",
		"import { StickerBox, stickerConfig } from './stickers.js';\n" +
		`import { createMemeBridge } from './meme-bridge.js'; // [${MARK_MEME}]`,
		'import meme-bridge', 'import { createMemeBridge }');

	// 桥必须建在 buildContextBlock 之前（提示词里要用它的 status()），所以挪到 canConvertWebp 后面
	replaceOnce('index.js',
		'\tconst canConvertWebp = () => sharpReady() || douyinHost.running;',
		'\tconst canConvertWebp = () => sharpReady() || douyinHost.running;\n' +
		`\t// 借 dsh-meme 的只读取图服务（ctx.get('dshMeme')）：没装 / 开关关着都自己降级 [${MARK_MEME}]\n` +
		'\tconst memeBridge = createMemeBridge({ ctx, log, canConvertWebp });',
		'造 meme 桥', 'const memeBridge = createMemeBridge');
	replaceOnce('index.js',
		"\tconst stickersBox = new StickerBox({ db, getConfig: () => stickerConfig(currentConfig.stickers), log });",
		"\tconst stickersBox = new StickerBox({ db, getConfig: () => stickerConfig(currentConfig.stickers), log, meme: memeBridge });",
		'把 meme 桥交给 StickerBox');

	// 7) index.js：给模型的发图规则里说明「没有就去借」
	replaceOnce('index.js',
		"\t\t\tconst stickerRule = stickers.length > 0\n" +
		"\t\t\t\t? `发表情包写 ![名字](_stickers/文件名)（一次最多 2 张）；只想表达某种感觉、不确定是哪张时，写 ![得意](_stickers/@得意) 让她按标签自己挑，可用：${stickers.join('、')}；`\n" +
		"\t\t\t\t: '';",
		`\t\t\t// 借 dsh-meme 的图库开着、那边也确实有图时，才跟她说「没有就借」 [${MARK_MEME}]\n` +
		'\t\t\tconst memeReady = stickerConfig(currentConfig.stickers).meme === true && memeBridge.status().ok === true;\n' +
		"\t\t\tconst memeRule = memeReady ? '自己的表情包里没有合适的，会自动去 dsh-meme 的图库里挑一张发（不用编文件名）；' : '';\n" +
		'\t\t\tconst stickerRule = stickers.length > 0\n' +
		"\t\t\t\t? `发表情包写 ![名字](_stickers/文件名)（一次最多 2 张）；只想表达某种感觉、不确定是哪张时，写 ![得意](_stickers/@得意) 让她按标签自己挑，可用：${stickers.join('、')}；` + memeRule\n" +
		"\t\t\t\t: (memeRule === '' ? '' : `只想表达某种感觉时写 ![得意](_stickers/@得意)（一次最多 2 张），她按感觉自己挑；${memeRule}`);",
		'提示词里加借库说明');

	// 8) 配置 schema
	replaceOnce('config-schema.js',
		'\t\t\tbiliPanelListed: z.number().default(30) // 提示词里最多列几个码（面板有 400+，放不下）',
		'\t\t\tbiliPanelListed: z.number().default(30), // 提示词里最多列几个码（面板有 400+，放不下）\n' +
		`\t\t\t// 借 dsh-meme 的图库（只读取图，默认关）：自己的表情包里没有合适的，就去它那儿挑一张 [${MARK_MEME}]\n` +
		'\t\t\tmeme: z.boolean().default(false)',
		'config-schema 加 meme');

	// 9) 设置接口
	replaceOnce('routes-v07.js',
		'\t\tif (b.biliPanel !== undefined) s.biliPanel = b.biliPanel === true;',
		'\t\tif (b.biliPanel !== undefined) s.biliPanel = b.biliPanel === true;\n' +
		`\t\tif (b.meme !== undefined) s.meme = b.meme === true; // 借 dsh-meme 的图库（只读取图）[${MARK_MEME}]`,
		'/stickers/config 收 meme', 's.meme = b.meme === true');

	// 10) 设置界面：带说明的开关
	replaceOnce('client.js',
		'\t\t\t\t\t\tMuted("张/天")) : null,',
		'\t\t\t\t\t\tMuted("张/天")) : null,\n' +
		'\t\t\t\t\tform.enabled ? Row({ title: "借 dsh-meme 的表情库",\n' +
		'\t\t\t\t\t\tdesc: qq.stickers?.meme === true\n' +
		'\t\t\t\t\t\t\t? "已开：她自己的表情包里没有合适的，就去 dsh-meme 的图库里挑一张（只读取图：不改动它的图库、不占收藏额度；图会复制一份到 fish-soul 自己的缓存目录再发）"\n' +
		'\t\t\t\t\t\t\t: "她自己的表情包里没有合适的时，去 dsh-meme 的图库挑一张发（只读取图；需要本机装了 dsh-meme 并打开了图库）" },\n' +
		'\t\t\t\t\t\th(Switch, { label: "借 dsh-meme 的表情库", checked: qq.stickers?.meme === true,\n' +
		'\t\t\t\t\t\t\tonChange: (v) => run("/stickers/config", { meme: v }, v ? "没有合适的会去 dsh-meme 挑表情" : "只用自己的表情包", "保存失败") })) : null,',
		'设置页加开关', '借 dsh-meme 的表情库');
}

// ───────────────────────────── P2 / P3：锚点小块补丁 ─────────────────────────────

/**
 * 每处改动都是一小段锚点替换（old → new），各自带 upstreamFixed：
 * 上游哪天自己把某一处改好了，那一处就自动退役，其余几处继续打，互不牵连。
 * 全部退役时这一组就自然什么都不做了。
 *
 * upstreamFixedIn（可选）：判断「上游修好了没」要读哪个文件，默认就是 h.file。
 * 有些补丁改的是 A 文件，但上游真正的修复出现在 B 文件里，就把这里指过去。
 */
function patchHunks({ tag, label, jsonName }) {
	log(`\n[${tag}] ${label}（锚点补丁）`);
	const hunksPath = join(HERE, 'assets', jsonName);
	if (!existsSync(hunksPath)) {
		log(`  × 缺 assets/${jsonName}（补丁包根目录 assets 下应带着它）`);
		failed += 1;
		return;
	}
	const hunks = JSON.parse(readFileSync(hunksPath, 'utf8'));
	let up = 0;
	for (const h of hunks) {
		const rel = String(h.file ?? '').replace(/^lib\//, '');
		if (!existsSync(join(lib, rel))) {
			log(`  × 没有 lib/${rel}，插件版本可能太老 / 太新`);
			failed += 1;
			note(h.id, 'MISSING', h.title);
			continue;
		}
		const text = read(rel);
		const fixRel = String(h.upstreamFixedIn ?? h.file ?? '').replace(/^lib\//, '');
		const fixText = fixRel === rel ? text : existsSync(join(lib, fixRel)) ? readFileSync(join(lib, fixRel), 'utf8') : '';
		const result = (() => {
			// 先认「完整新版」：h.new 整段已经在文件里，就说明这处是最新的，必须立刻收手。
			// 这一步不能挪到 upgradeOld 后面 —— 旧版模板经常是新版的前缀（dm-vars 就是），
			// 那样每跑一次都会再追加一份，跑两次就是重复声明 const dmCands 直接白屏。
			if (text.includes(h.new)) {
				log(`  ＝ lib/${rel}：${h.title} 已经打过`);
				return 'skipped';
			}
			// 升级：这处上一版已经打过，现在模板改了内容。按「旧模板原文 → 新模板」整段换掉，
			// 不用重新找锚点（锚点早就不在原处了）。h.upgradeOld 记的是上一版的 new。
			if (typeof h.upgradeOld === 'string' && h.upgradeOld !== '' && h.upgradeOld !== h.new && text.includes(h.upgradeOld)) {
				write(rel, text.replace(h.upgradeOld, h.new));
				log(`  ↑ lib/${rel}：${h.title} 旧版已打 → 升到新版`);
				changed += 1;
				note(h.id, 'UPGRADED', h.title);
				return 'upgraded';
			}
			if (text.includes(h.marker) || text.includes(h.new)) {
				log(`  ＝ lib/${rel}：${h.title} 已经打过`);
				return 'skipped';
			}
			if (upstreamDone(h.upstreamFixed, fixText)) {
				up += 1;
				log(`  ↷ lib/${rel}：${h.title} —— 上游已自己修好（${JSON.stringify(h.upstreamFixed)}）→ 本处退役`);
				note(h.id, 'UPSTREAM', h.title);
				return 'upstream';
			}
			if (!text.includes(h.old)) {
				log(`  × lib/${rel}：${h.title} 找不到锚点（上游改版挪了这段代码），本补丁没退役、是锚点过期了`);
				drifted += 1;
				note(h.id, 'DRIFT', h.title);
				return 'drift';
			}
			if (text.split(h.old).length > 2) {
				log(`  × lib/${rel}：${h.title} 的锚点在文件里出现多次，不敢猜改哪一处`);
				failed += 1;
				note(h.id, 'AMBIGUOUS', h.title);
				return 'ambiguous';
			}
			write(rel, text.replace(h.old, h.new));
			log(`  ✓ lib/${rel}：${h.title}`);
			changed += 1;
			note(h.id, 'PATCHED', h.title);
			return 'patched';
		})();
		if (result === 'skipped') {
			skipped += 1;
			note(h.id, 'ALREADY', h.title);
		}
	}
	if (up === hunks.length) {
		log(`  ↷ ${hunks.length} 处在最新上游里都已自行修好 → ${tag} 这组整体退役，不需要再维护`);
		retired += 1;
	}
}

// ───────────────────────────── P4：系统设置里的「已装插件」─────────────────────────────

const PLUGINS_ROUTE_SRC = join(HERE, 'assets', 'plugins-route.js');
// routes-plugins.js 自己的版本戳：内容一改就跟着改，老版本会被自动顶掉
const PLUGINS_ROUTE_VER = 'FS-PLUGINS-ROUTE v4';

/**
 * 设置页加一个只读的「个人插件」清单：新增 lib/routes-plugins.js（读当前 profile 的 dependencies
 * 与各插件自己的 package.json，本地算出来，不联网），再按 assets/plugins-hunks.json 打锚点。
 * 这一页只列本仓库打在 dsh-fish-soul 上的补丁，不列 DSH 宿主里装的插件。
 */
function patchPlugins() {
	log('\n[P4 plugins] 设置里列出个人插件（只读清单）');
	const routePath = join(lib, 'routes-plugins.js');
	const haveRoute = existsSync(routePath) ? readFileSync(routePath, 'utf8') : '';
	if (haveRoute.includes(PLUGINS_ROUTE_VER)) {
		log('  ＝ lib/routes-plugins.js 已经是最新的');
		skipped += 1;
	} else {
		const upgrading = haveRoute !== '';
		if (!existsSync(PLUGINS_ROUTE_SRC)) {
			log('  × 缺 assets/plugins-route.js（补丁包根目录 assets 下应带着它）');
			failed += 1;
			return;
		}
		if (!CHECK) {
			mkdirSync(dirname(routePath), { recursive: true });
			if (upgrading) {
				const bak = join(backupDir, 'routes-plugins.js');
				mkdirSync(dirname(bak), { recursive: true });
				if (!existsSync(bak)) copyFileSync(routePath, bak);
			}
			writeFileSync(routePath, readFileSync(PLUGINS_ROUTE_SRC, 'utf8'), 'utf8');
		}
		log(upgrading ? '  ↑ lib/routes-plugins.js（旧版 → 新版：个人插件清单里带上补丁核对）' : '  ✓ lib/routes-plugins.js（新文件）');
		changed += 1;
	}
	patchHunks({ tag: 'P4 plugins', label: '设置 → 系统 → 已装插件', jsonName: 'plugins-hunks.json' });
}

// ───────────────────────────── P5：主动给抖音互关好友发私信 ─────────────────────────────

const DM_SRC = join(HERE, 'assets', 'douyin-proactive.js');

/**
 * 抖音那边原本只有「别人发来 → 她回」，没有「她主动找人」。
 * 这里新增 lib/douyin-proactive.js（拉希希关注列表里互相关注的人 / 按人格写话 / 发送 + 记账），
 * 再按 assets/dm-hunks.json 打 12 处锚点：douyin-social（方法 + status）、index（tick + 人格全文注入）、
 * config-platforms（schema）、routes-douyin（回显 / 保存 / 候选名单 + 新路由）、
 * client.douyin（设置页：拉名单 → 自己勾人 + 同一个人一天最多几次 + 同一个人隔几小时）。
 */
function patchDm() {
	log('\n[P5 dm] 主动给抖音互关好友发私信（设置 → 平台 → 抖音 → 主动私信）');
	const target = join(lib, 'douyin-proactive.js');
	const hasMarker = existsSync(target) && readFileSync(target, 'utf8').includes('FS-DOUYIN-DM-PATCH');
	// 老版本装过（内容跟本包里的不一样）→ 整份换成包里的新版；本插件自己的文件，不做逐行 diff。
	const staleFile = hasMarker && existsSync(DM_SRC) && readFileSync(target, 'utf8') !== readFileSync(DM_SRC, 'utf8');
	if (staleFile) {
		if (!CHECK) writeFileSync(target, readFileSync(DM_SRC, 'utf8'), 'utf8');
		log('  ↑ lib/douyin-proactive.js 老版本 → 换成新版');
		changed += 1;
	} else if (hasMarker) {
		log('  ＝ lib/douyin-proactive.js 已经存在');
		skipped += 1;
	} else {
		if (!existsSync(DM_SRC)) {
			log('  × 缺 assets/douyin-proactive.js（补丁包根目录 assets 下应带着它）');
			failed += 1;
			return;
		}
		if (!CHECK) {
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, readFileSync(DM_SRC, 'utf8'), 'utf8');
		}
		log('  ✓ lib/douyin-proactive.js（新文件）');
		changed += 1;
	}
	patchHunks({ tag: 'P5 dm', label: '抖音 —— 主动给互关好友发私信', jsonName: 'dm-hunks.json' });
}

/**
 * P6 share：「刷到有意思的就发给你」改成发视频卡片（不是发链接）。
 *
 * 老路：douyin-browse 刷完 → life.queueShare 排一条「把链接原样发出去 + 感受」的主动消息（发到 QQ）。
 * 新路：同上排队，但 deliverOne 里先用抖音自带的「分享 → 私信」把那条视频发给主人（卡片），
 *       再补一句话；卡片这条路不通才退回发链接。分享的类型从她在设置里选的几个里挑**一个**来搜。
 *
 * ⚠️ 必须排在 P5 dm 之后：dm 先把 lib/douyin-proactive.js 换成新版，share 才有 shareBrowsedVideo 可用。
 */
function patchShare() {
	log('\n[P6 share] 抖音 —— 刷到的视频发卡片（不是发链接）');
	patchHunks({ tag: 'P6 share', label: '刷到有意思的就发给你 → 视频卡片', jsonName: 'share-hunks.json' });
}

/**
 * 打完补丁后冒烟：真把插件入口 import 一次。
 * 文本上全是 PATCHED 不等于能加载 —— 比如 schemastery 根本没有 z.record（是 z.dict），
 * 写入时毫无报错，要等宿主启用插件才炸成「1 entry did not activate」。
 * 这里提前把它暴露在打补丁这一步。
 */
function smokeLoad() {
	const entry = join(lib, 'index.js');
	if (!existsSync(entry)) return;
	const code =
		`import(${JSON.stringify(pathToFileURL(entry).href)})` +
		`.then(()=>console.log('SMOKE_OK'))` +
		`.catch((e)=>{console.log('SMOKE_FAIL '+(e&&e.message?e.message:String(e)));process.exit(3)})`;
	// node:sqlite 在 22.5+ 是实验特性，得带 flag 才能 import（插件本身要求 node>=22.5）
	const run = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', '--input-type=module', '-e', code], {
		encoding: 'utf8',
		cwd: root,
		timeout: 180000
	});
	const out = `${run.stdout || ''}${run.stderr || ''}`;
	if (out.includes('SMOKE_OK')) {
		log('✓ 冒烟：插件入口 import 通过');
		note('P0 smoke', 'PATCHED', '插件入口 import 通过');
		return;
	}
	failed += 1;
	const tail = out.trim().split('\n').slice(-6).join('\n');
	note('P0 smoke', 'DRIFT', `插件入口 import 失败：${tail.replace(/\s+/g, ' ').slice(0, 400)}`);
	log(`\n× 冒烟失败：补丁写进去了但插件加载不了（宿主会报 "did not activate"）\n${tail}`);
}

// ───────────────────────────── 主流程 ─────────────────────────────

log(`dsh-fish-soul ${pkg.version} → ${root}`);
if (CHECK) log('（--check：只看状态，不改文件）');
try {
	if (ONLY === '' || ONLY === 'meme') patchMeme();
	if (ONLY === '' || ONLY === 'douyin')
		patchHunks({ tag: 'P2 douyin', label: 'douyin-social —— 回评论发不出 / 图文无 BGM', jsonName: 'douyin-hunks.json' });
	if (ONLY === '' || ONLY === 'remount')
		patchHunks({ tag: 'P3 remount', label: 'index —— 热更新后人格卡 + 记忆块掉线', jsonName: 'index-hunks.json' });
	if (ONLY === '' || ONLY === 'plugins') patchPlugins();
	if (ONLY === '' || ONLY === 'dm') patchDm();
	if (ONLY === '' || ONLY === 'share') patchShare();
} catch (error) {
	log(`\n× 出错：${String(error instanceof Error ? error.message : error)}`);
	process.exitCode = 1;
}

// 文本替换全 PATCHED 不代表宿主能加载，改过就跑一次冒烟；--smoke 可单独要求
if ((!CHECK && changed > 0) || has('--smoke')) smokeLoad();

if (!CHECK && changed > 0) log(`\n原文件备份在：${backupDir}`);
log(`\n结果：改了 ${changed} 处，已打过 ${skipped} 处，上游已实现 / 自动退役 ${retired} 段，漂移 ${drifted} 处，失败 ${failed} 处`);
if (retired > 0) log('退役的补丁不需要再维护：上游已经自己做好了，下次升级也不用管它。');
if (drifted > 0) log('漂移的补丁不是「上游修好了」，是上游改版把锚点挪走了，需要更新锚点（见上游新版对应片段）。');
if (changed > 0 && !CHECK) log('改完重启 DeepSeek Harness（或重新加载插件）才生效。');
if (failed > 0 || drifted > 0) process.exitCode = 1;

if (has('--json')) {
	console.log(
		'\n' +
			JSON.stringify(
				{
					plugin: 'dsh-fish-soul',
					version: pkg.version,
					root,
					check: CHECK,
					summary: { patched: changed, already: skipped, retired, drifted, failed },
					patches: report
				},
				null,
				2
			)
	);
}
