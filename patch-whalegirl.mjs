#!/usr/bin/env node
/**
 * patch-whalegirl.mjs —— WhaleLauncher（鲸鱼 / WhaleGirl 桥）侧的微信链路补丁。
 *
 * 为什么单独一个脚本：patch-fish-soul.mjs 只管 dsh 插件目录（node_modules/dsh-fish-soul），
 * 而这条链路的两处补丁在鲸鱼安装目录里。鲸鱼一更新，整个 src/http/routes/bridge.js 与
 * bridge/app.py 会被换回官方版，微信就退化成「只有鲸鲸、没有希希」，所以这两处必须能一键重放。
 *
 * 六组补丁（都幂等、都按标记判定，标记在就不会重复插）：
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
 *   W5 residue-clean：点了发送但没生效时别把正文留成草稿，否则该会话永久发不出
 *        bridge/bg_sender.py 的 send() 两段（标记 WHALE-RESIDUE-CLEAN）
 *        W5a 尾部：点完发送按钮后输入框还留着本条正文，以前直接报 residue_left 收工，
 *            正文变草稿，下一条立刻 input_not_empty —— 群里表现就是「希希不理人」。
 *            现在按框内内容分流：空（UIA 慢一拍）算已发；是本条正文先清框再重打重发一次；
 *            是别人打的字才照旧 residue_left。
 *        W5b 入口：输入框残留文本正好等于本条待发正文时，认成「上轮没发出去的正文」
 *            清掉继续发，而不是当用户草稿拒发（dirty）。
 *
 *   W6 outbound-image：dsh 发图 / 发表情时桥里真把图贴出去（标记 WHALE-OUTBOUND-IMAGE）
 *        a) bridge/outbound_image.py 整份来自 assets/whalegirl/outbound_image.py（文件丢了就补回）；
 *        b) bridge/outbound_api.py 的 bind() 里调 outbound_image.attach(bridge)；
 *        c) bridge/sticker_transport.py 发送抛异常时留一行日志（标记 WHALE-STICKER-LOG）。
 *        缺 a/b 时 outbound_api 那句 bridge.send_outbound_image(...) 必然 AttributeError，
 *        微信端表现是「图片、表情一条也发不出，只回 failed:image:AttributeError」。
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
 *   node patch-whalegirl.mjs --only forward   # 只跑 W1（forward / outbound / probe / voicelocal / residue / image）
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
const MARK_VOICELOCAL = 'WHALE-VOICE-LOCAL';
const MARK_CHATNAME = 'WHALE-CHATNAME';
const MARK_RESIDUECLEAN = 'WHALE-RESIDUE-CLEAN';
const MARK_OUTBOUNDIMAGE = 'WHALE-OUTBOUND-IMAGE';
const MARK_STICKERLOG = 'WHALE-STICKER-LOG';
const MARK_UIFALLBACK = 'WHALE-UI-FALLBACK';
const MARK_MEDIAFIX = 'WHALE-MEDIA-RETRY';

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

/**
 * W4 voice-local：给桥的语音发送加 audio 形参，并把发送路径切到「桥内本地录音」。
 * 两个坑都在同一个文件里，鲸鱼更新会把 voice_mixin.py 整份替换回去：
 *   1) 没有 audio 形参 -> outbound_api 的 record 分支传参即 TypeError，微信语音全挂；
 *   2) 没有本地录音分支 -> 退回 exe 的语音发送，本机 exe 4.1.2 恒报「参数错误。」（打不开播放设备）。
 */
