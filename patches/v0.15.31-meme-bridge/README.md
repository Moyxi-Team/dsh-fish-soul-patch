# dsh-fish-soul · 借 dsh-meme 图库补丁（适配 0.15.31）

给 `dsh-fish-soul` 加两个能力：

1. **借图**：她自己的表情包不够用时，去同进程的 `dsh-meme` 图库里挑一张发（只读，不写对方图库）。
2. **开关**：设置页「表情包」里多一个带说明的开关，默认关，随时可关掉。

另外把上游 0.15.30 起一直没修的抖音缺陷（回评论发不出 / 图文没 BGM）一起重新打上——详见 `patches/v0.15.30-douyin/`。

- 目标版本：`dsh-fish-soul@0.15.31`（`node --check` 全部通过）
- 上游：<https://github.com/britneycode/dsh-fish-soul>
- 形态：**幂等补丁脚本**，不手改 `node_modules` 存档；插件升级后重跑一次即可

---

## 一、为什么需要它

两个插件原本是平行系统：

| | dsh-fish-soul | dsh-meme |
|---|---|---|
| 图库位置 | 会话工作区 `_stickers/`（装好是空的） | `memes/`，约 339 个文件，按情绪分 6 桶 |
| 配置 | 插件自己的 `stickers` 段 | `dsh-expression.json` |
| 发图语法 | `![名字](_stickers/文件名)` / `![感觉](_stickers/@感觉)` | 自己的面板 |

`dsh-meme` 的 README 明确给了同进程插件可用的**只读取图服务**（`ctx.get('dshMeme')`，契约 `contractVersion: 1`，实现见 `dsh-meme/index.js` 的 `ctx.provide('dshMeme', memeService)`），方法是 `packs()` / `search()` / `pick()`，只读、幂等、不发图。

而 fish-soul 的 `stickers.js` 只读本地向量，`_stickers` 为空时她的 `![感觉](_stickers/@感觉)` 一律得到「还没打标签」，只能干发文字。这个补丁就是把这条只读链路接上。

## 二、边界（重要）

- **只读**：不写 dsh-meme 的图库、不改它的配置、不占它的收藏额度、不触发它发图。
- **落盘仅在 fish-soul 自己的缓存目录**：挑中的图会复制一份到 `~/.dsh/fish-soul/meme-cache/`（文件名是源路径的 sha1 前 12 位 + 原扩展名，最多留 300 张，超了按 mtime 删最旧）。两个原因：
  1. 网关只允许发「工作区 / fish-soul 数据目录」里的图（`lib/gateway-media.js` 的 `resolveImageFile` 白名单），直接拿图库里的绝对路径会被拒；
  2. 图库文件名带空格时 `![x](路径)` 的 markdown 解析会把路径截断，缓存出来的名字没有空格。
- **没装 / 没开都自己降级**：拿不到服务、或对方图库总数为 0，一律当没有，静默回到原来的行为（日志里只提示一次，一分钟内不重复试）。

## 三、开关在哪

设置页 → 「表情包」区块，新增一行：

> **借 dsh-meme 的表情库**
> 她自己的表情包里没有合适的时，去 dsh-meme 的图库挑一张发（只读取图；需要本机装了 dsh-meme 并打开了图库）

打开后的说明文字会变成：

> 已开：她自己的表情包里没有合适的，就去 dsh-meme 的图库里挑一张（只读取图：不改动它的图库、不占收藏额度；图会复制一份到 fish-soul 自己的缓存目录再发）

- 字段：`stickers.meme`（布尔，默认 `false`）
- 接口：`POST /api/plugins/fish-soul/stickers/config` body `{ "meme": true }`
- 生效：下次挑表情即生效（不用重启）

