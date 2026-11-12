#requires -Version 5
# wechat-stack-watchdog.ps1 - keeps the WeChat side of the fish-soul link alive.
#
# What it guards (all on 127.0.0.1):
#   * 11229  reverse OneBot server of the WeChat bridge   (social-bridge.js)
#   * 11234  fish-soul outbound listener             (social-bridge.js, in-process)
# It never starts WeChatAgent itself. It only acts once the app is up (adapter port
# listening) and DSH is up (plugin port listening), because the bridge is useless and
# pointless to run before that.
#
# Two failure modes it is built around:
#   1. A WechatAgent update overwrites social-bridge.js with the stock file. The bridge
#      still starts and still binds 11229, but the fish-soul wiring is gone: no inbound
#      forward to DSH 11233 and no outbound listener on 11234. So every 5 minutes, and on
#      every (re)start, scripts\ensure-fish-soul-link.mjs re-applies the wiring; if it had
#      to patch, the bridge is cycled so the new code is actually loaded.
#   2. The bridge dies (wrong node build without node:sqlite, crash, port stolen). Ports go
#      dead silently. The loop restarts it through the hidden VBS launcher, which resolves
#      a node that can really require() node:sqlite.
#
# The runtime.json record for "bridge" is rewritten after each start so manage.ps1 still
# recognises (and can stop) a bridge that this watchdog owns.
#
# Design rules borrowed from fish-stack-watchdog.ps1: resident loop + named mutex, hidden
# spawn through wscript, log on transitions only.

$ErrorActionPreference = 'Continue'

$dshDir = 'C:\Users\Administrator\.dsh'
$log = Join-Path $dshDir 'wechat-stack-watchdog.log'
$stateFile = Join-Path $dshDir 'wechat-stack-watchdog.state.json'
$launcherVbs = Join-Path $dshDir 'wechat-bridge-start.vbs'

$WA = 'E:\ruanjian\WeChatAgent'
$work = Join-Path $WA 'data\workspace'
$stateDir = Join-Path $work 'state'
$runtimeJson = Join-Path $stateDir 'runtime.json'
$bridgeEntry = Join-Path $work 'components\qq-bridge\src\social-bridge.js'
$guardScript = Join-Path $work 'scripts\ensure-fish-soul-link.mjs'
$configFile = Join-Path $work 'config\wechatagent.json'

$ADAPTER_PORT = 8766
$ONEBOT_PORT = 11229
$OUTBOUND_PORT = 11234
$DSH_PORT = 11230

function Write-Log([string]$msg) {
  try {
    Add-Content -Path $log -Value ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding UTF8
    $fi = Get-Item $log -ErrorAction SilentlyContinue
    if ($fi -and $fi.Length -gt 2MB) { Get-Content $log -Tail 500 | Set-Content $log -Encoding UTF8 }
  } catch { }
}

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

# Spawn through wscript: no console window, and nothing pinned to this process tree.
function Start-Hidden([string]$vbsPath) {
  try {
    if (-not (Test-Path $vbsPath)) { Write-Log ('launcher missing: ' + $vbsPath); return 0 }
    $cmd = 'C:\Windows\System32\wscript.exe //B //Nologo "' + $vbsPath + '"'
    $r = ([wmiclass]'\\.\root\cimv2:Win32_Process').Create($cmd, $dshDir)
    if ($r.ReturnValue -ne 0) { Write-Log ('spawn failed rc=' + $r.ReturnValue) }
    return [int]$r.ProcessId
  } catch {
    Write-Log ('spawn error: ' + $_.Exception.Message)
    return 0
  }
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

# Kill only really-dead bridge processes: this is called exclusively while 11229 has no
# listener, so nothing that is serving the adapter can be hit.
function Remove-StaleBridge {
  $killed = 0
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'social-bridge\.js' } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $killed++ } catch { }
    }
  if ($killed -gt 0) { Write-Log ('reaped ' + $killed + ' bridge process(es) with no listener') }
  return $killed
}

# Keep manage.ps1 able to stop/manage this bridge: same record shape it writes itself.
function Update-BridgeRecord {
  try {
    $owners = @(Get-NetTCPConnection -LocalPort $ONEBOT_PORT -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique)
    if (-not $owners.Count) { return }
    $pidOwned = [int]$owners[0]
    $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $pidOwned) -ErrorAction SilentlyContinue
    if (-not $proc) { return }
    $record = @{}
    if (Test-Path -LiteralPath $runtimeJson) {
      $loaded = Get-Content -LiteralPath $runtimeJson -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($prop in $loaded.PSObject.Properties) { $record[$prop.Name] = $prop.Value }
    }
    $record['bridge'] = @{ pid = $pidOwned; exe = $proc.ExecutablePath; marker = $bridgeEntry }
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $runtimeJson -Encoding UTF8
  } catch {
    Write-Log ('runtime.json update failed: ' + $_.Exception.Message)
  }
}

