# dsh-fish-soul-patch

> **这是 DSH 插件 [`dsh-fish-soul`](https://github.com/Britneycode/dsh-fish-soul) 的补丁仓库，不是插件本体。**
> 本仓库**不包含上游任何源码**（没有 `lib/`、没有 `test/`、没有上游的构建与发布配置），只放补丁脚本、补丁数据和上游兼容性体检结果。
> 用之前请先按[上游 README](https://github.com/Britneycode/dsh-fish-soul#readme) 安装插件本体，再回来跑这里的脚本。

上游插件本身是完整的：人格、按人记忆、生活节奏、QQ / B站 / 抖音三端。这个仓库只负责「上游还没做、但我们需要」的几处改动（含系统设置里那份已装插件清单），用脚本打到你机器上**已安装的那一份**插件里。

## 设计原则

| 原则 | 说明 |
| --- | --- |
| 不跟版本号 | 按代码锚点打，打的是你当前安装的那一版；上游小改不会整体冲突，也不会把插件回退成旧版本 |
| 幂等 | 每处补丁带 probe，重复跑只补没打过的，不会在同一锚点上叠第二遍 |
| 会退役 | 每个补丁声明了「上游做完了长什么样」，上游原生实现后自动跳过且不再维护 |
| 不硬来 | 锚点没了、上游也没做（改版挪了代码）时停手报错，交给 `audit-upstream.mjs` 更新锚点，不靠 `--force` 硬改 |
| 改前备份 | 每次改文件先备份到 `~/.dsh/backup/fish-soul-patch-<时间戳>/`，与原目录结构一致 |

补丁会丢：`node_modules` 下的第三方插件被 pnpm 整体重写，升级或重装后就没了——重装完再跑一遍脚本即可。

## 补丁清单

| 补丁 | 锚点名 | 改了上游哪里 | 上游状态 |
| --- | --- | --- | --- |
| 借 dsh-meme 的表情库 | `meme-bridge` | 接上 dsh-meme 的只读取图服务（`ctx.get('dshMeme')`），新增 `lib/meme-bridge.js` 与表情包设置里的开关 | 🟡 仍需（上游未接入 dsh-meme） |
| 评论区状态按可见性判定 | `douyin-comment-visible` | 折叠态不再被误判成「评论已打开」 | 🟡 仍需 |
| 详情页只走直链 + 点右侧「评论(n)」 | `douyin-note-tab` | 作品详情页只走 note / video 直链，再点右侧 Tab 进评论 | 🟡 仍需 |
| 回复只在可见评论条目里找 | `douyin-reply-visible` | 用真实鼠标点击可见条目，不再对隐藏节点下手 | 🟡 仍需 |
| BGM 抓取留痕 + 挑歌兜底 | `douyin-music-trace` | 抓不到 BGM 时留痕，挑歌时滤掉非歌曲条目 | 🟡 仍需 |
| 热更新后人格卡 + 记忆块掉线 | `index-remount-our-session` | `noteInteraction` 里每条消息补挂一次人格段（会话还活着、`ensureSession` 见 live 直接 return 时不再永久掉线） | 🟡 仍需 |
| `sectionsMounted` 从 Set 改 Map | `index-remount-map` | 记的是 ctx 本身而不是 id，宿主换了 ctx 才重挂、同一 ctx 不重复注册 | 🟡 仍需 |
| 设置里列出已装插件 | `client-system-plugins-tab` 等 5 处 | 系统设置加「已装插件」只读清单（名字 / 版本 / 来源 / 是否启用），新增 `lib/routes-plugins.js` + `GET /plugins/installed`，不装不卸、不联网 | 🟡 仍需（上游无此页） |

状态取自 [`reports/upstream-compatibility.md`](reports/upstream-compatibility.md)（对着 npm 最新版自动体检生成，每周更新一次）。带 `douyin-` / `index-` / `client-` / `routes-` 前缀的都是小块锚点：抖音四处看 [`assets/douyin-hunks.json`](assets/douyin-hunks.json)，人格段两处看 [`assets/index-hunks.json`](assets/index-hunks.json)，已装插件五处看 [`assets/plugins-hunks.json`](assets/plugins-hunks.json)（外加新文件 [`assets/plugins-route.js`](assets/plugins-route.js)），逐处替换、不再整文件覆盖。

## 用法

```bash
node patch-fish-soul.mjs                    # 自动找 ~/.dsh/profiles/*/node_modules/dsh-fish-soul
node patch-fish-soul.mjs --root <插件目录>   # 指定插件目录（含 package.json 的那层）
node patch-fish-soul.mjs --check            # 只报告状态，不改文件
node patch-fish-soul.mjs --only meme        # 只跑一组（meme / douyin / remount / plugins）
node patch-fish-soul.mjs --json             # 结尾多打一段机器可读汇总（CI / 体检用）
node patch-fish-soul.mjs --force            # 忽略「已打过」判断按内容重算（谨慎）
```

每次运行对每处补丁给出四种判定之一：

| 判定 | 含义 | 动作 |
| --- | --- | --- |
| `PATCHED` | 锚点在、上游没做 | 打上 |
| `ALREADY` | 本补丁已打过 | 跳过 |
| `UPSTREAM` | 上游已原生实现 | **自动退役**，一行不改 |
| `DRIFT` | 锚点没了、上游也没做 | 停手报错，等人更新锚点 |

需要 Node ≥ 22.5。

## 上游体检

```bash
node audit-upstream.mjs
```

直接拉 npm 上最新版 `dsh-fish-soul`，逐处判断补丁是「可退役 / 仍需 / 漂移」，结果写进 `reports/upstream-compatibility.md`。GitHub Actions（[`upstream-audit.yml`](.github/workflows/upstream-audit.yml)）每周自动跑一次并提交结果，所以这个文件不用手动维护。

## 仓库内容

```
patch-fish-soul.mjs    补丁器：版本无关、幂等、三态判定、可自动退役
audit-upstream.mjs     上游体检：对 npm 最新版判断每处补丁还有没有用
assets/
  douyin-hunks.json    抖音四处补丁的小块锚点与替换内容
  index-hunks.json     人格段补挂两处的小块锚点与替换内容
  plugins-hunks.json   已装插件五处（client.js 3 + routes.js 2）的锚点与替换内容
  plugins-route.js     「已装插件」只读路由模块（新文件，落到插件 lib/routes-plugins.js）
  meme-bridge.js       dsh-meme 只读取图桥接模块（打进插件 lib/ 用）
reports/
  upstream-compatibility.md   体检报告（自动生成）
.github/workflows/
  upstream-audit.yml   每周体检
```

## 上游与归属

- 插件本体、完整能力说明、配置项、数据目录（`~/.dsh/fish-soul-config.json`、`~/.dsh/fish-soul/soul.db` 等）、安装方式，全部**以上游为准**：[Britneycode/dsh-fish-soul](https://github.com/Britneycode/dsh-fish-soul)。本仓库不复制那套文档，避免两边版本对不上。
- 上游插件 MIT，本仓库的补丁代码同样 MIT。上游作者不为这里的改动负责；补丁出问题时先跑 `--check` 和 `audit-upstream.mjs` 分清是「锚点过期」还是「上游已实现」。

## 许可

MIT
