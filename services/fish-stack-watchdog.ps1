#requires -Version 5
# fish-stack-watchdog.ps1 — keeps the side-car services of dsh-fish-soul alive.
#
#   * voice-rotate-proxy.mjs on 127.0.0.1:17890  (TTS / STT gateway)  — always wanted
#   * SnowLuma index.mjs      on 127.0.0.1:3001  (QQ OneBot bridge)   — only while QQ.exe runs
#
# Design notes (learned the hard way):
#   * SnowLuma binds its OneBot HTTP/WS ports (3000/3001) ONLY after it has hooked a
#     logged-in QQ client. Started with QQ absent it binds just the WebUI (5099) and
#     never picks QQ up afterwards — that zombie then blocks the next real start.
#     So: 3001 down + QQ running  -> reap every SnowLuma copy, start one fresh;
#         3001 down + QQ absent   -> reap every SnowLuma copy and wait.
#   * This script is a RESIDENT 8-second loop, not a one-shot. Task Scheduler fires it
#     every minute with MultipleInstances=IgnoreNew; while the loop lives those ticks are
#     ignored, and the moment the loop dies the next tick resurrects it. A named mutex
#     covers the gap between the two mechanisms.
#   * Log lines are written on transitions only, so the file stays readable.

$ErrorActionPreference = 'Continue'
$log = 'C:\Users\Administrator\.dsh\fish-stack-watchdog.log'
$stateFile = 'C:\Users\Administrator\.dsh\fish-stack-watchdog.state.json'

$VOICE_PORT = 17890
$QQ_PORT = 3001
# Douyin webhook sink (formerly a Startup-folder autostart entry of its own).
$SINK_PORT = 8791
$SINK_VBS = 'C:\Users\Administrator\.dsh\start-douyin-sink.vbs'
$SINK_SCRIPT = 'C:\Users\Administrator\.dsh\douyin-duty\webhook-sink.mjs'
$HOST_GRACE_MINUTES = 5
$VOICE_NODE = 'C:\Program Files\nodejs\node.exe'
$VOICE_SCRIPT = 'C:\Users\Administrator\.dsh\voice-rotate-proxy.mjs'
$SNOW_NODE = 'C:\SnowLuma\node.exe'
$SNOW_DIR = 'C:\SnowLuma'
# Node that has node:sqlite (the DSH primary runtime), for the session-size guard.
$SCRIPT_NODE = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'

# Launch one of the side-car services with NO console window, and outside this script's
# own process tree.
#
# Two separate problems, both solved by going through a VBS launcher:
#   1. Visibility. A node process started by WMI's Win32_Process.Create inherits a real
#      console: it shows up with a MainWindowHandle and a taskbar entry titled
#      "C:\Program Files\nodejs\node.exe". wscript.exe is a GUI-subsystem binary, so it has
#      no console at all; the VBS then calls WScript.Shell.Run(cmd, 0, False) and node is
#      created with SW_HIDE — verified MainWindowHandle = 0.
#   2. Tree pinning. Task Scheduler keeps a task instance "running" until every descendant
#      exits; a resident node child pinned the instance forever and MultipleInstances=
#      IgnoreNew then silently skipped every later tick. wscript exits as soon as it has
#      spawned node, and WMI parentage (WmiPrvSE) is gone right after, so nothing is pinned.
#
# The two VBS files are hard-coded command lines, so no quoting gymnastics are involved:
#   C:\Users\Administrator\.dsh\start-voice-proxy.vbs
#   C:\Users\Administrator\.dsh\start-snowluma.vbs
function Start-Hidden([string]$vbsPath) {
  try {
    if (-not (Test-Path $vbsPath)) { Write-Log ("launcher missing: " + $vbsPath); return 0 }
    $cmd = 'C:\Windows\System32\wscript.exe //B //Nologo "' + $vbsPath + '"'
    $r = ([wmiclass]'\\.\root\cimv2:Win32_Process').Create($cmd, 'C:\Users\Administrator\.dsh')
    if ($r.ReturnValue -ne 0) { Write-Log ("spawn failed rc=" + $r.ReturnValue + " vbs=" + $vbsPath) }
    return [int]$r.ProcessId
  } catch {
    Write-Log ("spawn error: " + $_.Exception.Message)
    return 0
  }
}

