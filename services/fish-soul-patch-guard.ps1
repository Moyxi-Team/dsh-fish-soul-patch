#Requires -Version 5.1
# fish-soul patch guard
# Runs every patch repo under ~/.dsh/patches in --check mode; if anything is missing,
# drifted or failed, re-apply the patches and re-check. Log goes to ~/.dsh/fish-soul-patch-guard.log.
#
# History: used to guard only dsh-fish-soul-patch. The meme-bridge repo
# (~/.dsh/patches/fish-soul-meme-bridge) was never checked here, so its drift went
# unnoticed until a manual --check. Now both repos are walked with their own
# "expected patched count" floor.

param([int]$DelaySeconds = 0)

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$root = 'C:\Users\Administrator\.dsh'
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

# repo -> how many patches a healthy tree should already have applied.
$repos = @(
  @{ dir = (Join-Path $root 'patches\dsh-fish-soul-patch');   minPatched = 100 },
  @{ dir = (Join-Path $root 'patches\fish-soul-meme-bridge'); minPatched = 30 }
)

$slept = $false

function Invoke-Check {
  param([string]$dir, [string]$patchScript)
  try {
    $out = & $node $patchScript '--check' 2>&1 | Out-String
  } catch {
    return @{ ok = $false; raw = $_.Exception.Message }
  }
  $m = [regex]::Match($out, '\u7ed3\u679c\uff1a\u6539\u4e86\s*(\d+)\s*\u5904\uff0c\u5df2\u6253\u8fc7\s*(\d+)\s*\u5904.*?\u6f02\u79fb\s*(\d+)\s*\u5904\uff0c\u5931\u8d25\s*(\d+)\s*\u5904')
  if (-not $m.Success) { return @{ ok = $false; raw = $out } }
  return @{
    ok      = $true
    changed = [int]$m.Groups[1].Value
    patched = [int]$m.Groups[2].Value
    drift   = [int]$m.Groups[3].Value
    failed  = [int]$m.Groups[4].Value
    raw     = $out
  }
}

foreach ($r in $repos) {
  $dir = [string]$r.dir
  $min = [int]$r.minPatched
  $label = Split-Path $dir -Leaf
  $script = Join-Path $dir 'patch-fish-soul.mjs'

  if (-not (Test-Path $script)) { Write-Log ($label + ': patch repo missing (' + $dir + ')'); continue }
  Set-Location $dir
  if (-not $slept -and $DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds; $slept = $true }

  $state = Invoke-Check -dir $dir -patchScript 'patch-fish-soul.mjs'
  if (-not $state.ok) {
    Write-Log ($label + ': check output not parsed: ' + (($state.raw -split "`n" | Select-Object -Last 3) -join ' / '))
    continue
  }

  $need = ($state.changed -gt 0) -or ($state.drift -gt 0) -or ($state.failed -gt 0) -or ($state.patched -lt $min)
  if (-not $need) {
    Write-Log ('{0}: healthy: patched={1} drift={2} failed={3} changed={4} - nothing to do' -f $label, $state.patched, $state.drift, $state.failed, $state.changed)
    continue
  }

  Write-Log ('{0}: patch lost or drifted: patched={1} drift={2} failed={3} changed={4} - re-applying' -f $label, $state.patched, $state.drift, $state.failed, $state.changed)
  $apply = & $node 'patch-fish-soul.mjs' 2>&1 | Out-String
  Write-Log ($label + ' apply: ' + ((($apply -split "`r?`n") | Where-Object { $_ -match '\u7ed3\u679c' }) -join ' | '))

  $after = Invoke-Check -dir $dir -patchScript 'patch-fish-soul.mjs'
  if (-not $after.ok) { Write-Log ($label + ': after-check output not parsed'); continue }
  Write-Log ('{0}: after: patched={1} drift={2} failed={3} changed={4}' -f $label, $after.patched, $after.drift, $after.failed, $after.changed)
  if ($after.drift -gt 0 -or $after.failed -gt 0) {
    Write-Log ($label + ': WARN: drift/failure left - anchors need updating against the new upstream build')
  } elseif ($after.changed -eq 0 -and $after.patched -ge $min) {
    Write-Log ($label + ': patched files restored after DSH install; restart DSH once for the plugin to load them')
  }
}

exit 0
