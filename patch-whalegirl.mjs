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
 *   W12 voice-chatfallback：私聊语音不再一上来就 local:no-chat（标记 WHALE-VOICE-CHATFALLBACK）
 *        bridge/voice_mixin.py 的 prepare() 里，前台 uia_driver.open_chat 切不过去（大概率是
 *        Windows 前台锁 / 微信窗口被盖住）时原本直接 return ''，调用方只能 fail('local:no-chat')。
 *        现场群聊能发、私聊必挂就是这个原因——群窗口恰好在前面时 open_chat 才成功。
 *        改成前台失败后走 bg_sender.open_chat 的后台通道（正是桥发文字用的那条，已验证能切私聊），
 *        两路都失手才放弃。替换式。
 *
 *   W13 chat-canonical：显示名 / 内核哈希标识统一反查回真实会话 id（标记 WHALE-CHAT-CANONICAL）
 *        bridge/outbound_api.py 的 deliver() 直接把 payload 里的 target 当会话名用。dsh 有时给过来的
 *        是 UI 显示名，甚至内核哈希标识（形如 #597fdc6d(19字)），桥比对当前会话就对不上，报
 *        chat-mismatch 把图、表情、语音一并挡掉。新增 _canonical_target()：先认 wxid / 群 id，
 *        再剥掉「微信·」「(主人)」「(19字)」「#597fdc6d」这些装饰，按 remark / nick_name / 群名反查，
 *        查到就把 target 换成 wxid、chat 换成备注名；查不到原样往下走，不新增失败分支。
 *
 *   W14 image-confirm-latest：图发出去了别误判成「没确认到」（标记 WHALE-IMAGE-CONFIRM-LATEST）
 *        bridge/sticker_transport.py 的 confirm_delivery() 超时前只按基线 seq 找新消息，微信写库慢
 *        一拍或草稿没清就返回 'no new outgoing media message confirmed'，于是重发、报错，用户看到
 *        「表情没发出去」。改成到点前先回读本地消息库最新一条（_latest_delivery_row），出站媒体
 *        确实是本条就判已发；否则维持原判定。
 *
 *   W17 wechat-name-squash：会话名比对前先剥零宽字符（标记 FS-WX-INVIS）
 *        bridge/sticker_transport.py、bg_sender.py、account_mixin.py 三处：微信备注里常夹
 *        零宽字符（U+200B），肉眼同名但字符串不等，精确匹配恒失手。新增 _squash_name() /
 *        clean_shown_name() 归一再比。
 *
 *   W18 moments-external：朋友圈文案由 dsh 出、鲸鱼只负责「点发表」（标记 WHALE-MOMENTS-EXTERNAL）
 *        a) src/services/momentsPublisher.js 新增 queueExternal()：跳过鲸鱼的模型生成，
 *           把外部文案直接压进队列（manual，不占鲸鱼自己的每日额度），仍走 claim / complete 通道；
 *        b) src/http/routes/moments.js 新增 POST /api/moments/publish-external：
 *           body { text, emotion, withImage }，成功返回 { ok:true, job }。
 *        缺这两段时 dsh 侧 publishUrl（127.0.0.1:8787/api/moments/publish-external）只会拿到 404，
 *        moments.log 里就是一条条 publish -> 404，朋友圈永远发不出去。
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
 *   node patch-whalegirl.mjs --only forward   # 只跑 W1（forward / outbound / probe / voicelocal / residue / image
 *                                             / chatname / uifallback / mediafix / wxsquash
 *                                             / voicechat / chatcanon / imgconfirm）
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
const MARK_MOMENTSEXTERNAL = 'WHALE-MOMENTS-EXTERNAL';

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
	// 用函数式替换：newBody 里只要出现 $& / $' / $` 这类字符，字符串替换会把它们当替换模式展开，
	// 直接把补丁内容拼坏（W13 的 Python 正则就以 $') 结尾踩过一次）。
	const repl = newBody.replace(/\r\n/g, '\n');
	let out = norm.replace(oldText, () => repl);
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
	// 资产仓里没有 image_clip_fallback.py / wb_pixel.py（这两个早期是现场落盘、未入仓）。
	// 缺资产时若目标端已带必需标记就保留原文件，绝不因为读不到资产抛 ENOENT 把 W10+ 全部带停。
	const assetOrKeep = (name, mustHas) => {
		const src = join(ASSETS, name);
		const tgt = join(root, 'bridge', name);
		if (!existsSync(src)) {
			const cur = existsSync(tgt) ? readFileSync(tgt, 'utf8') : '';
			return cur.includes(mustHas);
		}
		writeFileSync(tgt, asset(name), 'utf8');
		return true;
	};
	writeFileSync(file, asset('image_ui_fallback.py'), 'utf8');
	// W9b：右键复制取图（用户指定方式）。像素定位图片气泡 -> 短暂把微信窗口置前（右键才生效，
	// 用完把焦点还给原窗口）-> 右键 -> 点「复制」-> 读剪贴板，直接拿聊天里的原图，
	// 不弹预览窗、不关窗、不挪窗口；PrintWindow 抓图所以微信被盖住也能定位。
	const clipKept = assetOrKeep('image_clip_fallback.py', 'WHALE-UI-CLIP');
	const pixelKept = assetOrKeep('wb_pixel.py', 'WHALE-UI-CLIP');
	log(`  image_clip_fallback.py=${clipKept ? '就绪' : '缺'} / wb_pixel.py=${pixelKept ? '就绪' : '缺'}`);
	changed += 1;
	note(id, 'PATCHED', '已换成「右键复制取原图」+ 控件定位截图双路兜底');
	log(`[${id}] 已写入 image_ui_fallback.py / image_clip_fallback.py / wb_pixel.py（原文件：${saved}）`);
}




// ---------------------------------------------------------------------------
// W12 voice-chatfallback / W13 chat-canonical / W14 image-confirm-latest
// 现场三连：私聊语音报 local:no-chat、私聊图片 / 表情报 chat-mismatch、
// 图明明发出去了却回 no new outgoing media message confirmed；群聊全部正常。
// 三段都只在「原来会失败」的分支上加兜底，不改群聊既有路径。
// ---------------------------------------------------------------------------
const MARK_VOICECHATFALLBACK = 'WHALE-VOICE-CHATFALLBACK';
const MARK_CHATCANONICAL = 'WHALE-CHAT-CANONICAL';
const MARK_IMGCONFIRMLATEST = 'WHALE-IMAGE-CONFIRM-LATEST';

// W12 voice_mixin.prepare()：前台 UIA 切不过去时改走后台通道，别再直接 local:no-chat。
const OLD_VOICE_PREPARE = `                keys = self.aliases_for(username, who)
                if u.current_chat() not in keys and (not u.open_chat(keys)):
                    return ''
                current = str(u.current_chat() or '')
`;
const NEW_VOICE_PREPARE = `                keys = self.aliases_for(username, who)
                if u.current_chat() not in keys and (not u.open_chat(keys)):
                    # [WHALE-VOICE-CHATFALLBACK] 前台 UIA 打不开会话时改走后台通道（bg_sender）：
                    # 现场私聊语音一直报 local:no-chat，而文字走同一条后台通道切会话一直是成功的；
                    # 以前这里直接 return ''，音频都已经合成好了却整条丢掉，上层只看到「希希不发语音」。
                    try:
                        try:
                            from . import bg_sender as _bg
                        except Exception:  # noqa: BLE001 - 单独运行 / 包外导入时
                            import bg_sender as _bg  # type: ignore
                        if _bg.open_chat(_bg.WeChatSender(hwnd), sorted(keys), log=G.log):
                            G.log('自动语音：前台打不开会话，已用后台通道切到会话')
                    except Exception as _exc:  # noqa: BLE001
                        G.log('自动语音：后台通道切会话失败 %s' % repr(_exc))
                    for _ in range(8):
                        if str(u.current_chat() or '') in keys:
                            break
                        G.time.sleep(0.25)
                current = str(u.current_chat() or '')
`;

