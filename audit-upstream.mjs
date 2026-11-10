#!/usr/bin/env node
/**
 * audit-upstream.mjs —— 对着 **上游最新版** 体检：这些补丁还需要吗？
 *
 * 补丁是耗材，不是资产。上游把功能自己做好了，补丁就该退役，仓库也不该继续挂在旧版本上。
 * 这个脚本直接从 npm 拉 dsh-fish-soul 最新版（或指定版本 / 本地 tgz），把每个补丁点过一遍：
 *
 *   RETIRED 上游自己已经实现 → 这一处不用再维护
 *   NEEDED  上游还没有 → 补丁继续有效
 *   DRIFT   上游既没实现、锚点又找不到了（改版挪走了代码）→ 需要更新锚点后重跑
 *
 * 输出 Markdown 报告（默认 stdout，可 --out 写文件），并给出仓库层面的结论：
 * 全部 RETIRED 就是「这个补丁仓库可以归档了」。
 *
 * 用法：
 *   node audit-upstream.mjs                                   # 体检 npm 上的 latest
 *   node audit-upstream.mjs --version 0.15.31                 # 指定版本
 *   node audit-upstream.mjs --tarball ./dsh-fish-soul.tgz     # 离线：用本地 tgz
 *   node audit-upstream.mjs --from <插件目录>                 # 体检「本机已装的那一份」（升级后想知道自己这版要不要动）
 *   node audit-upstream.mjs --out reports/upstream-compatibility.md
 *   node audit-upstream.mjs --brief                            # 只打「一句话结论 + 要处理的 id」（Agent 判兼容首选，drift>0 退出码 2）
 *   node audit-upstream.mjs --json                            # 机器可读（stdout 只出 JSON，md 走 stderr；含 group / status）
 *
 * 退出码：0 = 一切正常（有需要维护的补丁也算正常）；2 = 有 DRIFT，锚点过期需要更新。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARK_MEME = 'FS-MEME-BRIDGE-PATCH';

const args = process.argv.slice(2);
const opt = (name, fallback = '') => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);

const run = (cmd, argv, cwd) =>
	execFileSync(cmd, argv, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: process.platform === 'win32'
	});

/** 拉一份上游源码到临时目录，返回 {dir, version, source}。--from 直接用本机已装目录，不联网。 */
function fetchUpstream() {
	const local = opt('--from', '');
	if (local !== '') {
		const dir = resolve(local);
		if (!existsSync(join(dir, 'package.json'))) throw new Error(`这个目录里没有 package.json（要指向插件根目录）：${dir}`);
		const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
		return { dir, version: pkg.version, source: '本机已装' };
	}
	const work = mkdtempSync(join(tmpdir(), 'fish-soul-audit-'));
	const tarball = opt('--tarball', '');
	if (tarball !== '') {
		const src = resolve(tarball);
		if (!existsSync(src)) throw new Error(`没有这个文件：${src}`);
		run('tar', ['-xzf', src, '-C', work]);
	} else {
		const version = opt('--version', 'latest');
		const out = run('npm', ['pack', `dsh-fish-soul@${version}`, '--silent', '--pack-destination', work], work);
		const name = out.trim().split('\n').filter(Boolean).pop();
		if (!name || !name.endsWith('.tgz')) throw new Error(`npm pack 没拿到 tgz：${out}`);
		run('tar', ['-xzf', join(work, name), '-C', work]);
	}
	const dir = join(work, 'package');
	if (!existsSync(join(dir, 'package.json'))) throw new Error('解包后没找到 package/ 目录');
	const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
	return { dir, version: pkg.version, source: tarball === '' ? 'npm' : '本地 tgz' };
}

const allFiles = (dir, filter = () => true) => {
	const out = [];
	const walk = (d) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			let st;
			try { st = statSync(p); } catch { continue; }
			if (st.isDirectory()) walk(p);
			else if (filter(name)) out.push(p);
		}
	};
	walk(dir);
	return out;
};

const upstreamDone = (spec, text) => {
	if (!spec) return false;
	if (typeof spec.present === 'string' && spec.present !== '') return text.includes(spec.present);
	if (typeof spec.absent === 'string' && spec.absent !== '') return !text.includes(spec.absent);
	return false;
};

// ───────────────────────────── 体检 ─────────────────────────────

/** P1：上游自己接上 dsh-meme 了吗。 */
function auditMeme(dir) {
	const lib = join(dir, 'lib');
	if (!existsSync(lib)) return { group: 'P1 meme', id: 'meme-bridge', title: '借 dsh-meme 的只读取图服务', status: 'DRIFT', detail: '上游包结构变了：没有 lib/' };
	const strip = (s) => s.split('\n').filter((line) => !line.includes(MARK_MEME)).join('\n');
	const hit = allFiles(lib, (n) => n.endsWith('.js') && n !== 'meme-bridge.js').find((p) => {
		try { return strip(readFileSync(p, 'utf8')).includes('dshMeme'); } catch { return false; }
	});
	return hit
		? { group: 'P1 meme', id: 'meme-bridge', title: '借 dsh-meme 的只读取图服务', status: 'RETIRED', detail: `上游已自带：lib/${hit.split(/[\\/]/).pop()} 里出现 dshMeme` }
		: { group: 'P1 meme', id: 'meme-bridge', title: '借 dsh-meme 的只读取图服务', status: 'NEEDED', detail: '上游仍未接入 dsh-meme' };
}

