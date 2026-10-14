# مثبت NSIS حقيقي على runner معزول. إعادة تثبيت نفس الحزمة بوضع --updated؛ ليس اختبار تنزيل قناة GitHub.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'CI Windows runner only — never run against the owner installation' }
$install = Join-Path $env:RUNNER_TEMP 'Tahakom native smoke\previous install'
$ud = Join-Path $env:APPDATA 'Tahakom'
if (Test-Path $ud) { throw "Expected an isolated fresh runner; will not touch existing userdata: $ud" }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = (Resolve-Path "release/tahakom-setup-$version.exe").Path
$electron = (Resolve-Path 'node_modules/electron/dist/electron.exe').Path
$probe = (Resolve-Path 'scripts/windows_installer_db_probe.cjs').Path
$exe = Join-Path $install 'Tahakom.exe'
$ready = Join-Path $ud 'last-run.json'
$results = Join-Path $env:RUNNER_TEMP 'native-smoke-results.json'

function Wait-Until($description, [scriptblock]$predicate, $seconds = 90) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $predicate) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Timeout: $description"
}
function App-Processes {
  @(Get-Process Tahakom -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
}
function Stop-App-Gracefully {
  $processes = App-Processes
  $closed = $false
  foreach ($p in $processes) { if ($p.CloseMainWindow()) { $closed = $true } }
  if (-not $closed) { throw 'Installed application did not expose a real window to close' }
  Wait-Until 'application flush/backup/exit' { (App-Processes).Count -eq 0 } 45
}
function Run-Installer([string[]]$arguments, [bool]$launchManually = $false) {
  Write-Output "::notice title=Native NSIS stage::Installer arguments: $($arguments -join ' ')"
  $p = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru
  $script:installerProcesses += $p
  if (-not $p.WaitForExit(180000)) {
    $command = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)").CommandLine
    $title = (Get-Process -Id $p.Id -ErrorAction SilentlyContinue).MainWindowTitle
    throw "NSIS installer hung; command=$command; window=$title; installed=$(Test-Path $exe); ready=$(Test-Path $ready); appProcesses=$((App-Processes).Count)"
  }
  if ($p.ExitCode -ne 0) { throw "NSIS exit code $($p.ExitCode)" }
  if ($launchManually) { Start-Process $exe }
  Wait-Until 'installed application forced restart' { (Test-Path $ready) -and (App-Processes).Count -gt 0 }
}
function Run-Probe($mode, $file) {
  Write-Output "::notice title=Native database stage::Probe $mode : $file"
  $out = Join-Path $env:RUNNER_TEMP "db-probe-$mode.json"
  Remove-Item $out -ErrorAction SilentlyContinue
  # ArgumentList is joined by PowerShell; quote filesystem arguments explicitly.
  $args = @("`"$probe`"", $mode, "`"$ud`"", "`"$file`"", "`"$out`"")
  $p = Start-Process -FilePath $electron -ArgumentList $args -PassThru
  if (-not $p.WaitForExit(60000)) { throw 'Electron database probe hung' }
  if (-not (Test-Path $out)) { throw 'Electron probe produced no result' }
  $result = Get-Content $out -Raw | ConvertFrom-Json
  if ($p.ExitCode -ne 0 -or -not $result.ok) { throw "Database probe failed: $($result.error)" }
}
$script:installerProcesses = @()
try {
  # التثبيت الأول ليس تحديثاً: اعزل إنهاء المثبت عن بدء التطبيق يدوياً.
  Run-Installer -arguments @('/S', '/currentuser', "/D=$install") -launchManually $true
  Stop-App-Gracefully
  $key = Join-Path $ud 'device.key.enc'
  $keyHash = (Get-FileHash $key -Algorithm SHA256).Hash
  $defaultDb = Join-Path $ud 'shopsys.db'
  Run-Probe 'seed' $defaultDb
  Run-Probe 'verify' $defaultDb
  # سيناريو المالك: قاعدة حقيقية داخل شجرة التثبيت، تُحمى عند الإقلاع قبل أي تحديث.
  $unsafeDb = Join-Path $install 'shopsys.db'
  Copy-Item $defaultDb $unsafeDb
  Run-Probe 'verify' $unsafeDb
  @{ customDbPath = $unsafeDb; secondaryBackupDir = $null; lastFileBackupAt = $null; customDbOpenedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content (Join-Path $ud 'db-location.json') -Encoding utf8
  Remove-Item $ready
  Start-Process $exe
  Wait-Until 'protected database startup' { (Test-Path $ready) -and (App-Processes).Count -gt 0 }
  Stop-App-Gracefully
  $safePath = (Get-Content (Join-Path $ud 'db-location.json') -Raw | ConvertFrom-Json).customDbPath
  if (-not $safePath -or $safePath.StartsWith($install, [StringComparison]::OrdinalIgnoreCase)) { throw 'Database was not protected outside installation' }
  Run-Probe 'verify' $safePath
  $marker = Join-Path $install 'old-installation-marker.txt'
  Set-Content $marker 'must be removed by actual NSIS update'
  Remove-Item $ready
  Run-Installer -arguments @('/S', '--updated', '--force-run', "/D=$install")
  Stop-App-Gracefully
  if (Test-Path $marker) { throw 'NSIS did not replace the old installation tree' }
  if (Test-Path $unsafeDb) { throw 'Old unsafe database unexpectedly survived installation removal' }
  $afterPath = (Get-Content (Join-Path $ud 'db-location.json') -Raw | ConvertFrom-Json).customDbPath
  if ($afterPath -ne $safePath) { throw 'Existing safe database pointer changed during update' }
  if ((Get-FileHash $key -Algorithm SHA256).Hash -ne $keyHash) { throw 'Device encryption key changed during update' }
  Run-Probe 'verify' $afterPath
  @{ ok = $true; version = $version; installation = $install; database = $afterPath; nativeNSIS = $true; samePackageReinstall = $true; feedDownloadTested = $false } | ConvertTo-Json | Set-Content $results
  Write-Host 'PASS: actual NSIS install/update-mode, same directory, forced restart, old-tree removal, encrypted SQLite/key preservation.'
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content $results
  if (Test-Path (Join-Path $ud 'main.log')) {
    Get-Content (Join-Path $ud 'main.log') -Tail 100
    Get-Content (Join-Path $ud 'main.log') | Where-Object { $_ -match '\[(db|boot|db-protection|db-recovery|device-key-fatal)\]' } | Select-Object -Last 10 | ForEach-Object {
      Write-Output "::notice title=Native runtime log::$($_.Replace('%', '%25'))"
    }
  }
  throw
} finally {
  # Cleanup applies only to processes at the isolated fixture installation path.
  foreach ($p in $script:installerProcesses) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
  App-Processes | Stop-Process -Force -ErrorAction SilentlyContinue
}
