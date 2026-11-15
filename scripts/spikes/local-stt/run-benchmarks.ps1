# Phase 33 spike, maintainer tasks 4 and 5: the timed runs that make the laptop estimate (M2, M11), in the
# calibrated profiles, then out\summary.md.
#
# What it changes: it switches to "DeScribe laptop emulation", then to "… (throttled)", and back to the scheme that
# was active before when it ends, however it ends. It edits no scheme.
#
# The runs (each pinned to the profile's twelve logical processors by pinrun, CPU only):
#   Laptop:    a quick Cinebench R23 check against the calibration;
#              5 min, 1 h and 3 h with the words and speakers models in parallel (8 + 4 threads);
#              5 min and 1 h one after the other, at 6 and at 12 threads;
#              1 h in parallel while `busy` keeps 2 of the 12 processors busy (M11);
#   Throttled: 1 h in parallel.
# At the work laptop's estimated speed this takes about an hour and a half. Leave the PC alone meanwhile.
#
# -ColdLoad: only the 5-minute run, for the model load time straight after a restart (task 5).
# -DryRun: no scheme change and the 5-minute runs only, unpinned clock ("uncapped"): checks the script works.
# -Recording5min / -Recording1h / -Recording3h: real recordings instead of the test set (out\test-set\).
param(
  [switch]$ColdLoad,
  [switch]$DryRun,
  [string]$Recording5min = '',
  [string]$Recording1h = '',
  [string]$Recording3h = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'emulation.ps1')

foreach ($tool in $PinRun, $SttBench, $Busy) {
  if (-not (Test-Path $tool)) { throw "$tool is missing: build the harness first (cargo build --release in harness\)." }
}
$set = Join-Path $Out 'test-set'
$rec = @{
  '5min' = $(if ($Recording5min) { $Recording5min } else { Join-Path $set 'test_audio.5min.m4a' })
  '1h' = $(if ($Recording1h) { $Recording1h } else { Join-Path $set 'test_audio.1h.m4a' })
  '3h' = $(if ($Recording3h) { $Recording3h } else { Join-Path $set 'test_audio.3h.m4a' })
}
foreach ($k in $rec.Keys) { if (-not (Test-Path $rec[$k])) { throw "Recording $k is missing: $($rec[$k]) (run make-test-set.mjs)." } }

$common = @('--asr', 'parakeet-tdt-0.6b-v3', '--diar', 'nemotron-3-diarization', '--diar-preset', 'v3-offline',
  '--chunk-sec', '30', '--overlap-sec', '2', '--mode', 'pipeline')
$benchDir = Join-Path $Out 'bench'
New-Item -ItemType Directory -Force -Path $benchDir | Out-Null

function Invoke-Run([string]$ProfileName, [string]$Length, [int]$Threads, [bool]$Parallel, [int]$BusyLps = 0, [string]$Tag = '') {
  $label = "bench.$ProfileName.$Length.$(if ($Parallel) { 'par' } else { 'seq' }).t$Threads$Tag"
  $benchArgs = @($rec[$Length]) + $common + @('--threads', "$Threads", '--label', $label)
  if ($Parallel) { $benchArgs += '--parallel' }
  $busy = $null
  if ($BusyLps -gt 0) {
    $busy = Start-Process -FilePath $PinRun -ArgumentList @('--profile', $ProfileName, '--report', (Join-Path $benchDir "$label.busy.json"), '--', $Busy, '--lps', "$BusyLps") -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }
  try {
    Write-Host "$(Get-Date -Format HH:mm:ss) $label …"
    & $PinRun --profile $ProfileName --report (Join-Path $benchDir "$label.pinrun.json") -- $SttBench @benchArgs 2>&1 |
      Where-Object { "$_" -match 'real time|pinrun:' } | ForEach-Object { Write-Host "  $_" }
  } finally {
    if ($busy -and -not $busy.HasExited) { Stop-Process -Id $busy.Id -Force; Get-Process busy -ErrorAction SilentlyContinue | Stop-Process -Force }
  }
}

$started = Get-Date
if ($DryRun) {
  Write-Host 'Dry run: no scheme change, 5-minute runs only, unpinned clock.'
  Invoke-Run 'uncapped' '5min' 8 $true
  Invoke-Run 'uncapped' '5min' 6 $false
  Invoke-Run 'uncapped' '5min' 8 $true 2 '.busy2'
} else {
  $laptop = Get-ProfileScheme 'laptop'
  $throttled = Get-ProfileScheme 'throttled'
  $profiles = Read-Profiles
  if (-not $profiles.profiles.laptop.capMHz -or -not $profiles.profiles.throttled.capMHz) { throw 'Run calibrate.ps1 for both profiles first.' }
  Invoke-WithScheme $laptop.Guid {
    if ($ColdLoad) {
      Invoke-Run 'laptop' '5min' 8 $true 0 '.cold'
      return
    }
    $check = Invoke-Cinebench -Version R23 -ProfileName 'laptop'
    $drift = $check / [double]$profiles.profiles.laptop.cinebenchR23Multi - 1
    Write-Host ("Cinebench R23 check: {0} ({1:P1} from the calibration)." -f $check, $drift)
    if ([math]::Abs($drift) -gt 0.05) { Write-Warning 'More than 5 % from the calibration: run calibrate.ps1 -Profile Laptop again before trusting these numbers.' }
    @{ checkedAt = (Get-Date).ToString('o'); cinebenchR23Multi = $check; drift = $drift } | ConvertTo-Json | Set-Content (Join-Path $benchDir 'laptop-check.json')
    Invoke-Run 'laptop' '5min' 8 $true
    Invoke-Run 'laptop' '1h' 8 $true
    Invoke-Run 'laptop' '3h' 8 $true
    Invoke-Run 'laptop' '5min' 6 $false
    Invoke-Run 'laptop' '5min' 12 $false
    Invoke-Run 'laptop' '1h' 6 $false
    Invoke-Run 'laptop' '1h' 12 $false
    Invoke-Run 'laptop' '1h' 8 $true 2 '.busy2'
    Set-ActiveScheme $throttled.Guid
    Invoke-Run 'throttled' '1h' 8 $true
  }
}
node (Join-Path $Spike 'summarize.mjs')
Write-Host ("Done in {0:N0} min. Send out\summary.md." -f ((Get-Date) - $started).TotalMinutes)
