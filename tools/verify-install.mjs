#!/usr/bin/env node
/**
 * verify-install.mjs —— 「补丁还在不在 + 下次启动会不会被冲掉」一键体检
 *
 * 为什么需要它：
 *   DSH（DeepSeek Harness）启动时会按 profile 的 package.json / pnpm-lock.yaml 做依赖安装。
 *   只要「profile 里声明的版本」「pnpm-lock 里锁定的版本」「node_modules 里实际装的版本」
 *   三者中有一个对不上，它就会把 dsh-fish-soul 按 registry 的 tarball 重装一遍 ——
 *   打过补丁的文件被整包覆盖，80 处补丁静默归零（2026-11-11 就这么丢过一次）。
 *
 *   所以「补丁在位」只说明现在能用，「三处版本一致」才说明下次启动它还在。
 *
 * 用法：
 *   node tools/verify-install.mjs                       # 体检默认 desktop profile
 *   node tools/verify-install.mjs --root <安装目录>      # 指定别的安装目录
 *   node tools/verify-install.mjs --json                # 机器可读
 *
 * 退出码：0 健康 / 1 有风险（补丁缺失或版本不一致，下次启动会被覆盖）/ 2 体检失败
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

function parseArgs(argv) {
  const out = { root: "", json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") out.root = argv[++i] ?? "";
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") {
      console.log("用法：node tools/verify-install.mjs [--root <安装目录>] [--json]");
      process.exit(0);
    }
  }
  return out;
}

const DEFAULT_ROOT = join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".dsh", "profiles", "desktop", "node_modules", "dsh-fish-soul",
);

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/** 从 pnpm-lock.yaml 里抠出 dsh-fish-soul 被锁定的版本 */
function lockVersion(profileDir) {
  const p = join(profileDir, "pnpm-lock.yaml");
  if (!existsSync(p)) return { version: "", note: "无 pnpm-lock.yaml" };
  const text = readFileSync(p, "utf8");
  // 形如：dsh-fish-soul@0.15.33:  或  dsh-fish-soul@0.15.33(@scope/dep@1.0.0):
  const hits = [...text.matchAll(/dsh-fish-soul@(\d+\.\d+\.\d+[^\s:()]*)/g)].map((m) => m[1]);
  if (!hits.length) return { version: "", note: "lock 里没找到该包" };
  const uniq = [...new Set(hits)];
  return { version: uniq[0], notes: uniq.length > 1 ? `lock 内出现多个版本：${uniq.join(" / ")}` : "" };
}

/** 调用补丁器的 --check，只看末尾那行结论 */
function patchStatus(root) {
  const script = join(REPO, "patch-fish-soul.mjs");
  if (!existsSync(script)) return { ok: false, tail: "找不到 patch-fish-soul.mjs", misses: [] };
  const r = spawnSync(process.execPath, [script, "--check", "--root", root], {
    cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const tailLine = text.split(/\r?\n/).filter((l) => l.includes("结果：")).pop() ?? "";
  const misses = text.split(/\r?\n/).filter((l) => /^\s*[×↑↷]/.test(l)).map((l) => l.trim()).slice(0, 12);
  const applied = /已打过\s*(\d+)\s*处/.exec(tailLine)?.[1] ?? "0";
  const changed = /改了\s*(\d+)\s*处/.exec(tailLine)?.[1] ?? "0";
  const drift = /漂移\s*(\d+)\s*处/.exec(tailLine)?.[1] ?? "0";
  const fail = /失败\s*(\d+)\s*处/.exec(tailLine)?.[1] ?? "0";
  return {
    ok: Number(applied) > 0 && Number(drift) === 0 && Number(fail) === 0,
    tail: tailLine || "（没拿到结论行）",
    applied: Number(applied), changed: Number(changed), drift: Number(drift), fail: Number(fail),
    misses,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ? resolve(args.root) : DEFAULT_ROOT;
  const nmDir = dirname(root);
  const profileDir = dirname(nmDir);

  if (!existsSync(root)) {
    console.error(`× 找不到安装目录：${root}`);
    process.exit(2);
  }

  const pkg = readJson(join(root, "package.json"));
  const installed = pkg?.version ?? "未知";
  const profilePkg = readJson(join(profileDir, "package.json")) ?? {};
  const declared = profilePkg.dependencies?.["dsh-fish-soul"]
    ?? profilePkg.devDependencies?.["dsh-fish-soul"] ?? "（未声明）";
  const lock = lockVersion(profileDir);
  const patch = patchStatus(root);

  // 版本一致性：声明值可能是 0.15.33 / ^0.15.33 / ~0.15.33 / workspace:* 等，只比对数字主干
  const clean = (v) => String(v).replace(/^[\^~>=<\s]+/, "").trim();
  const declaredOk = installed === "未知" ? false : clean(declared) === installed;
  const lockOk = installed === "未知" ? false : lock.version === installed;
  const consistent = declaredOk && lockOk;

  if (args.json) {
    console.log(JSON.stringify({
      root, installed, declared, declaredOk, lock: lock.version, lockOk, consistent, patch,
      healthy: consistent && patch.ok,
    }, null, 2));
    process.exit(consistent && patch.ok ? 0 : 1);
  }

  const mark = (b) => (b ? "✓" : "×");
  console.log("dsh-fish-soul 安装体检");
  console.log(`  安装目录：${root}`);
  console.log(`  实际版本：${installed}`);
  console.log(`  ${mark(declaredOk)} profile 声明：${declared}`);
  console.log(`  ${mark(lockOk)} pnpm-lock 锁定：${lock.version || "（空）"}${lock.notes ? "  ← " + lock.notes : ""}${lock.note ? "  ← " + lock.note : ""}`);
  console.log(`  ${mark(patch.ok)} 补丁状态：${patch.tail}`);
  for (const m of patch.misses) console.log(`      ${m}`);
  console.log("");

  if (!consistent) {
    console.log("结论：有风险 —— 三处版本不一致，下次 DSH 启动会按 registry 重装 dsh-fish-soul，");
    console.log("      补丁会被整包覆盖（80 处静默归零）。先统一版本，再重跑 patch：");
    console.log(`      1) 把 profiles 下 package.json 的 dsh-fish-soul 改成 ${installed}（或让它等于你要装的版本）`);
    console.log("      2) 让 pnpm-lock.yaml 同步到同一版本（正常安装一次即可，不要手改 lock）");
    console.log("      3) node patch-fish-soul.mjs --root <安装目录>");
    process.exit(1);
  }

  if (!patch.ok) {
    console.log("结论：版本一致，但补丁不全 —— 直接重跑 patch：");
    console.log(`      node patch-fish-soul.mjs --root "${root}"`);
    process.exit(1);
  }

  console.log(`结论：健康 —— 版本三处一致（${installed}），补丁 ${patch.applied} 处在位，下次启动不会被覆盖。`);
  process.exit(0);
}

main();
