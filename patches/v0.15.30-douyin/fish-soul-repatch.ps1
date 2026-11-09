# 重打 dsh-fish-soul 抖音补丁（评论可见性 / 作品页 URL / 回复真点 / BGM 记录与兜底）
# 用法：
#   pwsh -File fish-soul-repatch.ps1            # 只在被覆盖时重打，并提示重启
#   pwsh -File fish-soul-repatch.ps1 -Restart   # 重打后自动重启 DSH 使其生效
param([switch]$Restart)

$dst = "C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-fish-soul\lib\douyin-social.js"
$src = "C:\Users\Administrator\.dsh\fish-soul\patches\douyin-social-0.15.29-fixed.js"
$patchedLen = 52166

if (-not (Test-Path $dst)) { Write-Host "[skip] 插件未安装：$dst"; exit 0 }
if (-not (Test-Path $src)) { Write-Host "[error] 补丁文件缺失：$src"; exit 1 }

$cur = (Get-Item $dst).Length
if ($cur -eq $patchedLen) { Write-Host "[ok] 补丁已在位（$cur B）"; exit 0 }

Copy-Item $src $dst -Force
$now = (Get-Item $dst).Length
Write-Host ("[patched] {0} -> {1} B（原 {2} B）" -f $dst, $now, $cur)
Write-Host "需要重启 DSH 才会加载新代码。"

if ($Restart) {
    $main = Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" |
        Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
    if ($main) {
        taskkill /T /F /PID $main.ProcessId | Out-Null
        Start-Sleep -Seconds 6
    }
    if (-not (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
        Start-Process 'E:\ruanjian\DeepSeekHarness\DeepSeek Harness.exe'
        Write-Host "[restart] 已重新拉起 DSH"
    }
}