/**
 * 锚点小块补丁，逐处看上游是否已经自己修好 / 锚点是否还在。
 *
 * ⚠️ assets 里 hunk 的 file 字段有的带 `lib/` 前缀（P2/P3/P4 那时写的），有的只写文件名（P5/P6），
 * 所以这里统一先把 `lib/` 剥掉再拼，否则 dm/share 会整组误报 DRIFT。
 */
function auditHunks(dir, jsonName, group = jsonName) {
	const hunksPath = join(HERE, 'assets', jsonName);
	if (!existsSync(hunksPath)) return [{ group, id: jsonName, title: jsonName, status: 'DRIFT', detail: `缺 assets/${jsonName}` }];
	const libRel = (rel) => String(rel ?? '').replace(/^lib\//, '');
	const hunks = JSON.parse(readFileSync(hunksPath, 'utf8'));
	return hunks.map((h) => {
		const rel = libRel(h.file);
		const p = join(dir, 'lib', rel);
		if (!existsSync(p)) return { group, id: h.id, title: h.title, status: 'DRIFT', detail: `上游没有 lib/${rel}` };
		const text = readFileSync(p, 'utf8');
		const fixRel = libRel(h.upstreamFixedIn ?? h.file);
		const fixPath = join(dir, 'lib', fixRel);
		const fixText = existsSync(fixPath) ? readFileSync(fixPath, 'utf8') : '';
		const hasStr = (s) => typeof s === 'string' && s !== '' && text.includes(s);
		const upstreamFixedHit = upstreamDone(h.upstreamFixed, fixText);
		// 判定顺序：new → upgradeOld → upstreamFixed → old → DRIFT
		// 「补丁在位」比「上游是否实现」更具体，必须排在前面：否则 --from 指向已打补丁的目录时，
		// 补丁自己写进去的标记会被 upstreamFixed 误认成「上游实现了」，整组假退役。
		if (hasStr(h.new))
			return {
				group,
				id: h.id,
				title: h.title,
				status: 'NEEDED',
				detail: upstreamFixedHit
					? '补丁已在位（本机已打过）；同时也命中上游同类实现的迹象 → 判退役请以 npm 干净源码（不带 --from）为准'
					: '补丁已在位（本机已打过），上游仍未原生实现'
			};
		// 本机装的是「上一版模板」：h.upgradeOld 是上一版的 new，命中也算在位（重跑 patch 会自动升级）
		if (hasStr(h.upgradeOld)) return { group, id: h.id, title: h.title, status: 'NEEDED', detail: '补丁在位但为旧版模板（重跑 patch-fish-soul.mjs 会升到新版）' };
		if (upstreamFixedHit)
			return { group, id: h.id, title: h.title, status: 'RETIRED', detail: `上游已自己修好（${JSON.stringify(h.upstreamFixed)}${fixRel !== rel ? ` @ lib/${fixRel}` : ''}）` };
		if (text.includes(h.old)) return { group, id: h.id, title: h.title, status: 'NEEDED', detail: '锚点在，补丁仍有效' };
		return { group, id: h.id, title: h.title, status: 'DRIFT', detail: '锚点找不到、上游也没修 → 需要按新版更新锚点' };
	});
}

/**
 * 本仓库「整文件新增」的补丁（不是锚点替换，是塞一个上游没有的文件）。
 * 这类没有被锚点自然覆盖：上游要是自己加了同名文件，整文件覆盖会把它顶掉 → 报 DRIFT 让人看一眼。
 *
 * ⚠️ --from 指向本机已打过补丁的目录时，这些文件本来就在（正是补丁写进去的），
 * 所以必须靠文件里的 marker 区分「本补丁产物」和「上游自带同名文件」，否则每次都是假冲突。
 */
function auditNewFile(dir, group, id, title, rel, marker) {
	const p = join(dir, 'lib', rel);
	if (!existsSync(p)) return { group, id, title, status: 'NEEDED', detail: `上游无 lib/${rel}，本仓库新增文件仍需要` };
	const text = readFileSync(p, 'utf8');
	if (text.includes(marker)) return { group, id, title, status: 'NEEDED', detail: `lib/${rel} 是本补丁写入的（含 ${marker}），上游仍未原生实现` };
	return { group, id, title, status: 'DRIFT', detail: `上游已自带 lib/${rel} 且不含本补丁标记 → 整文件覆盖会顶掉上游实现，需人工比对后再决定是否退役` };
}

const { dir, version, source } = fetchUpstream();
// 按 P1 → P6 顺序：先跑锚点组，再对「整文件新增」单独判一遍（锚点覆盖不到它们）
const rows = [
	auditMeme(dir),
	...auditHunks(dir, 'douyin-hunks.json', 'P2 douyin'),
	...auditHunks(dir, 'index-hunks.json', 'P3 remount'),
	...auditHunks(dir, 'plugins-hunks.json', 'P4 plugins'),
	auditNewFile(dir, 'P4 plugins', 'plugins-route-file', '个人插件清单（整文件 routes-plugins.js）', 'routes-plugins.js', 'FS-PLUGINS-ROUTE'),
	...auditHunks(dir, 'dm-hunks.json', 'P5 dm'),
	auditNewFile(dir, 'P5 dm', 'dm-proactive-file', '主动私信实现（整文件 douyin-proactive.js）', 'douyin-proactive.js', 'FS-DOUYIN-DM-PATCH'),
	...auditHunks(dir, 'share-hunks.json', 'P6 share')
];

const retired = rows.filter((r) => r.status === 'RETIRED').length;
const needed = rows.filter((r) => r.status === 'NEEDED').length;
const drift = rows.filter((r) => r.status === 'DRIFT').length;

let verdict;
if (drift > 0) verdict = `需要更新锚点：${drift} 处的上游代码改版了，补丁本身没被上游吸收。`;
else if (needed === 0) verdict = '全部补丁都已被上游原生实现 → 这些补丁可以整体退役，仓库不必再跟着上游版本维护。';
else verdict = `仍有 ${needed} 处补丁有效、${retired} 处已可退役。补丁继续适配上游最新版（${version}）即可。`;

const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const icon = { RETIRED: '🟢 可退役', NEEDED: '🟡 仍需', DRIFT: '🔴 漂移' };

// 按组汇总：一眼看出「哪一组要动」，不必逐行读
const groupNames = rows.map((r) => r.group).filter((g, i, arr) => arr.indexOf(g) === i);
const groups = groupNames.map((g) => {
	const sub = rows.filter((r) => r.group === g);
	const c = (s) => sub.filter((r) => r.status === s).length;
	const state = c('DRIFT') > 0 ? '🔴 要更新锚点' : c('NEEDED') === 0 ? '🟢 整组可退役' : '🟡 继续用';
	return { group: g, total: sub.length, retired: c('RETIRED'), needed: c('NEEDED'), drift: c('DRIFT'), state };
});

const md = [
	'# 上游兼容性核查（自动生成）',
	'',
	`- 核查时间：${today}`,
	`- 核查对象：\`dsh-fish-soul@${version}\`（${source === 'npm' ? 'npm 最新版' : source}）`,
	'- 生成方式：`node audit-upstream.mjs`（GitHub Actions 每周自动跑一次并提交本文件）',
	'',
	'## 分组结论',
	'',
	'| 组 | 处 | 可退役 | 仍需 | 漂移 | 结论 |',
	'| --- | --- | --- | --- | --- | --- |',
	...groups.map((g) => `| ${g.group} | ${g.total} | ${g.retired} | ${g.needed} | ${g.drift} | ${g.state} |`),
	'',
	'## 逐处明细',
	'',
	'| 组 | 补丁 | 处 | 上游状态 | 说明 |',
	'| --- | --- | --- | --- | --- |',
	...rows.map((r) => `| ${r.group} | ${r.title} | \`${r.id}\` | ${icon[r.status]} | ${r.detail} |`),
	'',
	`**结论**：${verdict}`,
	'',
	'> 说明：`可退役` = 上游自己已经做完了，这类补丁不必再维护、也不必跟版本；`仍需` = 上游还没有，补丁继续用；`漂移` = 上游改了这段代码但没实现同样功能，需要按新版更新锚点。',
	''
].join('\n');

const out = opt('--out', '');
if (out !== '') {
	const p = resolve(out);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, md, 'utf8');
	process.stderr.write(`报告已写入 ${p}\n`);
} else if (has('--json')) {
	// --json 时 stdout 只留 JSON（Agent 可直接 JSON.parse），人看的 Markdown 走 stderr
	process.stderr.write(md);
} else if (!has('--brief')) {
	process.stdout.write(md);
}

// --brief：只给「一句话结论 + 需要处理的 id」，Agent 判兼容时的首选入口
if (has('--brief')) {
	const ids = (st) => rows.filter((r) => r.status === st).map((r) => r.id);
	process.stdout.write(
		[
			`dsh-fish-soul@${version}（${source}）`,
			`可退役 ${retired} / 仍需 ${needed} / 漂移 ${drift}`,
			`DRIFT: ${ids('DRIFT').length ? ids('DRIFT').join(', ') : '无'}`,
			retired > 0 ? `可退役: ${ids('RETIRED').join(', ')}` : '',
			verdict
		]
			.filter(Boolean)
			.join('\n') + '\n'
	);
	process.exit(drift > 0 ? 2 : 0);
}

if (has('--json')) {
	process.stdout.write(
		'\n' +
			JSON.stringify({ upstream: version, source, checkedAt: today, summary: { retired, needed, drift }, groups, verdict, patches: rows }, null, 2) +
			'\n'
	);
}

if (drift > 0) process.exitCode = 2;
