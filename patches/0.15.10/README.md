# dsh-fish-soul 0.15.10 补丁 / Patch

**上游 / Upstream:** [Britneycode/dsh-fish-soul](https://github.com/Britneycode/dsh-fish-soul)，[v0.15.10](https://github.com/Britneycode/dsh-fish-soul/tree/v0.15.10)。

本非官方补丁针对 npm 的 `dsh-fish-soul@0.15.10`。应用前必须确认版本和文件内容；其他版本不能直接套用。上游 `package.json` 声明 MIT，本项目不代表上游维护者。

This unofficial patch targets the npm package `dsh-fish-soul@0.15.10`. Verify the installed version and baseline before applying it. It is not intended for other versions. The upstream `package.json` declares MIT; this patch is not endorsed by upstream.

## 功能与适配 / Changes and compatibility

- **QQ 语音**：识别段中及常见括号形式的语音标记；按配置的长度拆分长语音，每次回复最多三条语音，其余转为文字。明确要求语音时，可在 TTS 可用且设置允许的情况下补上模型遗漏的语音标记；失败回退文字并记录原因。
- **新版本兼容**：保留 0.15.10 的按消息轮次绑定引用和跨轮防复读机制；语音请求意图同样绑定到消息轮次。多段语音在单条回复内串行合成，避免这些片段并发绕过配额检查。
- **模型兼容**：模型明确报不支持 `temperature` 时，不带该参数重试一次；后续同模型的空回复或图片回退仍保留该状态。
- **边界**：不包含原本机器专用的日志路径，也不包含个人聊天、配置、账号信息或密钥。不会修改上游其他功能。

**QQ voice:** Recognizes voice markers inside paragraphs and common bracket variants. Long voice content is split according to the configured length; at most three segments per reply are synthesized, and remaining segments are sent as text. If voice was explicitly requested, TTS is available and the configuration permits it, a missing voice marker can be supplied automatically. Failed synthesis falls back to text and logs the reason.

**0.15.10 compatibility:** Retains upstream per-turn reply references and cross-turn duplicate suppression; voice-request intent is also carried with the message. Voice segments within one reply are synthesized sequentially so those segments cannot simultaneously pass the quota check.

**Model compatibility:** When an error explicitly indicates that `temperature` is unsupported, the request is retried once without it. Empty-response and image fallback retries for the same model preserve that choice.

The patch excludes machine-specific diagnostic paths, private chats, configuration, account information and credentials.

## 文件 / Files

`gateway.js.diff`、`llm.js.diff`、`voice.js.diff` 分别修改对应的 `lib` 文件。`test-patch.mjs` 为无需真实 QQ 或 TTS 服务的回归测试。

The three `.diff` files change their respective `lib` files. `test-patch.mjs` is a regression test that does not use real QQ or TTS services.

## 应用 / Apply

关闭 DSH、备份插件目录及 profile 配置，确认插件版本为 `0.15.10`。在 PowerShell 中将 `$plugin` 和 `$patch` 指向本机实际位置后执行。请先完整执行检查，失败时不要继续。

Stop DSH, back up the plugin directory and profile configuration, and verify version `0.15.10`. In PowerShell, set `$plugin` and `$patch` to the actual local paths. Run the entire check first; do not continue if it fails.

```powershell
$plugin = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-fish-soul'
$patch = '<path-to-this-patch-directory>'
$version = (Get-Content -LiteralPath (Join-Path $plugin 'package.json') -Raw | ConvertFrom-Json).version
if ($version -ne '0.15.10') { throw "Expected 0.15.10, got $version" }
$files = @('gateway.js.diff', 'llm.js.diff', 'voice.js.diff') |
    ForEach-Object { Join-Path $patch $_ }
git -c core.autocrlf=false -C $plugin apply --check -- $files
if ($LASTEXITCODE -ne 0) { throw 'Patch check failed; no patch was applied.' }
git -c core.autocrlf=false -C $plugin apply -- $files
if ($LASTEXITCODE -ne 0) { throw 'Patch application failed; inspect before restarting.' }
```

应用后重启 DSH；插件更新或重装会覆盖补丁。回滚可使用更新前备份，或重装官方 `dsh-fish-soul@0.15.10`。不要对新版直接覆盖旧版完整文件。

Restart DSH after applying. An upgrade or reinstall replaces the patch. Roll back using your backup or reinstall the official `dsh-fish-soul@0.15.10`. Do not overwrite newer releases with full files from an older release.

## 验证与限制 / Verification and limitations

三个补丁均从干净的 npm 0.15.10 包重放，基线文件与 GitHub `v0.15.10` 标签逐项一致，应用后的文件与测试版本一致。回归测试覆盖标记、长文本、语音失败回退、引用、防复读、轮次隔离和模型重试。没有连接真实 QQ、TTS 或 DSH 生产服务进行端到端测试；真实环境仍需验证。

All three diffs were replayed on a clean npm 0.15.10 package; the baseline files matched the GitHub `v0.15.10` tag, and patched files matched the tested files. Regression tests cover marker handling, long text, TTS fallback, reply references, duplicate suppression, turn isolation and model retries. Real QQ, TTS and DSH production services were not used; validate in your own environment.
