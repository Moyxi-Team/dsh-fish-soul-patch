// [WHALE-DSH-FORWARD-HELPERS:BEGIN] 本段由 dsh-fish-soul-patch/patch-whalegirl.mjs 维护，删了会被重放补回。
/**
 * [WHALE-DSH-FORWARD] 微信入站转发给 dsh-fish-soul 的「希希」。
 *
 * 桥收微信消息后一律投给鲸鲸（本地引擎）并由鲸鲸回话，人格是「鲸鲸」；用户要的是微信回「希希」，
 * 所以这里在投给鲸鲸之前把消息转给 dsh 的微信入站口，再对桥返回 action='none'
 * （桥的逻辑：action 不是 reply 就不发任何消息），鲸鲸只当不开口的传声筒，
 * 回复由 dsh 经 8899/outbound 出站发回微信。
 *
 * 开关只看 data/dsh-forward.json，不碰 settings.json，删掉或 enabled=false 即恢复鲸鲸本体。
 *   {"enabled":true,"url":"http://127.0.0.1:11233/fish-soul/wechat/inbound","token":"","timeoutMs":8000}
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const FORWARD_FILE = path.join(__dirname, '..', '..', '..', 'data', 'dsh-forward.json');

function readForwardConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(FORWARD_FILE, 'utf8'));
    if (!cfg || cfg.enabled !== true) return null;
    const url = String(cfg.url || '').trim();
    if (!/^http:\/\//i.test(url)) return null;
    return {
      url,
      token: String(cfg.token || ''),
      timeoutMs: Number(cfg.timeoutMs) > 0 ? Number(cfg.timeoutMs) : 8000,
    };
  } catch (_) {
    return null;
  }
}

/** 桥的入站字段 → dsh wechat-inbound 认的 payload（events 数组，字段 chatType/senderId/targetId/text/senderName/messageId）。 */
function toDshPayload(body) {
  const src = body && typeof body === 'object' ? body : {};
  const rawType = String(src.chatType || src.chat_type || src.kind || 'private').toLowerCase();
  const chatType = rawType === 'group' ? 'group' : 'private';
  const senderId = String(src.senderId || src.sender_id || src.userId || src.user_id || '').trim();
  const targetId = String(src.targetId || src.chat_id || src.chatId || (chatType === 'private' ? senderId : '')).trim();
  if (senderId === '' || targetId === '') return null;
  const text = String(src.text == null ? '' : src.text);
  // 纯图片/表情等没有正文的入站先不转：转过去 dsh 也接不上话，还会白占一条入站。
  if (text.trim() === '') return null;
  const senderName = String(src.senderName || src.sender_name || src.nickname || '').trim();
  const conversationName = String(src.conversationName || src.conversation_name || src.groupName || '').trim();
  const messageId = String(src.messageId || src.message_id || src.msgId || src.msg_id || '').trim();
  let timeMs = Number(src.timeMs || src.time_ms || src.timestamp || src.createTime || 0) || 0;
  if (timeMs > 0 && timeMs < 1e12) timeMs *= 1000; // 秒级时间戳补到毫秒
  return {
    events: [{
      chatType,
      senderId,
      targetId,
      senderName,
      conversationName,
      messageId,
      text,
      timeMs: timeMs > 0 ? timeMs : Date.now(),
    }],
  };
}

/** 极简 POST JSON：不引第三方库，超时自己控。 */
function postJsonTo(url, payload, timeoutMs, token) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
    };
    if (token) {
      headers['x-fish-soul-token'] = token;
      headers['Authorization'] = `Bearer ${token}`;
    }
    const req = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: 'POST',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(timeoutMs || 8000, () => req.destroy(new Error('dsh 转发超时')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function logLine(runtime, level, message) {
  try {
    const logger = runtime && runtime.logger;
    if (logger && typeof logger[level] === 'function') logger[level](message);
    else if (logger && typeof logger.info === 'function') logger.info(message);
  } catch (_) {
    /* 日志永远是尽力而为 */
  }
}
// [WHALE-DSH-FORWARD-HELPERS:END]
