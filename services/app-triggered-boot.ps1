# app-triggered-boot.ps1
# Brings the local fish-soul service stack up on demand - only after the user has
# actually started DSH (DeepSeek Harness). Nothing here runs at logon any more:
# the DSH profile plugin "dsh-boot-hooks" (C:\Users\Administrator\.dsh\boot-hooks)
# fires this script once per DSH launch.
#
# Stack this owns:
#   fish-stack-watchdog.ps1   -> voice-rotate-proxy 17890, SnowLuma 3001, douyin sink 8791
#   wechat-stack-watchdog.ps1 -> social bridge 11229 (onebot) / 11234 (outbound)
# Both watchdogs are resident loops with their own named mutex, so launching them
# repeatedly is harmless; they also exit by themselves once DSH is gone.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\Administrator\.dsh'
$log  = Join-Path $root 'app-triggered-boot.log'
$lock = Join-Path $root 'app-triggered-boot.lock'

function Write-Log([string]$msg) {
  try {
    Add-Content -Path $log -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding UTF8
    $fi = Get-Item $log
    if ($fi.Length -gt 1MB) { Get-Content $log -Tail 400 | Set-Content $log -Encoding UTF8 }
  } catch { }
}

# Debounce. Electron boots a whole process tree and every child can fire the hook,
# so ignore re-entrant calls for two minutes; the watchdogs re-check ports every few
# seconds anyway.
try {
  if (Test-Path $lock) {
    $age = ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalSeconds
    if ($age -lt 120) { exit 0 }
  }
  Set-Content -Path $lock -Value (Get-Date -Format o) -Encoding UTF8
} catch { }

function ProcRunning([string]$name) {
  return [bool](Get-Process -Name $name -ErrorAction SilentlyContinue)
}

function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(300)) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    try { $client.Close() } catch { }
  }
}

function Start-Hidden([string]$vbsPath) {
  if (-not (Test-Path $vbsPath)) { Write-Log ('launcher missing: ' + $vbsPath); return }
  try {
    $cmd = 'C:\Windows\System32\wscript.exe //B //Nologo "' + $vbsPath + '"'
    $r = ([wmiclass]'\\.\root\cimv2:Win32_Process').Create($cmd, $root)
    if ($r.ReturnValue -ne 0) { Write-Log ('spawn failed rc=' + $r.ReturnValue + ' vbs=' + $vbsPath) }
  } catch {
    Write-Log ('spawn error: ' + $_.Exception.Message)
  }
}

$dshUp = ProcRunning 'DeepSeek Harness'
$waUp  = ProcRunning 'WeChatAgent'
Write-Log ('trigger: DSH=' + $dshUp + ' WeChatAgent=' + $waUp)

if (-not $dshUp) {
  Write-Log 'DSH is not running - nothing to start (hook fired late or DSH already closed)'
  exit 0
}

Start-Hidden (Join-Path $root 'fish-stack-watchdog.vbs')
# This used to be the "DSH-QQ-Autostart" scheduled task, fired at logon. The behaviour is
# unchanged (bring QQ up, then SnowLuma), but it now only ever runs because DSH just
# started. Detached on purpose: it can sit for two minutes waiting for QQ to log in, and
# that must not delay the watchdogs below.
Start-Hidden (Join-Path $root 'qq-autostart\run-autostart-hidden.vbs')
if ($waUp) {
  Start-Hidden (Join-Path $root 'wechat-stack-watchdog.vbs')
} else {
  # Still start it: it parks itself until the WeChatAgent adapter shows up, which means
  # opening WeChat later needs no second trigger.
  Write-Log 'WeChatAgent not running yet - wechat watchdog starts parked'
  Start-Hidden (Join-Path $root 'wechat-stack-watchdog.vbs')
}

Start-Sleep -Seconds 8
Write-Log ('ports: voice17890={0} snow3001={1} sink8791={2} bridge11229={3} out11234={4} adapter8766={5} dsh11230={6}' -f `
  (Test-Port 17890), (Test-Port 3001), (Test-Port 8791), (Test-Port 11229), (Test-Port 11234), (Test-Port 8766), (Test-Port 11230))