## 四、改了哪些地方（14 处）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `lib/meme-bridge.js` | **新增**。`createMemeBridge({ctx, log, canConvertWebp})` → `{ pick, status, moodOfFeel }`。`pick({feel, avoid})` 依次尝试「感觉词 + 情绪桶」→「只按情绪桶」→「只按关键词」，跳过已用过的、非图片、`.webp` 但本机转不了 png 的；返回缓存副本的绝对路径与 `label`。`moodOfFeel` 把中文感觉词映射到 dsh-meme 的 6 个桶（happy / angry / sad / shy / confused / daily） |
| 2 | `lib/stickers.js` | `stickerConfig` 增加 `meme`；`StickerBox` 构造参数增加 `meme`；`resolveFeelRefs` 支持「绝对路径」引用（借来的图不在 `_stickers` 里）；`pickByFeel` 在本地标签向量找不到时回落 `meme.pick()`；新增 `imageRef()` 帮助函数（含空格 / 括号的路径包一层 `file://`） |
| 3 | `lib/index.js` | import 桥；在 `canConvertWebp` 之后创建桥（`ctx.get('dshMeme')` 要在插件 ctx 有效期内取）；把桥交给 `StickerBox`；提示词里补一句「自己的表情包里没有合适的，可以写 `![感觉](_stickers/@感觉)`，会自动去 dsh-meme 挑」 |
| 4 | `lib/config-schema.js` | `stickers.meme: z.boolean().default(false)` |
| 5 | `lib/routes-v07.js` | `/stickers/config` 接收 `meme` 字段 |
| 6 | `lib/client.js` | 设置页开关（带上面那两段说明文案） |
| 7 | `lib/gateway.js` | 挑表情的日志用友好名字（`dsh-meme / 包名 / 说明`）代替裸文件名 |
| 8 | `lib/douyin-social.js` | **P2 独立补丁**：整文件替换为 0.15.30 起的抖音修复版（见另一目录） |

## 五、怎么用

```powershell
# 1) 检查当前版本能不能打（只读，不改文件）
node patch-fish-soul.mjs --check

# 2) 只打 P1（借图 + 开关），不碰抖音
node patch-fish-soul.mjs --only meme

# 3) 只打 P2（抖音修复）
node patch-fish-soul.mjs --only douyin

# 4) 全打（默认）
node patch-fish-soul.mjs
```

- 默认根目录：`C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-fish-soul`
- `--root <路径>`：指定别的 profile / 别的安装位置
- 改前自动备份到 `~/.dsh/backup/fish-soul-patch-<时间戳>/`
- **改完要重启 DeepSeek Harness**（插件实例重建但 `require` 缓存不会重读文件）

### 幂等

每个改动都有唯一标记（`FS-MEME-BRIDGE-PATCH` / `FS-DOUYIN-SOCIAL-PATCH`），重跑时检测到就跳过。对于「锚点替换后锚点本身还在」的那几处（例如把 `const EMPTY_TAGS = …` 原地扩写、往 `import` 后面追加一行），额外带一个 **probe 串**（补丁打完才会出现的短串），避免同一锚点被叠第二遍。

实测（`npm pack dsh-fish-soul@0.15.31` 的干净包上）：

| 轮次 | 结果 |
|---|---|
| 第 1 次 | 改了 15 处，已打过 0 处，失败 0 处 |
| 第 2 次 | 改了 0 处，已打过 15 处，失败 0 处 |

## 六、回滚

```powershell
# 从备份目录整体还原
Copy-Item "C:\Users\Administrator\.dsh\backup\fish-soul-patch-<时间戳>\*" `
          "C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-fish-soul\lib\" -Force
```

或直接 `pnpm install` / 重装插件（包管理器会整体覆盖），再决定要不要重跑补丁。

## 七、和上游 0.15.31 的关系

本补丁**不改动**上游任何已有语义，只做两件事：新增一个文件、在既有函数里加分叉。上游若把同能力做进原版，跑 `--check` 会报锚点不匹配，届时删掉本补丁即可，不会有残留状态。

已知：`dsh-meme` 没有任何导出给「别的插件」用的写接口，本补丁也只调用它的 `packs/search`（`pick` 只作为存在性校验），不依赖它未来是否改内部结构。

## 八、许可

补丁代码随上游 MIT。`assets/douyin-social-fixed.js` 是上游文件（`dsh-fish-soul@0.15.30`）的修改版，版权归上游作者。
