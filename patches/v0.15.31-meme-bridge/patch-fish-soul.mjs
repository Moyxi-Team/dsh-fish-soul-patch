#!/usr/bin/env node
/**
 * patch-fish-soul.mjs —— dsh-fish-soul 的两处本地补丁，幂等可重跑。
 *
 *   P1 fish-soul-meme-bridge  ：接上 dsh-meme 的只读取图服务（ctx.get('dshMeme')），
 *                               新增 lib/meme-bridge.js、表情包设置里一个带说明的开关。
 *   P2 douyin-social-0.15.30  ：抖音「回评论发不出 / 图文无 BGM」修复（lib/douyin-social.js 四处改动，
 *                               由 patches/douyin-social/ 里的 fixed 文件整体替换）。
 *
 * 为什么会丢：node_modules 下的第三方插件被 pnpm 整体重写，升级 / 重装就没了。
 * 所以补丁都带唯一标记，重跑时检测到标记就跳过；改之前把原文件备份到 ~/.dsh/backup/。
 *
 * 用法：
 *   node patch-fish-soul.mjs                       # 自动找 ~/.dsh/profiles/<profile>/node_modules/dsh-fish-soul
 *   node patch-fish-soul.mjs --root <插件目录>      # 指定插件目录（含 package.json 的那层）
 *   node patch-fish-soul.mjs --check               # 只报告状态，不改文件
 *   node patch-fish-soul.mjs --only meme           # 只跑某一个补丁（meme / douyin）
 *   node patch-fish-soul.mjs --force               # 忽略「已打过」判断，按文件内容重算（谨慎）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lib = join(root, 'lib');
const backupDir = join(homedir(), '.dsh', 'backup', 'fish-soul-patch-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));

const log = (msg) => console.log(msg);
let changed = 0;
let skipped = 0;
let failed = 0;

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
	copyFileSync(src, bak);
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
		if (text.includes(MARK_MEME) || text.includes(MARK_DOUYIN)) {
			log(`  ＝ ${rel}：${title} 找不到锚点，但文件已带补丁标记（当作已打过；插件若大改过请用 --force 前先看 README）`);
			skipped += 1;
			return 'skipped';
		}
		log(`  × ${rel}：${title} 找不到锚点（插件版本可能变了）`);
		failed += 1;
		return 'failed';
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

function patchMeme() {
	log('\n[P1] fish-soul-meme-bridge —— 借 dsh-meme 的只读取图服务');
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

// ───────────────────────────── P2：抖音 0.15.30 修复 ─────────────────────────────

function patchDouyin() {
	log('\n[P2] douyin-social —— 回评论发不出 / 图文无 BGM（0.15.30 补丁）');
	const target = join(lib, 'douyin-social.js');
	const fixed = join(HERE, 'assets', 'douyin-social-fixed.js');
	if (!existsSync(target)) {
		log('  × 没有 lib/douyin-social.js，插件版本可能太老 / 太新');
		failed += 1;
		return;
	}
	const now = readFileSync(target, 'utf8');
	if (now.includes(MARK_DOUYIN)) {
		log('  ＝ lib/douyin-social.js 已经打过');
		skipped += 1;
		return;
	}
	if (!existsSync(fixed)) {
		log('  × 缺 assets/douyin-social-fixed.js');
		failed += 1;
		return;
	}
	const fixedText = readFileSync(fixed, 'utf8');
	if (!CHECK) {
		const bak = join(backupDir, 'lib', 'douyin-social.js');
		mkdirSync(dirname(bak), { recursive: true });
		copyFileSync(target, bak);
		writeFileSync(target, fixedText, 'utf8');
	}
	log('  ✓ lib/douyin-social.js 换成修好的版本');
	changed += 1;
}

// ───────────────────────────── 主流程 ─────────────────────────────

log(`dsh-fish-soul ${pkg.version} → ${root}`);
if (CHECK) log('（--check：只看状态，不改文件）');
try {
	if (ONLY === '' || ONLY === 'meme') patchMeme();
	if (ONLY === '' || ONLY === 'douyin') patchDouyin();
} catch (error) {
	log(`\n× 出错：${String(error instanceof Error ? error.message : error)}`);
	process.exitCode = 1;
}

if (!CHECK && changed > 0) log(`\n原文件备份在：${backupDir}`);
log(`\n结果：改了 ${changed} 处，已打过 ${skipped} 处，失败 ${failed} 处`);
if (changed > 0 && !CHECK) log('改完重启 DeepSeek Harness（或重新加载插件）才生效。');
if (failed > 0) process.exitCode = 1;