// W13 outbound_api：显示名 / 内核哈希标识 -> 真实 wxid / 群 id，顺带换回备注名。
const OLD_CHAT_HEAD = `def deliver(payload):
    """把 OneBot 风格的段依次发出去，返回 (status, body)。"""
    bridge = BRIDGE
    if bridge is None:
        return 503, {'ok': False, 'error': '桥接还没就绪'}
    if not isinstance(payload, dict):
        return 400, {'ok': False, 'error': '请求体不是 JSON 对象'}
    target = str(payload.get('target') or '').strip()
    if target == '':
        return 400, {'ok': False, 'error': 'target 为空'}
    chat = str(payload.get('chatName') or '').strip() or target
`;
const NEW_CHAT_HEAD = `# [WHALE-CHAT-CANONICAL] 私聊会话标识归一 -------------------------------------------
# 现场：私聊语音报 local:no-chat、私聊图片 / 表情报 chat-mismatch，群聊却一切正常。
# 根因是 dsh 传下来的 target 不一定是 wxid：可能是带频道前缀 / 括号备注的显示名，
# 也可能是内核自己生成的会话哈希标识（日志里写作 #597fdc6d(19字)）。
# 桥这边 aliases_for() 对私聊只保留「显示名」一个候选（raw id 会被过滤掉），
# 名字对不上就切不过去。这里统一用数据库把显示名反查回 wxid / 群 id，
# 再把显示名换成微信里的备注名——alias 与 UIA 会话行才能真正对上。
_CHAT_ID_RE = re.compile(r'^(?:wxid_[0-9A-Za-z_-]+|\\d+@chatroom|gh_[0-9A-Za-z_-]+|\\d{5,})\\Z')
_HASH_TAG_RE = re.compile(r'#?[0-9a-f]{6,32}', re.I)
_LEN_TAG_RE = re.compile(r'[（(]\\s*\\d+\\s*字\\s*[)）]')
_NAME_NOISE_RE = re.compile(r'[（(]\\s*主人\\s*[)）]|^(?:微信|WeChat|QQ|企微|企业微信)\\s*[·・.:：\\-—]\\s*', re.I)


def _is_chat_id(value):
    """已经是 wxid / 群 id 的原样返回，不参与反查。"""
    return bool(_CHAT_ID_RE.match(str(value or '').strip()))


def _name_candidates(value):
    """把一个可能带装饰的会话标识拆成几个能拿去查库的名字（原名优先）。"""
    out = []
    raw = str(value or '')
    stripped = _NAME_NOISE_RE.sub(' ', _HASH_TAG_RE.sub(' ', _LEN_TAG_RE.sub(' ', raw)))
    for text in (raw, stripped):
        text = ' '.join(str(text or '').split())
        if text and text not in out:
            out.append(text)
    return out


def _lookup_chat_id(db, name, kind=''):
    """按名字反查 wxid / 群 id：先精确匹配，再退到联系人模糊搜索。"""
    order = ('group_name_to_id', 'username_by_nickname') if kind == 'group' else \\
            ('username_by_nickname', 'group_name_to_id')
    for meth in order:
        fn = getattr(db, meth, None)
        if not callable(fn):
            continue
        try:
            got = str(fn(name) or '').strip()
        except Exception:
            got = ''
        if got and _is_chat_id(got):
            return got
    search = getattr(db, 'search_contact', None)
    if callable(search):
        try:
            rows = search(name) or []
        except Exception:
            rows = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            got = str(row.get('username') or '').strip()
            shown = str(row.get('remark') or row.get('nick_name') or '').strip()
            if got and _is_chat_id(got) and shown and (shown == name or shown in name or name in shown):
                return got
    return ''


def _canonical_target(bridge, target, chat, kind=''):
    """返回 (target, chat)：target 统一成 wxid / 群 id，chat 统一成微信里的备注名。"""
    if target == '' or _is_chat_id(target):
        return target, chat
    db = getattr(bridge, 'db', None)
    if db is None:
        return target, chat
    resolved = ''
    seen = []
    for value in (target, chat):
        for name in _name_candidates(value):
            if not name or name in seen:
                continue
            seen.append(name)
            resolved = _lookup_chat_id(db, name, kind)
            if resolved != '':
                break
        if resolved != '':
            break
    if resolved == '' or resolved == target:
        return target, chat
    shown = ''
    try:
        shown = str(bridge.display_name(resolved) or '').strip()
    except Exception:
        shown = ''
    if shown != '' and not _is_chat_id(shown):
        chat = shown
    G.log('[outbound-api] 会话标识归一：%s -> %s（显示名 %s）'
          % (target[:32], resolved, chat[:24]))
    return resolved, chat


def deliver(payload):
    """把 OneBot 风格的段依次发出去，返回 (status, body)。"""
    bridge = BRIDGE
    if bridge is None:
        return 503, {'ok': False, 'error': '桥接还没就绪'}
    if not isinstance(payload, dict):
        return 400, {'ok': False, 'error': '请求体不是 JSON 对象'}
    target = str(payload.get('target') or '').strip()
    if target == '':
        return 400, {'ok': False, 'error': 'target 为空'}
    chat = str(payload.get('chatName') or payload.get('conversationName') or '').strip() or target
    # [WHALE-CHAT-CANONICAL] target 可能是显示名或内核哈希标识，先归一成真实会话 id。
    target, chat = _canonical_target(bridge, target, chat, str(payload.get('kind') or ''))
`;

// W14 sticker_transport：超时前回读本地消息库最新一条，别把已发出的图判成未确认。
const OLD_CONFIRM_HEAD = `def confirm_delivery(db, username, baseline, identity, gate, timeout=5.0,
                     clock=time.monotonic, sleep=time.sleep, marker=None):
    deadline = clock() + timeout
`;
const NEW_CONFIRM_HEAD = `def _latest_delivery_row(db, username, own_username, marker, since):
    """[WHALE-IMAGE-CONFIRM-LATEST] 超时兜底：直接读本会话最新一条消息比对。

    现场：图 / 表情其实已经贴出去了，但 get_new_messages(since_seq=baseline) 按
    sort_seq 过滤时看不到那一行（写库慢、分表、sort_seq 没推进都会这样），
    于是每轮都判「没有新的出站媒体」，最后误报 no new outgoing media message
    confirmed，上层要么把已发出的图再发一遍，要么直接判失败。
    只认「本会话最新一条 + 自己发的 + 媒体 / 文件类 + 时间落在本次发送之后」，
    既兜住误报，又不会把别人刚发的图认成自己的。
    """
    try:
        rows = db.get_messages(username, limit=1)
    except Exception:
        return False
    row = rows[0] if isinstance(rows, list) and rows else None
    if not isinstance(row, dict):
        return False
    try:
        if not _outgoing(db, row, own_username):
            return False
        if not (_message_matches(row, marker) or row.get('type') in MEDIA_TYPES | FILE_TYPES):
            return False
        created = int(row.get('create_time') or 0)
        if created and since and created < int(since) - 120:
            return False
    except Exception:
        return False
    return True


def confirm_delivery(db, username, baseline, identity, gate, timeout=5.0,
                     clock=time.monotonic, sleep=time.sleep, marker=None):
    deadline = clock() + timeout
    started = time.time()  # [WHALE-IMAGE-CONFIRM-LATEST] 本次发送的墙上时间，超时兜底用
`;
const OLD_CONFIRM_TIMEOUT = `        if clock() >= deadline:
            return result('unconfirmed', 'no new outgoing media message confirmed; do not retry')
`;
const NEW_CONFIRM_TIMEOUT = `        if clock() >= deadline:
            # [WHALE-IMAGE-CONFIRM-LATEST] 超时前再看一眼本地消息库最新一条，
            # 别把「已经发出去、只是增量查询没看见」的图判成未确认。
            if _latest_delivery_row(db, username, identity[1], marker, started):
                return result('confirmed')
            return result('unconfirmed', 'no new outgoing media message confirmed; do not retry')
`;