function Write-Log([string]$msg) {
  try {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $log -Value $line -Encoding UTF8
    $fi = Get-Item $log
    if ($fi.Length -gt 2MB) { Get-Content $log -Tail 500 | Set-Content $log -Encoding UTF8 }
  } catch { }
}

# Cheap liveness probe: a 400 ms TCP connect is far cheaper than Get-NetTCPConnection.
function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    try { $client.Close() } catch { }
  }
}

# Kill every SnowLuma copy (the launcher and the child it spawns both carry "SnowLuma"
# in their command line). Only ever called while 3001 has no listener, so nothing that
# is actually serving OneBot can be hit.
function Remove-SnowLuma {
  $killed = 0
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'SnowLuma' } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        $killed++
      } catch { }
    }
  if ($killed -gt 0) { Write-Log ("reaped $killed stalled snowluma process(es)") }
  return $killed
}

# Voice-rotate proxy: a pure side-car for DSH, so it goes down together with the host.
function Remove-Voice {
  $killed = 0
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'voice-rotate-proxy\.mjs' } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        $killed++
      } catch { }
    }
  if ($killed -gt 0) { Write-Log ("stopped $killed voice proxy process(es)") }
  return $killed
}

# The douyin webhook sink is a bare node script with no lifecycle of its own, so this
# watchdog owns it: started while DSH runs, reaped when we stand down.
function Remove-Sink {
  $killed = 0
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'webhook-sink\.mjs' } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        $killed++
      } catch { }
    }
  if ($killed -gt 0) { Write-Log ("stopped $killed douyin sink process(es)") }
  return $killed
}

# A hashtable, not a PSCustomObject: ConvertFrom-Json hands back an object that rejects
# assignment to any property it did not already have ("在此对象上找不到属性…").
$state = @{ voiceUp = $null; snowUp = $null; sinkUp = $null; qqMissingLogged = $false; snowFails = 0; lastTokenRefresh = ''; lastSessionCheck = ''; hostGoneSince = '' }
try {
  if (Test-Path $stateFile) {
    $loaded = Get-Content $stateFile -Raw | ConvertFrom-Json
    foreach ($prop in $loaded.PSObject.Properties) {
      if ($state.ContainsKey($prop.Name)) { $state[$prop.Name] = $prop.Value }
    }
  }
} catch { }
function Save-State { try { $state | ConvertTo-Json | Set-Content $stateFile -Encoding UTF8 } catch { } }

# ---------------------------------------------------------------- single instance
$mutex = $null
$owned = $false
try {
  $mutex = New-Object System.Threading.Mutex($true, 'Global\dsh-fish-stack-watchdog', [ref]$owned)
} catch { $owned = $true }
if (-not $owned) { exit 0 }

Write-Log 'watchdog loop started'

