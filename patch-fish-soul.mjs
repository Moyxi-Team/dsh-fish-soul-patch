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
 *   node patch-fish-soul.mjs --only meme           # 只跑某一个补丁（meme / douyin / remount / plugins / dm / share / wechat / wechat-pane）
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

/**
 * 这条补丁「最长的一句新增内容」：new 里有、old 里没有的行里最长的那条。
 * 同文件多条补丁共用 marker 时，用它分辨「是这条打过了」还是「只是兄弟那条打过了」。
 */
const keyAddedLine = (h) => {
	const oldLines = new Set(
		String(h.old ?? '')
			.split('\n')
			.map((l) => l.trim())
	);
	const cand = String(h.new ?? '')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length >= 12 && !oldLines.has(l));
	cand.sort((a, b) => b.length - a.length);
	return cand[0] ?? '';
};

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
	// 多行锚点必须按目标文件的实际换行符比较：上游有的文件整份是 CRLF（index.js / config-schema.js /
	// gateway.js 都是），拿 \n 拼出来的锚点永远 includes 不到 → 会误报「锚点过期」。这里统一 fit 一次。
	const useCrlf = text.includes('\r\n');
	const oldS = fit(oldStr, useCrlf);
	const newS = fit(newStr, useCrlf);
	// probe：打完之后才会出现的短串。给「锚点替换后依然保留」的那几处用，避免重跑时在同一锚点上叠第二遍
	if (probe !== '' && text.includes(probe)) {
		log(`  ＝ ${rel}：${title} 已经打过`);
		skipped += 1;
		return 'skipped';
	}
	if (!text.includes(oldS)) {
		if (text.includes(newS)) {
			log(`  ＝ ${rel}：${title} 已经打过`);
			skipped += 1;
			return 'skipped';
		}
		log(`  × ${rel}：${title} 找不到锚点（上游改版挪了这段代码）；本补丁没有退役，是锚点过期了`);
		log('     → 用 audit-upstream.mjs 对着上游新版看这段改成了什么，更新锚点后重跑；不要直接 --force');
		drifted += 1;
		return 'drift';
	}
	if (text.split(oldS).length > 2) {
		log(`  × ${rel}：${title} 的锚点出现多次，不敢改`);
		failed += 1;
		return 'failed';
	}
	write(rel, text.replace(oldS, newS));
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

	// 10a) 设置界面：这个开关从 QQ 页搬去「日常 → 表情包」，那边才是表情包设置
	// 顺带修掉一个 bug：原来读的是 qq.stickers?.meme，而 stickers 是顶层配置，所以永远显示成关着
	replaceOnce('client.js',
		'\n\t\t\t\t\tform.enabled ? Row({ title: "借 dsh-meme 的表情库",\n' +
		'\t\t\t\t\t\tdesc: qq.stickers?.meme === true\n' +
		'\t\t\t\t\t\t\t? "已开：她自己的表情包里没有合适的，就去 dsh-meme 的图库里挑一张（只读取图：不改动它的图库、不占收藏额度；图会复制一份到 fish-soul 自己的缓存目录再发）"\n' +
		'\t\t\t\t\t\t\t: "她自己的表情包里没有合适的时，去 dsh-meme 的图库挑一张发（只读取图；需要本机装了 dsh-meme 并打开了图库）" },\n' +
		'\t\t\t\t\t\th(Switch, { label: "借 dsh-meme 的表情库", checked: qq.stickers?.meme === true,\n' +
		'\t\t\t\t\t\t\tonChange: (v) => run("/stickers/config", { meme: v }, v ? "没有合适的会去 dsh-meme 挑表情" : "只用自己的表情包", "保存失败") })) : null,',
		`\n\t\t\t\t\t// 借 dsh-meme 的表情库这个开关搬到「日常 → 表情包」页了，那边才是表情包设置 [${MARK_MEME}]`,
		'把开关从 QQ 页搬走', '搬到「日常 → 表情包」页了');

	// 10b) client.soul.js：表情包设置里放开关；开了才多一行「配置看 dsh-meme」，关着跟原版一模一样
	replaceOnce('client.soul.js',
		'\t\t\tconst panelOn = cfg.biliPanel === true;',
		'\t\t\tconst panelOn = cfg.biliPanel === true;\n' +
		`\t\t\tconst memeOn = cfg.meme === true; // 借 dsh-meme 的图库（开关在表情包设置里，不在 QQ 页）[${MARK_MEME}]`,
		'表情包页读 meme 状态', 'const memeOn = cfg.meme === true;');

	replaceOnce('client.soul.js',
		'\t\t\treturn Group({ title: "表情包", aside: items.length ? Tag(String(items.length), "outline") : null },\n',
		'\t\t\treturn Group({ title: "表情包", aside: items.length ? Tag(String(items.length), "outline") : null },\n' +
		`\t\t\t\t// 借 dsh-meme 的图库：开关归到表情包设置里（原来在 QQ 页）[${MARK_MEME}]\n` +
		'\t\t\t\tRow({ title: "借 dsh-meme 的表情库",\n' +
		'\t\t\t\t\tdesc: memeOn\n' +
		'\t\t\t\t\t\t? "已开：她自己的表情包里没有合适的，就去 dsh-meme 的图库里挑一张（只读取图：不改动它的图库、不占收藏额度；图会复制一份到 fish-soul 自己的缓存目录再发）"\n' +
		'\t\t\t\t\t\t: "她自己的表情包里没有合适的时，去 dsh-meme 的图库挑一张发（只读取图；需要本机装了 dsh-meme 并打开了图库）" },\n' +
		'\t\t\t\t\tmemeOn ? Tag("开着", "outline") : null,\n' +
		'\t\t\t\t\th(Switch, { label: "借 dsh-meme 的表情库", disabled: saving, checked: memeOn,\n' +
		'\t\t\t\t\t\tonChange: (v) => saveConfig({ meme: v }, v ? "没有合适的会去 dsh-meme 挑表情" : "只用自己的表情包") })),\n' +
		'\t\t\t\tmemeOn ? Row({ title: "表情包配置看 dsh-meme 设置", desc: "表情包怎么挑（图库开关、分类、权重这些）以 dsh-meme 那边为准，去 dsh-meme 的设置里改；这里只管她自己的收藏和你手动导入的图" }) : null,\n',
		'表情包页加借库开关', '表情包配置看 dsh-meme 设置');

	// ───── 11~14：把 dsh-meme 教出来的 [表情: 描述] 也换成真图发出去 ─────
	// dsh-meme 在 Web 会话里靠它的前端把 [表情: 描述] 配成图；fish-soul 的 IM 出站（QQ / 微信 / 抖音）
	// 不经过那个前端，方括号原样发过去就是一串文字。这里在出站前按描述挑一张真图，复用 P1 的选图链路
	// （先自己的表情库，再借 dsh-meme），挑不到就把标记删掉，绝不把它当文字露出去。

	// 11) stickers.js：新增 resolveMemeTags（插在 pickFromMeme 的注释之前，别把它的文档注释顶掉）
	replaceOnce('stickers.js',
		'\t/**\n\t * 借 dsh-meme 的只读取图服务挑一张',
		`\t/**
\t * 回复里的 [表情: 描述]：dsh-meme 教给模型的写法，Web 会话靠它的前端按描述配图。
\t * IM 出站（QQ / 微信 / 抖音）不走那个前端，方括号原样发出去就是一串文字 ——
\t * 这里按描述挑一张（先自己的库，再借 dsh-meme），换成真图片引用；挑不到就把标记删掉。
\t * [${MARK_MEME}]
\t */
\tasync resolveMemeTags(text, workspacePath, embedder, { model = '', max = 2 } = {}) {
\t\tconst src = String(text ?? '');
\t\tconst hits = [...src.matchAll(/\\[表情\\s*[:：]\\s*([^\\]\\n]{1,80})\\]/g)];
\t\tif (hits.length === 0) return { text, resolved: [] };
\t\tlet out = src;
\t\tconst resolved = [];
\t\tconst used = [];
\t\tfor (const [i, m] of hits.entries()) {
\t\t\tconst whole = m[0];
\t\t\tconst desc = String(m[1] ?? '').trim();
\t\t\t// 一次最多换 max 张，多出来的只把标记剥掉，绝不留成文字
\t\t\tif (i >= max) { out = out.split(whole).join(''); continue; }
\t\t\tlet r = { ok: false, reason: '没写要什么表情' };
\t\t\tif (desc !== '') r = await this.pickByFeel(workspacePath, desc, embedder, { model, avoid: used, top: 5 });
\t\t\tif (r.ok) used.push(r.file);
\t\t\tconst ref = r.ok ? (r.absolute === true ? imageRef(r.file) : '_stickers/' + r.file) : '';
\t\t\tresolved.push({ desc, file: r.ok ? r.file : null, fromMeme: r.fromMeme === true, reason: r.ok ? null : (r.reason ?? null) });
\t\t\tout = out.split(whole).join(r.ok ? '![' + desc.replace(/[[\\]]/g, '') + '](' + ref + ')' : '');
\t\t}
\t\treturn { text: out.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim(), resolved };
\t}

\t/**
\t * 借 dsh-meme 的只读取图服务挑一张`,
		'新增 resolveMemeTags（解析 [表情: 描述]）', 'async resolveMemeTags(');

	// 12) gateway.js：出站前（抠正文图之前）把 [表情: 描述] 换成真图片引用
	replaceOnce('gateway.js',
		"\t\tlet feelText = raw.replace(/\\s*\\[(不回|沉默)\\]\\s*$/g, '');",
		[
			"\t\tlet feelText = raw.replace(/\\s*\\[(不回|沉默)\\]\\s*$/g, '');",
			`\t\t// [表情: 描述]：QQ / 微信 / 抖音出站不走 dsh-meme 的前端配图，先换成真图片再发 [${MARK_MEME}]`,
			'\t\tif (/\\[表情\\s*[:：]/.test(feelText)) {',
			'\t\t\ttry {',
			"\t\t\t\tconst tagged = await this.stickers?.resolveMemeTags(feelText, row.workspace_path, this.embedder, { model: this.embeddingModel() })",
			"\t\t\t\t\t?? { text: feelText, resolved: [] };",
			'\t\t\t\tfeelText = tagged.text;',
			'\t\t\t\tfor (const one of tagged.resolved) {',
			"\t\t\t\t\tthis.note(one.file ? 'sent' : 'sticker-skip', {",
			'\t\t\t\t\t\tchannelId: row.channel_id, title: row.title, text: one.desc,',
			"\t\t\t\t\t\treason: one.file ? '按描述挑了一张表情包' : '没有像「' + one.desc + '」的表情，这段没发'",
			'\t\t\t\t\t});',
			'\t\t\t\t}',
			'\t\t\t} catch (error) {',
			"\t\t\t\tthis.log('warn', '[fish-soul] 解析 [表情] 失败：' + String(error instanceof Error ? error.message : error));",
			'\t\t\t}',
			'\t\t}'
		].join('\n'),
		'出站前解析 [表情: 描述]', '/\\[表情\\s*[:：]/.test(feelText)');

	// 13) 抖音私信也得能带图（这条路径原来只发文字）
	replaceOnce('gateway.js',
		'\tasync sendDouyinDm(row, text) {',
		`\tasync sendDouyinDm(row, text, images = [], convId = '') { // [${MARK_MEME}] 带图 + 会话 ID`,
		'抖音私信签名加图', 'async sendDouyinDm(row, text, images = [], convId = ');
	replaceOnce('gateway.js',
		"\t\tconst parts = String(text ?? '').split(/\\n{2,}/).map((s) => s.trim()).filter((s) => s !== '').map((s) => ({ type: 'text', text: s }));",
		"\t\tconst parts = String(text ?? '').split(/\\n{2,}/).map((s) => s.trim()).filter((s) => s !== '').map((s) => ({ type: 'text', text: s }));\n" +
		`\t\tfor (const p of images.slice(0, 2)) parts.push({ type: 'image', path: p }); // [${MARK_MEME}] 表情包跟在文字后面`,
		'抖音私信拼上图片段', "parts.push({ type: 'image', path: p })");
	replaceOnce('gateway.js',
		'\t\t\tconst r = await ch.send(name, parts);',
		[
			`\t\t\t// 没确认过会话身份就不传第三参，照原来的发法，绝不因为多传参数发不出去 [${MARK_MEME}]`,
			`\t\t\tconst r = convId === '' ? await ch.send(name, parts) : await ch.send(name, parts, convId);`
		].join('\n'),
		'抖音私信传会话 ID');

	// 14) 抖音分支：把图一起递下去（以前这段只取文字）
	replaceOnce('gateway.js',
		"\t\t\tif (dmText === '') { st.douyinSilent = true; return true; }\n\t\t\tconst r = await this.sendDouyinDm(row, dmText);",
		[
			`\t\t\t// 只有表情包没文字时也要发出去；会话身份没确认到就照原来的发法 [${MARK_MEME}]`,
			`\t\t\tconst dmConv = /^0:1:\\d+:\\d+$/.test(String(st?.convId ?? '')) ? String(st.convId) : '';`,
			`\t\t\tconst dmImgs = [];`,
			`\t\t\tfor (const img of await this.dmImages(row, 图, st)) {`,
			`\t\t\t\tif (typeof img?.path === 'string' && img.path !== '' && !dmImgs.includes(img.path)) dmImgs.push(img.path);`,
			`\t\t\t}`,
			`\t\t\tif (dmText === '' && dmImgs.length === 0) { st.douyinSilent = true; return true; }`,
			`\t\t\tconst r = await this.sendDouyinDm(row, dmText, dmImgs, dmConv);`
		].join('\n'),
		'抖音分支带上图片');

	// 15) 抖音评论回复：同样先把 [表情: 描述] 换成真图（评论一条最多带 1 张）
	replaceOnce('douyin-social.js',
		"\t\tif (out.text.includes('_stickers/@')) {",
		[
			`\t\t// [表情: 描述] 换成真图；挑不到就把标记删掉，别当文字发出去 [${MARK_MEME}]`,
			'\t\tif (/\\[表情\\s*[:：]/.test(out.text)) {',
			"\t\t\ttry { out.text = (await this.stickers.resolveMemeTags(out.text, this.workspacePath(), this.embedder, { max: 1 }))?.text ?? out.text; } catch { /* 解析失败就当没写表情 */ }",
			'\t\t}',
			"\t\tif (out.text.includes('_stickers/@')) {"
		].join('\n'),
		'评论回复解析 [表情: 描述]', '/\\[表情\\s*[:：]/.test(out.text)');
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
	// marker 归属：同一个文件里，这段文字出现在几条补丁的 old/new 里？
	// 只被一条补丁用到 → 看到它就算这条打过了；被好几条用到（共用 / 被兄弟补丁蹭到）→ marker 说明不了问题。
	const markerOwners = new Map();
	for (const h of hunks) {
		if (!h.marker) continue;
		const rel = String(h.file ?? '').replace(/^lib\//, '');
		const k = `${rel}|${h.marker}`;
		const owners = markerOwners.get(k) ?? new Set();
		for (const g of hunks) {
			if (String(g.file ?? '').replace(/^lib\//, '') !== rel) continue;
			if (!`${g.old ?? ''}\n${g.new ?? ''}`.includes(h.marker)) continue;
			owners.add(g.id);
		}
		markerOwners.set(k, owners);
	}
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
		// 目标文件若是 CRLF（slang.js 这类被 Windows 编辑器动过换行的），模板里的 \n 直接 includes 永远不中，
		// 会被误判成「锚点过期」。所以按目标文件自己的换行风格把模板现算一遍再比。
		const fileCrlf = text.includes('\r\n');
		const at = (x) => (typeof x === 'string' ? fit(x, fileCrlf) : x);
		const NEW = at(h.new);
		const OLD = at(h.old);
		const MARK = at(h.marker);
		const UPOLD = at(h.upgradeOld);
		const fixRel = String(h.upstreamFixedIn ?? h.file ?? '').replace(/^lib\//, '');
		const fixText = fixRel === rel ? text : existsSync(join(lib, fixRel)) ? readFileSync(join(lib, fixRel), 'utf8') : '';
		const result = (() => {
			// 先认「完整新版」：h.new 整段已经在文件里，就说明这处是最新的，必须立刻收手。
			// 这一步不能挪到 upgradeOld 后面 —— 旧版模板经常是新版的前缀（dm-vars 就是），
			// 那样每跑一次都会再追加一份，跑两次就是重复声明 const dmCands 直接白屏。
			if (text.includes(NEW)) {
				log(`  ＝ lib/${rel}：${h.title} 已经打过`);
				return 'skipped';
			}
			// 升级：这处上一版已经打过，现在模板改了内容。按「旧模板原文 → 新模板」整段换掉，
			// 不用重新找锚点（锚点早就不在原处了）。h.upgradeOld 记的是上一版的 new。
			if (typeof UPOLD === 'string' && UPOLD !== '' && UPOLD !== NEW && text.includes(UPOLD)) {
				write(rel, text.replace(UPOLD, NEW));
				log(`  ↑ lib/${rel}：${h.title} 旧版已打 → 升到新版`);
				changed += 1;
				note(h.id, 'UPGRADED', h.title);
				return 'upgraded';
			}
			// marker 是「这块补丁打过」的记号。大多数补丁的 marker 是自己独有的，看到就算打过。
			// 但同一个文件里几条补丁可能共用同一个 marker（P5 的 gateway.js 三条都是 [FS-DM-SESSION]），
			// 那时只看 marker 就会把「兄弟那条打过了」当成「我这条也打过了」→ 全新安装漏打、还不报错。
			// 共用 marker 的改用「这条补丁最长的一句新增内容」核对，对不上才继续往下打。
			if (text.includes(MARK)) {
				const shared = (markerOwners.get(`${rel}|${h.marker}`)?.size ?? 0) > 1;
				const key = shared ? keyAddedLine(h) : '';
				if (!shared || key === '' || text.includes(key)) {
					log(`  ＝ lib/${rel}：${h.title} 已经打过`);
					return 'skipped';
				}
				log(`  · lib/${rel}：${h.title} 只碰到兄弟补丁共用的 marker，这条还没打 → 继续`);
			}
			if (upstreamDone(h.upstreamFixed, fixText)) {
				up += 1;
				log(`  ↷ lib/${rel}：${h.title} —— 上游已自己修好（${JSON.stringify(h.upstreamFixed)}）→ 本处退役`);
				note(h.id, 'UPSTREAM', h.title);
				return 'upstream';
			}
			if (!text.includes(OLD)) {
				log(`  × lib/${rel}：${h.title} 找不到锚点（上游改版挪了这段代码），本补丁没退役、是锚点过期了`);
				drifted += 1;
				note(h.id, 'DRIFT', h.title);
				return 'drift';
			}
			if (text.split(OLD).length > 2) {
				log(`  × lib/${rel}：${h.title} 的锚点在文件里出现多次，不敢猜改哪一处`);
				failed += 1;
				note(h.id, 'AMBIGUOUS', h.title);
				return 'ambiguous';
			}
			write(rel, text.replace(OLD, NEW));
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
const PLUGINS_ROUTE_VER = 'FS-PLUGINS-ROUTE v5';

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
	// 比内容时先把换行归一：本机那份若是 CRLF（Windows 编辑器动过），逐字节比会把「一模一样」当成老版本，
	// 每跑一次都重写一遍、计数也在瞎涨。写回时再按目标文件自己的换行风格还原。
	const dmText = existsSync(target) ? readFileSync(target, 'utf8') : '';
	const dmWant = readFileSync(DM_SRC, 'utf8');
	const dmSame = dmText.replace(/\r\n/g, '\n') === dmWant.replace(/\r\n/g, '\n');
	const staleFile = hasMarker && existsSync(DM_SRC) && !dmSame;
	if (staleFile) {
		if (!CHECK) writeFileSync(target, fit(dmWant, dmText.includes('\r\n')), 'utf8');
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

// ───────────────────────────── P7：微信侧（WechatAgent）与人格记忆互通 ─────────────────────────────

/**
 * 微信侧（WechatAgent）接进来之后，鱼要能「认得出同一个人、记得住两边说过的话」。
 *
 * 三条硬边界，改造全部围着它们转：
 *  ① 微信 id（wxid 派生的数字，如 853200206）**不是 QQ 号**（412205303），拿它去 person 表按 QQ 查
 *     只会查到 null、甚至撞到别人 —— 所以微信身份单独走 person_wechat_alias 别名表；
 *  ② 通道各聊各的：微信私聊 / 微信群不并进 QQ 会话，只共享人格与记忆（gateway.js 那条 early return）；
 *  ③ 记忆要合并：同一个 canonical person 的微信私聊与 QQ 私聊共用一份黑话 / 表达（slangBucket），
 *     群聊按平台分开（group:wechat:<房间>），认不出身份才退回按通道各存。
 *
 * 覆盖 8 个文件 21 处锚点（chat-archive 2、db 3、gateway-util 3、gateway 1、index 4、life 1、
 * routes-soul 1、slang 6），见 assets/wechat-hunks.json。
 *
 * ⚠️ 顺带给聊天存档补了两个接口：/chat-archive/append（微信侧把消息落进来）与
 *    /chat-archive/recent（跨渠道翻刚发生过什么）；设置里「聊天存档」的通道白名单也认微信写法了。
 */
function patchWechat() {
	log('\n[P7 wechat] 微信（WechatAgent）↔ 人格记忆互通');
	patchHunks({ tag: 'P7 wechat', label: '微信通道认人 + 聊天存档桥接 + 黑话共桶', jsonName: 'wechat-hunks.json' });
}

// ───────────────────────────── P8：平台 → 微信设置页 ─────────────────────────────

/**
 * 微信接进来以后，面板「平台」里一直没有微信这一栏，只能在 QQ / B站 / 抖音 之间打转；
 * 更麻烦的是她发的表情包在 DSH 里是动的、到微信里全变静态图，没人说清楚该去哪儿改。
 *
 * 这条补丁做两件事：
 *  ① 新增 lib/client.wechat.js（整文件落地）：平台 → 微信。页面上把设置项分成两栏 ——
 *     「去 WechatAgent 改才生效」（登录、收发端口、表情入库、发图、好友/群同步）与
 *     「在这儿改就生效」（人格记忆、认人白名单、接话、插嘴、挑表情策略）；
 *  ② 22 处锚点：config-schema 加 stickerAnimatedFirst / stickerAnimatedStrict 两项；
 *     gateway 出站挑表情时按微信平台透传动图偏好；stickers / meme-bridge 支持「先只在 GIF 里挑」
 *     与「挑不到动图就不发」；routes 加 wechatState() 与 POST /channels/wechat-config；
 *     client 加「微」页签与 WechatPane 渲染。见 assets/wechat-pane-hunks.json。
 *
 * 为什么要动表情：微信自己发的表情消息（wechat_sticker）只认 GIF —— 静态图发过去一定不动。
 * soul 这边能控的只有「挑图时挑哪一张」，所以给了「先发动图 / 只发动图 / 不过滤」三档。
 */
function patchWechatPane() {
	log('\n[P8 wechat-pane] 平台 → 微信设置页 + 表情只发动图');
	const tpl = join(HERE, 'assets', 'client.wechat.js');
	const target = join(lib, 'client.wechat.js');
	if (!existsSync(tpl)) {
		failed += 1;
		note('P8 wechat-pane', 'DRIFT', '仓库里缺 assets/client.wechat.js，没法落地微信设置页');
		log('  × 缺 assets/client.wechat.js');
		return;
	}
	const body = readFileSync(tpl, 'utf8');
	if (existsSync(target) && readFileSync(target, 'utf8') === body) {
		skipped += 1;
		note('P8 wechat-pane', 'ALREADY', 'lib/client.wechat.js 已是当前版本');
		log('  · lib/client.wechat.js 已是最新，跳过');
	} else if (CHECK) {
		log('  [check] 会写 lib/client.wechat.js');
		note('P8 wechat-pane', 'DRIFT', '[check] 待写 lib/client.wechat.js');
	} else {
		writeFileSync(target, body, 'utf8');
		changed += 1;
		note('P8 wechat-pane', 'PATCHED', '新增 lib/client.wechat.js');
		log('  ✓ 新增 lib/client.wechat.js');
	}
	patchHunks({ tag: 'P8 wechat-pane', label: '平台 → 微信设置页 + 微信表情只发动图', jsonName: 'wechat-pane-hunks.json' });
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
	if (ONLY === '' || ONLY === 'wechat') patchWechat();
	if (ONLY === '' || ONLY === 'wechat-pane') patchWechatPane();
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