function patchVoiceLocal(root) {
	const id = 'W4 voice-local';
	const file = join(root, 'bridge', 'voice_mixin.py');
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_VOICELOCAL)) {
		note(id, 'ALREADY', 'audio 形参与桥内本地录音分支在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺 audio 形参与桥内本地录音分支');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const sigOld = '    def send_voice_reply(self, text, who, username, cancelled=None, outcome=None):';
	const sigNew = [
		`    def send_voice_reply(self, text, who, username, cancelled=None, outcome=None, audio=None):  # ${MARK_VOICELOCAL}`,
		'        # audio：dsh 已合成好的 mp3（base64）；走桥内本地录音时自己合成，这里收下但不使用。',
		'        # 少了这个形参，outbound_api 的 record 分支会直接 TypeError，微信语音全部失败。',
	].join('\n');
	const retOld = '        return G.voice_reply.deliver(G.ROOT, text, hwnd, prepare, G.log, cancelled=cancelled, outcome=outcome, send_lock=self.send_lock)';
	const retNew = [
		'        # 本机 exe 的录音发送恒报「参数错误。」（打不开播放设备），优先走桥内本地录音：mp3 → WAV → 热键录音 → 发送。',
		'        try:',
		'            import voice_local as _voice_local',
		'            if _voice_local.enabled(G.ROOT):',
		'                payload = audio or _voice_local.synthesize(G.ROOT, text, G.log)',
		'                if payload:',
		'                    return _voice_local.deliver(',
		'                        G.ROOT, text, payload, hwnd, prepare, G.log,',
		'                        cancelled=cancelled, outcome=outcome, send_lock=self.send_lock,',
		'                    )',
		"                G.log('自动语音：本地录音拿不到音频，回退 exe 路径')",
		'        except Exception as exc:',
		"            G.log('自动语音：本地录音异常 %s，回退 exe 路径' % type(exc).__name__)",
		'',
		retOld,
	].join('\n');
	const first = replaceOnce(file, sigOld, sigNew, MARK_VOICELOCAL);
	if (!first.ok) {
		failed += 1;
		note(id, 'DRIFT', first.reason);
		log(`[${id}] × ${first.reason}`);
		return;
	}
	const second = replaceOnce(file, retOld, retNew, MARK_VOICELOCAL);
	if (!second.ok) {
		failed += 1;
		note(id, 'DRIFT', second.reason);
		log(`[${id}] × ${second.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', '已补 audio 形参与桥内本地录音分支');
	log(`[${id}] 已补 audio 形参与本地录音分支（改前已备份）`);
}

/**
 * W6 outbound-image：dsh 要发图 / 发表情时，桥里必须真的有一双手把图贴出去。
 *   a) bridge/outbound_image.py 整份来自 assets/whalegirl/outbound_image.py
 *      （鲸鱼更新会把 bridge/*.py 换回官方版，文件没了就补回来）；
 *   b) bridge/outbound_api.py 的 bind() 里挂 runtime.send_outbound_image；
 *   c) bridge/sticker_transport.py 发送抛异常时留一行日志，否则只有 failed 状态没原因。
 * 缺 a/b 时 outbound_api 那句 bridge.send_outbound_image(...) 必然 AttributeError，
 * 微信端表现是「图片和表情一条也发不出，只回 failed:image:AttributeError」。
 */
function patchOutboundImage(root) {
	const id = 'W6 outbound-image';
	const imgFile = join(root, 'bridge', 'outbound_image.py');
	const apiFile = join(root, 'bridge', 'outbound_api.py');
	const stkFile = join(root, 'bridge', 'sticker_transport.py');

	// a) 实现文件整份落盘
	if (existsSync(imgFile) && readFileSync(imgFile, 'utf8').includes(MARK_OUTBOUNDIMAGE)) {
		note(id, 'ALREADY', 'outbound_image.py 在位');
		log(`[${id}] outbound_image.py 已经在（跳过）`);
	} else if (CHECK) {
		note(id, 'PENDING', '缺 outbound_image.py');
		log(`[${id}] 缺 outbound_image.py -> 待打（--check，不动文件）`);
	} else {
		const saved = existsSync(imgFile) ? backup(imgFile) : '(原先不存在，新建)';
		writeFileSync(imgFile, asset('outbound_image.py'), 'utf8');
		changed += 1;
		log(`[${id}] 已写入 outbound_image.py（原文件：${saved}）`);
	}

	// b) outbound_api.py 挂载：import + bind 里 attach
	const apiText = readFileSync(apiFile, 'utf8');
	if (apiText.includes(MARK_OUTBOUNDIMAGE)) {
		note(id, 'ALREADY', 'outbound_api.py 挂载在位');
		log(`[${id}] outbound_api.py 挂载已经在（跳过）`);
	} else if (CHECK) {
		note(id, 'PENDING', '缺 outbound_api.py 的 attach 挂载');
		log(`[${id}] 缺 outbound_api.py 挂载 -> 待打（--check，不动文件）`);
	} else {
		const impOld = 'import engine as G\nimport tts_relay\nimport voice_local\n';
		const impNew = 'import engine as G\nimport outbound_image  # ' + MARK_OUTBOUNDIMAGE + '\nimport tts_relay\nimport voice_local\n';
		const r1 = replaceOnce(apiFile, impOld, impNew, MARK_OUTBOUNDIMAGE);
		if (!r1.ok) {
			failed += 1;
			note(id, 'DRIFT', 'import 锚点：' + r1.reason);
			log(`[${id}] 停手（import 锚点）：${r1.reason}`);
			return;
		}
		const bindOld = '    global BRIDGE\n    BRIDGE = bridge\n';
		const bindNew = '    global BRIDGE\n    BRIDGE = bridge\n'
			+ '    try:\n'
			+ '        outbound_image.attach(bridge)  # ' + MARK_OUTBOUNDIMAGE + '\n'
			+ "    except Exception as exc:\n"
			+ "        G.log('[outbound-api] 图片出站挂载失败 type=%s' % type(exc).__name__)\n";
		const r2 = replaceOnce(apiFile, bindOld, bindNew, MARK_OUTBOUNDIMAGE);
		if (!r2.ok) {
			failed += 1;
			note(id, 'DRIFT', 'bind 锚点：' + r2.reason);
			log(`[${id}] 停手（bind 锚点）：${r2.reason}`);
			return;
		}
		changed += 1;
		note(id, 'PATCHED', 'outbound_api.py 已挂 attach');
		log(`[${id}] 已补上（原文件备份：${r2.saved}）`);
	}

	// c) sticker_transport.py 异常日志（诊断增强，漂移不阻断）
	const stkText = readFileSync(stkFile, 'utf8');
	if (stkText.includes(MARK_STICKERLOG)) {
		log(`[${id}] sticker 异常日志已经在（跳过）`);
	} else if (CHECK) {
		log(`[${id}] 缺 sticker 异常日志 -> 待打（--check，不动文件）`);
	} else {
		const stkOld = '    except Exception as exc:\n        if touched or attempted_enter:\n';
		const stkNew = '    except Exception as exc:  # ' + MARK_STICKERLOG + '\n'
			+ '        try:\n'
			+ '            import engine as _G\n'
			+ "            _G.log('[sticker-transport] stage=send exception=%s msg=%s touched=%s enter=%s'\n"
			+ "                   % (type(exc).__name__, str(exc)[:160], touched, attempted_enter))\n"
			+ '        except Exception:\n'
			+ '            pass\n'
			+ '        if touched or attempted_enter:\n';
		const r3 = replaceOnce(stkFile, stkOld, stkNew, MARK_STICKERLOG);
		if (r3.ok) {
			changed += 1;
			log(`[${id}] 已补 sticker 异常日志（原文件备份：${r3.saved}）`);
		} else {
			note(id, 'SKIP', 'sticker 异常日志：' + r3.reason);
			log(`[${id}] sticker 异常日志跳过：${r3.reason}`);
		}
	}
}

/**
 * W7 wechat-chatname：入站 payload 把会话名字（群名 / 好友备注）带上，群和私聊都带。
 *
 * 现网症状：DSH 里微信会话标题一直是数字群号 / wxid。原因是桥上报只给了 chat_id，
 * 内核拿不到名字，只能拿 ID 当标题。
 * 做法：payload 里补 conversationName（内核认这个字段），私聊拿不到备注就退回对方昵称。
 * 幂等判定：payload 行里已有 conversationName 就是打过了。
 */
function patchWechatChatName(root) {
	const id = 'W7 wechat-chatname';
	const file = join(root, 'bridge', 'receiver_mixin.py');
	if (!existsSync(file)) {
		failed += 1;
		note(id, 'MISSING', '没有 bridge/receiver_mixin.py');
		log(`[${id}] 找不到 ${file}`);
		return;
	}
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_CHATNAME)) {
		note(id, 'ALREADY', '入站会话名字上报在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	const lines = text.split('\n');
	let idx = -1;
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i].includes("payload = {'chat_id': username")) {
			idx = i;
			break;
		}
	}
	if (idx < 0) {
		failed += 1;
		note(id, 'DRIFT', '找不到入站 payload 组装行');
		log(`[${id}] 停手：找不到 payload = {'chat_id': username ...} 那一行`);
		return;
	}
	if (lines[idx].includes('conversationName')) {
		note(id, 'ALREADY', 'payload 已带 conversationName');
		log(`[${id}] payload 已带 conversationName（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺入站会话名字上报');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const indent = (lines[idx].match(/^\s*/) ?? [''])[0];
	lines[idx] = lines[idx].replace(/\}\s*$/, `, 'conversationName': _conv_name}  # ${MARK_CHATNAME}`);
	lines.splice(idx, 0,
		`${indent}# ${MARK_CHATNAME} conversationName 是内核认的字段（群名 / 好友备注），群和私聊都给：`,
		`${indent}# 只给群的 chat_title 的话，私聊在 DSH 里就只剩一串 wxid。`,
		`${indent}_conv_name = self.display_name(username) or ''`,
		`${indent}if _conv_name == username:`,
		`${indent}    _conv_name = nickname or ''`);
	const saved = backup(file);
	writeFileSync(file, lines.join('\n'), 'utf8');
	changed += 1;
	note(id, 'PATCHED', '已补入站会话名字上报（群名 / 好友备注）');
	log(`[${id}] 已补上（原文件备份：${saved}）`);
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

/**
 * W5 residue-clean：点了发送但没生效时，别把本条正文留成草稿。
 *
 * 现网症状：群里希希完全不说话、私聊也哑火，桥日志是 residue_left → input_not_empty →
 * 「发送暂停：目标输入框已有草稿」。也就是点了发送按钮但消息没出去，正文留在输入框里，
 * 下一次发送立刻被判脏框拒发，这个会话从此一条都发不出去。
 *
 * 两段替换（都按标记 WHALE-RESIDUE-CLEAN 判定）：
 *   W5a send() 尾部：residue_left 之前按框里的内容分流 —— 空（UIA 慢一拍）算已发；
 *       是本条正文就先清框、重打重发一次；是别人的字才照旧报 residue_left。
 *   W5b send() 入口：输入框残留文本正好等于本条要发的正文时，认成「上轮没发出去的正文」
 *       清掉继续发，而不是当成用户草稿拒发。
 */
function patchResidueClean(root) {
	const id = 'W5 residue-clean';
	const file = join(root, 'bridge', 'bg_sender.py');
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_RESIDUECLEAN)) {
		note(id, 'ALREADY', '发送残留自愈段在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺发送残留自愈段');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const a = replaceOnce(file, asset('residue-send-old.py'), asset('residue-send-new.py'), MARK_RESIDUECLEAN);
	if (!a.ok) {
		failed += 1;
		note(id, 'DRIFT', '发送尾部：' + a.reason);
		log(`[${id}] 停手（发送尾部）：${a.reason}`);
		return;
	}
	const b = replaceOnce(file, asset('residue-in-old.py'), asset('residue-in-new.py'), MARK_RESIDUECLEAN);
	if (!b.ok) {
		failed += 1;
		note(id, 'DRIFT', '入口残留判定：' + b.reason);
		log(`[${id}] 停手（入口残留判定）：${b.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', '已补发送残留自愈（发送尾部 + 入口残留判定）');
	log(`[${id}] 已补上（原文件备份：${b.saved}）`);
}

/**
 * W9 ui-fallback：微信图片取不到时，别再靠界面「碰运气找气泡」。
 *
 * 现网症状：视觉 Key 已配好，桥日志仍是「无法获取图片 AES 密钥」，随后界面兜底又报
 * 「没在可视区认出这条图片气泡 / 消息列表不在控件树里」，图一张也进不来。
 * 根因有两层：微信 4.x 的 .dat/wxgf 是加密容器（要密钥才解得开）；而兜底那条路
 * 用数据库顺序去对齐气泡，图一旦被后续消息顶出可视区就永远点不到。
 *
 * 本补丁整份替换 bridge/image_ui_fallback.py，改成「按控件类名（mmui::ChatImageItemView）
 * 找最新一张图 → 滚轮把它带回可视区 → 点开大图 → 截屏 → Esc 关闭」。这条路完全不解密，
 * 只认微信自己已经画在界面上的图，点开大图这套动作本身也不影响微信使用。
 */
function patchImageFallback(root) {
	const id = 'W9 ui-fallback';
	const file = join(root, 'bridge', 'image_ui_fallback.py');
	const clipFile = join(root, 'bridge', 'image_clip_fallback.py');
	// 同时要求带「短暂置前」逻辑：只有旧版右键复制（不置前）时要重放覆盖成新版
	const clipSrc = existsSync(clipFile) ? readFileSync(clipFile, 'utf8') : '';
	const clipOk = clipSrc.includes('WHALE-UI-CLIP') && clipSrc.includes('_bring_to_front');
	if (existsSync(file) && readFileSync(file, 'utf8').includes(MARK_UIFALLBACK) && clipOk) {
		note(id, 'ALREADY', 'image_ui_fallback.py 已是右键复制 + 控件定位版');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', 'image_ui_fallback.py 仍是数据库顺序对齐的旧版');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const saved = existsSync(file) ? backup(file) : '(原先不存在，新建)';
	writeFileSync(file, asset('image_ui_fallback.py'), 'utf8');
	// W9b：右键复制取图（用户指定方式）。像素定位图片气泡 -> 短暂把微信窗口置前（右键才生效，
	// 用完把焦点还给原窗口）-> 右键 -> 点「复制」-> 读剪贴板，直接拿聊天里的原图，
	// 不弹预览窗、不关窗、不挪窗口；PrintWindow 抓图所以微信被盖住也能定位。
	writeFileSync(join(root, 'bridge', 'image_clip_fallback.py'), asset('image_clip_fallback.py'), 'utf8');
	writeFileSync(join(root, 'bridge', 'wb_pixel.py'), asset('wb_pixel.py'), 'utf8');
	changed += 1;
	note(id, 'PATCHED', '已换成「右键复制取原图」+ 控件定位截图双路兜底');
	log(`[${id}] 已写入 image_ui_fallback.py / image_clip_fallback.py / wb_pixel.py（原文件：${saved}）`);
}

let root = '';
try {
	root = findRoot();
	log(`鲸鱼目录：${root}`);
	if (ONLY === '' || ONLY === 'forward') patchBridgeForward(root);
	if (ONLY === '' || ONLY === 'outbound') patchAppOutbound(root);
	if (ONLY === '' || ONLY === 'probe') patchProbeClean(root);
	if (ONLY === '' || ONLY === 'voicelocal') patchVoiceLocal(root);
	if (ONLY === '' || ONLY === 'residue') patchResidueClean(root);
	if (ONLY === '' || ONLY === 'image') patchOutboundImage(root);
	if (ONLY === '' || ONLY === 'chatname') patchWechatChatName(root);
	if (ONLY === '' || ONLY === 'uifallback') patchImageFallback(root);
if (ONLY === '' || ONLY === 'mediafix') patchMediaFix(root);
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

const NEW1 = "                desc = run_media_with_timeout(lambda: self.describe_emoji(msg), '表情', msg, G.log)\n                if not desc:\n                    # [WHALE-MEDIA-RETRY] 首次识别失败（多半是首帧取图/看图接口慢）先重试一次，\n                    # 别急着把「看不懂」抛给模型；重试给它更长的上限，但整体仍有封顶。\n                    G.log('表情包首次识别为空，重试一次：消息id=%s:%s' % (msg.get('shard') or '', msg.get('local_id')))\n                    desc = run_media_with_timeout(lambda: self.describe_emoji(msg), '表情', msg, G.log, timeout=120.0)\n                if not desc:\n                    # 表情包识别不出来以前是直接 return（她一声不吭），现场看就是「发了表情她不理」。\n                    # 改成给一句占位，让她自然地接话、并且明确禁止编造画面。\n                    media_failed('表情')\n                    content = ('（对方发了一个表情包，但这边没看清画面。'\n                               '不要编造表情的内容；可以自然地接一句，比如问问这是什么表情、'\n                               '或者就随口应一下，别让对方解释半天）')\n                    media_placeholder = True\n                else:\n                    content = '（对方发了一个表情包，画面是：%s）' % desc";
const NEW2 = "                desc = run_media_with_timeout(lambda: self.describe_image(msg), '图片', msg, G.log)\n                if not desc:\n                    G.log('图片首次识别为空，重试一次：消息id=%s:%s' % (msg.get('shard') or '', msg.get('local_id')))\n                    desc = run_media_with_timeout(lambda: self.describe_image(msg), '图片', msg, G.log, timeout=120.0)\n                if not desc:\n                    # 取不到图就装没看见，用户只会觉得「又卡死了」。改成让她自然地回一句：\n                    # 明确禁止编造画面，只允许问一句 / 让对方再发。\n                    media_failed('图片')";
const NEW3 = "            _guard_text = content\n            if media_placeholder or mtype in ('图片', '表情', '动画表情', '语音'):\n                _guard_text = '媒体#%s:%s' % (msg.get('shard') or '', msg.get('local_id'))";
const NEW4 = "            prompt = ('这是对方发来的表情包。简短描述主体（是什么形象/角色，像不像某个知名 IP 或表情包系列）、'\n                  '表情、动作、画面文字，以及它通常想表达的意思（比如\"无语\"\"笑哭\"\"点赞\"）；'\n                  '看清就直说，看不清就说明，不要编造。')";
const OLD1 = "                desc = run_media_with_timeout(lambda: self.describe_emoji(msg), '表情', msg, G.log)\n                if not desc:\n                    media_failed('表情')\n                    return\n                content = '（对方发了一个表情包，画面是：%s）' % desc";
const OLD2 = "                desc = run_media_with_timeout(lambda: self.describe_image(msg), '图片', msg, G.log)\n                if not desc:\n                    media_failed('图片')";
const OLD3 = "            _guard_text = content\n            if media_placeholder:\n                _guard_text = '%s#%s:%s' % (content, msg.get('shard') or '', msg.get('local_id'))";
const OLD4 = "        prompt = '这是对方发来的表情包。简短描述主体、表情、动作和画面文字，看不清就说明，不要编造。'";

function patchMediaFix(root) {
	const id = 'W10 media-fix';
	const recv = join(root, 'bridge', 'receiver_mixin.py');
	const vis = join(root, 'src', 'adapters', 'vision.js');
	if (!existsSync(recv)) {
		failed += 1;
		note(id, 'MISSING', '没有 bridge/receiver_mixin.py');
		log(`[${id}] 找不到 ${recv}`);
		return;
	}
	const text = readFileSync(recv, 'utf8');
	if (text.includes(MARK_MEDIAFIX)) {
		note(id, 'ALREADY', '图片/表情识别失败先重试 + 媒体消息按 id 去重 在位');
		log(`[${id}] receiver_mixin.py 已经在（跳过）`);
	} else if (CHECK) {
		note(id, 'PENDING', '缺图片/表情识别重试 + 媒体消息按 id 去重');
		log(`[${id}] 缺媒体修复 -> 待打（--check，不动文件）`);
	} else {
		const pairs = [[OLD1, NEW1], [OLD2, NEW2], [OLD3, NEW3], [OLD4, NEW4]];
		let out = text;
		let drift = '';
		for (const [o, n] of pairs) {
			const at = out.indexOf(o);
			if (at < 0) {
				drift = o.split('\n')[0];
				break;
			}
			out = out.slice(0, at) + n + out.slice(at + o.length);
		}
		if (drift) {
			failed += 1;
			note(id, 'DRIFT', '锚点对不上：' + drift.trim().slice(0, 40));
			log(`[${id}] 停手：receiver_mixin.py 里锚点对不上（${drift.trim().slice(0, 40)}）`);
		} else {
			const saved = backup(recv);
			writeFileSync(recv, out, 'utf8');
			changed += 1;
			log(`[${id}] 已改 receiver_mixin.py：识别失败先重试一次、媒体消息按消息 id 去重、表情描述带上形象与含义（原文件：${saved}）`);
		}
	}
	if (!existsSync(vis)) {
		note(id, 'ALREADY', '没有 src/adapters/vision.js（非鲸鱼目录，跳过）');
		return;
	}
	const vtext = readFileSync(vis, 'utf8');
	if (vtext.includes('Number(v.timeoutMs) || 60000')) {
		note(id, 'ALREADY', 'vision 识别超时已是 60s');
		log(`[${id}] vision.js 超时已在（跳过）`);
	} else if (CHECK) {
		note(id, 'PENDING', 'vision 识别超时还是 30s');
		log(`[${id}] 缺 vision 超时放宽 -> 待打（--check，不动文件）`);
	} else if (!vtext.includes('Number(v.timeoutMs) || 30000')) {
		failed += 1;
		note(id, 'DRIFT', 'vision.js 找不到 timeoutMs 默认 30s 那一行');
		log(`[${id}] 停手：vision.js 的超时行对不上`);
	} else {
		const saved = backup(vis);
		writeFileSync(vis, vtext.replace('Number(v.timeoutMs) || 30000', 'Number(v.timeoutMs) || 60000'), 'utf8');
		changed += 1;
		log(`[${id}] 已把视觉识别超时放宽到 60s（原文件：${saved}）`);
	}
}