# The loop below cannot throw its way out in normal operation, but if it ever does the
# handler spawns a fresh copy and exits. The mutex has to be released first, otherwise the
# replacement finds it held and quits on sight.
try {

while ($true) {
  try {
    # --------------------------------------------------------- host presence gate
    # This stack only exists to serve DSH. It is no longer started at logon: the DSH
    # boot hook (boot-hooks.mjs -> app-triggered-boot.ps1) launches it when DSH starts.
    # Symmetrically, once DSH has been gone for the grace period there is nothing left
    # to serve, so the loop stands down and takes the douyin sink with it - a closed
    # DSH leaves zero resident services behind.
    if ($null -ne (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
      if ($state.hostGoneSince) {
        $state.hostGoneSince = ''
        Save-State
        Write-Log 'DSH is running again - watchdog stays resident'
      }
    } elseif (-not $state.hostGoneSince) {
      $state.hostGoneSince = (Get-Date).ToUniversalTime().ToString('o')
      Save-State
      Write-Log ('DSH is not running - standing down in ' + $HOST_GRACE_MINUTES + ' minute(s) unless it comes back')
    } else {
      $goneMinutes = 0
      try { $goneMinutes = ((Get-Date).ToUniversalTime() - [datetime]::Parse($state.hostGoneSince, $null, 'RoundtripKind')).TotalMinutes } catch { $state.hostGoneSince = (Get-Date).ToUniversalTime().ToString('o'); Save-State }
      if ($goneMinutes -ge $HOST_GRACE_MINUTES) {
        Write-Log ('DSH gone for ' + [int]$goneMinutes + ' min - stopping the fish stack (voice proxy, snowluma, douyin sink)')
        $null = Remove-Sink
        $null = Remove-Voice
        $null = Remove-SnowLuma
        $state.hostGoneSince = ''
        $state.sinkUp = $false
        Save-State
        try { $mutex.ReleaseMutex() } catch { }
        try { $mutex.Dispose() } catch { }
        exit 0
      }
    }

    # ------------------------------------------------------------ voice proxy
    if (Test-Port $VOICE_PORT) {
      if ($state.voiceUp -ne $true) { $state.voiceUp = $true; Save-State }
    } elseif ((Test-Path $VOICE_NODE) -and (Test-Path $VOICE_SCRIPT)) {
      $state.voiceUp = $false
      $null = Start-Hidden 'C:\Users\Administrator\.dsh\start-voice-proxy.vbs'
      for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Port $VOICE_PORT) { break }
      }
      if (Test-Port $VOICE_PORT) { Write-Log "voice-proxy started on $VOICE_PORT"; $state.voiceUp = $true }
      else { Write-Log "voice-proxy FAILED to bind $VOICE_PORT" }
      Save-State
    } else {
      Write-Log "voice-proxy missing: node=$VOICE_NODE script=$VOICE_SCRIPT"
    }

    # ---------------------------------------------------------------- SnowLuma
    $qqPresent = $null -ne (Get-Process -Name 'QQ' -ErrorAction SilentlyContinue)
    if (Test-Port $QQ_PORT) {
      if ($state.snowUp -ne $true) { Write-Log "snowluma serving on $QQ_PORT"; $state.snowUp = $true }
      if ($state.snowFails -ne 0 -or $state.qqMissingLogged) { $state.snowFails = 0; $state.qqMissingLogged = $false; Save-State }
    } elseif (-not $qqPresent) {
      # Nothing to hook: park the bridge so it cannot squat on 5099 and block a real start.
      $null = Remove-SnowLuma
      if (-not $state.qqMissingLogged) {
        Write-Log "QQ client not running - snowluma parked (starts within ~10 s of QQ appearing)"
        $state.qqMissingLogged = $true
        $state.snowUp = $false
        Save-State
      }
    } elseif ((Test-Path $SNOW_NODE) -and (Test-Path (Join-Path $SNOW_DIR 'index.mjs'))) {
      $state.qqMissingLogged = $false
      $state.snowUp = $false
      $null = Remove-SnowLuma
      Start-Sleep -Milliseconds 800
      $null = Start-Hidden 'C:\Users\Administrator\.dsh\start-snowluma.vbs'
      $bound = $false
      for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Port $QQ_PORT) { $bound = $true; break }
      }
      if ($bound) {
        Write-Log "snowluma started on $QQ_PORT"
        $state.snowUp = $true
        $state.snowFails = 0
      } else {
        $state.snowFails = [int]$state.snowFails + 1
        Write-Log ("snowluma FAILED to bind $QQ_PORT (fails=" + $state.snowFails + ", QQ hook not ready?)")
        $null = Remove-SnowLuma
      }
      Save-State
    } else {
      Write-Log "snowluma missing: node=$SNOW_NODE dir=$SNOW_DIR"
    }

    # --------------------------------------------------- douyin webhook sink
    # Moved out of the Startup folder: same on-demand lifecycle as everything else here.
    if ((Test-Path $SINK_SCRIPT) -and (Test-Path $SINK_VBS)) {
      if (Test-Port $SINK_PORT) {
        if ($state.sinkUp -ne $true) { Write-Log "douyin sink serving on $SINK_PORT"; $state.sinkUp = $true; Save-State }
      } else {
        $state.sinkUp = $false
        $null = Start-Hidden $SINK_VBS
        for ($i = 0; $i -lt 16; $i++) {
          Start-Sleep -Milliseconds 500
          if (Test-Port $SINK_PORT) { break }
        }
        if (Test-Port $SINK_PORT) { Write-Log "douyin sink started on $SINK_PORT"; $state.sinkUp = $true }
        else { Write-Log "douyin sink FAILED to bind $SINK_PORT" }
        Save-State
      }
    }

    # ------------------------------------------- Copilot short-lived token refresh
    # Task Scheduler is unusable on this machine (360 self-protection denies task
    # creation with "拒绝访问", and it also removed the tasks that used to exist), so the
    # 50-minute refresh that used to be its own task lives here instead: a hidden
    # wscript run every 45 minutes. refresh-token-hidden.vbs itself waits for node and
    # appends to C:\Users\Administrator\.dsh\tools\refresh-token.log.
    $nowUtc = (Get-Date).ToUniversalTime()
    $lastRefresh = $state.lastTokenRefresh
    $due = $true
    if ($lastRefresh) {
      try { $due = ($nowUtc - [datetime]::Parse($lastRefresh, $null, 'RoundtripKind')).TotalMinutes -ge 45 } catch { $due = $true }
    }
    if ($due) {
      $refreshVbs = 'C:\Users\Administrator\.dsh\tools\refresh-token-hidden.vbs'
      if (Test-Path $refreshVbs) {
        $null = Start-Hidden $refreshVbs
        $state.lastTokenRefresh = $nowUtc.ToString('o')
        Save-State
        Write-Log 'copilot token refresh dispatched (45 min cadence)'
      }
    }

    # ------------------------------------------- session size guard
    # The DSH agent truncates history to a ~128K nominal window, but the copilot proxy
    # really only accepts 64000 prompt tokens — a big enough transcript makes the prompt
    # 150K and the turn dies with CONTEXT_WINDOW_EXCEEDED (fish stops replying). So every
    # few minutes, retire any active chat_session whose transcript has grown past ~600KB;
    # the next inbound message then opens a fresh, small session. soul.db memory survives,
    # so the fish still knows the person — only the raw transcript is dropped.
    $nowCheck = (Get-Date).ToUniversalTime()
    $lastCheck = $state.lastSessionCheck
    $checkDue = $true
    if ($lastCheck) {
      try { $checkDue = ($nowCheck - [datetime]::Parse($lastCheck, $null, 'RoundtripKind')).TotalMinutes -ge 5 } catch { $checkDue = $true }
    }
    if ($checkDue) {
      $watchScript = 'C:\Users\Administrator\.dsh\im\_session_watch.mjs'
      if ((Test-Path $watchScript) -and (Test-Path $SCRIPT_NODE)) {
        try {
          $out = & $SCRIPT_NODE $watchScript 2>&1
          foreach ($line in @($out)) { if ("$line" -match 'RETIRED') { Write-Log "$line" } }
        } catch { Write-Log ("session-watch error: " + $_.Exception.Message) }
        $state.lastSessionCheck = $nowCheck.ToString('o')
        Save-State
      }
    }
  } catch {
    Write-Log ("tick error: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds 8
}

} catch {
  Write-Log ("FATAL: " + $_.Exception.Message + " - handing over to a fresh copy")
  try { $mutex.ReleaseMutex() } catch { }
  try { $mutex.Dispose() } catch { }
  $null = Start-Hidden 'C:\Users\Administrator\.dsh\fish-stack-watchdog.vbs'
  exit 1
}



