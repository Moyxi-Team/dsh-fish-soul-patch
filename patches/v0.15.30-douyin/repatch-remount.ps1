# 重打「记忆块补挂」补丁（index.js）
# 症状：插件热更新/重链后，已开着的会话里人格卡 + 瞬态块（此刻状态 / Top5 记忆）永久掉线，
#       面板里的动态每条都显示「记忆没进这轮」。
# 改法：noteInteraction 里对自家会话的每条 inbox 消息补挂一次（先挂再 return），
#       并把 sectionsMounted 从 Set 换成 Map(id -> ctx)，ctx 换了就重挂。
# 幂等：跑几次都一样；已经是补丁状态就什么都不做。
# 用法：
#   pwsh -File repatch-remount.ps1             # 缺什么补什么
#   pwsh -File repatch-remount.ps1 -Restart    # 补完自动重启 DSH
param([switch]$Restart)

$dst = "C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-fish-soul\lib\index.js"
if (-not (Test-Path $dst)) { Write-Host "[skip] 插件未安装：$dst"; exit 0 }

$text = Get-Content $dst -Raw -Encoding utf8
$changed = $false

# 1) inbox 里补挂（插在「自家来源直接 return」之前）
if ($text -match '(?m)^\s*if \(gateway\?\.isOurSession\(agentId\) === true\) mountSectionsFor\(payload\?\.agent\);') {
	Write-Host "[ok] 补挂那一行已在位"
} else {
	$anchor = '(?m)^([ \t]*)if \(source\.kind === SOURCE_QQ \|\| source\.kind === SOURCE_PROACTIVE \|\| source\.kind === SOURCE_BILI \|\| source\.kind === SOURCE_DOUYIN\) return;'
	if ($text -match $anchor) {
		$text = [regex]::Replace($text, $anchor, '$1if (gateway?.isOurSession(agentId) === true) mountSectionsFor(payload?.agent);' + "`r`n" + '$1if (source.kind === SOURCE_QQ || source.kind === SOURCE_PROACTIVE || source.kind === SOURCE_BILI || source.kind === SOURCE_DOUYIN) return;', 1)
		$changed = $true
		Write-Host "[patch] 已插入 inbox 补挂"
	} else {
		Write-Host "[warn] 找不到插入点（插件改版了？）——需要手工看一眼 noteInteraction"
	}
}

# 2) Set -> Map（单个改动点，两行一起换，避免 Map 上误用 has/add 炸掉）
if ($text -match 'const sectionsMounted = new Map\(\);') {
	Write-Host "[ok] sectionsMounted 已是 Map"
} else {
	$text = $text -replace 'const sectionsMounted = new Set\(\);', 'const sectionsMounted = new Map();'
	$text = [regex]::Replace($text, 'if \(id === '''' \|\| sectionsMounted\.has\(id\) \|\| agent\?\.ctx === undefined\) return;\s*\r?\n\s*sectionsMounted\.add\(id\);',
		"if (id === '' || agent?.ctx === undefined || sectionsMounted.get(id) === agent.ctx) return;`r`n`t`tsectionsMounted.set(id, agent.ctx);")
	$changed = $true
	Write-Host "[patch] sectionsMounted -> Map（ctx 换了会重挂）"
}

if ($changed) {
	Set-Content -Path $dst -Value $text -Encoding utf8 -NoNewline
	Write-Host "[done] 已写入，需要重启 DSH 才会加载新代码。"
} else {
	Write-Host "[ok] 无需改动。"
}
# 写坏自检：Map 还在配 has/add 就说明补丁半残
$now = Get-Content $dst -Raw -Encoding utf8
if ($now -match 'new Map\(\)' -and $now -match 'sectionsMounted\.(has|add)\(') { Write-Host "[FATAL] Map 配 has/add，语法对但运行会炸，请手工修" ; exit 1 }
node --check $dst
if ($LASTEXITCODE -ne 0) { Write-Host "[FATAL] 语法检查没过"; exit 1 }

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
