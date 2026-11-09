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
 *   node audit-upstream.mjs --out reports/upstream-compatibility.md
 *   node audit-upstream.mjs --json                            # 机器可读
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

/** 拉一份上游源码到临时目录，返回 {dir, version}。 */
function fetchUpstream() {
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
	return { dir, version: pkg.version };
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
	if (!existsSync(lib)) return { id: 'meme-bridge', title: '借 dsh-meme 的只读取图服务', status: 'DRIFT', detail: '上游包结构变了：没有 lib/' };
	const strip = (s) => s.split('\n').filter((line) => !line.includes(MARK_MEME)).join('\n');
	const hit = allFiles(lib, (n) => n.endsWith('.js') && n !== 'meme-bridge.js').find((p) => {
		try { return strip(readFileSync(p, 'utf8')).includes('dshMeme'); } catch { return false; }
	});
	return hit
		? { id: 'meme-bridge', title: '借 dsh-meme 的只读取图服务', status: 'RETIRED', detail: `上游已自带：lib/${hit.split(/[\\/]/).pop()} 里出现 dshMeme` }
		: { id: 'meme-bridge', title: '借 dsh-meme 的只读取图服务', status: 'NEEDED', detail: '上游仍未接入 dsh-meme' };
}

/** P2 / P3：锚点小块补丁，逐处看上游是否已经自己修好 / 锚点是否还在。 */
function auditHunks(dir, jsonName) {
	const hunksPath = join(HERE, 'assets', jsonName);
	if (!existsSync(hunksPath)) return [{ id: jsonName, title: jsonName, status: 'DRIFT', detail: `缺 assets/${jsonName}` }];
	const hunks = JSON.parse(readFileSync(hunksPath, 'utf8'));
	return hunks.map((h) => {
		const rel = String(h.file ?? '');
		const p = join(dir, rel);
		if (!existsSync(p)) return { id: h.id, title: h.title, status: 'DRIFT', detail: `上游没有 ${rel}` };
		const text = readFileSync(p, 'utf8');
		const fixRel = String(h.upstreamFixedIn ?? rel);
		const fixPath = join(dir, fixRel);
		const fixText = existsSync(fixPath) ? readFileSync(fixPath, 'utf8') : '';
		if (upstreamDone(h.upstreamFixed, fixText))
			return { id: h.id, title: h.title, status: 'RETIRED', detail: `上游已自己修好（${JSON.stringify(h.upstreamFixed)}${fixRel !== rel ? ` @ ${fixRel}` : ''}）` };
		if (text.includes(h.old)) return { id: h.id, title: h.title, status: 'NEEDED', detail: '锚点在，补丁仍有效' };
		return { id: h.id, title: h.title, status: 'DRIFT', detail: '锚点找不到、上游也没修 → 需要按新版更新锚点' };
	});
}

const { dir, version } = fetchUpstream();
const rows = [
	auditMeme(dir),
	...auditHunks(dir, 'douyin-hunks.json'),
	...auditHunks(dir, 'index-hunks.json'),
	...auditHunks(dir, 'plugins-hunks.json')
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

const md = [
	'# 上游兼容性核查（自动生成）',
	'',
	`- 核查时间：${today}`,
	`- 上游 npm 最新版：\`dsh-fish-soul@${version}\``,
	'- 生成方式：`node audit-upstream.mjs`（GitHub Actions 每周自动跑一次并提交本文件）',
	'',
	'| 补丁 | 处 | 上游状态 | 说明 |',
	'| --- | --- | --- | --- |',
	...rows.map((r) => `| ${r.title} | \`${r.id}\` | ${icon[r.status]} | ${r.detail} |`),
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
} else {
	process.stdout.write(md);
}

if (has('--json')) {
	process.stdout.write(
		'\n' +
			JSON.stringify({ upstream: version, checkedAt: today, summary: { retired, needed, drift }, verdict, patches: rows }, null, 2) +
			'\n'
	);
}

if (drift > 0) process.exitCode = 2;
