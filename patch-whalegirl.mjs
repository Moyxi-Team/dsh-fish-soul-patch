#!/usr/bin/env node
/**
 * patch-whalegirl.mjs —— WhaleLauncher（鲸鱼 / WhaleGirl 桥）侧的微信链路补丁。
 *
 * 为什么单独一个脚本：patch-fish-soul.mjs 只管 dsh 插件目录（node_modules/dsh-fish-soul），
 * 而这条链路的两处补丁在鲸鱼安装目录里。鲸鱼一更新，整个 src/http/routes/bridge.js 与
 * bridge/app.py 会被换回官方版，微信就退化成「只有鲸鲸、没有希希」，所以这两处必须能一键重放。
 *
 * 三组补丁（都幂等、都按标记判定，标记在就不会重复插）：
 *
 *   W1 bridge-forward：微信入站转发给 dsh-fish-soul
 *        src/http/routes/bridge.js 插两段（标记 WHALE-DSH-FORWARD）
 *        ① helpers 段 —— 读 data/dsh-forward.json + 入站字段映射 + 极简 POST JSON
 *        ② hook 段 —— /webhook/wechat 里在 gateway.handleInbound 之前把消息投给 dsh 的
 *           11233/fish-soul/wechat/inbound，然后一律返回 action:'none'（桥不开口，鲸鲸不插嘴）
 *        只对带文字正文的入站转发（纯图/表情转过去 dsh 也接不上话）；dsh 没在跑也不回退给鲸鲸。
 *
 *   W2 app-outbound：给 dsh 的微信出站开本地口
 *        bridge/app.py 的 BridgeRuntime.start() 里在「已启动」日志前调
 *        outbound_api.bind(self) / start()，监听 127.0.0.1:8899/outbound（标记 WHALE-DSH-OUTBOUND）
 *        丢了这段，dsh 想得出话也发不出去——鲸鱼只有手，出口在这里。端口占用只记日志。
 *
 *   W3 probe-clean：清掉编码探测残留的「鲸」，别让出站单会话永久堵死
 *        bridge/bg_sender.py 的 send() 里，输入框非空时原本只打日志就 return
 *        input_not_empty —— 探测字留在框里，这个会话从此一条也发不出去。
 *        改成：确认是探测残留（_PROBE_TEXTS）先调 _clear_composer 清空，
 *        复查干净继续发送，清不干净才拒发（标记 WHALE-PROBE-CLEAN）。替换式，非插入式。
 *
 * 三态判定（与 patch-fish-soul.mjs 同一套思路）：
 *   ALREADY 目标文件里已有标记        → 不动
 *   PATCHED 锚点在、标记没有          → 插进去（改前备份到 ~/.dsh/backup/whalegirl-patch-<时间戳>/）
 *   DRIFT   锚点找不到 / 出现多次      → 停手报错，交给人更新锚点（鲸鱼大改版才会这样）
 *
 * 用法：
 *   node patch-whalegirl.mjs                  # 自动找鲸鱼目录（E:\ruanjian\WhaleGirl 等候选）
 *   node patch-whalegirl.mjs --root <目录>     # 指定鲸鱼安装目录（含 src/ 与 bridge/）
 *   node patch-whalegirl.mjs --check          # 只报告状态，不改文件
 *   node patch-whalegirl.mjs --only forward   # 只跑 W1（forward / outbound / probe）
 *   node patch-whalegirl.mjs --json           # 结尾多打一段机器可读汇总
 *
 * 改完鲸鱼必须重启才生效：8787（node server.js）与 python 桥（8899/outbound 由它开）。
 * 注意：本脚本只改运行目录，鲸鱼自己重装/更新时会再次覆盖——所以更新完再跑一次本脚本。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'assets', 'whalegirl');

const args = process.argv.slice(2);
const opt = (name, fallback = '') => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);
const CHECK = has('--check');
const ONLY = opt('--only', '');

const MARK_FORWARD = 'WHALE-DSH-FORWARD';
const MARK_OUTBOUND = 'WHALE-DSH-OUTBOUND';
const MARK_PROBECLEAN = 'WHALE-PROBE-CLEAN';

const log = (msg) => console.log(msg);
const report = [];
const note = (patch, status, detail) => report.push({ patch, status, detail });
let changed = 0;
let failed = 0;

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = join(homedir(), '.dsh', 'backup', 'whalegirl-patch-' + stamp);

/** 找鲸鱼安装目录：--root > WHALEGIRL_ROOT > 常见安装位置。认得的标准是两处待补文件都在。 */
function findRoot() {
	const explicit = opt('--root', '') || process.env.WHALEGIRL_ROOT || '';
	const candidates = [
		explicit,
		'E:\\ruanjian\\WhaleGirl',
		'D:\\ruanjian\\WhaleGirl',
		join(process.env.LOCALAPPDATA || '', 'Programs', 'WhaleGirl'),
		join(process.env.PROGRAMFILES || '', 'WhaleGirl'),
	].filter((v) => String(v || '').trim() !== '');
	for (const candidate of candidates) {
		const root = resolve(candidate);
		if (existsSync(join(root, 'src', 'http', 'routes', 'bridge.js')) && existsSync(join(root, 'bridge', 'app.py'))) {
			return root;
		}
	}
	throw new Error('没找到 WhaleLauncher 安装目录（需同时含 src/http/routes/bridge.js 与 bridge/app.py）。用 --root 或环境变量 WHALEGIRL_ROOT 指定。');
}

