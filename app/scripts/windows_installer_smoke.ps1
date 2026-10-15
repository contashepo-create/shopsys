param([switch]$FromPublished23)
# NSIS حقيقي على runner معزول: نفس الحزمة، أو v23 المنشور إلى المرشح. ليس فحص قناة HTTP.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'CI Windows runner only — never run against the owner installation' }
$install = Join-Path $env:RUNNER_TEMP 'Tahakom native smoke\previous install'
$ud = Join-Path $env:APPDATA $(if ($FromPublished23) { 'app' } else { 'Tahakom' })
if (Test-Path $ud) { throw "Expected an isolated fresh runner; will not touch existing userdata: $ud" }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = (Resolve-Path "release/tahakom-setup-$version.exe").Path
$candidateInstaller = $installer
if ($FromPublished23) { $installer = (Resolve-Path 'release-previous/tahakom-setup-1.0.23.exe').Path }
$electron = (Resolve-Path 'node_modules/electron/dist/electron.exe').Path
$probe = (Resolve-Path 'scripts/windows_installer_db_probe.cjs').Path
$exe = Join-Path $install 'Tahakom.exe'
$ready = Join-Path $ud 'last-run.json'
$results = Join-Path $env:RUNNER_TEMP $(if ($FromPublished23) { 'previous-release-upgrade.json' } else { 'native-smoke-results.json' })

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
  if ($launchManually) {
    if ($FromPublished23) {
      # fixture فقط: لا تسمح لفحص التحديث الخلفي للنسخة القديمة أن يثبت إصداراً
      # مختلفاً وسط الاختبار. تنزيل القناة العامة مفحوص بشكل مستقل بHTTP حقيقي.
      "provider: generic`nurl: http://127.0.0.1:9`nupdaterCacheDirName: ci-disabled-update" | Set-Content (Join-Path $install 'resources/app-update.yml') -Encoding utf8
    }
    $script:lastLaunch = Start-Process $exe -PassThru -RedirectStandardError (Join-Path $env:RUNNER_TEMP 'native-app-stderr.log') -RedirectStandardOutput (Join-Path $env:RUNNER_TEMP 'native-app-stdout.log')
  }
  $expectedVersion = $(if ($FromPublished23 -and $installer -ne $candidateInstaller) { '1.0.23' } else { $version })
  Wait-Until 'installed application startup with expected version/profile' {
    try { (Test-Path $ready) -and (Get-Content $ready -Raw | ConvertFrom-Json).version -eq $expectedVersion -and (App-Processes).Count -gt 0 } catch { $false }
  }
}
function Run-Probe($mode, $file, $destination = $null) {
  Write-Output "::notice title=Native database stage::Probe $mode : $file"
  $out = Join-Path $env:RUNNER_TEMP "db-probe-$mode.json"
  Remove-Item $out -ErrorAction SilentlyContinue
  # ArgumentList is joined by PowerShell; quote filesystem arguments explicitly.
  $args = @("`"$probe`"", $mode, "`"$ud`"", "`"$file`"", "`"$out`"")
  if ($destination) { $args += "`"$destination`"" }
  $p = Start-Process -FilePath $electron -ArgumentList $args -PassThru
  if (-not $p.WaitForExit(60000)) { throw 'Electron database probe hung' }
  if (-not (Test-Path $out)) { throw 'Electron probe produced no result' }
  $result = Get-Content $out -Raw | ConvertFrom-Json
  if ($p.ExitCode -ne 0 -or -not $result.ok) { throw "Database probe failed: mode=$mode file=$file error=$($result.error)" }
}
$script:installerProcesses = @()
try {
  # التثبيت الأول ليس تحديثاً: اعزل إنهاء المثبت عن بدء التطبيق يدوياً.
  Run-Installer -arguments @('/S', '/currentuser', "/D=$install") -launchManually $true
  Stop-App-Gracefully
  if ($FromPublished23 -and -not (Get-Item $exe).VersionInfo.ProductVersion.StartsWith('1.0.23')) { throw 'The old binary was not published v1.0.23' }
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
  if (-not $FromPublished23 -and (-not $safePath -or $safePath.StartsWith($install, [StringComparison]::OrdinalIgnoreCase))) { throw 'Database was not protected outside installation' }
  Run-Probe 'verify' $safePath
  if ($FromPublished23) {
    if ($safePath -ne $unsafeDb) { throw 'Published v23 did not use the requested owner installation database' }
    $backupDir = Join-Path $env:USERPROFILE 'Documents/Tahakom-Backups/manual'
    New-Item -Path $backupDir -ItemType Directory -Force | Out-Null
    $backup = Join-Path $backupDir 'owner-first-upgrade.db'
    # اترك القاعدة الافتراضية القديمة أقدم عمداً؛ الاسترداد يجب أن يحفظ آخر عمل.
    Run-Probe 'advance' $unsafeDb
    Run-Probe 'verify-latest' $unsafeDb
    Run-Probe 'copy-latest' $unsafeDb $backup
    Run-Probe 'verify-latest' $backup
    $installer = $candidateInstaller
  }
  $marker = Join-Path $install 'old-installation-marker.txt'
  Set-Content $marker 'must be removed by actual NSIS update'
  # last-run دليل هوية حقيقي للنسخة القديمة؛ لا نحذفه من fixture أول انتقال.
  if (-not $FromPublished23) { Remove-Item $ready }
  if ($FromPublished23) {
    # أول انتقال من EXE لا يعرف الحماية: تثبيت فعلي من القديم إلى المرشح، ثم
    # فتحه يدوياً بوجهة fixture غير متصلة. --force-run مفحوص في job مستقل.
    Run-Installer -arguments @('/S', '--updated', "/D=$install") -launchManually $true
  } else {
    Run-Installer -arguments @('/S', '--updated', '--force-run', "/D=$install")
  }
  Stop-App-Gracefully
  if (Test-Path $marker) { throw 'NSIS did not replace the old installation tree' }
  if (Test-Path $unsafeDb) { throw 'Old unsafe database unexpectedly survived installation removal' }
  $afterPath = (Get-Content (Join-Path $ud 'db-location.json') -Raw | ConvertFrom-Json).customDbPath
  if ($FromPublished23) {
    if (-not $afterPath -or $afterPath.StartsWith($install, [StringComparison]::OrdinalIgnoreCase)) { throw 'First upgrade did not recover the owner backup outside installation' }
    if (Test-Path (Join-Path $env:APPDATA 'Tahakom/device.key.enc')) { throw 'First upgrade created a new profile/key instead of using v23 actual profile' }
    if ((Get-Content $ready -Raw | ConvertFrom-Json).version -ne $version) { throw 'Candidate application did not start on the original profile' }
  } elseif ($afterPath -ne $safePath) { throw 'Existing safe database pointer changed during update' }
  if ((Get-FileHash $key -Algorithm SHA256).Hash -ne $keyHash) { throw 'Device encryption key changed during update' }
  Run-Probe $(if ($FromPublished23) { 'verify-latest' } else { 'verify' }) $afterPath
  @{ ok = $true; version = $version; installation = $install; database = $afterPath; nativeNSIS = $true; samePackageReinstall = (-not $FromPublished23); oldBinaryExecuted = [bool]$FromPublished23; fromVersion = $(if ($FromPublished23) { '1.0.23' } else { $version }); actualProfile = $ud; feedDownloadTested = $false } | ConvertTo-Json | Set-Content $results
  Write-Host "PASS: actual NSIS, oldBinaryExecuted=$FromPublished23, same profile and legacy enc:v1 snapshot key/data preserved; forced restart tested only in same-package mode."
} catch {
  foreach ($profile in @('app', 'Tahakom')) {
    $log = Join-Path $env:APPDATA "$profile/main.log"
    if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '\[(boot|db|db-recovery|device-key-fatal)\]' } | Select-Object -Last 6 | ForEach-Object { Write-Output "::notice title=Profile ${profile}::$($_.Replace('%', '%25'))" } }
  }
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content $results
  if (Test-Path (Join-Path $ud 'main.log')) {
    Get-Content (Join-Path $ud 'main.log') -Tail 100
    Get-Content (Join-Path $ud 'main.log') | Where-Object { $_ -match '\[(db|boot|db-protection|db-recovery|device-key-fatal)\]' } | Select-Object -Last 10 | ForEach-Object {
      Write-Output "::notice title=Native runtime log::$($_.Replace('%', '%25'))"
    }
  }
  $diagnostics = @('installedVersion=' + (Get-Item $exe).VersionInfo.ProductVersion)
  foreach ($stream in @('stderr', 'stdout')) {
    $streamFile = Join-Path $env:RUNNER_TEMP "native-app-$stream.log"
    if (Test-Path $streamFile) { $diagnostics += (Get-Content $streamFile -Tail 12) }
  }
  foreach ($name in @('app', 'Tahakom')) {
    $root = Join-Path $env:APPDATA $name
    if (Test-Path (Join-Path $root 'db-location.json')) { $diagnostics += "$name pointer=" + (Get-Content (Join-Path $root 'db-location.json') -Raw) }
    if (Test-Path (Join-Path $root 'main.log')) { $diagnostics += (Get-Content (Join-Path $root 'main.log') | Where-Object { $_ -match '\[(db|db-recovery|db-protection|boot-fatal|fatal)\]' } | Select-Object -Last 5) }
  }
  throw ($_.Exception.Message + '; fixture diagnostics: ' + ($diagnostics -join ' | '))
} finally {
  # Cleanup applies only to processes at the isolated fixture installation path.
  foreach ($p in $script:installerProcesses) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
  App-Processes | Stop-Process -Force -ErrorAction SilentlyContinue
}