function patchVoiceChatFallback(root) {
	const id = 'W12 voice-chatfallback';
	const file = join(root, 'bridge', 'voice_mixin.py');
	if (!existsSync(file)) {
		failed += 1;
		note(id, 'MISSING', `没有 ${file}`);
		log(`[${id}] 找不到 ${file}`);
		return;
	}
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_VOICECHATFALLBACK)) {
		note(id, 'ALREADY', '语音切会话的后台通道兜底在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺语音切会话的后台通道兜底');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const res = replaceOnce(file, OLD_VOICE_PREPARE, NEW_VOICE_PREPARE, MARK_VOICECHATFALLBACK);
	if (!res.ok) {
		failed += 1;
		note(id, 'DRIFT', res.reason);
		log(`[${id}] 停手：${res.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', '前台切不过去时改走 bg_sender 后台通道');
	log(`[${id}] 已改 voice_mixin.py（原文件备份：${res.saved}）`);
}

function patchChatCanonical(root) {
	const id = 'W13 chat-canonical';
	const file = join(root, 'bridge', 'outbound_api.py');
	if (!existsSync(file)) {
		failed += 1;
		note(id, 'MISSING', `没有 ${file}`);
		log(`[${id}] 找不到 ${file}`);
		return;
	}
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_CHATCANONICAL)) {
		note(id, 'ALREADY', '会话标识归一在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺会话标识归一（显示名/哈希 -> wxid）');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const res = replaceOnce(file, OLD_CHAT_HEAD, NEW_CHAT_HEAD, MARK_CHATCANONICAL);
	if (!res.ok) {
		failed += 1;
		note(id, 'DRIFT', res.reason);
		log(`[${id}] 停手：${res.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', 'target 反查回 wxid / 群 id，chat 换成备注名');
	log(`[${id}] 已改 outbound_api.py（原文件备份：${res.saved}）`);
}

function patchImageConfirmLatest(root) {
	const id = 'W14 image-confirm-latest';
	const file = join(root, 'bridge', 'sticker_transport.py');
	if (!existsSync(file)) {
		failed += 1;
		note(id, 'MISSING', `没有 ${file}`);
		log(`[${id}] 找不到 ${file}`);
		return;
	}
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_IMGCONFIRMLATEST)) {
		note(id, 'ALREADY', '超时回读最新一条的兜底在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺超时回读最新一条的兜底');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const head = replaceOnce(file, OLD_CONFIRM_HEAD, NEW_CONFIRM_HEAD, MARK_IMGCONFIRMLATEST);
	if (!head.ok) {
		failed += 1;
		note(id, 'DRIFT', head.reason);
		log(`[${id}] 停手：${head.reason}`);
		return;
	}
	const tail = replaceOnce(file, OLD_CONFIRM_TIMEOUT, NEW_CONFIRM_TIMEOUT, MARK_IMGCONFIRMLATEST);
	if (!tail.ok) {
		failed += 1;
		note(id, 'DRIFT', tail.reason);
		log(`[${id}] 停手（已插入最新一条比对函数，超时分支未改）：${tail.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', '超时前回读本地消息库最新一条再判');
	log(`[${id}] 已改 sticker_transport.py（原文件备份：${tail.saved}）`);
}



// ---------------------------------------------------------------------------
// W15 chat-exact / W16 alias-remark-raw
// 名称匹配两处缺陷：①「嘉新」被当成「嘉新的妈妈」的命中，私聊消息发错人；
// ②联系人备注里夹着 U+200B 时，候选名全是剥干净的版本，UIA 会话行对不上 -> local:no-chat。
// ---------------------------------------------------------------------------
const MARK_CHATEXACT = 'WHALE-CHAT-EXACT';
const MARK_ALIASREMARK = 'FS-WX-REMARK-RAW';

// W15：反查只做精确相等（容忍零宽差异），删掉 shown in name / name in shown 两条子串判定。
const OLD_CHAT_SEARCH = `        for row in rows:
            if not isinstance(row, dict):
                continue
            got = str(row.get('username') or '').strip()
            shown = str(row.get('remark') or row.get('nick_name') or '').strip()
            if got and _is_chat_id(got) and shown and (shown == name or shown in name or name in shown):
                return got
    return ''
`;
const NEW_CHAT_SEARCH = `        for row in rows:
            if not isinstance(row, dict):
                continue
            got = str(row.get('username') or '').strip()
            shown = str(row.get('remark') or row.get('nick_name') or '').strip()
            # [WHALE-CHAT-EXACT] 只认精确相等，禁止子串包含判定：
            # 以前写成 (shown == name or shown in name or name in shown)，搜「嘉新」会把
            # 「嘉新的妈妈」也算命中，私聊消息直接发给了他妈。这里只放行同一个名字。
            if got and _is_chat_id(got) and shown and _same_shown_name(shown, name):
                return got
    return ''


# [WHALE-CHAT-EXACT] 名字比对只做精确相等，但容忍「零宽字符差异」——微信备注里常夹
# U+200B 之类不可见字符，肉眼同一个名字，字符串却不相等。绝不做子串包含。
_ZW_ONLY_RE = re.compile('[\\u200b-\\u200f\\u2060\\ufeff]')


def _zw_less(value):
    """去掉零宽 / 方向控制字符后的名字（只用于相等判定，不用于改写候选）。"""
    return _ZW_ONLY_RE.sub('', str(value or ''))


def _same_shown_name(shown, name):
    """两个名字是否指同一个人：精确相等，或去掉零宽字符后精确相等。"""
    left = str(shown or '').strip()
    right = str(name or '').strip()
    if not left or not right:
        return False
    if left == right:
        return True
    return _zw_less(left) == _zw_less(right)
`;

// W16：aliases_for 候选里补数据库备注原文（零宽字符原样保留），排最前。
const OLD_ALIAS_DEDUPE = `        out = [x for x in dict.fromkeys(out) if x and not is_raw_chat_id(x)]
`;
const NEW_ALIAS_DEDUPE = `        # [FS-WX-REMARK-RAW] 数据库里该联系人的备注原文排最前（零宽字符原样保留）：
        # 微信会话列表那一行用的就是备注原文，剥过零宽字符的干净名反而比不上，
        # 备注里带 U+200B 时 open_chat 一直报 local:no-chat。
        try:
            remark_raw = self.db.get_nickname(username) or ''
        except Exception:
            remark_raw = ''
        if remark_raw and remark_raw != username and not is_raw_chat_id(remark_raw):
            out.insert(0, remark_raw)
        out = [x for x in dict.fromkeys(out) if x and not is_raw_chat_id(x)]
`;

function patchChatExact(root) {
	const id = 'W15 chat-exact';
	const file = join(root, 'bridge', 'outbound_api.py');
	if (!existsSync(file)) {
		failed += 1;
		note(id, 'MISSING', `没有 ${file}`);
		log(`[${id}] 找不到 ${file}`);
		return;
	}
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_CHATEXACT)) {
		note(id, 'ALREADY', '名字反查已是精确匹配');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '名字反查还在用子串包含');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const res = replaceOnce(file, OLD_CHAT_SEARCH, NEW_CHAT_SEARCH, MARK_CHATEXACT);
	if (!res.ok) {
		failed += 1;
		note(id, 'DRIFT', res.reason);
		log(`[${id}] 停手：${res.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', '名字反查改为精确相等（容忍零宽差异）');
	log(`[${id}] 已改 outbound_api.py（原文件备份：${res.saved}）`);
}

function patchAliasRemarkRaw(root) {
	const id = 'W16 alias-remark-raw';
	const file = join(root, 'bridge', 'account_mixin.py');
	if (!existsSync(file)) {
		failed += 1;
		note(id, 'MISSING', `没有 ${file}`);
		log(`[${id}] 找不到 ${file}`);
		return;
	}
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_ALIASREMARK)) {
		note(id, 'ALREADY', '备注原文候选已在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺备注原文候选（零宽字符会让精确匹配失败）');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const res = replaceOnce(file, OLD_ALIAS_DEDUPE, NEW_ALIAS_DEDUPE, MARK_ALIASREMARK);
	if (!res.ok) {
		failed += 1;
		note(id, 'DRIFT', res.reason);
		log(`[${id}] 停手：${res.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', 'aliases_for 候选最前插入数据库备注原文');
	log(`[${id}] 已改 account_mixin.py（原文件备份：${res.saved}）`);
}


// ---------------------------------------------------------------------------
// W17 voice-devcapture：私聊语音「发出去了但是空的」。
// 现场：V-1b 本地录音链路是「WAV 播进 CABLE Input（虚拟线）→ 微信按住热键录音，从系统
// 默认录音设备采集」，而系统默认录音是耳机麦（INZONE H5-Chat），不在虚拟线链路上，
// 微信录到的就是静音：语音 5120ms 只有 3341 字节（≈652 B/s；正常语音 2KB/s 以上）。
// 方案 B（用户已确认）：
//   a) bridge/voice_guard.py 整份落盘：发语音前把默认录音的 console / multimedia /
//      communications 三个角色临时切到 CABLE Output，发完或失败后立刻还原；并回读微信库
//      按 length/(voicelength/1000) 算码率，低于 minBitrate（默认 900 B/s）判空语音；
//   b) voice_local.deliver：发前 begin()，无论成功失败都在 finally 里 restore()；
//   c) voice_mixin 的本地录音分支：先记已有语音 cursor → 发送 → 校验码率，判空按约定
//      重试一次，仍为空才判失败交上层降级；回读不到的按已发处理，绝不重发。
// ---------------------------------------------------------------------------
const MARK_VOICEDEVCAP = 'WHALE-VOICE-DEVCAP';
const MARK_VOICEVERIFY = 'WHALE-VOICE-VERIFY';

const OLD_VL_BEGIN = `    try:
        wav = to_wav(root, audio, log)
    except Exception as exc:
        return fail('local:wav:%s' % exc)
`;
const NEW_VL_BEGIN = `    try:
        wav = to_wav(root, audio, log)
    except Exception as exc:
        return fail('local:wav:%s' % exc)

    # [${MARK_VOICEDEVCAP}] 发语音前把系统默认录音（含通讯角色）临时切到虚拟线 CABLE Output：
    # 微信按住热键录音时是从「默认录音设备」采集的，默认设备是耳机麦时录到的是静音
    # （现场 voicelength 5120ms / length 3341B ≈ 652B/s，对方听不到）。护栏放在 try 外面，
    # 这样 finally 里能拿到 guard 句柄；任何异常都只打日志，不影响发语音本身。
    guard = None
    try:
        import voice_guard as _voice_guard
        guard = _voice_guard.begin(root, log)
    except Exception as exc:  # noqa: BLE001 - 守卫不可用时保持原行为，绝不阻断发送
        _log(log, '[voice-guard] 默认录音守卫不可用（%s），沿用当前默认录音设备'
             % type(exc).__name__)
`;
const OLD_VL_FINALLY = `    finally:
        try:
            time.sleep(0.5)
            os.remove(wav)
        except OSError:
            pass
`;
const NEW_VL_FINALLY = `    finally:
        # [${MARK_VOICEDEVCAP}] 发送完成或失败都立刻把默认录音还原成用户原来的设备，
        # 不留副作用（用户自己的通话 / 会议还在用耳机麦）。
        try:
            if guard is not None:
                guard.restore()
        except Exception:  # noqa: BLE001 - 还原失败也不能影响发语音结果
            pass
        try:
            time.sleep(0.5)
            os.remove(wav)
        except OSError:
            pass
`;

const OLD_VM_CALL = `                if payload:
                    return _voice_local.deliver(
                        G.ROOT, text, payload, hwnd, prepare, G.log,
                        cancelled=cancelled, outcome=outcome, send_lock=self.send_lock,
                    )
`;
const NEW_VM_CALL = `                if payload:
                    # [${MARK_VOICEVERIFY}] 改走「发送 + 回读码率校验」包装：默认录音不在虚拟线
                    # 链路上时微信录到的是静音，语音照发但对方听不到，必须回读库确认后
                    # 再决定重试一次还是判失败交上层降级。
                    return self._voice_local_checked(
                        G, _voice_local, text, payload, hwnd, prepare,
                        cancelled, outcome, who, username,
                    )
`;

const NEW_VM_HELPER = `    def _voice_local_checked(self, G, _voice_local, text, payload, hwnd, prepare,
                             cancelled, outcome, who, username):
        # [${MARK_VOICEVERIFY}] 本地录音发完之后回读微信库校验码率：
        #   码率正常 -> 成功；判空 -> 按方案 B 重试一次；重试仍空 -> 判失败交上层降级；
        #   回读不到这条语音（unknown）-> 按已发处理，绝不重试，避免同一条语音发两遍。
        def _send():
            return _voice_local.deliver(
                G.ROOT, text, payload, hwnd, prepare, G.log,
                cancelled=cancelled, outcome=outcome, send_lock=self.send_lock,
            )

        try:
            import voice_guard as _vg
        except Exception as exc:  # noqa: BLE001 - 守卫缺失时保持原行为
            G.log('自动语音：voice_guard 不可用 %s，按原流程直接发送' % type(exc).__name__)
            return _send()
        try:
            me = str(getattr(self.db, 'wxid', '') or '')
        except Exception:  # noqa: BLE001
            me = ''
        cursor = _vg.voice_cursor(self.db, username)
        if not _send():
            return False
        res = _vg.check_voice(self.db, username, me, cursor, G.time.time(), G.ROOT)
        state = res.get('state')
        if state == 'ok':
            G.log('[voice-guard] 语音码率正常：%s' % res.get('detail'))
            return True
        if state != 'empty':
            G.log('[voice-guard] 语音已发但回读不到（%s），按已发处理、不重试' % res.get('detail'))
            return True
        G.log('[voice-guard] 语音是空的（%s），按方案 B 重试一次' % res.get('detail'))
        if cancelled is not None and cancelled():
            return True
        cursor = _vg.voice_cursor(self.db, username)
        if not _send():
            return False
        res = _vg.check_voice(self.db, username, me, cursor, G.time.time(), G.ROOT)
        if res.get('state') == 'ok':
            G.log('[voice-guard] 重试后语音码率正常：%s' % res.get('detail'))
            return True
        G.log('[voice-guard] 重试仍为空（%s），本次判失败交上层降级' % res.get('detail'))
        if outcome is not None:
            try:
                outcome.update(Status='failed', Error='voice:empty')
            except Exception:  # noqa: BLE001
                pass
        return False
`;

function patchVoiceDevCap(root) {
	const id = 'W17 voice-devcapture';
	// a) 守卫模块整份落盘（鲸鱼更新把 bridge/*.py 换回官方版后靠这条复原）
	const guardFile = join(root, 'bridge', 'voice_guard.py');
	const guardOk = existsSync(guardFile) && readFileSync(guardFile, 'utf8').includes(MARK_VOICEDEVCAP);
	if (guardOk) {
		note(id, 'ALREADY', 'voice_guard.py 已在（默认录音守卫 + 码率校验）');
	} else if (CHECK) {
		note(id, 'PENDING', '缺 voice_guard.py（默认录音守卫 + 码率校验）');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
	} else {
		const saved = existsSync(guardFile) ? backup(guardFile) : '(原先不存在，新建)';
		writeFileSync(guardFile, asset('voice_guard.py'), 'utf8');
		changed += 1;
		note(id, 'PATCHED', '已落盘 voice_guard.py（临时切默认录音 + 码率校验）');
		log(`[${id}] 已写入 voice_guard.py（原文件：${saved}）`);
	}

	// b) voice_local.deliver：发前切设备、finally 还原
	const vlFile = join(root, 'bridge', 'voice_local.py');
	const vlText = readFileSync(vlFile, 'utf8');
	if (vlText.includes(MARK_VOICEDEVCAP)) {
		note(id, 'ALREADY', 'voice_local.deliver 已有默认录音切换与还原');
		log(`[${id}] voice_local.py 已经在（跳过）`);
	} else if (CHECK) {
		note(id, 'PENDING', 'voice_local.deliver 缺默认录音切换与还原');
		log(`[${id}] voice_local.py 缺 -> 待打（--check，不动文件）`);
	} else {
		const r1 = replaceOnce(vlFile, OLD_VL_BEGIN, NEW_VL_BEGIN, MARK_VOICEDEVCAP);
		if (!r1.ok) {
			failed += 1;
			note(id, 'DRIFT', 'voice_local 发前切设备锚点：' + r1.reason);
			log(`[${id}] 停手：${r1.reason}`);
		} else {
			const r2 = replaceOnce(vlFile, OLD_VL_FINALLY, NEW_VL_FINALLY, MARK_VOICEDEVCAP);
			if (!r2.ok) {
				failed += 1;
				note(id, 'DRIFT', 'voice_local finally 还原锚点：' + r2.reason);
				log(`[${id}] 停手：${r2.reason}`);
			} else {
				changed += 1;
				note(id, 'PATCHED', 'voice_local.deliver 已加发前切设备 + finally 还原');
				log(`[${id}] 已改 voice_local.py（原文件备份：${r2.saved}）`);
			}
		}
	}

	// c) voice_mixin：本地录音分支改成「发送 + 回读码率校验」
	const vmFile = join(root, 'bridge', 'voice_mixin.py');
	const vmText = readFileSync(vmFile, 'utf8');
	if (vmText.includes(MARK_VOICEVERIFY)) {
		note(id, 'ALREADY', 'voice_mixin 本地录音分支已带码率校验与重试');
		log(`[${id}] voice_mixin.py 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', 'voice_mixin 本地录音分支缺码率校验与重试');
		log(`[${id}] voice_mixin.py 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const r3 = replaceOnce(vmFile, OLD_VM_CALL, NEW_VM_CALL, MARK_VOICEVERIFY);
	if (!r3.ok) {
		failed += 1;
		note(id, 'DRIFT', 'voice_mixin 本地录音调用锚点：' + r3.reason);
		log(`[${id}] 停手：${r3.reason}`);
		return;
	}
	const r4 = insertBlocks(
		vmFile,
		[{ anchor: '    def voice_test_loop(self):', content: NEW_VM_HELPER }],
		MARK_VOICEVERIFY,
	);
	if (!r4.ok) {
		failed += 1;
		note(id, 'DRIFT', 'voice_mixin 插入 _voice_local_checked：' + r4.reason);
		log(`[${id}] 停手：${r4.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', 'voice_mixin 已改走发送 + 回读码率校验（判空重试一次）');
	log(`[${id}] 已改 voice_mixin.py（原文件备份：${r4.saved}）`);
}

/**
 * W18 moments-external：朋友圈文案由 dsh（fish-soul）出，鲸鱼只当「手」去发表。
 *   a) src/services/momentsPublisher.js 新增 queueExternal()：跳过鲸鱼自己的模型生成，
 *      把外部文案直接压进队列（manual，不占鲸鱼自己的每日额度），仍走 claim / complete 通道；
 *   b) src/http/routes/moments.js 新增 POST /api/moments/publish-external：
 *      body { text, emotion, withImage }，成功返回 { ok:true, job }。
 * 缺这两段时 dsh 侧 publishUrl（127.0.0.1:8787/api/moments/publish-external）只会拿到 404，
 * moments.log 里就是一条条 publish -> 404，朋友圈永远发不出去。
 */
// ---------------------------------------------------------------------------
// W20 voice-idcheck：语音只认会话 id，不允许群成员名冒充群会话。
// 现场：希希测试群只有一个成员「嘉新」，aliases_for() 把群成员名并进候选，
// prepare() 只比会话名就放行，语音录进了「嘉新」的私聊，文字却正确地进了群。
// 改法与文字发送同一口径：能反查到当前会话 id 就严格比 id，取不到 id 才退回
// primary_chat_name() 的主名比对；成员名永远不能当作「已经在目标会话」的依据。
// ---------------------------------------------------------------------------
const MARK_VOICEIDCHECK = 'WHALE-VOICE-IDCHECK';
const OLD_VM_HEAD = `import engine as G


class VoiceMixin:`;
const NEW_VM_HEAD = `import engine as G

_VOICE_INVISIBLE = dict.fromkeys([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad, 0x200e, 0x200f])


def _voice_squash(value):
    """[WHALE-VOICE-IDCHECK] 会话名归一：去掉零宽 / 方向控制字符再比（微信备注里常夹 U+200B）。"""
    return str(value if value is not None else '').translate(_VOICE_INVISIBLE).strip()


class VoiceMixin:`;
const OLD_VM_TAIL = `                current = str(u.current_chat() or '')
                if current not in keys:
                    return ''
                return current`;
const NEW_VM_TAIL = `                current = str(u.current_chat() or '')
                if current not in keys:
                    return ''
                # [WHALE-VOICE-IDCHECK] 语音落到哪个会话，必须和文字发送同一口径：只认会话 id。
                # aliases_for() 会把群成员名当候选（未命名的群在列表里显示的就是成员名），
                # 群只有一个成员时「嘉新」直接命中，prepare 以为已经切到群，语音就录进了
                # 这个成员的私聊。能反查到当前会话 id 就严格要求 id 相等；取不到 id 才退回
                # 「主名完全相等」（群=群名 / 私聊=备注本名），成员名永远不能冒充群会话。
                _resolve = getattr(self, 'resolve_chat_id', None)
                _tid = str(username or '').strip()
                _cid = ''
                if callable(_resolve):
                    try:
                        _cid = str(_resolve(current) or '').strip()
                    except Exception:  # noqa: BLE001
                        _cid = ''
                    if _tid:
                        try:
                            _tid = str(_resolve(_tid) or '').strip()
                        except Exception:  # noqa: BLE001
                            _tid = ''
                _primary = ''
                if _cid and _tid:
                    if _cid == _tid:
                        return current
                    # 当前会话不是目标（成员私聊冒充群）：只按主名切一次，成员名不参与匹配，
                    # 切完仍以会话 id 复核，核不过就这一轮不发语音，绝不发错人。
                    try:
                        _primary = str(self.primary_chat_name(username, who) or '').strip()
                    except Exception:  # noqa: BLE001
                        _primary = ''
                    if _primary:
                        try:
                            try:
                                from . import bg_sender as _bgv
                            except Exception:  # noqa: BLE001 - 单独运行 / 包外导入时
                                import bg_sender as _bgv  # type: ignore
                            with _bgv._IdCtx(_tid, _resolve):
                                if _bgv.open_chat(_bgv.WeChatSender(hwnd), [_primary], log=G.log):
                                    for _wait in range(12):
                                        _now = str(u.current_chat() or '')
                                        try:
                                            _now_id = str(_resolve(_now) or '').strip()
                                        except Exception:  # noqa: BLE001
                                            _now_id = ''
                                        if _now_id and _now_id == _tid:
                                            G.log('自动语音：当前会话是成员私聊，已按会话 id 切回目标会话')
                                            return _now
                                        G.time.sleep(0.25)
                        except Exception as _exc:  # noqa: BLE001
                            G.log('自动语音：按会话 id 切回目标会话失败 %s' % repr(_exc))
                    G.log('自动语音：当前会话与目标会话 id 不一致，本轮不发语音（避免发错人）')
                    return ''
                try:
                    _primary = str(self.primary_chat_name(username, who) or '').strip()
                except Exception:  # noqa: BLE001
                    _primary = ''
                if _primary and _voice_squash(current) != _voice_squash(_primary):
                    G.log('自动语音：当前会话不是目标主名，本轮不发语音（避免发错人）')
                    return ''
                return current`;

function patchVoiceIdCheck(root) {
	const id = 'W20 voice-idcheck';
	const file = join(root, 'bridge', 'voice_mixin.py');
	if (!existsSync(file)) {
		failed += 1;
		note(id, 'MISSING', '没有 bridge/voice_mixin.py');
		log(`[${id}] 找不到 ${file}`);
		return;
	}
	const text = readFileSync(file, 'utf8');
	if (text.includes(MARK_VOICEIDCHECK)) {
		note(id, 'ALREADY', '语音会话 id 核对方已在位');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', '缺 语音会话 id 核对');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const r1 = replaceOnce(file, OLD_VM_HEAD, NEW_VM_HEAD, MARK_VOICEIDCHECK);
	if (!r1.ok) {
		failed += 1;
		note(id, 'DRIFT', 'voice_mixin 头部插 _voice_squash：' + r1.reason);
		log(`[${id}] 停手：${r1.reason}`);
		return;
	}
	const r2 = replaceOnce(file, OLD_VM_TAIL, NEW_VM_TAIL, MARK_VOICEIDCHECK);
	if (!r2.ok) {
		// 头部已经插进去了但主体没打上，标记会误导下一轮判「已在位」，先把头部还原。
		const back = replaceOnce(file, NEW_VM_HEAD, OLD_VM_HEAD, 'class VoiceMixin:');
		failed += 1;
		note(id, 'DRIFT', 'voice_mixin prepare 尾部：' + r2.reason + (back.ok ? '（头部已还原）' : '（头部还原失败，需手工处理）'));
		log(`[${id}] 停手：${r2.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', '语音 prepare 改为会话 id 核对（原文件备份：' + r2.saved + '）');
	log(`[${id}] 已补 语音会话 id 核对（原文件备份：${r2.saved}）`);
}

// ---------------------------------------------------------------------------
// W21 image-foreground-retry：抢不到前台不再整张丢图。
// 现场：outbound-image failed / could-not-bring-wechat-to-front 连打三次，微信窗口明明
// 开着只是没被置到最前，表情包与图片全被丢掉。改为置前重试 3 次（间隔 150ms），仍非
// 前台但 hwnd 有效、可见、未最小化时继续发送；只有 hwnd 无效 / 最小化才返回原错误码。
// outbound_image.py 由本仓 assets 整份下发，所以这里按资产内容比对并覆盖。
// ---------------------------------------------------------------------------
const MARK_IMGFG = 'WHALE-IMAGE-FOREGROUND-RETRY';

function patchImageForegroundRetry(root) {
	const id = 'W21 image-foreground-retry';
	const file = join(root, 'bridge', 'outbound_image.py');
	const want = asset('outbound_image.py');
	if (!want.includes(MARK_IMGFG)) {
		failed += 1;
		note(id, 'DRIFT', '资产 outbound_image.py 里没有前台重试标记');
		log(`[${id}] 资产缺标记，停手`);
		return;
	}
	const has = existsSync(file);
	if (has && readFileSync(file, 'utf8') === want) {
		note(id, 'ALREADY', 'outbound_image.py 已是带前台重试的版本');
		log(`[${id}] 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', has ? 'outbound_image.py 与资产不一致（缺前台重试 / 被上游回滚）' : '缺 outbound_image.py');
		log(`[${id}] 缺 -> 待打（--check，不动文件）`);
		return;
	}
	mkdirSync(dirname(file), { recursive: true });
	const saved = has ? backup(file) : '';
	writeFileSync(file, want, 'utf8');
	changed += 1;
	note(id, 'PATCHED', has ? `已按资产覆盖 outbound_image.py（备份 ${saved}）` : '已按资产写入 outbound_image.py');
	log(`[${id}] 已写入前台重试版${has ? `（原文件备份：${saved}）` : '（新写入）'}`);
}

function patchMomentsExternal(root) {
	const id = 'W18 moments-external';
	const steps = [
		{
			file: join(root, 'src', 'services', 'momentsPublisher.js'),
			label: 'momentsPublisher.queueExternal',
			blocks: [{ anchor: '  claim(account) {', content: asset('publish-external-method.js'), where: 'before' }],
		},
		{
			file: join(root, 'src', 'http', 'routes', 'moments.js'),
			label: '/api/moments/publish-external 路由',
			blocks: [{
				anchor: "    return json(res, 409, { ok: false, error: messages[code] });\n  });",
				content: asset('publish-external-route.js'),
				where: 'after',
			}],
		},
	];
	for (const step of steps) {
		if (!existsSync(step.file)) {
			failed += 1;
			note(id, 'MISSING', `没有 ${step.file}`);
			log(`[${id}] 找不到 ${step.file}`);
			continue;
		}
		const text = readFileSync(step.file, 'utf8');
		if (text.includes(MARK_MOMENTSEXTERNAL)) {
			note(id, 'ALREADY', `${step.label} 在位`);
			log(`[${id}] ${step.label} 已经在（跳过）`);
			continue;
		}
		if (CHECK) {
			note(id, 'PENDING', `缺 ${step.label}`);
			log(`[${id}] 缺 ${step.label} -> 待打（--check，不动文件）`);
			continue;
		}
		const res = insertBlocks(step.file, step.blocks, MARK_MOMENTSEXTERNAL);
		if (!res.ok) {
			failed += 1;
			note(id, 'DRIFT', `${step.label}：${res.reason}`);
			log(`[${id}] 停手（${step.label}）：${res.reason}`);
			continue;
		}
		changed += 1;
		note(id, 'PATCHED', `已补 ${step.label}`);
		log(`[${id}] 已补 ${step.label}（原文件备份：${res.saved}）`);
	}
}

// W22 voice-foreground 的常量必须定义在下面的调度段之前（顶层 const 有 TDZ）。
const MARK_VOICEFOREGROUND = 'WHALE-VOICE-FOREGROUND';
const OLD_VM_FOREGROUND = `            return _voice_local.deliver(
                G.ROOT, text, payload, hwnd, prepare, G.log,
                cancelled=cancelled, outcome=outcome, send_lock=self.send_lock,
            )`;
const NEW_VM_FOREGROUND = `            # [${MARK_VOICEFOREGROUND}] 桥自己的窗口激活（带 ShowWindowAsync）先试一次，
            # voice_local 内部还会校验 GetForegroundWindow；拉不到前台就如实判失败，
            # 不再出现「日志写着已发出、群里其实没有语音」的假成功。
            return _voice_local.deliver(
                G.ROOT, text, payload, hwnd, prepare, G.log,
                cancelled=cancelled, outcome=outcome, send_lock=self.send_lock,
                foreground=getattr(self, 'force_foreground', None),
            )`;

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
	if (ONLY === '' || ONLY === 'wxsquash') patchWechatNameSquash(root);
	if (ONLY === '' || ONLY === 'voicechat') patchVoiceChatFallback(root);
	if (ONLY === '' || ONLY === 'chatcanon') patchChatCanonical(root);
	if (ONLY === '' || ONLY === 'imgconfirm') patchImageConfirmLatest(root);
	if (ONLY === '' || ONLY === 'chatexact') patchChatExact(root);
	if (ONLY === '' || ONLY === 'aliasremark') patchAliasRemarkRaw(root);
	if (ONLY === '' || ONLY === 'voicedevcap') patchVoiceDevCap(root);
	if (ONLY === '' || ONLY === 'moments') patchMomentsExternal(root);
	if (ONLY === '' || ONLY === 'chatstrict') patchChatStrict(root);
	if (ONLY === '' || ONLY === 'voiceid') patchVoiceIdCheck(root);
	if (ONLY === '' || ONLY === 'imgfgretry') patchImageForegroundRetry(root);
	if (ONLY === '' || ONLY === 'voicefg') patchVoiceForeground(root);
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


/**
 * W22 voice-foreground：让「按住说话」真的落在微信上，并且不再假报「已发出」。
 *
 * 现场证据（2026-11-21 07:43 那一轮）：
 *   V-1b 合成完成 46032 字节 → 转 WAV → 按 rightalt 录音 → play_wav 到 CABLE Input →
 *   日志写「已发出语音」，微信却根本没进录音态（CapabilityAccessManager 里 Weixin.exe
 *   的麦克风 LastUsedTimeStart 还停在 2026-10-06）。根因三条：
 *   1) 热键录音只对前台窗口生效，deliver 里没人保证微信在前台就盲按；
 *   2) 热键本身可能和微信实际设置不符（exe 侧 voice-send.json 记的是 Ctrl+Alt，
 *      voice_local 只认单键 rightalt，组合键根本发不出去）；
 *   3) 发完不做任何录音态校验，直接 outcome=Status:'sent'，上层以为成功、不重试。
 *
 * 改法：
 *   a) voice_local.py 整份落盘（原生更新会把 bridge/*.py 换回官方版，靠这条复原）；
 *   b) voice_mixin 的本地录音分支把 foreground 交给 deliver，让桥的窗口激活参与；
 *   c) deliver 内：前台校验失败 → local:no-foreground；热键支持组合键并按
 *      fallbackHotkey 二次尝试；发完比微信麦克风使用记录，没刷新 → local:no-record。
 */
function patchVoiceForeground(root) {
	const id = 'W22 voice-foreground';
	const vlFile = join(root, 'bridge', 'voice_local.py');
	const vlText = existsSync(vlFile) ? readFileSync(vlFile, 'utf8') : '';
	const vlOk = vlText.includes(MARK_VOICEFOREGROUND) && vlText.includes('WHALE-VOICE-RECORD-CHECK');
	if (vlOk) {
		note(id, 'ALREADY', 'voice_local 已带前台校验 + 组合热键 + 麦克风录音校验');
		log(`[${id}] voice_local.py 已经在（跳过）`);
	} else if (CHECK) {
		note(id, 'PENDING', 'voice_local 缺前台校验 / 组合热键 / 麦克风录音校验');
		log(`[${id}] voice_local.py 缺 -> 待打（--check，不动文件）`);
	} else {
		const saved = existsSync(vlFile) ? backup(vlFile) : '(原先不存在，新建)';
		writeFileSync(vlFile, asset('voice_local.py'), 'utf8');
		changed += 1;
		note(id, 'PATCHED', '已落盘 voice_local.py（前台校验 + 组合热键 + 录音校验）');
		log(`[${id}] 已写入 voice_local.py（原文件：${saved}）`);
	}

	const vmFile = join(root, 'bridge', 'voice_mixin.py');
	const vmText = existsSync(vmFile) ? readFileSync(vmFile, 'utf8') : '';
	if (vmText.includes('force_foreground')) {
		note(id, 'ALREADY', 'voice_mixin 本地录音分支已把 foreground 交给 deliver');
		log(`[${id}] voice_mixin.py 已经在（跳过）`);
		return;
	}
	if (CHECK) {
		note(id, 'PENDING', 'voice_mixin 本地录音分支缺 foreground 透传');
		log(`[${id}] voice_mixin.py 缺 -> 待打（--check，不动文件）`);
		return;
	}
	const r = replaceOnce(vmFile, OLD_VM_FOREGROUND, NEW_VM_FOREGROUND, MARK_VOICEFOREGROUND);
	if (!r.ok) {
		failed += 1;
		note(id, 'DRIFT', 'voice_mixin 本地录音调用锚点：' + r.reason);
		log(`[${id}] 停手：${r.reason}`);
		return;
	}
	changed += 1;
	note(id, 'PATCHED', 'voice_mixin 已把 foreground 交给 deliver');
	log(`[${id}] 已改 voice_mixin.py（原文件备份：${r.saved}）`);
}

function patchMediaFix(root) {
	// 常量必须在使用前初始化：原先放在文件末尾的顶层 const，调度段调用本函数时会触发 TDZ。
	const NEW1 = "                desc = run_media_with_timeout(lambda: self.describe_emoji(msg), '表情', msg, G.log)\n                if not desc:\n                    # [WHALE-MEDIA-RETRY] 首次识别失败（多半是首帧取图/看图接口慢）先重试一次，\n                    # 别急着把「看不懂」抛给模型；重试给它更长的上限，但整体仍有封顶。\n                    G.log('表情包首次识别为空，重试一次：消息id=%s:%s' % (msg.get('shard') or '', msg.get('local_id')))\n                    desc = run_media_with_timeout(lambda: self.describe_emoji(msg), '表情', msg, G.log, timeout=120.0)\n                if not desc:\n                    # 表情包识别不出来以前是直接 return（她一声不吭），现场看就是「发了表情她不理」。\n                    # 改成给一句占位，让她自然地接话、并且明确禁止编造画面。\n                    media_failed('表情')\n                    content = ('（对方发了一个表情包，但这边没看清画面。'\n                               '不要编造表情的内容；可以自然地接一句，比如问问这是什么表情、'\n                               '或者就随口应一下，别让对方解释半天）')\n                    media_placeholder = True\n                else:\n                    content = '（对方发了一个表情包，画面是：%s）' % desc";
	const NEW2 = "                desc = run_media_with_timeout(lambda: self.describe_image(msg), '图片', msg, G.log)\n                if not desc:\n                    # [WHALE-MEDIA-RETRY] 首次识别失败（多半是首帧取图/看图接口慢）先重试一次，\n                    # 别急着把「看不懂」抛给模型；重试给它更长的上限，但整体仍有封顶。\n                    G.log('图片首次识别为空，重试一次：消息id=%s:%s' % (msg.get('shard') or '', msg.get('local_id')))\n                    desc = run_media_with_timeout(lambda: self.describe_image(msg), '图片', msg, G.log, timeout=120.0)\n                if not desc:\n                    # 取不到图就装没看见，用户只会觉得「又卡死了」。改成让她自然地回一句：\n                    # 明确禁止编造画面，只允许问一句 / 让对方再发。\n                    media_failed('图片')\n                    content = ('（对方发了一张图片，但这边没取到、也看不清。'\n                               '不要编造图里的内容；可以自然地回一句，比如问对方图怎么了、'\n                               '或让对方再发一次 / 说说图里是什么）')\n                    media_placeholder = True\n                else:\n                    content = '（对方发了一张图片，图里是：%s）' % desc";
	const NEW3 = "            _guard_text = content\n            if media_placeholder or mtype in ('图片', '表情', '动画表情', '语音'):\n                _guard_text = '媒体#%s:%s' % (msg.get('shard') or '', msg.get('local_id'))";
	const NEW4 = "            prompt = ('这是对方发来的表情包。简短描述主体（是什么形象/角色，像不像某个知名 IP 或表情包系列）、'\n                  '表情、动作、画面文字，以及它通常想表达的意思（比如\"无语\"\"笑哭\"\"点赞\"）；'\n                  '看清就直说，看不清就说明，不要编造。')";
	const OLD1 = "                desc = run_media_with_timeout(lambda: self.describe_emoji(msg), '表情', msg, G.log)\n                if not desc:\n                    media_failed('表情')\n                    return\n                content = '（对方发了一个表情包，画面是：%s）' % desc";
	const OLD2 = "                desc = run_media_with_timeout(lambda: self.describe_image(msg), '图片', msg, G.log)\n                if not desc:\n                    # 取不到图就装没看见，用户只会觉得「又卡死了」。改成让她自然地回一句：\n                    # 明确禁止编造画面，只允许问一句 / 让对方再发。\n                    media_failed('图片')\n                    content = ('（对方发了一张图片，但这边没取到、也看不清。'\n                               '不要编造图里的内容；可以自然地回一句，比如问对方图怎么了、'\n                               '或让对方再发一次 / 说说图里是什么）')\n                    media_placeholder = True\n                else:\n                    content = '（对方发了一张图片，图里是：%s）' % desc";
	const OLD3 = "            _guard_text = content\n            if media_placeholder:\n                _guard_text = '%s#%s:%s' % (content, msg.get('shard') or '', msg.get('local_id'))";
	const OLD4 = "            prompt = '这是对方发来的表情包。简短描述主体、表情、动作和画面文字，看不清就说明，不要编造。'";

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


// W11 [FS-WX-INVIS]：微信备注里夹的零宽字符（U+200B 等）会让「UIA 读到的会话名」和
// 「数据库里的备注名」严格比较失败 —— 文字走后台通道没事，图片/表情出站却一直 chat-mismatch。
// 只在比较前去掉不可见字符，不改身份（"A B" 与 "AB" 仍然不相等）。
function patchWechatNameSquash(root) {
	const id = 'W11 wechat-name-invisible';
	const SQUASH = `_INVISIBLE_CHARS = dict.fromkeys(map(ord, '\\u200b\\u200c\\u200d\\u2060\\ufeff\\u00ad\\u200e\\u200f'))


def _squash_name(value):
    """会话名归一：去掉零宽 / 方向控制等不可见字符再比。 [FS-WX-INVIS]

    微信备注里的 U+200B 会让「UIA 读到的会话名」和「数据库里的备注名」严格比较失败，
    表现为图片 / 表情出站一直 chat-mismatch，而纯文字走后台通道却是好的。
    """
    return str(value if value is not None else '').translate(_INVISIBLE_CHARS).strip()


`;
	const CLEAN = `_INVIS_CHARS = dict.fromkeys(map(ord, '\\u200b\\u200c\\u200d\\u2060\\ufeff\\u00ad\\u200e\\u200f'))
# 频道口径前缀：soul 那边叫「微信·嘉新」「QQ·希希」，微信会话列表里只显示「嘉新」。
_CHANNEL_PREFIX_RE = re.compile(r'^(?:微信|WeChat|QQ|企微|企业微信|飞书|钉钉)\\s*[·・\\.\\-—_:：]\\s*', re.I)
# 括号注释：「（主人）」「(群)」这类备注是 soul 自己加的，微信里没有。
_BRACKET_NOTE_RE = re.compile(r'[（(【\\[][^）)】\\]]{0,20}[）)】\\]]')


def clean_shown_name(text):
    """把频道口径的显示名剥成微信里真正的会话名。 [FS-WX-INVIS]

    现场：soul 传下来的显示名是「微信·嘉新\\u200b\\u200b（主人）」，微信会话列表里只有「嘉新」。
    带着前缀 / 括号 / 零宽字符去搜索和比对永远对不上，表现就是文字走后台通道能发出去，
    图片和表情却一直 open-chat-failed / chat-mismatch。
    """
    s = str(text or '').translate(_INVIS_CHARS)
    s = _CHANNEL_PREFIX_RE.sub('', s)
    s = _BRACKET_NOTE_RE.sub('', s)
    s = re.sub(r'\\s+', ' ', s).strip()
    return s


`;
	const targets = [
		{
			file: join(root, 'bridge', 'sticker_transport.py'),
			pairs: [
				['def _is_blank(value):', SQUASH + 'def _is_blank(value):'],
				[
					"    cur = str(current or '').strip()\n    return bool(cur) and any(str(alias or '').strip() == cur for alias in (aliases or ()))",
					"    cur = _squash_name(current)\n    return bool(cur) and any(_squash_name(alias) == cur for alias in (aliases or ()))",
				],
			],
		},
		{
			file: join(root, 'bridge', 'bg_sender.py'),
			pairs: [
				['def name_score(alias, name):', SQUASH + 'def name_score(alias, name):'],
				[
					'    alias = str(alias or "").strip()\n    name = str(name or "").strip()\n    if not alias or not name:\n        return None',
					'    alias = _squash_name(alias)\n    name = _squash_name(name)\n    if not alias or not name:\n        return None',
				],
			],
		},
		{
			file: join(root, 'bridge', 'account_mixin.py'),
			pairs: [
				['def is_raw_chat_id(text):', CLEAN + 'def is_raw_chat_id(text):'],
				[
					'        if not out:\n            out.append(shown or username)',
					'        if not out:\n            out.append(shown or username)\n        # [FS-WX-INVIS] 再补一个剥掉频道前缀 / 括号备注 / 零宽字符的干净名。\n        # 原名保留在前面（不改变现有优先级），干净名在打分时才会拿到 0 分精确匹配。\n        clean = clean_shown_name(shown)\n        if clean and clean != shown and clean not in out:\n            out.append(clean)',
				],
			],
		},
	];
	for (const t of targets) {
		if (!existsSync(t.file)) {
			failed += 1;
			note(id, 'MISSING', `没有 ${t.file}`);
			log(`[${id}] 找不到 ${t.file}`);
			continue;
		}
		const text = readFileSync(t.file, 'utf8');
		if (text.includes('FS-WX-INVIS')) {
			note(id, 'ALREADY', '会话名比对的零宽归一在位');
			log(`[${id}] ${t.file} 已经在（跳过）`);
			continue;
		}
		let out = text;
		let drift = '';
		for (const [o, n] of t.pairs) {
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
			log(`[${id}] 停手：${t.file} 里锚点对不上（${drift.trim().slice(0, 40)}）`);
			continue;
		}
		const saved = backup(t.file);
		writeFileSync(t.file, out, 'utf8');
		changed += 1;
		log(`[${id}] 已改 ${t.file}：会话名比较前先去掉零宽字符（原文件：${saved}）`);
	}
}

// ──────────────────── W19：chat-strict（群消息回复被投到私聊） ────────────────────
/**
 * 现象：群里有人问话，她的回复发到了私聊。
 *
 * 根因两处：
 *   ① 会话定位用「别名列表」去点会话。群会话的别名里混进了群成员备注（"希希测试"），
 *      open_chat 命中第一个别名就把私聊窗点开；校验时 _chat_is_target 又是「任一别名成立即通过」，
 *      于是私聊被当成群，核对行照样打印「→ 通过」。
 *   ② 出站时 target 取不到群 id 就回退成 senderId（发消息的人），天然把群回复送进私聊。
 *
 * 修法：
 *   ① 会话定位只认会话级主名（群名 / 私聊备注本名），成员备注一律不得用来点会话或通过校验；
 *   ② aliases_for 不再把群成员名逐个塞进群别名，只保留「甲、乙」整串；
 *   ③ 能拿到当前会话 id 时严格按 id 比对，拿不到才退回「命中行名 == 首选会话名」；
 *   ④ 出站日志打印实际命中的会话名，不再打别名首项（否则永远看不出打错了谁）；
 *   ⑤ 插件侧 group 出站必须用入站 targetId，缺 id 直接丢弃并告警，禁止回退 senderId。
 *
 * 锚点都在 assets/whalegirl/chat-strict-hunks.json 里，old/new 直接由官方原版 diff 得出
 * （带上下文，保证唯一），逐对按序应用；任何一处对不上就整份文件停手，绝不半改。
 */
const MARK_CHATSTRICT = 'CHAT-STRICT';

function patchChatStrict(root) {
	log('\n[W19] chat-strict —— 群回复误投私聊：会话定位只认主名 / 别名不混成员备注 / 出站严格比对会话 id');
	const jsonPath = join(ASSETS, 'chat-strict-hunks.json');
	if (!existsSync(jsonPath)) {
		log(`  × 缺 ${jsonPath}`);
		failed += 1;
		note('chat-strict', 'FAILED', '缺 assets/whalegirl/chat-strict-hunks.json');
		return;
	}
	let doc;
	try {
		doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
	} catch (e) {
		log(`  × ${jsonPath} 解析失败：${e.message}`);
		failed += 1;
		note('chat-strict', 'FAILED', 'JSON 解析失败');
		return;
	}
	const hunks = Array.isArray(doc.hunks) ? doc.hunks : [];
	if (hunks.length === 0) {
		log('  × 补丁包里没有任何替换对');
		failed += 1;
		note('chat-strict', 'FAILED', 'hunks 为空');
		return;
	}
	const byFile = new Map();
	for (const h of hunks) {
		if (!h || typeof h.old !== 'string' || typeof h.new !== 'string' || h.old === '') continue;
		const rel = String(h.file || '').replace(/\\/g, '/');
		if (!byFile.has(rel)) byFile.set(rel, []);
		byFile.get(rel).push(h);
	}
	let applied = 0;
	let already = 0;
	let bad = 0;
	for (const [rel, list] of byFile) {
		const file = join(root, rel);
		if (!existsSync(file)) {
			log(`  × ${rel}：文件不存在`);
			failed += 1;
			bad += 1;
			note('chat-strict', 'FAILED', `${rel} 不存在`);
			continue;
		}
		const text = readFileSync(file, 'utf8');
		const crlf = text.includes('\r\n');
		let norm = text.replace(/\r\n/g, '\n');
		let fileApplied = 0;
		let fileAlready = 0;
		let fileBad = 0;
		for (const h of list) {
			const o = h.old.replace(/\r\n/g, '\n');
			const n = h.new.replace(/\r\n/g, '\n');
			const cnt = norm.split(o).length - 1;
			// 先判「已应用」再判锚点：纯插入类替换对的 old 是 new 的前缀（old = 上下文 + 插入点），
			// 打完以后 old 依然在文件里，先查 old 会把「已打过」误判成「待应用」，再打一遍就插重了。
			// new 都带足够上下文、生成时已校验全篇唯一，所以 includes(new) 是可靠的「已应用」判据。
			if (norm.includes(n)) {
				fileAlready += 1;
				continue;
			}
			if (cnt === 1) {
				norm = norm.replace(o, () => n);
				fileApplied += 1;
				continue;
			}
			log(`  × ${rel}：${h.title || '某处'} 锚点${cnt === 0 ? '不见了' : `出现 ${cnt} 次`}`);
			fileBad += 1;
		}
		if (fileBad > 0) {
			failed += 1;
			bad += 1;
			note('chat-strict', 'DRIFT', `${rel} 有 ${fileBad} 处锚点过期（上游改版挪了这段代码）`);
			continue;
		}
		applied += fileApplied;
		already += fileAlready;
		if (fileApplied === 0) {
			log(`  ＝ ${rel}：${fileAlready} 处均已打过`);
			continue;
		}
		if (CHECK) {
			log(`  [check] 会改 ${rel}（${fileApplied} 处）`);
			continue;
		}
		const saved = backup(file);
		writeFileSync(file, crlf ? norm.replace(/\n/g, '\r\n') : norm, 'utf8');
		log(`  ✓ ${rel}：${fileApplied} 处已改（备份 ${saved}）`);
		changed += 1;
	}
	if (bad > 0) return;
	log(`  ${CHECK ? '待应用' : '已应用'} ${applied} 处 / 已存在 ${already} 处 / 共 ${hunks.length} 处`);
	note('chat-strict', applied > 0 ? (CHECK ? 'PENDING' : 'PATCHED') : 'ALREADY', `共 ${hunks.length} 处，本次应用 ${applied}，已存在 ${already}`);
}
