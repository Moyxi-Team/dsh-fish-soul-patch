#!/usr/bin/env node
/**
 * gen-patch-docs.mjs —— 由 assets/*-hunks.json 生成 docs/patches.md（逐处清单）
 *
 * 为什么要有这脚本：README 只到「组」这一层（P1–P7 每组改了哪块），
 * CHANGELOG 只记每轮改了什么。40 处锚点逐处是什么、在哪、上游接管怎么判，
 * 靠手写必然和 JSON 漂移 —— 所以这里按 JSON 生成，锚点增删后重跑即可。
 *
 * 用法：
 *   node tools/gen-patch-docs.mjs          # 写 docs/patches.md
 *   node tools/gen-patch-docs.mjs --check  # 只比对，不写；不一致退出码 1
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = path.join(ROOT, 'assets');
const OUT = path.join(ROOT, 'docs', 'patches.md');
const CHECK = process.argv.includes('--check');

/** 分组定义，必须与 patch-fish-soul.mjs 里的 patchHunks({ tag, label, jsonName }) 一致 */
const GROUPS = [
  { tag: 'P1', only: 'meme', label: '借 dsh-meme 的表情库', json: null, whole: 'meme-bridge.js' },
  { tag: 'P2', only: 'douyin', label: 'douyin-social —— 回评论发不出 / 图文无 BGM', json: 'douyin-hunks.json', whole: null },
  { tag: 'P3', only: 'remount', label: 'index —— 热更新后人格卡 + 记忆块掉线', json: 'index-hunks.json', whole: null },
  { tag: 'P4', only: 'plugins', label: '设置 → 系统 → 已装插件', json: 'plugins-hunks.json', whole: 'plugins-route.js' },
  { tag: 'P5', only: 'dm', label: '抖音 —— 主动给互关好友发私信', json: 'dm-hunks.json', whole: 'douyin-proactive.js' },
  { tag: 'P6', only: 'share', label: '刷到有意思的就发给你 → 视频卡片', json: 'share-hunks.json', whole: null },
  { tag: 'P7', only: 'wechat', label: '微信（WechatAgent）↔ 人格记忆互通', json: 'wechat-hunks.json', whole: null },
];

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

async function load(p) {
  try { return JSON.parse(await readFile(path.join(A, p), 'utf8')); }
  catch (e) { throw new Error(`读不到 assets/${p}：${e.message}`); }
}

const SCRIPT_SRC = await readFile(path.join(ROOT, 'patch-fish-soul.mjs'), 'utf8');
const PROBE_SRC = await readFile(path.join(A, 'plugins-route.js'), 'utf8');

/**
 * P1 不是锚点组：它的改动直接写在 patch-fish-soul.mjs 的 patchMeme() 里（replaceOnce / replaceFunction），
 * 所以这里从脚本源码里抽「改了哪个文件、改了什么」，保证文档跟代码一致。
 */
function parseP1() {
  const start = SCRIPT_SRC.indexOf('// ───────────────────────────── P1');
  const end = SCRIPT_SRC.indexOf('// ───────────────────────────── P2');
  const seg = SCRIPT_SRC.slice(start, end > start ? end : undefined);
  const calls = [];
  const re = /replace(Once|Function)\(\s*'([^']+)'(?:,\s*'((?:\\t|\\n|\\\\|[^'\\\n])*)')?/g;
  const marks = [...seg.matchAll(re)].map((m) => ({ kind: m[1], file: m[2], sym: m[3], at: m.index }));
  marks.forEach((mk, i) => {
    const block = seg.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : seg.length);
    const inner = block.slice(block.indexOf(mk.file) + mk.file.length);
    let label = '—';
    if (mk.kind === 'Once') {
      const zh = [...inner.matchAll(/'([^'\n]*[\u4e00-\u9fa5][^'\n]*)'/g)]
        .map((m) => m[1].trim())
        .filter((x) => x.length > 0 && x.length <= 30);
      if (zh.length) label = zh[zh.length - 1];
      if (label === '—') {
        const plain = [...inner.matchAll(/'([^'\n]{1,40})'/g)]
          .map((m) => m[1].trim())
          .filter((x) => x && !x.includes('\\n') && !x.includes('\\t') && !x.includes('${'));
        if (plain.length) label = plain[plain.length - 1];
      }
    } else {
      label = '整函数替换 `' + String(mk.sym || '').replace(/\\t/g, '  ').trim() + '`';
    }
    calls.push({ kind: mk.kind === 'Once' ? '锚点替换' : '整函数替换', file: mk.file, label });
  });
  return calls;
}