const asset = (name) => readFileSync(join(ASSETS, name), 'utf8');

function backup(file) {
	if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
	const target = join(backupDir, file.split(/[\\/]/).slice(-2).join('__'));
	copyFileSync(file, target);
	return target;
}

/**
 * 按锚点往文件里插代码块。blocks[i] = { anchor, content, where: 'after'|'before', dedupeLines }
 * 同一文件多段时从后往前插，保证前面的偏移量不失效。
 */
function insertBlocks(file, blocks, marker) {
	let text = readFileSync(file, 'utf8');
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const plan = [];
	for (const block of blocks) {
		let content = block.content.replace(/\r\n/g, '\n').split('\n');
		// 目标里已经有同样的 require 就别再插一遍，否则 const 重复声明会直接语法错误。
		for (const line of block.dedupeLines || []) {
			if (text.includes(line)) content = content.filter((l) => l.trim() !== line.trim());
		}
		let body = content.join('\n');
		if (!body.endsWith('\n')) body += '\n';
		if (eol === '\r\n') body = body.replace(/\n/g, '\r\n');
		const hits = [];
		let from = 0;
		for (;;) {
			const at = text.indexOf(block.anchor, from);
			if (at < 0) break;
			hits.push(at);
			from = at + block.anchor.length;
		}
		if (hits.length !== 1) {
			return { ok: false, reason: `锚点出现 ${hits.length} 次（要求 1 次）：${JSON.stringify(block.anchor.trim().slice(0, 80))}` };
		}
		plan.push({ at: hits[0], anchor: block.anchor, body, where: block.where || 'before' });
	}
	plan.sort((a, b) => b.at - a.at);
	for (const step of plan) {
		const cut = step.where === 'after' ? step.at + step.anchor.length : step.at;
		const head = text.slice(0, cut);
		const tail = text.slice(cut);
		if (step.where === 'after') {
			// 插入块前后各留一个空行，和手写的样式一致（顺带把原文件里紧跟在锚点后的那一个换行吃掉，别堆成两行空白）
			const rest = tail.replace(/^\r?\n/, '');
			text = head + eol + eol + step.body + rest;
		} else {
			text = head + step.body + tail;
		}
	}
	if (!text.includes(marker)) {
		return { ok: false, reason: '插入后仍找不到标记，内容拼接可能出错' };
	}
	const saved = backup(file);
	writeFileSync(file, text, 'utf8');
	return { ok: true, saved };
}

