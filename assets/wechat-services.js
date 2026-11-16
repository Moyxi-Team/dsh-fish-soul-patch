/**
 * dsh-fish-soul — 微信服务开关（[FS-WECHAT-SERVICES]）
 *
 * 只干两件事：
 *   1. 报状态：鲸鱼启动器在不在跑、8787 / 8899 / 11233 三个端口通不通、最后一次收到微信消息是几点。
 *   2. 拉起来：按「鲸鱼启动器 → server.js → python 桥」的顺序补缺，已经在跑的不重复拉。
 *
 * 为什么放在 soul 这边：微信这套是鲸鱼（WhaleGirl）和 soul 两半拼的，
 * DSH 重启之后鲸鱼那边不会自己回来，面板上点一下比去任务管理器翻进程省事，
 * 也省得每次都要远程指挥人手动开三个窗口。
 */

import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const WG_ROOT = String(process.env.FISH_SOUL_WHALEGIRL_ROOT || 'E:\\ruanjian\\WhaleGirl');
const LAUNCHER = path.join(WG_ROOT, 'WhaleLauncher.exe');
const NODE_BIN = path.join(WG_ROOT, 'runtime', 'node.exe');
const PY_BIN = path.join(WG_ROOT, 'runtime', 'python', 'python.exe');
const BRIDGE_LOG = path.join(WG_ROOT, 'data', 'wechat-bridge-4x.log');

/** 三个端口各管一段：8787 鲸鱼 web（桥从这儿拿登录态）、8899 出站、11233 DSH 入站 */
const PORTS = [
  { key: 'web', port: 8787, title: '鲸鱼服务（8787）' },
  { key: 'outbound', port: 8899, title: '出站通道（8899）' },
  { key: 'inbound', port: 11233, title: '入站端口（11233）' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 单个端口探活：连上就算通，连不上/超时都算没通，不区分原因 */
function probePort(port, timeout = 600) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    try {
      sock.connect(port, '127.0.0.1');
    } catch {
      finish(false);
    }
  });
}

/** tasklist 比 wmic 快得多，这里只关心「这个名字的进程在不在」 */
function processRunning(imageName) {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', `IMAGENAME eq ${imageName}`, '/NH', '/FO', 'CSV'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve(false);
        resolve(String(stdout ?? '').toLowerCase().includes(imageName.toLowerCase()));
      }
    );
  });
}

/**
 * 读桥日志尾部（只读最后 256KB，日志会越长越大，别整文件读进来）。
 * 认两种行：
 *   [08:42:42] INFO 收到 …         → 微信进来一条
 *   [08:42:55] INFO 后台通道发送成功 → 希希发出去一条
 */
function readBridgeMarks(maxBytes = 256 * 1024) {
  const empty = { inboundAt: null, outboundAt: null, inboundLine: '', outboundLine: '', logPath: BRIDGE_LOG };
  if (!existsSync(BRIDGE_LOG)) return empty;
  let text = '';
  try {
    const size = statSync(BRIDGE_LOG).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    const fd = openSync(BRIDGE_LOG, 'r');
    try {
      readSync(fd, buf, 0, len, start);
    } finally {
      closeSync(fd);
    }
    text = buf.toString('utf8');
  } catch {
    return empty;
  }
  const out = { ...empty };
  const lines = text.split(/\r?\n/);
  const at = /^\[(\d{2}:\d{2}:\d{2})\]/;
  for (const line of lines) {
    if (line.includes('INFO 收到')) {
      const m = at.exec(line);
      if (m) {
        out.inboundAt = m[1];
        out.inboundLine = line.trim().slice(0, 160);
      }
    } else if (line.includes('后台通道发送成功')) {
      const m = at.exec(line);
      if (m) {
        out.outboundAt = m[1];
        out.outboundLine = line.trim().slice(0, 160);
      }
    }
  }
  return out;
}

/** 桥日志里的时刻只有 HH:MM:SS，补上今天日期；比现在晚 2 小时以上的当成昨天 */
function stampOf(hhmmss) {
  if (!hhmmss) return null;
  const [h, m, s] = hhmmss.split(':').map((x) => Number(x));
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s);
  if (d.getTime() - now.getTime() > 2 * 3600 * 1000) d.setDate(d.getDate() - 1);
  return d;
}

