# fish-soul-patch-guard.ps1
# Self-heal guard for the dsh-fish-soul patch set.
#
# Why: DSH runs a pnpm install on every launch, and that rewrites
# node_modules\dsh-fish-soul with the pristine upstream build - silently dropping
# every patch (WeChat tab in the panel, animated sticker swap, proactive DM, ...).
#
# What this does: run the patcher in --check mode; if anything is missing, drifted or
# failing, re-apply the whole patch set once and report. Fully idempotent, silent,
# never blocks anything - failures only go to the log.
#
# Called by app-triggered-boot.ps1 (hidden, delayed so the install has finished).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Administrator\.dsh\fish-soul-patch-guard.ps1 [-DelaySeconds 90]
param([int]$DelaySeconds = 90)

$ErrorActionPreference = 'Continue'
# node prints UTF-8; without this the check output arrives as mojibake and nothing parses.
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch { }
$root = 'C:\Users\Administrator\.dsh'
$repo = Join-Path $root 'patches\dsh-fish-soul-patch'
$log  = Join-Path $root 'fish-soul-patch-guard.log'
$lock = Join-Path $root 'fish-soul-patch-guard.lock'

function Write-Log([string]$msg) {
  try {
    Add-Content -Path $log -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding UTF8
    $fi = Get-Item $log
    if ($fi.Length -gt 512KB) { Get-Content $log -Tail 400 | Set-Content $log -Encoding UTF8 }
  } catch { }
}

# Single instance + debounce: Electron spawns a whole process tree, the hook fires repeatedly.
try {
  if (Test-Path $lock) {
    $age = ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalSeconds
    if ($age -lt 300) { exit 0 }
  }
  Set-Content -Path $lock -Value (Get-Date -Format o) -Encoding UTF8
} catch { }

# node: prefer the system Node install, fall back to PATH.
$node = $null
foreach ($cand in @('C:\Program Files\nodejs\node.exe', 'node')) {
  if ($cand -eq 'node') { $node = 'node'; break }
  if (Test-Path $cand) { $node = $cand; break }
}
if (-not $node) { Write-Log 'node not found - guard skipped'; exit 0 }
if (-not (Test-Path (Join-Path $repo 'patch-fish-soul.mjs'))) { Write-Log ('patch repo missing: ' + $repo); exit 0 }

Set-Location $repo
if ($DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds }

function Invoke-Check {
  try {
    $out = & $node 'patch-fish-soul.mjs' '--check' 2>&1 | Out-String
  } catch {
    return @{ ok = $false; raw = $_.Exception.Message }
  }
  $m = [regex]::Match($out, '\u7ed3\u679c\uff1a\u6539\u4e86\s*(\d+)\s*\u5904\uff0c\u5df2\u6253\u8fc7\s*(\d+)\s*\u5904.*?\u6f02\u79fb\s*(\d+)\s*\u5904\uff0c\u5931\u8d25\s*(\d+)\s*\u5904')
  if (-not $m.Success) { return @{ ok = $false; raw = $out } }
  return @{
    ok = $true
    changed = [int]$m.Groups[1].Value
    patched = [int]$m.Groups[2].Value
    drift   = [int]$m.Groups[3].Value
    failed  = [int]$m.Groups[4].Value
    raw     = $out
  }
}

$state = Invoke-Check
if (-not $state.ok) {
  Write-Log ('check output not parsed: ' + (($state.raw -split "`n" | Select-Object -Last 3) -join ' / '))
  exit 0
}

$need = ($state.changed -gt 0) -or ($state.drift -gt 0) -or ($state.failed -gt 0) -or ($state.patched -lt 100)
if (-not $need) {
  Write-Log ('healthy: patched={0} drift={1} failed={2} changed={3} - nothing to do' -f $state.patched, $state.drift, $state.failed, $state.changed)
  exit 0
}

Write-Log ('patch lost or drifted: patched={0} drift={1} failed={2} changed={3} - re-applying' -f $state.patched, $state.drift, $state.failed, $state.changed)
$apply = & $node 'patch-fish-soul.mjs' 2>&1 | Out-String
Write-Log ('apply: ' + ((($apply -split "`r?`n") | Where-Object { $_ -match '\u7ed3\u679c' }) -join ' | '))

$after = Invoke-Check
if (-not $after.ok) { Write-Log 'after-check output not parsed'; exit 0 }
Write-Log ('after: patched={0} drift={1} failed={2} changed={3}' -f $after.patched, $after.drift, $after.failed, $after.changed)
if ($after.drift -gt 0 -or $after.failed -gt 0) {
  Write-Log 'WARN: drift/failure left - anchors need updating against the new upstream build'
} elseif ($after.changed -eq 0 -and $after.patched -ge 100) {
  Write-Log 'patched files restored after DSH install; restart DSH once for the plugin to load them'
}