function patchBridgeForward(root) {
	const id = 'W1 bridge-forward';
	const file = join(root, 'src', 'http', 'routes', 'bridge.js');
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_FORWARD)) {
		note(id, 'ALREADY', '微信入站转发段在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺微信入站转发段');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const res = insertBlocks(file, [
		{
			anchor: "const { json, readBody } = require('../util');",
			content: asset('bridge-forward-helpers.js'),
			where: 'after',
			dedupeLines: ["const fs = require('fs');", "const path = require('path');", "const http = require('http');"],
		},
		{
			anchor: '    if (!gateway.options.enabled) {',
			content: asset('bridge-forward-hook.js'),
			where: 'before',
		},
	], MARK_FORWARD);
	if (!res.ok) {
		failed += 1;
		note(id, 'DRIFT', res.reason);
		log(`[${id}] 停手：${res.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', '已补微信入站转发段');
	log(`[${id}] 已补上（原文件备份：${res.saved}）`);
}

function patchAppOutbound(root) {
	const id = 'W2 app-outbound';
	const file = join(root, 'bridge', 'app.py');
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_OUTBOUND)) {
		note(id, 'ALREADY', '出站接口启动段在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺 8899/outbound 启动段');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const res = insertBlocks(file, [{
		anchor: "        G.log('已启动。鲸鲸地址：', self.bot_url)",
		content: asset('app-outbound-snippet.py'),
		where: 'before',
	}], MARK_OUTBOUND);
	if (!res.ok) {
		failed += 1;
		note(id, 'DRIFT', res.reason);
		log(`[${id}] 停手：${res.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', '已补 8899/outbound 启动段');
	log(`[${id}] 已补上（原文件备份：${res.saved}）`);
}

/**
 * 替换式补丁：把 old 段整体换成 new 段（W3 是改既有逻辑，插不进去）。
 * 两边 EOL 归一到 LF 比对，落盘仍用目标文件自身的 EOL 风格。
 */
function replaceOnce(file, oldBody, newBody, marker) {
	let text = readFileSync(file, 'utf8');
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const norm = text.replace(/\r\n/g, '\n');
	const oldText = oldBody.replace(/\r\n/g, '\n');
	const hits = norm.split(oldText).length - 1;
	if (hits !== 1) {
		return { ok: false, reason: `替换锚点出现 ${hits} 次（要求 1 次）` };
	}
	let out = norm.replace(oldText, newBody.replace(/\r\n/g, '\n'));
	if (!out.includes(marker)) {
		return { ok: false, reason: '替换后仍找不到标记' };
	}
	const saved = backup(file);
	if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
	writeFileSync(file, out, 'utf8');
	return { ok: true, saved };
}

function patchProbeClean(root) {
	const id = 'W3 probe-clean';
	const file = join(root, 'bridge', 'bg_sender.py');
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_PROBECLEAN)) {
		note(id, 'ALREADY', '探测残留清理段在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺探测残留清理段');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const res = replaceOnce(file, asset('probe-clean-old.py'), asset('probe-clean-new.py'), MARK_PROBECLEAN);
	if (!res.ok) {
		failed += 1;
		note(id, 'DRIFT', res.reason);
		log(`[${id}] 停手：${res.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', '已补探测残留清理段');
	log(`[${id}] 已补上（原文件备份：${res.saved}）`);
}

let root = '';
try {
	root = findRoot();
	log(`鲸鱼目录：${root}`);
	if (ONLY === '' || ONLY === 'forward') patchBridgeForward(root);
	if (ONLY === '' || ONLY === 'outbound') patchAppOutbound(root);
	if (ONLY === '' || ONLY === 'probe') patchProbeClean(root);
} catch (err) {
	failed += 1;
	log(`出错：${err && err.message ? err.message : err}`);
	process.exitCode = 1;
}

if (changed > 0) {
	// 给 watchdog 用的英文标记：中文在 PowerShell 5.1 里按 GBK 解码会乱码，匹配不上。
	log('PATCH_APPLIED ' + changed);
	log('改动已落盘，重启才生效：8787（node server.js）与 python 桥（8899 由它开）。');
}
if (has('--json')) {
	log(JSON.stringify({ root, changed, failed, patches: report }, null, 2));
}
if (failed > 0) process.exitCode = 1;
