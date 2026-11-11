/**
 * 微信通道适配器（本机回环）：把 ChatGateway 的出站动作打到 WechatAgent 的 social-bridge。
 *
 * 分工：
 *  - 入站（微信 → 希希）：social-bridge 把消息 POST 到本插件的 wechat-inbound.js，再进 gateway.onWechatMessage；
 *  - 出站（希希 → 微信）：本类把 OneBot 段原样转成 HTTP 请求交给 bridge，由 WechatAgent 用自己那套
 *    发送链路（表情选图 / 回执 / 节流）真正发出去。
 *
 * 段格式沿用 OneBot 的 [{ type, data }]，bridge 侧负责翻译成微信动作，插件侧不关心怎么落地。
 */
import http from 'node:http';
import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 20000;

/** 往 bridge POST 一段 JSON，返回解析后的 JSON（失败抛异常）。 */
function postJson(url, body, token, timeoutMs = DEFAULT_TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		let u;
		try {
			u = new URL(url);
		} catch {
			reject(new Error(`bridge 地址不对：${url}`));
			return;
		}
		const payload = Buffer.from(JSON.stringify(body), 'utf8');
		const mod = u.protocol === 'https:' ? https : http;
		const req = mod.request({
			protocol: u.protocol,
			hostname: u.hostname,
			port: u.port || (u.protocol === 'https:' ? 443 : 80),
			path: `${u.pathname}${u.search}`,
			method: 'POST',
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-length': payload.length,
				...(token !== '' ? { authorization: `Bearer ${token}` } : {})
			}
		}, (res) => {
			const chunks = [];
			let size = 0;
			res.on('data', (chunk) => {
				size += chunk.length;
				if (size <= 1 << 20) chunks.push(chunk);
			});
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				let json = null;
				try { json = JSON.parse(text); } catch { json = null; }
				if (res.statusCode < 200 || res.statusCode >= 300) {
					reject(new Error(`bridge 返回 ${res.statusCode}：${String(json?.error ?? text).slice(0, 200)}`));
					return;
				}
				resolve(json ?? { ok: true });
			});
		});
		req.setTimeout(timeoutMs, () => req.destroy(new Error('bridge 超时')));
		req.on('error', (error) => reject(error));
		req.end(payload);
	});
}

/** channel_id → bridge 认识的收件人。 */
function parseTarget(channelId) {
	const s = String(channelId ?? '');
	const m = /^wechat:(private|group):(.+)$/i.exec(s);
	if (m !== null) return { kind: m[1].toLowerCase(), target: m[2] };
	if (s.startsWith('wechat-private:')) return { kind: 'private', target: s.slice('wechat-private:'.length) };
	if (s.startsWith('wechat-group:')) return { kind: 'group', target: s.slice('wechat-group:'.length) };
	return { kind: 'private', target: s };
}

export class WechatChannel {
	/**
	 * @param {object} deps
	 * @param {() => object} deps.getConfig 读当前 wechat 配置
	 * @param {(level: string, message: string) => void} [deps.log]
	 */
	constructor({ getConfig, log = () => {} }) {
		this.getConfig = getConfig;
		this.log = log;
		/** bridge 与插件同机：起来就算连着，真发不出去由 send 抛错暴露 */
		this.connected = false;
		this.selfId = '';
		this.lastError = '';
		this.lastErrorAt = 0;
	}

	cfg() {
		const w = this.getConfig() ?? {};
		return {
			enabled: w.enabled === true,
			bridgeUrl: String(w.bridgeUrl ?? 'http://127.0.0.1:11234/fish-soul/outbound'),
			token: String(w.bridgeToken ?? w.token ?? ''),
			selfId: String(w.selfId ?? ''),
			masterUserIds: Array.isArray(w.masterUserIds) ? w.masterUserIds.map(String) : [],
			privateAllowList: Array.isArray(w.privateAllowList) ? w.privateAllowList.map(String) : []
		};
	}

	start() {
		const cfg = this.cfg();
		this.selfId = cfg.selfId;
		this.connected = cfg.enabled;
		if (cfg.enabled) this.log('info', `[fish-soul] 微信通道就绪（出站 → ${cfg.bridgeUrl}）`);
	}

	stop() {
		this.connected = false;
	}

	isMaster(userId) {
		const cfg = this.cfg();
		return cfg.masterUserIds.includes(String(userId ?? ''));
	}

	/** 微信私聊都在白名单里：名单内就是"好友"，名单外只记不回。 */
	isFriend(userId) {
		const cfg = this.cfg();
		const id = String(userId ?? '');
		if (id === '') return false;
		return cfg.privateAllowList.length === 0 ? true : cfg.privateAllowList.includes(id);
	}

	async send(channelId, segs, convId = '') {
		const cfg = this.cfg();
		if (!cfg.enabled) throw new Error('微信通道没开');
		const { kind, target } = parseTarget(channelId);
		const segments = Array.isArray(segs) ? segs : [];
		if (segments.length === 0) return '';
		const res = await postJson(cfg.bridgeUrl, {
			channelId: String(channelId),
			kind,
			target: String(target),
			convId: String(convId ?? ''),
			segments
		}, cfg.token);
		this.connected = true;
		return String(res?.messageId ?? res?.message_id ?? '');
	}

	async groupName() {
		return '';
	}

	async getMessage() {
		return null;
	}

	async fetchHistory() {
		return [];
	}

	/** OneBot 扩展接口（点表情 / 输入状态 / 戳一戳）：微信侧不支持，交给 gateway 的 tryCall 吞掉。 */
	async call() {
		throw new Error('微信通道不支持 OneBot 扩展接口');
	}
}

export default WechatChannel;
