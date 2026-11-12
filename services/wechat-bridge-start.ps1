#requires -Version 5
# wechat-bridge-start.ps1 - hidden launcher for the WeChat fish-soul bridge.
#
# Why a separate launcher: the bridge needs (a) a node build that can require()
# node:sqlite, (b) SOCIAL_DSH_TOKEN in its environment, (c) cwd = components\qq-bridge,
# and (d) no console window. Doing all four here keeps the watchdog loop simple.
#
# Called by wechat-bridge-start.vbs (wscript, window style 0) so nothing flashes.

$ErrorActionPreference = 'Stop'

$WA = 'E:\ruanjian\WeChatAgent'
$work = Join-Path $WA 'data\workspace'
$logDir = Join-Path $work 'state\logs'
$dshDir = 'C:\Users\Administrator\.dsh'
$log = Join-Path $dshDir 'wechat-stack-watchdog.log'

function Write-Log([string]$msg) {
  try { Add-Content -Path $log -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding UTF8 } catch { }
}

function Get-SqliteNode {
  $candidates = @()
  $runtimes = Join-Path $WA 'data\runtimes'
  if (Test-Path -LiteralPath $runtimes) {
    $candidates += @(Get-ChildItem -LiteralPath $runtimes -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'node.exe' } |
      Where-Object { Test-Path -LiteralPath $_ })
  }
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    try {
      & $candidate -e "try{require('node:sqlite');process.exit(0)}catch(e){process.exit(1)}" 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { return $candidate }
    } catch { }
  }
  return $null
}

$entry = Join-Path $work 'components\qq-bridge\src\social-bridge.js'
$cfg = Join-Path $work 'state\bridge-config.json'
$tokenFile = Join-Path $work 'state\social-dsh-token.txt'

if (-not (Test-Path -LiteralPath $entry)) { Write-Log ('bridge-start: entry missing ' + $entry); exit 1 }
if (-not (Test-Path -LiteralPath $cfg)) { Write-Log ('bridge-start: config missing ' + $cfg); exit 1 }

$node = Get-SqliteNode
if (-not $node) { Write-Log 'bridge-start: NO node build with node:sqlite found - bridge not started'; exit 1 }

if (Test-Path -LiteralPath $tokenFile) {
  $env:SOCIAL_DSH_TOKEN = (Get-Content -LiteralPath $tokenFile -Raw -Encoding UTF8).Trim()
} else {
  Write-Log ('bridge-start: token file missing - ' + $tokenFile)
}

# Re-apply the fish-soul wiring first: a WechatAgent update overwrites social-bridge.js.
$guard = Join-Path $work 'scripts\ensure-fish-soul-link.mjs'
if (Test-Path -LiteralPath $guard) {
  $out = & $node $guard $entry 2>&1
  Write-Log ('bridge-start link check: ' + ((@($out) -join ' ').Trim()) + ' (exit ' + $LASTEXITCODE + ')')
}

try {
  $proc = Start-Process -FilePath $node `
    -ArgumentList ('"' + $entry + '" "' + $cfg + '"') `
    -WorkingDirectory (Join-Path $work 'components\qq-bridge') `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'bridge.stdout.log') `
    -RedirectStandardError (Join-Path $logDir 'bridge.stderr.log')
  Write-Log ('bridge-start spawned pid ' + $proc.Id + ' node=' + $node)
  exit 0
} catch {
  Write-Log ('bridge-start spawn failed: ' + $_.Exception.Message)
  exit 1
}
