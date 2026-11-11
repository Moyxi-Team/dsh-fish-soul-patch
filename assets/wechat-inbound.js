/**
 * 微信入站口（本机回环）：WechatAgent 的 social-bridge 把微信消息 POST 过来，
 * 这里只做鉴权 + 拆包，然后交给 gateway.onWechatMessage 走和 QQ 完全相同的判定 / 会话 / 记忆链路。
 *
 * 为什么要一个 HTTP 口：两个进程（DSH 插件宿主 / WechatAgent）不共享内存，
 * 而 ChatGateway 在 DSH 进程里。回环 HTTP 是最小依赖的对接方式（无端口转发、无消息队列）。
 */
import http from 'node:http';

const MAX_BODY = 1 << 20; // 1MB：入站消息只带文本和元信息，够用

function json(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
	res.end(text);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				reject(new Error('入站消息太大'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

export class WechatInboundServer {
	/**
	 * @param {object} deps
	 * @param {() => object} deps.getConfig 读 wechat 配置（端口 / 路径 / token）
	 * @param {(payload: object) => Promise<void>|void} deps.onMessage 单条微信消息
	 * @param {(level: string, message: string) => void} [deps.log]
	 */
	constructor({ getConfig, onMessage, log = () => {} }) {
		this.getConfig = getConfig;
		this.onMessage = onMessage;
		this.log = log;
		this.server = null;
		this.port = 0;
	}

	cfg() {
		const w = this.getConfig() ?? {};
		return {
			enabled: w.enabled === true,
			port: Number.isFinite(Number(w.inboundPort)) ? Number(w.inboundPort) : 11232,
			path: String(w.inboundPath ?? '/fish-soul/wechat/inbound'),
			token: String(w.inboundToken ?? w.token ?? '')
		};
	}

	authorized(req, token) {
		if (token === '') return true;
		const header = String(req.headers.authorization ?? '');
		if (header.startsWith('Bearer ')) return header.slice(7).trim() === token;
		return String(req.headers['x-fish-soul-token'] ?? '') === token;
	}

	start() {
		const cfg = this.cfg();
		if (!cfg.enabled) return;
		if (this.server !== null) return;
		this.server = http.createServer((req, res) => {
			void this.handle(req, res).catch((error) => {
				this.log('error', `[fish-soul] 微信入站处理失败：${String(error instanceof Error ? error.message : error)}`);
				try { json(res, 500, { ok: false, error: 'internal' }); } catch { /* 已经回了 */ }
			});
		});
		this.server.on('error', (error) => {
			this.log('error', `[fish-soul] 微信入站口起不来（${cfg.port}）：${String(error instanceof Error ? error.message : error)}`);
			this.server = null;
		});
		this.server.listen(cfg.port, '127.0.0.1', () => {
			this.port = cfg.port;
			this.log('info', `[fish-soul] 微信入站口在 http://127.0.0.1:${cfg.port}${cfg.path}`);
		});
		this.server.unref?.();
	}

	stop() {
		try { this.server?.close(); } catch { /* 关不掉就算了 */ }
		this.server = null;
	}

	async handle(req, res) {
		const cfg = this.cfg();
		const url = String(req.url ?? '');
		if (req.method === 'GET' && url.startsWith('/fish-soul/wechat/ping')) {
			json(res, 200, { ok: true, port: cfg.port, path: cfg.path });
			return;
		}
		if (req.method !== 'POST' || !url.startsWith(cfg.path)) {
			json(res, 404, { ok: false, error: 'not found' });
			return;
		}
		if (!this.authorized(req, cfg.token)) {
			json(res, 401, { ok: false, error: 'unauthorized' });
			return;
		}
		const raw = await readBody(req);
		let body = null;
		try { body = raw === '' ? {} : JSON.parse(raw); } catch {
			json(res, 400, { ok: false, error: 'bad json' });
			return;
		}
		const list = Array.isArray(body?.events) ? body.events : Array.isArray(body?.messages) ? body.messages : [body];
		const accepted = [];
		for (const item of list) {
			if (item === null || typeof item !== 'object') continue;
			accepted.push(item);
			// 逐条串行：同一会话的先后顺序就是微信里的顺序，并行会把"先问后答"打乱
			try {
				await this.onMessage(item);
			} catch (error) {
				this.log('warn', `[fish-soul] 这条微信消息没处理成：${String(error instanceof Error ? error.message : error)}`);
			}
		}
		json(res, 200, { ok: true, accepted: accepted.length });
	}
}

export default WechatInboundServer;
