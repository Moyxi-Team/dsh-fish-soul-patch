# dsh-fish-soul 0.15.20 补丁 / Patch

**上游 / Upstream:** [Britneycode/dsh-fish-soul](https://github.com/Britneycode/dsh-fish-soul)，[v0.15.20](https://github.com/Britneycode/dsh-fish-soul/tree/v0.15.20)。

本非官方补丁针对 npm 的 `dsh-fish-soul@0.15.20`；请勿直接用于其他版本。上游 `package.json` 声明 MIT，本补丁不代表上游维护者。

This unofficial patch targets the npm package `dsh-fish-soul@0.15.20`. Do not apply it directly to other versions. The upstream `package.json` declares MIT; this patch is not endorsed by upstream.

## 功能与适配 / Changes and compatibility

- **QQ 语音**：识别段中和多种括号形式的语音标记；按配置拆分长语音，每次回复最多三条语音，其余转文字。明确要求语音时，在 TTS 可用且设置允许的情况下补上模型遗漏的语音标记；失败回退文字并记录原因。
- **兼容新版**：保留按轮次绑定引用、防复读、表情标签和可配置语音超时；语音请求意图同样绑定到消息轮次。单条回复的多段语音串行合成，避免这些片段并发绕过配额检查。
- **模型兼容**：模型明确报不支持 `temperature` 时，不带该参数重试一次；同模型的空回复或图片回退仍保留该状态。
- **旧补丁修正**：恢复上游对失败事件来源的判断，避免非插件会话被误记为插件失败。
- **隐私**：不包含机器专用日志路径、个人聊天、配置、账号信息或密钥。

**QQ voice:** Recognizes voice markers inside paragraphs and common bracket variants. Long content is split according to the configured length. At most three segments per reply are synthesized; remaining segments are sent as text. If voice is explicitly requested, TTS is available and the configuration permits it, a missing marker can be supplied automatically. Failed synthesis falls back to text and logs the reason.

**Compatibility:** Retains upstream per-turn reply references, duplicate suppression, sticker tags and configurable voice timeout. Voice intent is also tied to the turn. Segments within one reply are synthesized sequentially so those segments cannot simultaneously pass the quota check.

**Model compatibility:** When an error explicitly indicates that `temperature` is unsupported, the request is retried once without it. Empty-response and image fallback retries for the same model preserve that choice. The patch also restores the upstream failure-event source guard accidentally altered in the previous patch, preventing unrelated turns from being logged as plugin failures.

The patch excludes machine-specific diagnostic paths, private chats, configuration, account information and credentials.

## 文件 / Files

`gateway.js.diff`、`llm.js.diff`、`voice.js.diff` 分别修改对应的 `lib` 文件。`test-patch.mjs` 是不连接真实 QQ 或 TTS 服务的回归测试。

The three `.diff` files change their respective `lib` files. `test-patch.mjs` is a regression test that does not use real QQ or TTS services.

## 应用 / Apply

关闭 DSH，备份插件目录及 profile 配置，确认插件版本为 `0.15.20`。在 PowerShell 中将 `$plugin` 和 `$patch` 指向本机实际位置后执行；检查失败时不要继续。

Stop DSH, back up the plugin directory and profile configuration, and verify version `0.15.20`. In PowerShell, set `$plugin` and `$patch` to the actual local paths. Do not continue if the check fails.

```powershell
$plugin = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-fish-soul'
$patch = '<path-to-this-patch-directory>'
$version = (Get-Content -LiteralPath (Join-Path $plugin 'package.json') -Raw | ConvertFrom-Json).version
if ($version -ne '0.15.20') { throw "Expected 0.15.20, got $version" }
$files = @('gateway.js.diff', 'llm.js.diff', 'voice.js.diff') |
    ForEach-Object { Join-Path $patch $_ }
git -c core.autocrlf=false -C $plugin apply --check -- $files
if ($LASTEXITCODE -ne 0) { throw 'Patch check failed; no patch was applied.' }
git -c core.autocrlf=false -C $plugin apply -- $files
if ($LASTEXITCODE -ne 0) { throw 'Patch application failed; inspect before restarting.' }
```

应用后重启 DSH；插件更新或重装会覆盖补丁。回滚可使用更新前备份，或重装官方 `dsh-fish-soul@0.15.20`。

Restart DSH after applying. An upgrade or reinstall replaces the patch. Roll back using your backup or reinstall the official `dsh-fish-soul@0.15.20`.

## 验证与限制 / Verification and limitations

三份补丁已在干净的 npm 0.15.20 包上重放；基线文件与 GitHub `v0.15.20` 标签一致。回归测试覆盖语音、引用、防复读、轮次隔离、模型重试、表情标签、超时配置和失败事件来源。尚未连接真实 QQ、TTS 或 DSH 生产服务进行端到端测试。

All three diffs were replayed on a clean npm 0.15.20 package; baseline files matched the GitHub `v0.15.20` tag. Regression tests cover voice, reply references, duplicate suppression, turn isolation, model retries, sticker tags, timeout configuration and failure-event source. Real QQ, TTS and DSH production services were not used.
