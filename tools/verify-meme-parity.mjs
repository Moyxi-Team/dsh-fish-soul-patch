#!/usr/bin/env node
/**
 * verify-meme-parity.mjs —— 证明「出站配图」和「DSH 会话端配图」用的是同一套匹配算法。
 *
 * 为什么要有这脚本：表情包两端不一致的根因是出站另写了一套（情绪桶 + 词面打分 + 随机打散），
 * 现在出站直接照抄 dsh-meme 前端 client.js 的 foldCaption / looseCaption / splitDescTokens /
 * addIndexKey / buildMemeIndex / buildMemeSearch / matchDesc。以后升级 dsh-meme，如果前端改了
 * 这几个函数而 assets/meme-bridge.js 没跟，这个脚本会立刻报出来（而不是等用户发现两边图不一样）。
 *
 * 用法：
 *   node tools/verify-meme-parity.mjs
 *   node tools/verify-meme-parity.mjs --bridge <path> --client <path>
 *
 * 归一化口径（唯一允许的差异）：前端 index 里存的是浏览器 url（toUrl(row)），出站存的是本地绝对
 * 路径（row.abs），所以把 abs/url/toUrl 一律映射成 P 再比；分号 / 空白 / 注释也不比。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const BRIDGE = argOf('--bridge', join(here, '..', 'assets', 'meme-bridge.js'));
// 前端 client.js 在这几个位置之一（按顺序找，第一个存在的就用）
const CLIENT = argOf('--client', [
  process.env.DSH_MEME_CLIENT,
  join(dirname(BRIDGE), '..', 'dsh-meme', 'client.js'),
  join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-meme', 'client.js')
].filter(Boolean).find((p) => existsSync(p)) ?? '');

if (CLIENT === '' || !existsSync(CLIENT)) {
  console.log('找不到 dsh-meme/client.js，用 --client <path> 指定（或设 DSH_MEME_CLIENT）');
  process.exit(1);
}

const cut = (src, fromName, toName) => {
  const lines = src.replace(/\r/g, '').split('\n');
  const a = lines.findIndex((l) => new RegExp(`^\\s*(const|function)\\s+${fromName}\\b`).test(l));
  if (a < 0) return null;
  // 到 toName 为止；toName 缺省（'matchDesc' 自身）时按花括号配平取到函数块结束
  let b = lines.findIndex((l, i) => i > a && new RegExp(`^\\s*(const|function)\\s+${toName}\\b`).test(l));
  if (fromName === toName) {
    const start = lines.findIndex((l) => new RegExp(`^\\s*(const|function)\\s+${toName}\\b`).test(l));
    if (start < 0) return null;
    let depth = 0;
    let seen = false;
    b = -1;
    for (let i = start; i < lines.length; i += 1) {
      depth += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
      if ((lines[i].match(/\{/g) ?? []).length > 0) seen = true;
      if (seen && depth <= 0) { b = i + 1; break; }
    }
    if (b < 0) return null;
  }
  if (b < 0 || b <= a) return null;
  return lines.slice(a, b).join('\n');
};

const norm = (s) => s
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/;\s*/g, '')
  .replace(/,(\s*[)\]}])/g, '$1')
  .replace(/(abs|url)\(\s*row\s*\)/g, 'P')
  .replace(/row\.(abs|url)/g, 'P')
  .replace(/\b(toUrl|abs|url)\b/g, 'P')
  .replace(/\s+/g, '')
  .replace(/\(rows,P\)/g, '(rows)')
  .replace(/constP=P\(row\)/g, 'constP=P()')
  .replace(/P\(row\)/g, 'P')
  .replace(/constP=P(?=addIndexKey)/g, 'constP=P()')
  .trim();

// 出站侧：前端同款函数就从 foldCaption 一直到 matchDesc 结束（下一个函数是 pickByFrontendDesc）
// 前端侧：同样的函数块再接 apply(ctx)，所以截到 findMemeUrl 之前
const bSeg = cut(readFileSync(BRIDGE, 'utf8'), 'foldCaption', 'matchDesc');
const cSeg = cut(readFileSync(CLIENT, 'utf8'), 'foldCaption', 'matchDesc');
if (!bSeg || !cSeg) {
  console.log(`区间定位失败（出站 ${!!bSeg} / 前端 ${!!cSeg}）；确认 --bridge / --client 指向正确文件`);
  process.exit(1);
}

const nb = norm(bSeg);
const nc = norm(cSeg);
let k = 0;
while (k < nb.length && k < nc.length && nb[k] === nc[k]) k += 1;
const same = k === nb.length || k === nc.length;

console.log(`出站 ${nb.length} 字符 / 前端 ${nc.length} 字符 / 公共前缀 ${k} 字符`);
if (nb === nc) {
  console.log('PARITY=OK 两端匹配算法逐字符一致（归一化后）');
  process.exit(0);
}
if (k >= Math.min(nb.length, nc.length)) {
  console.log('PARITY=OK 短的一侧被长的一侧完整包含（多出来的是各自后续代码）');
  process.exit(0);
}
console.log('PARITY=BAD 匹配算法已分叉，出站要重新照抄前端');
console.log('  出站: ' + nb.slice(Math.max(0, k - 60), k + 120));
console.log('  前端: ' + nc.slice(Math.max(0, k - 60), k + 120));
process.exit(1);
