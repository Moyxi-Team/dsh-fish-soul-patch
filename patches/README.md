# dsh-fish-soul-patch

给 [`dsh-fish-soul`](https://github.com/britneycode/dsh-fish-soul) 打补丁的地方。

**一句话原则：补丁跟着上游走，不跟版本号走。**

脚本不绑任何版本，直接对着「你机器上当前装的那一版」找锚点打；上游哪天自己把某个功能做出来了，那个补丁就**自动退役**——不改文件、不再维护，也不会因为上游升级而报错。所以这里没有「停在 0.15.8」「只适配 0.15.31」这种说法。

| 补丁 | 内容 | 退役条件（上游自己做好就撒手） |
|---|---|---|
| `meme-bridge` | 表情包借 `dsh-meme` 的只读取图服务（`ctx.get('dshMeme')`）+ 设置页开关，没装 / 关着都自己降级 | 上游 `lib/` 里自己出现 `dshMeme` 调用 |
| `douyin-comment-visible` | 评论区按**可见性**判定是否真展开（折叠态 0×0 不再误报「已打开」） | 上游代码里出现 `itemsVisible` 判定 |
| `douyin-note-tab` | 作品详情页只走 `note` / `video` 直链 + 点右侧「评论(n)」Tab（不再靠 `?modal_id=` 白等 7 秒） | 上游代码里不再出现 `modal_id` |
| `douyin-reply-visible` | 回评论只在**可见**评论条目里找，并用真实鼠标点击（合成 click 抖音不响应） | 上游代码里出现 `const pool = shown.length ? shown : all;` |
| `douyin-music-trace` | BGM 抓取留痕 + 挑歌兜底（滤掉「创作的原声」这类非歌曲条目） | 上游代码里出现 `douyin.music.last` 落库 |

---

## 一、用起来

```bash
# 1) 先看现状（不改任何文件）
node patch-fish-soul.mjs --check

# 2) 真正打补丁（自动找 ~/.dsh/profiles/*/node_modules/dsh-fish-soul，自动备份到 ~/.dsh/backup/）
node patch-fish-soul.mjs

# 3) 重启 DeepSeek Harness（require 缓存不会重读文件）
```

其他参数：

| 参数 | 作用 |
|---|---|
| `--root <dir>` | 指定插件目录（默认自动找 `~/.dsh/profiles/*/node_modules/dsh-fish-soul`） |
| `--only meme` / `--only douyin` | 只打其中一组 |
| `--check` | 只报告状态，不写文件 |
| `--json` | 输出机器可读结果（给 CI / 脚本用） |

跑完会明确告诉你四类结果：`改了几处` / `已经打过` / `上游已实现（自动退役）` / `漂移（锚点过期，需要更新锚点）`。

## 二、脚本怎么做到「不会被版本甩下」

- **锚点替换，不是整文件覆盖**：每处改动是一小段 `old → new` 替换，存在 [`assets/douyin-hunks.json`](assets/douyin-hunks.json) 里，各自独立。上游只改了其中一处，另外三处照样能打。
- **每处自带退役判据**：`upstreamFixed` 字段写明「上游什么样子算它自己做好了」。命中即跳过，并在结果里标成 `自动退役`——这类补丁从此不需要人管。
- **认不出就报漂移，不硬改**：锚点找不到、上游也没实现，脚本判定为 `DRIFT`（退出码 2），提示「上游改版挪了代码，需要按新版更新锚点」。它绝不会把不匹配的内容硬塞进去。
- **幂等**：每处改动都有唯一标记，重跑 0 改动。插件升级（pnpm 重装会整体覆盖目录）后重跑一次即可恢复。

## 三、上游体检（自动跑，不用人盯）

```bash
node audit-upstream.mjs            # 直接拉 npm 上的 latest 体检，输出 Markdown
node audit-upstream.mjs --version 0.15.31
node audit-upstream.mjs --tarball ./dsh-fish-soul.tgz   # 离线
node audit-upstream.mjs --out reports/upstream-compatibility.md
```

结果写进 [`reports/upstream-compatibility.md`](reports/upstream-compatibility.md)，每处补丁标一个状态：

| 状态 | 含义 | 该怎么办 |
|---|---|---|
| 🟢 `RETIRED` | 上游自己已经实现了 | 这处不用再维护，从脚本里删掉或留着不管都行 |
| 🟡 `NEEDED` | 上游还没有 | 补丁继续有效，照常跟最新版 |
| 🔴 `DRIFT` | 上游改了这段代码但**没**实现同样功能 | 按上游新版对应片段更新 `assets/douyin-hunks.json` 的 `old` 锚点 |

全部 `RETIRED` 时结论会直接写「这些补丁可以整体退役，仓库不必再跟着上游版本维护」。

**`.github/workflows/upstream-audit.yml` 每周一自动跑一次**，把报告提交回仓库；一旦出现 `DRIFT` 会自动开 / 追加一个带 `upstream-drift` 标签的 issue，免得上游改版后补丁静默失效。

## 四、注意事项

1. 改动前自动备份到 `~/.dsh/backup/fish-soul-patch-<时间戳>/`；插件升级会覆盖目录，升级后重跑脚本。
2. 打完后**必须重启 DeepSeek Harness**。
3. 打补丁期间最好先退出 DSH，避免宿主把内存态回写覆盖改动。
4. 本仓库根目录的 `lib/`、`test/` 是 fork 上游时的 **v0.15.8 快照**，只作历史参考，**禁止整包覆盖到新版插件**（会回退十几个版本的功能）。真正要用的是根目录的两个脚本 + `assets/`。
5. `patches/v0.15.30-douyin/` 是早期整文件覆盖式补丁的**历史归档**，仅供追溯，不要再用（整文件覆盖会被上游改版打回原形）。

## 五、许可

上游 MIT。补丁代码同样 MIT；`assets/` 里含上游代码片段的文件，版权归上游作者。