/** 个人插件页（assets/plugins-route.js 里的 PATCH_GROUPS）每组探针条数 —— 与锚点数未必相等 */
function parseProbes() {
  const out = {};
  const re = /key:\s*"(P\d)"[\s\S]*?items:\s*\[([\s\S]*?)\n\s{4}\]/g;
  for (const m of PROBE_SRC.matchAll(re)) {
    out[m[1]] = (m[2].match(/\{\s*t:\s*"/g) || []).length;
  }
  return out;
}

const data = {};
let total = 0;
for (const g of GROUPS) {
  if (!g.json) continue;
  data[g.json] = await load(g.json);
  total += data[g.json].length;
}

const L = [];
const w = (s = '') => L.push(s);

w('# 补丁逐处清单（P1–P7）');
w();
w('> **本文件由 `tools/gen-patch-docs.mjs` 根据 `assets/*-hunks.json` 生成，请勿手改。**');
w('> 锚点增删后跑 `node tools/gen-patch-docs.mjs` 重生成；`--check` 可校验是否与 JSON 一致。');
w('> 组级说明、开关位置、配额算法、验证与回滚见 [README.md](../README.md) 与 [CHANGELOG.md](../CHANGELOG.md)，本文件只回答「每一处到底改了什么」。');
w();

w('## 组与 `--only` 对照');
w();
w('| 组 | `--only` 名 | 用途 | 锚点处数 | 整文件模块 | 数据文件 |');
w('| --- | --- | --- | --- | --- | --- |');
for (const g of GROUPS) {
  const n = g.json ? data[g.json].length : null;
  const wholeCell = g.whole ? `\`assets/${g.whole}\` → 插件 \`lib/\`` : '—';
  w(`| ${g.tag} | \`${g.only}\` | ${esc(g.label)} | ${n ?? '—'} | ${wholeCell} | ${g.json ? `\`assets/${g.json}\`` : '—'} |`);
}
w();
w(`合计锚点 **${total} 处**，另有整文件模块 \`meme-bridge.js\` / \`plugins-route.js\` / \`douyin-proactive.js\`。`);
w();
w('每处补丁在运行时按四种判定之一处理：`PATCHED` 打上 / `ALREADY` 跳过 / `UPSTREAM` 上游已原生实现则自动退役 / `DRIFT` 锚点没了停手报错（见 README「用法」）。');
w();

for (const g of GROUPS) {
  if (!g.json) {
    const calls = parseP1();
    const files = [...new Set(calls.map((c) => c.file))];
    w(`## ${g.tag} · ${esc(g.label)}（\`--only ${g.only}\`，${calls.length} 处 + 1 个新文件）`);
    w();
    w('这一组的改动**不放在 `*-hunks.json` 里**，直接写在 `patch-fish-soul.mjs` 的 `patchMeme()` 内（`replaceOnce` / `replaceFunction`），下面按脚本源码逐处列出。');
    w();
    w('| # | 目标文件 | 改了什么 | 类型 |');
    w('| --- | --- | --- | --- |');
    w(`| 0 | \`lib/meme-bridge.js\` | 新增只读取图桥（内容来自 \`assets/meme-bridge.js\`，已存在且一致则跳过） | 新文件 |`);
    calls.forEach((c, i) => w(`| ${i + 1} | \`${c.file}\` | ${esc(c.label)} | ${c.kind} |`));
    w();
    w(`涉及文件：${files.map((f) => '`' + f + '`').join(' / ')}。`);
    w();
    w('| 项 | 说明 |');
    w('| --- | --- |');
    w('| 开关 | 设置 → 表情包 → 「用 dsh-meme 的表情库」（默认关） |');
    w('| 上游状态 | 🟡 仍需（上游未接入 dsh-meme）；上游 lib 下任意 js 出现 `dshMeme` 就在运行时自动退役 |');
    w('| 标记 | 每处改动行尾带 `FS-MEME-BRIDGE-PATCH`，`--check` 与体检靠它认 |');
    w('| 关闭方式 | 关掉开关即可；彻底回滚就删 `lib/meme-bridge.js` 并把 `lib/` 从备份拷回 |');
    w();
    continue;
  }
  const arr = data[g.json];
  w(`## ${g.tag} · ${esc(g.label)}（\`--only ${g.only}\`，${arr.length} 处）`);
  w();
  if (g.whole) w(`另有整文件模块：\`assets/${g.whole}\` → 插件 \`lib/\`（内容变了要同步升脚本里的版本戳，见维护约定）。\n`);
  w('| # | 锚点名 | 文件 | 改了什么 | 上游接管判定 |');
  w('| --- | --- | --- | --- | --- |');
  arr.forEach((h, i) => {
    const up = h.upstreamFixed && h.upstreamFixed.present
      ? '`' + String(h.upstreamFixed.present).slice(0, 60) + '`'
      : '—';
    w(`| ${i + 1} | \`${h.id}\` | \`${h.file}\` | ${esc(h.title)} | ${esc(up)} |`);
  });
  w();
  w('<details><summary>锚点原文（marker）</summary>');
  w();
  w('```text');
  for (const h of arr) w(`# ${h.id}\n${String(h.marker).trim()}\n`);
  w('```');
  w();
  w('</details>');
  w();
}

w('## 设置里「个人插件」页显示几处（探针口径）');
w();
w('设置 → 系统 → 个人插件 那一页读的是 `assets/plugins-route.js` 里内联的 `PATCH_GROUPS`（探针：靠一段「只有打过才出现」的代码判断在不在），**按功能合并**，条数与上面的锚点数不是一一对应。核对时别拿两边的数字硬对。');
w();
const probes = parseProbes();
const p1c = parseP1().length + 1;
w('| 组 | 锚点 / 改动处数（补丁器） | 页面探针条数 | 差异 |');
w('| --- | --- | --- | --- |');
for (const g of GROUPS) {
  const n = g.json ? data[g.json].length + (g.whole ? 1 : 0) : p1c;
  const pb = probes[g.tag];
  const diff = pb == null ? '页面未覆盖该组' : (pb === n ? '一致' : (pb < n ? `少 ${n - pb} 条（合并成功能项）` : `多 ${pb - n} 条（一处拆成多项）`));
  w(`| ${g.tag} | ${n} | ${pb ?? '—'} | ${diff} |`);
}
w();
w('页面上某一组显示「已打 N / M」，N 是按探针数出来的；锚点数以本文件为准。探针漏了某处时，页面会少报，但补丁器 `--check` 仍然会管到那一处。');
w();

w('## 维护约定');
w();
w('| 场景 | 该改哪里 |');
w('| --- | --- |');
w('| 新增 / 删除一处锚点 | 改 `assets/<组>-hunks.json`，重跑本脚本生成 docs/patches.md，并把 README 清单里的处数同步 |');
w('| 改了某处 `new` 的内容 | 把上一版 `new` 原文写进该条 `upgradeOld`，否则老机器会停在旧文案（判 `ALREADY` 被挡住） |');
w('| 改 `assets/plugins-route.js` | 同步升 `patch-fish-soul.mjs` 里的 `PLUGINS_ROUTE_VER`，否则新逻辑落不了地 |');
w('| 改 `assets/douyin-proactive.js` | 插件真身 `lib/douyin-proactive.js` 要同步，否则重跑补丁会判漂移 |');
w('| 上游已原生实现 | 该条 `upstreamFixed.present` 写上「上游做了长什么样」，运行时自动退役、不再维护 |');
w();

const text = L.join('\n');
const old = existsSync(OUT) ? await readFile(OUT, 'utf8') : null;
if (CHECK) {
  if (old === text) { console.log(`✓ docs/patches.md 与 JSON 一致（${total} 处锚点）`); process.exit(0); }
  console.error('× docs/patches.md 与 assets/*.json 不一致，跑 node tools/gen-patch-docs.mjs 重生成');
  process.exit(1);
}
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, text, 'utf8');
console.log(`✓ 写入 docs/patches.md（${text.length} 字符，${total} 处锚点）`);
