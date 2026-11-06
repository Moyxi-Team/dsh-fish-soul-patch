# dsh-fish-soul 0.15.8 补丁集 / Patch Set

本仓库保存一组针对 **`dsh-fish-soul@0.15.8`** 的社区补丁。补丁基于上游 npm 官方包 0.15.8 的文件生成，面向对应版本；不应直接套用到其他版本。

This repository contains a community patch set for **`dsh-fish-soul@0.15.8`**. The patches were generated against the upstream npm package version 0.15.8 and are version-specific; do not apply them directly to another release.

## 上游 / Upstream

- 上游仓库 / Upstream repository: [Britneycode/dsh-fish-soul](https://github.com/Britneycode/dsh-fish-soul)
- 上游版本 / Upstream version: [`dsh-fish-soul@0.15.8`](https://www.npmjs.com/package/dsh-fish-soul/v/0.15.8)
- 许可证 / License: 上游 `package.json` 声明 MIT。此仓库是非官方补丁分支，不代表上游维护者背书。

## 补丁内容 / What Changes

### 1. QQ 语音发送链路 / QQ Voice Delivery

- 识别 `[语音]`、`【语音】`、`［语音］`、`(语音)` 和 `（语音）` 等标记写法，并支持标记出现在段落中间。
- 将语音段按 `voice.maxChars` 切分，尽可能在标点处断开；清理只应供文字阅读的旁白、动作和媒体标记，避免 TTS 将其读出。
- 当对方明确要求语音、TTS 可用但模型漏写语音标记时，将回复作为语音处理；每条回复最多合成三段，并并发合成。
- 在消息记录中保留实际发送形态；语音失败时继续回退为文字，并保留既有失败记录行为。
- 让引用回复避开语音消息，并在语音消息后单独发送图片，避免不兼容的消息段组合。

The patch recognizes `[语音]` and common full-width or parenthesized variants, including markers placed inside a paragraph. Voice text is split according to `voice.maxChars` (preferring punctuation), and narration/action/media markers are removed from spoken text. When a user explicitly requests voice and TTS is available, a missing model marker no longer silently prevents a voice reply. At most three segments are synthesized concurrently. The patch also preserves the actual sent form in the journal, keeps the existing text fallback on TTS failure, avoids attaching replies to voice segments, and sends images separately when needed.

### 2. 语音意图识别与提示 / Voice Intent and Prompting

- 扩展“唱首歌来听听”“怎么又变成文字”等明确语音请求的识别规则。
- 明确提示模型把语音内容单独放在一整段，并将 `[语音]` 放在段首。

Voice-request detection now covers additional direct requests (for example, asking for a song or objecting that replies keep becoming text). Prompt guidance explicitly asks the model to put voice content in its own paragraph with `[语音]` at the beginning.

### 3. `temperature` 参数兼容 / `temperature` Compatibility

- 当模型请求因错误信息包含 `temperature` 而失败时，以相同 prompt 和参数重试一次，但不发送 `temperature`。
- 原有支持该参数的模型仍走原始请求路径；重试最多一次。

If a model request fails with an error message mentioning `temperature`, the patch retries once with the same prompt and request options but omits that parameter. Models that accept `temperature` retain the original request path.

## 文件 / Files

```text
patches/0.15.8/
  gateway.js.diff
  llm.js.diff
  voice.js.diff
```

补丁仅包含相对于上游 0.15.8 文件的差异，不包含安装目录的完整源码、运行日志、聊天/群组标识、本机绝对路径或个人配置。原补丁包中写入机器专属日志路径的可选诊断改动没有纳入公开版本。

The patch files contain only diffs against upstream 0.15.8. They do not include full installed source snapshots, runtime logs, chat/group identifiers, machine-specific absolute paths, or personal configuration. An optional diagnostic write to a machine-specific log path from the original patch bundle was intentionally excluded.

## 应用 / Apply

先备份目标插件文件，并确认目标安装确为 `dsh-fish-soul@0.15.8`。关闭正在运行的 DSH 后，在 PowerShell 中执行以下命令；将 `<patch-directory>` 替换为本补丁仓库在本机的目录：

Back up the target plugin files first and confirm that the installed version is exactly `dsh-fish-soul@0.15.8`. Stop DSH, then run the following in PowerShell, replacing `<patch-directory>` with the local path of this repository:

```powershell
$plugin = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-fish-soul'
$patch = '<patch-directory>\patches\0.15.8'
git -c core.autocrlf=false -C $plugin apply --check "$patch\gateway.js.diff"
git -c core.autocrlf=false -C $plugin apply --check "$patch\llm.js.diff"
git -c core.autocrlf=false -C $plugin apply --check "$patch\voice.js.diff"
git -c core.autocrlf=false -C $plugin apply "$patch\gateway.js.diff"
git -c core.autocrlf=false -C $plugin apply "$patch\llm.js.diff"
git -c core.autocrlf=false -C $plugin apply "$patch\voice.js.diff"
node --check "$plugin\lib\gateway.js"
node --check "$plugin\lib\llm.js"
node --check "$plugin\lib\voice.js"
```

全部命令成功后再启动 DSH。若任一 `--check` 失败，请勿继续应用；这通常表示安装版本或文件内容与 0.15.8 基线不符。插件升级或重新安装会覆盖修改；回滚时重新安装 `dsh-fish-soul@0.15.8`，或从备份恢复文件。

Restart DSH only after all commands succeed. If any `--check` fails, do not apply the patches; the installed version or file contents likely differ from the 0.15.8 baseline. An upgrade or reinstall overwrites these changes. To roll back, reinstall `dsh-fish-soul@0.15.8` or restore the files from your backup.

## 验证范围与限制 / Validation and Limitations

- 已针对 npm 官方 `0.15.8` 包验证三份 diff 均可干净应用，并对应用后的三个 JavaScript 文件运行 `node --check`。
- 未在真实 QQ、TTS 服务或生产 DSH 配置中进行端到端验证；请先在可回滚的测试环境验证。
- 语音仍受 TTS 可用性、上游接口和 `voice.maxChars` 等设置影响。TTS 不可用时仍可能回退为文字。
- 此补丁不是上游正式发布，不保证兼容 0.15.9 或之后版本；每次升级后都需要重新审阅并验证差异。

The three diffs were checked against the official npm 0.15.8 package, applied cleanly, and the resulting JavaScript files passed `node --check`. No end-to-end testing against live QQ, a TTS service, or a production DSH configuration was performed; validate in a recoverable test environment first. Voice behavior still depends on TTS availability, upstream interfaces, and settings such as `voice.maxChars`. This is not an upstream release and is not guaranteed to work with 0.15.9 or later; review and validate the changes again after every upgrade.

## 免责声明 / Disclaimer

这是供审阅和测试使用的非官方补丁，不隶属于或代表 `Britneycode/dsh-fish-soul` 的维护者。使用者应自行评估风险并保留备份。

This is an unofficial patch for review and testing. It is not affiliated with or endorsed by the maintainers of `Britneycode/dsh-fish-soul`. Use it at your own discretion and keep a backup.
