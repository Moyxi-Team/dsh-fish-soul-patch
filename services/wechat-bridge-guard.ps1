# wechat-bridge-guard.ps1 - one-shot repair: make sure whale web (8787) and the
# python outbound bridge (8899) are listening again. Order: WhaleLauncher.exe ->
# node server.js -> python bridge\__main__.py. Spawned by fish-stack-watchdog when a
# port is found dead; exits as soon as the check/repair pass finishes (no resident
# loop, so there is no "guard the guard" recursion).
$ErrorActionPreference = 'Continue'

$WG_ROOT  = 'E:\ruanjian\WhaleGirl'
$LAUNCHER = Join-Path $WG_ROOT 'WhaleLauncher.exe'
$PY_BIN   = Join-Path $WG_ROOT 'runtime\python\python.exe'
$NODE_BIN = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $NODE_BIN)) { $NODE_BIN = Join-Path $WG_ROOT 'runtime\node\node.exe' }
$log      = 'C:\Users\Administrator\.dsh\wechat-bridge-guard.log'

function Write-Log([string]$msg) {
  try {
    $line = ('[{0}] {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $msg)
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    if ((Get-Item -LiteralPath $log).Length -gt 2MB) {
      $tail = Get-Content -LiteralPath $log -Tail 500
      Set-Content -LiteralPath $log -Value $tail -Encoding UTF8
    }
  } catch { }
}

function Test-Port([int]$port, [int]$timeoutMs = 400) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs, $false)) { return $false }
    $c.EndConnect($iar)
    return $true
  } catch { return $false } finally { try { $c.Close() } catch { } }
}

function Wait-Port([int]$port, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return (Test-Port $port)
}

$mutex = $null
try {
  $created = $false
  $mutex = New-Object System.Threading.Mutex($true, 'Global\dsh-wechat-bridge-guard', [ref]$created)
  if (-not $created) { exit 0 }
} catch { }

try {
  if (-not (Test-Path $WG_ROOT)) { Write-Log "WhaleGirl folder missing: $WG_ROOT"; exit 1 }

  # --- 8787 : whale web service ---
  if (-not (Test-Port 8787)) {
    $launcherUp = [bool](Get-Process -Name 'WhaleLauncher' -ErrorAction SilentlyContinue)
    if (-not $launcherUp -and (Test-Path $LAUNCHER)) {
      try {
        Start-Process -FilePath $LAUNCHER -WorkingDirectory $WG_ROOT -WindowStyle Hidden
        Write-Log '8787 dead: started WhaleLauncher.exe'
      } catch { Write-Log ("start WhaleLauncher failed: " + $_.Exception.Message) }
      $null = Wait-Port 8787 60
    }
    if (-not (Test-Port 8787)) {
      if (Test-Path $NODE_BIN) {
        try {
          Start-Process -FilePath $NODE_BIN -ArgumentList 'server.js', '--no-browser' -WorkingDirectory $WG_ROOT -WindowStyle Hidden
          Write-Log '8787 still dead: started node server.js'
        } catch { Write-Log ("start server.js failed: " + $_.Exception.Message) }
        $null = Wait-Port 8787 40
      } else {
        Write-Log "8787 still dead and node not found: $NODE_BIN"
      }
    }
    if (Test-Port 8787) { Write-Log '8787 back to listening' } else { Write-Log '8787 repair FAILED, manual action needed' }
  }

  # --- 8899 : python outbound bridge ---
  if (-not (Test-Port 8899)) {
    if (Test-Path $PY_BIN) {
      try {
        Start-Process -FilePath $PY_BIN -ArgumentList 'bridge\__main__.py' -WorkingDirectory $WG_ROOT -WindowStyle Hidden
        Write-Log '8899 dead: started python bridge'
      } catch { Write-Log ("start python bridge failed: " + $_.Exception.Message) }
      if (Wait-Port 8899 45) { Write-Log '8899 back to listening' } else { Write-Log '8899 repair FAILED, see bridge own log' }
    } else {
      Write-Log "8899 dead and python not found: $PY_BIN"
    }
  }
} catch {
  Write-Log ("guard error: " + $_.Exception.Message)
} finally {
  if ($mutex) {
    try { $mutex.ReleaseMutex() } catch { }
    try { $mutex.Dispose() } catch { }
  }
}
