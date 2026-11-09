/**
 * routes-plugins.js —— 系统设置 → 已装插件：
 *   GET /plugins/installed  列出本机这个 profile 里装着的插件（名字 / 版本 / 来源 / 是否启用）
 * 只读：不装、不卸、不发网络请求，也不改任何插件的配置。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const SELF_DIR = dirname(LIB_DIR);

const readJson = (path) => {
	try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
};

/**
 * 本插件所在的 profile 目录（含 package.json 的那层）。
 * 正常是 <profile>/node_modules/dsh-fish-soul/lib → 上两级；pnpm 之类把插件落在别处时，
 * 退回到 ~/.dsh/profiles 下按「谁的依赖里有我」认领。
 */
function findProfile() {
	const near = resolve(SELF_DIR, '..', '..');
	if (readJson(join(near, 'package.json')) !== null) return near;
	const self = readJson(join(SELF_DIR, 'package.json')) ?? {};
	const base = join(homedir(), '.dsh', 'profiles');
	let dirs = [];
	try { dirs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(base, d.name)); } catch { return null; }
	const owners = [];
	for (const dir of dirs) {
		const pkg = readJson(join(dir, 'package.json'));
		if (!pkg?.dependencies || typeof pkg.dependencies[self.name] !== 'string') continue;
		owners.push({ dir, exact: pkg.dependencies[self.name] === self.version });
	}
	owners.sort((a, b) => Number(b.exact) - Number(a.exact));
	return owners[0]?.dir ?? null;
}

/** 装的来源：官方内置 / 本地链接（自己写的、打包进 profile 的）/ 社区 npm 包。 */
function kindOf(name, declared) {
	if (String(declared).startsWith('link:') || String(declared).startsWith('file:')) return 'local';
	if (name.startsWith('@deepseek-ai/')) return 'official';
	return 'third';
}

/** 只读汇总：不联网，只读 profile 的 package.json 与各插件自己的 package.json。 */
export function installedPlugins() {
	const profileDir = findProfile();
	if (profileDir === null) return { ok: false, error: '找不到 DSH 的 profile 目录' };
	const profilePkg = readJson(join(profileDir, 'package.json')) ?? {};
	const self = readJson(join(SELF_DIR, 'package.json')) ?? {};
	const deps = profilePkg.dependencies && typeof profilePkg.dependencies === 'object' ? profilePkg.dependencies : {};
	const bundles = Array.isArray(profilePkg?.dsh?.profile?.bundles) ? profilePkg.dsh.profile.bundles : [];
	const pluginsRoot = join(profileDir, 'node_modules');
	const list = [];
	for (const [name, declared] of Object.entries(deps)) {
		const pkgPath = join(pluginsRoot, ...String(name).split('/'), 'package.json');
		const pkg = existsSync(pkgPath) ? readJson(pkgPath) : null;
		list.push({
			name,
			version: pkg?.version ?? '',
			declared: String(declared),
			kind: kindOf(name, declared),
			// bundles 里列着才算真被宿主加载；只写进 dependencies 的是装了没启用
			enabled: bundles.includes(name),
			self: name === (self.name ?? 'dsh-fish-soul'),
			description: typeof pkg?.description === 'string' ? pkg.description : ''
		});
	}
	list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
	const enabled = list.filter((x) => x.enabled).length;
	return {
		ok: true,
		profile: basename(profileDir),
		self: self.name ?? 'dsh-fish-soul',
		total: list.length,
		enabled,
		plugins: list
	};
}

/**
 * GET /plugins/installed
 */
export async function handlePluginsRoute({ method, path, req, send, sameOrigin }) {
	if (!String(path).startsWith('/plugins/')) return false;
	if (method === 'GET' && path === '/plugins/installed') {
		if (!sameOrigin(req)) { send(403, { ok: false, error: 'forbidden' }); return true; }
		try { send(200, installedPlugins()); }
		catch (error) { send(500, { ok: false, error: String(error instanceof Error ? error.message : error) }); }
		return true;
	}
	return false;
}