# Returns the guard script's verdict: OK / PATCHED:.. / NEEDS_MANUAL:.. / SKIP
function Invoke-LinkGuard {
  if (-not (Test-Path -LiteralPath $guardScript)) { return 'SKIP' }
  $node = Get-SqliteNode
  if (-not $node) { return 'NO_NODE' }
  try {
    $out = & $node $guardScript $bridgeEntry 2>&1
    return ((@($out) -join ' ').Trim())
  } catch {
    return ('ERROR:' + $_.Exception.Message)
  }
}

# --------------------------------------------------------------- config ports
try {
  if (Test-Path -LiteralPath $configFile) {
    $cfg = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.ports.adapter) { $ADAPTER_PORT = [int]$cfg.ports.adapter }
    if ($cfg.ports.onebot) { $ONEBOT_PORT = [int]$cfg.ports.onebot }
    if ($cfg.ports.dshPlugin) { $DSH_PORT = [int]$cfg.ports.dshPlugin }
  }
  $bridgeCfg = Join-Path $stateDir 'bridge-config.json'
  if (Test-Path -LiteralPath $bridgeCfg) {
    $bc = Get-Content -LiteralPath $bridgeCfg -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($bc.fishSoul -and $bc.fishSoul.outboundPort) { $OUTBOUND_PORT = [int]$bc.fishSoul.outboundPort }
  }
} catch { }

# ------------------------------------------------------------------- state
$state = @{
  adapterMissing = $false
  dshMissing = $false
  bridgeUp = $null
  bridgeFails = 0
  lastBridgeStart = ''
  lastLinkCheck = ''
  hostGoneSince = ''
}
try {
  if (Test-Path $stateFile) {
    $loaded = Get-Content $stateFile -Raw | ConvertFrom-Json
    foreach ($prop in $loaded.PSObject.Properties) {
      if ($state.ContainsKey($prop.Name)) { $state[$prop.Name] = $prop.Value }
    }
  }
} catch { }
function Save-State { try { $state | ConvertTo-Json | Set-Content $stateFile -Encoding UTF8 } catch { } }

function Test-Due([string]$stamp, [int]$minutes) {
  if (-not $stamp) { return $true }
  try { return ((Get-Date).ToUniversalTime() - [datetime]::Parse($stamp, $null, 'RoundtripKind')).TotalMinutes -ge $minutes } catch { return $true }
}

# ---------------------------------------------------------------- single instance
$mutex = $null
$owned = $false
try { $mutex = New-Object System.Threading.Mutex($true, 'Global\dsh-wechat-stack-watchdog', [ref]$owned) } catch { $owned = $true }
if (-not $owned) { exit 0 }

Write-Log ('wechat watchdog loop started (adapter=' + $ADAPTER_PORT + ' onebot=' + $ONEBOT_PORT + ' outbound=' + $OUTBOUND_PORT + ' dsh=' + $DSH_PORT + ')')