function agoText(date) {
  if (!date) return '';
  const sec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (sec < 60) return '刚刚';
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

/** 面板用的整份状态：launcher 在不在 + 三个端口 + 桥日志里最后一条进来 / 出去 */
export async function wechatServicesState() {
  const [launcher, ...portFlags] = await Promise.all([
    processRunning('WhaleLauncher.exe'),
    ...PORTS.map((p) => probePort(p.port))
  ]);
  const ports = {};
  PORTS.forEach((p, i) => {
    ports[p.key] = portFlags[i] === true;
  });
  const marks = readBridgeMarks();
  const inboundDate = stampOf(marks.inboundAt);
  const outboundDate = stampOf(marks.outboundAt);
  return {
    ok: true,
    root: WG_ROOT,
    launcher,
    ports,
    portList: PORTS.map((p) => ({ key: p.key, port: p.port, title: p.title, up: ports[p.key] === true })),
    lastInbound: marks.inboundAt ? { at: marks.inboundAt, ago: agoText(inboundDate), line: marks.inboundLine } : null,
    lastOutbound: marks.outboundAt ? { at: marks.outboundAt, ago: agoText(outboundDate), line: marks.outboundLine } : null,
    allUp: launcher && ports.web && ports.outbound && ports.inbound,
    logPath: BRIDGE_LOG
  };
}

/** 拉一个分离进程：不跟着 DSH 退出，也不弹黑窗 */
function spawnDetached(exe, args, cwd) {
  const child = spawn(exe, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  return child.pid ?? null;
}

/**
 * 按顺序补缺拉起。已经通的端口 / 已经在的进程直接跳过，重复点击不会起第二份。
 * 返回 actions 说明每一步干了什么，面板上直接展示，省得用户猜。
 */
export async function startWechatStack({ log = () => {} } = {}) {
  const actions = [];
  const note = (step, state, detail = '') => {
    actions.push({ step, state, detail });
    try {
      log(`[wechat-services] ${step} ${state} ${detail}`.trim());
    } catch {
      /* 日志写不进去不该把启动流程带崩 */
    }
  };

  if (!existsSync(WG_ROOT)) {
    return { ok: false, error: `找不到鲸鱼目录：${WG_ROOT}`, actions };
  }

  // ① 鲸鱼启动器：微信登录态在它手上，没它后面两步都没有意义
  let launcherUp = await processRunning('WhaleLauncher.exe');
  if (launcherUp) {
    note('鲸鱼启动器', 'skip', '已经在跑');
  } else if (!existsSync(LAUNCHER)) {
    note('鲸鱼启动器', 'fail', `找不到 ${LAUNCHER}`);
  } else {
    try {
      const pid = spawnDetached(LAUNCHER, [], WG_ROOT);
      note('鲸鱼启动器', 'started', `pid ${pid}`);
    } catch (e) {
      note('鲸鱼启动器', 'fail', String(e?.message ?? e));
    }
  }

  // ② 鲸鱼服务 8787：启动器要一点时间才把 web 起起来，先等它，别急着再起一份 server.js
  if (await probePort(8787)) {
    note('鲸鱼服务 8787', 'up', '已监听');
  } else {
    for (let i = 0; i < 10; i += 1) {
      await sleep(600);
      if (await probePort(8787)) break;
    }
  }

  let webUp = await probePort(8787);
  if (!webUp && existsSync(NODE_BIN)) {
    try {
      const pid = spawnDetached(NODE_BIN, ['server.js', '--no-browser'], WG_ROOT);
      note('鲸鱼服务 8787', 'started', `node server.js pid ${pid}`);
    } catch (e) {
      note('鲸鱼服务 8787', 'fail', String(e?.message ?? e));
    }
    for (let i = 0; i < 12; i += 1) {
      await sleep(600);
      if (await probePort(8787)) break;
    }
    webUp = await probePort(8787);
  } else if (webUp) {
    note('鲸鱼服务 8787', 'skip', '已经在跑');
  } else {
    note('鲸鱼服务 8787', 'fail', `找不到 ${NODE_BIN}`);
  }

  // ③ 出站 8899：python 桥在 app.py 里 bind，桥起来才有 8899
  const outboundUp = await probePort(8899);
  if (outboundUp) {
    note('出站通道 8899', 'skip', '已经在跑');
  } else if (!existsSync(PY_BIN)) {
    note('出站通道 8899', 'fail', `找不到 ${PY_BIN}`);
  } else {
    try {
      const pid = spawnDetached(PY_BIN, [path.join('bridge', '__main__.py')], WG_ROOT);
      note('出站通道 8899', 'started', `python bridge pid ${pid}`);
    } catch (e) {
      note('出站通道 8899', 'fail', String(e?.message ?? e));
    }
    for (let i = 0; i < 12; i += 1) {
      await sleep(600);
      if (await probePort(8899)) break;
    }
  }

  const after = await wechatServicesState();
  const failed = actions.filter((a) => a.state === 'fail');
  return {
    ok: failed.length === 0,
    error: failed.length ? failed.map((a) => `${a.step}：${a.detail}`).join('；') : undefined,
    actions,
    state: after
  };
}

/**
 * 两条路由，托管给 routes.js（[FS-WECHAT-SERVICES]）：
 *   GET  /channels/wechat-services        看状态
 *   POST /channels/wechat-services/start  点按钮拉起来
 * 处理了返回 true，不是这两条就返回 false，让主 handler 接着往下走。
 */
export async function handleWechatServicesRoute({ method, path, req, send, readBody, sameOrigin, deps }) {
  if (path !== '/channels/wechat-services' && path !== '/channels/wechat-services/start') return false;

  if (method === 'GET' && path === '/channels/wechat-services') {
    try {
      send(200, await wechatServicesState());
    } catch (e) {
      send(200, { ok: false, error: `读不到服务状态：${e?.message ?? e}` });
    }
    return true;
  }

  if (method === 'POST' && path === '/channels/wechat-services/start') {
    if (!sameOrigin(req)) {
      send(403, { ok: false, error: 'forbidden' });
      return true;
    }
    try {
      await readBody(req);
    } catch {
      /* body 不重要，读失败也照常往下走 */
    }
    const log = deps?.log ?? (() => {});
    const r = await startWechatStack({ log });
    send(200, r);
    return true;
  }

  // 路径对上了但方法不对，明确回一句，别让人以为接口没接上
  send(200, { ok: false, error: `${method} 不支持，只有 GET 和 POST /channels/wechat-services/start` });
  return true;
}
