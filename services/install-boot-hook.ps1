# install-boot-hook.ps1
# Idempotent repair for the "start these services only after DSH starts" hook.
#
# DSH rewrites its profile (package.json / pnpm-lock.yaml / cordis.patch.yml) on updates
# and on WeChatAgent startup, so the hook registration can silently disappear. Re-running
# this script puts back everything the hook needs. It touches nothing else, and it is
# safe to run any number of times - DSH does not need to be closed.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Administrator\.dsh\install-boot-hook.ps1
$ErrorActionPreference = 'Stop'

$root    = 'C:\Users\Administrator\.dsh'
$pkgDir  = Join-Path $root 'boot-hooks'
$profile = Join-Path $root 'profiles\desktop'
$pkgJson = Join-Path $profile 'package.json'
$lockYml = Join-Path $profile 'pnpm-lock.yaml'
$nmLink  = Join-Path $profile 'node_modules\dsh-boot-hooks'
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'

function Say([string]$m) { Write-Host $m }

# 1. the plugin package itself -------------------------------------------------
if (-not (Test-Path (Join-Path $pkgDir 'boot-hooks.mjs'))) { throw "missing plugin: $pkgDir\boot-hooks.mjs" }
if (-not (Test-Path (Join-Path $pkgDir 'package.json')))  { throw "missing plugin manifest: $pkgDir\package.json" }
Say ('[ok] plugin package present: ' + $pkgDir)

# 2. node_modules junction -----------------------------------------------------
$needLink = $true
if (Test-Path $nmLink) {
  $item = Get-Item $nmLink -Force
  if ($item.LinkType -eq 'Junction' -and ($item.Target -contains $pkgDir)) { $needLink = $false; Say '[ok] node_modules junction already points at the plugin' }
  else { Remove-Item $nmLink -Recurse -Force; Say '[fix] removed stale node_modules\dsh-boot-hooks' }
}
if ($needLink) {
  $null = cmd /c mklink /J "$nmLink" "$pkgDir" 2>&1
  Say '[fix] recreated node_modules junction'
}

# 3. profile package.json: dependency + bundle entry ---------------------------
Copy-Item $pkgJson ($pkgJson + '.bak-boothook-' + $stamp) -Force
$json = Get-Content $pkgJson -Raw -Encoding UTF8 | ConvertFrom-Json
$changed = $false
if ($json.dependencies.PSObject.Properties.Name -notcontains 'dsh-boot-hooks') {
  $json.dependencies | Add-Member -MemberType NoteProperty -Name 'dsh-boot-hooks' -Value 'link:C:/Users/Administrator/.dsh/boot-hooks'
  $changed = $true
  Say '[fix] added dsh-boot-hooks to dependencies'
}
$bundles = @($json.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-boot-hooks') {
  $json.dsh.profile.bundles = @($bundles + 'dsh-boot-hooks')
  $changed = $true
  Say '[fix] added dsh-boot-hooks to dsh.profile.bundles'
}
if ($changed) {
  ($json | ConvertTo-Json -Depth 32) | Set-Content $pkgJson -Encoding UTF8
  Say '[ok] profile package.json rewritten'
} else {
  Say '[ok] profile package.json already registers the hook'
}

# 4. pnpm-lock.yaml importer entry --------------------------------------------
$lockText = Get-Content $lockYml -Raw -Encoding UTF8
if ($lockText -notmatch 'dsh-boot-hooks:') {
  Copy-Item $lockYml ($lockYml + '.bak-boothook-' + $stamp) -Force
  $entry = @"
      dsh-boot-hooks:
        specifier: link:C:/Users/Administrator/.dsh/boot-hooks
        version: link:C:/Users/Administrator/.dsh/boot-hooks
"@
  # insert right before the first existing "      <name>:" dependency block
  $lockText = [regex]::Replace($lockText, "(?m)^(      [A-Za-z@][^:\r\n]*:\r?\n        specifier:)", ($entry + "`r`n" + '$1'), 1)
  Set-Content $lockYml -Value $lockText -Encoding UTF8 -NoNewline
  Say '[fix] added dsh-boot-hooks to pnpm-lock.yaml'
} else {
  Say '[ok] pnpm-lock.yaml already has the entry'
}

Say 'done. If DSH is running, restart it once so the hook is loaded.'