while ($true) {
  try {
    # --------------------------------------------------------- host presence gate
    # No logon autostart any more: this loop is launched by the DSH boot hook
    # (boot-hooks.mjs -> app-triggered-boot.ps1). Once DSH is gone for the grace
    # period the bridge has no peer, so the loop stands down instead of idling all
    # day. WeChatAgent being closed is NOT a reason to leave - the loop parks itself
    # and picks the adapter back up whenever the app returns.
    if ($null -ne (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
      if ($state.hostGoneSince) {
        $state.hostGoneSince = ''
        Save-State
        Write-Log 'DSH is running again - wechat watchdog stays resident'
      }
    } elseif (-not $state.hostGoneSince) {
      $state.hostGoneSince = (Get-Date).ToUniversalTime().ToString('o')
      Save-State
      Write-Log 'DSH is not running - wechat watchdog stands down in 5 minute(s) unless it comes back'
    } else {
      $goneMinutes = 0
      try { $goneMinutes = ((Get-Date).ToUniversalTime() - [datetime]::Parse($state.hostGoneSince, $null, 'RoundtripKind')).TotalMinutes } catch { $state.hostGoneSince = (Get-Date).ToUniversalTime().ToString('o'); Save-State }
      if ($goneMinutes -ge 5) {
        Write-Log ('DSH gone for ' + [int]$goneMinutes + ' min - stopping the wechat watchdog')
        $null = Remove-StaleBridge
        $state.hostGoneSince = ''
        Save-State
        try { $mutex.ReleaseMutex() } catch { }
        try { $mutex.Dispose() } catch { }
        exit 0
      }
    }

    $adapterUp = Test-Port $ADAPTER_PORT

    # No app, no bridge: WeChatAgent owns the adapter, and without it the bridge has
    # nothing to talk to. Never fight the user for WeChat.
    if (-not $adapterUp) {
      if (-not $state.adapterMissing) {
        Write-Log ('WeChatAgent adapter ' + $ADAPTER_PORT + ' is down - bridge stays parked until the app starts')
        $state.adapterMissing = $true
        $state.bridgeUp = $false
        $state.bridgeFails = 0
        Save-State
      }
      Start-Sleep -Seconds 20
      continue
    }
    if ($state.adapterMissing) {
      Write-Log ('WeChatAgent adapter ' + $ADAPTER_PORT + ' is up again')
      $state.adapterMissing = $false
      Save-State
    }

    if (-not (Test-Port $DSH_PORT)) {
      if (-not $state.dshMissing) {
        Write-Log ('DSH plugin port ' + $DSH_PORT + ' is down - not restarting the bridge until DSH is up')
        $state.dshMissing = $true
        Save-State
      }
      Start-Sleep -Seconds 20
      continue
    }
    if ($state.dshMissing) {
      Write-Log ('DSH plugin port ' + $DSH_PORT + ' is up again')
      $state.dshMissing = $false
      Save-State
    }

    $onebotUp = Test-Port $ONEBOT_PORT
    $outboundUp = Test-Port $OUTBOUND_PORT

    if ($onebotUp -and $outboundUp) {
      if ($state.bridgeUp -ne $true) {
        $state.bridgeUp = $true
        $state.bridgeFails = 0
        Save-State
        Write-Log ('bridge healthy: ' + $ONEBOT_PORT + ' + ' + $OUTBOUND_PORT + ' listening')
        Update-BridgeRecord
      }

      # Wiring audit: ports can listen while the fish-soul wiring has been overwritten.
      if (Test-Due $state.lastLinkCheck 5) {
        $verdict = Invoke-LinkGuard
        $state.lastLinkCheck = (Get-Date).ToUniversalTime().ToString('o')
        Save-State
        if ($verdict -like 'PATCHED*') {
          Write-Log ('fish-soul wiring was missing and has been re-applied (' + $verdict + ') - cycling bridge to load it')
          $null = Remove-StaleBridge
          Start-Sleep -Milliseconds 700
          $null = Start-Hidden $launcherVbs
          $state.lastBridgeStart = (Get-Date).ToUniversalTime().ToString('o')
          $state.bridgeUp = $false
          Save-State
        } elseif ($verdict -like 'NEEDS_MANUAL*' -or $verdict -like 'ERROR*' -or $verdict -eq 'NO_NODE') {
          Write-Log ('fish-soul wiring needs manual attention: ' + $verdict)
        }
      }
      Start-Sleep -Seconds 20
      continue
    }

    # ------------------------------------------------------------- restart path
    $now = (Get-Date).ToUniversalTime()
    $justStarted = $false
    if ($state.lastBridgeStart) {
      try { $justStarted = ($now - [datetime]::Parse($state.lastBridgeStart, $null, 'RoundtripKind')).TotalSeconds -lt 60 } catch { $justStarted = $false }
    }
    if ($justStarted) { Start-Sleep -Seconds 20; continue }

    if (-not $onebotUp) {
      Write-Log ('bridge not serving (onebot=' + $onebotUp + ' outbound=' + $outboundUp + ') - starting it')
      $null = Remove-StaleBridge
      Start-Sleep -Milliseconds 700
    } else {
      Write-Log ('bridge missing its outbound listener ' + $OUTBOUND_PORT + ' - cycling it')
      $null = Remove-StaleBridge
      Start-Sleep -Milliseconds 700
    }

    $state.lastBridgeStart = $now.ToString('o')
    $state.bridgeUp = $false
    Save-State
    $null = Start-Hidden $launcherVbs

    $bound = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      if ((Test-Port $ONEBOT_PORT) -and (Test-Port $OUTBOUND_PORT)) { $bound = $true; break }
    }
    if ($bound) {
      $state.bridgeUp = $true
      $state.bridgeFails = 0
      Save-State
      Update-BridgeRecord
      Write-Log ('bridge started: ' + $ONEBOT_PORT + ' + ' + $OUTBOUND_PORT + ' listening')
    } else {
      $state.bridgeFails = [int]$state.bridgeFails + 1
      Save-State
      Write-Log ('bridge FAILED to bind (fails=' + $state.bridgeFails + ') - see state\logs\bridge.stderr.log')
      $null = Remove-StaleBridge
    }
  } catch {
    Write-Log ('tick error: ' + $_.Exception.Message)
  }
  Start-Sleep -Seconds 20
}


