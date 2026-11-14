#!/usr/bin/env node
/**
 * verify-meme-wechat.mjs —— 实测出站配图的三条通道（回归用）：
 *   ① QQ / 抖音：无动图偏好 → 必须走前端同款 parity 匹配，且发静态图
 *   ② 微信：stickerAnimatedFirst=true → 静态图让位给真 GIF（不许把静态图当表情发出去）
 *   ③ 微信 strict：只认 GIF，一批里没有 GIF 就不发
 *
 * 为什么要有：微信不认静态表情（发了等于没发），但 QQ 又要和 DSH 会话端看到同一张图；
 * 这两件事互相拉扯，改动 stickers.js / meme-bridge.js 后必须重跑本脚本确认没退回去。
 *
 * 用法：node tools/verify-meme-wechat.mjs [--dsh <DSH 根目录，默认 ~/.dsh/profiles/desktop>]
 * 退出码：0 全过 / 1 有失败
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DSH = argOf('--dsh', join(homedir(), '.dsh', 'profiles', 'desktop'));
const FS = join(DSH, 'node_modules', 'dsh-fish-soul', 'lib');
const MEME_PKG = join(DSH, 'node_modules', 'dsh-meme');

const { StickerBox } = await import(pathToFileURL(join(FS, 'stickers.js')).href);
const { createMemeBridge } = await import(pathToFileURL(join(FS, 'meme-bridge.js')).href);

// 真图库一般全是 jpg/png；再挂一个临时图库塞几张 .gif，专门验「微信只认 GIF」这条通道
const WORK = join(tmpdir(), 'meme-verify-' + process.pid);
const FAKEPACK = join(WORK, 'fake-gif');
const WS = join(WORK, 'ws');
const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const IMG = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (IMG.has(extname(name).toLowerCase())) {
      out.push({ path: p, tag: 'happy', caption: basename(name, extname(name)), name: basename(name) });
    }
  }
  return out;
};

// 临时图库：6 张 gif
mkdirSync(join(FAKEPACK, 'memes'), { recursive: true });
mkdirSync(WS, { recursive: true });
for (let i = 1; i <= 6; i += 1) writeFileSync(join(FAKEPACK, 'memes', `meme-${i}.gif`), GIF_1PX);

const packsDir = join(MEME_PKG, 'memes');
const realPacks = existsSync(packsDir) ? readdirSync(packsDir).filter((n) => statSync(join(packsDir, n)).isDirectory()) : [];
const fakeFiles = walk(join(FAKEPACK, 'memes'));
const realFiles = realPacks.flatMap((n) => walk(join(packsDir, n, 'memes')));
const allFiles = [...fakeFiles, ...realFiles]; // gif 放前面，保证 search 前 30 条里就有动图

const svc = {
  packs: () => [
    { id: 'fake-gif', name: 'fake-gif', path: FAKEPACK, count: fakeFiles.length },
    ...realPacks.map((n) => ({ id: n, name: n, path: join(packsDir, n), count: walk(join(packsDir, n, 'memes')).length }))
  ],
  search: ({ limit } = {}) => ({ memes: allFiles.slice(0, Number(limit) || 12) })
};
const meme = createMemeBridge({ ctx: { get: (k) => (k === 'dshMeme' ? svc : null) }, log: () => {} });

const emptyStmt = { all: () => [], get: () => undefined, run: () => ({ changes: 0 }) };
const db = { prepare: () => emptyStmt, exec: () => {}, transaction: (fn) => fn };
const make = (wechat) => new StickerBox({ db, meme, log: () => {}, getConfig: () => ({ meme: true, wechat }) });
const isGif = (p) => extname(String(p ?? '')).toLowerCase() === '.gif';
// 静态图给的是图库绝对路径；动图会先落盘到 <ws>/_stickers/ 再只返回文件名（微信只认这个通道）
const fileOnDisk = (ws, p) => {
  const s = String(p ?? '');
  if (s === '') return '';
  return isAbsolute(s) ? s : join(ws, '_stickers', s);
};

const descs = ['开心', '生气', '无语', '早上好', '震惊'];
let pass = 0;
let fail = 0;
try {
  for (const d of descs) {
    const text = `前一句 [表情: ${d}]`;
    const qq = await make({}).resolveMemeTags(text, WS, null, {});
    const wx = await make({ stickerAnimatedFirst: true }).resolveMemeTags(text, WS, null, { animatedFirst: true, animatedStrict: false });
    const st = await make({ stickerAnimatedFirst: true, stickerAnimatedStrict: true }).resolveMemeTags(text, WS, null, { animatedFirst: true, animatedStrict: true });
    const qqOne = qq.resolved[0] ?? {};
    const wxOne = wx.resolved[0] ?? {};
    const stOne = st.resolved[0] ?? {};
    const qqFile = String(qqOne.file ?? '');
    const wxFile = String(wxOne.file ?? '');
    const stFile = String(stOne.file ?? '');

    const qqOk = qqFile !== '' && existsSync(fileOnDisk(WS, qqFile)) && qqOne.fromMeme === true && !isGif(qqFile);
    const wxOk = wxFile !== '' && isGif(wxFile) && existsSync(fileOnDisk(WS, wxFile)) && String(wxOne.animated ?? true) !== false;
    const stOk = stFile === '' || isGif(stFile);
    const ok = qqOk && wxOk && stOk;
    if (ok) pass += 1; else fail += 1;

    console.log(
      `[${d}] qq=${basename(qqFile || '-')}(frontend=${qqOne.fromMeme === true}) ` +
      `wx=${basename(wxFile || '-')}(gif=${isGif(wxFile)}) ` +
      `strict=${stFile ? basename(stFile) : '不发'} ${ok ? 'OK' : 'BAD'}`
    );
  }
} finally {
  rmSync(WORK, { recursive: true, force: true });
}
console.log(`PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
