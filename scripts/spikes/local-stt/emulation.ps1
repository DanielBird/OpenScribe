# Phase 33 spike: helpers shared by setup-emulation.ps1, calibrate.ps1 and run-benchmarks.ps1. Dot-source it.
# Nothing here changes a setting by itself; the scripts that call it say what they change.

$Spike = $PSScriptRoot
$Out = Join-Path $Spike 'out'
$ProfilesPath = Join-Path $Spike 'profiles.json'
$Bin = Join-Path $Spike 'harness\target\release'
$PinRun = Join-Path $Bin 'pinrun.exe'
$SttBench = Join-Path $Bin 'stt-bench.exe'
$Busy = Join-Path $Bin 'busy.exe'
$HfFetch = Join-Path $Bin 'hf-fetch.exe'
$Cinebench2024 = Join-Path $env:USERPROFILE 'Desktop\Cinebench2024_win_x86_64\Cinebench.exe'
$CinebenchR23 = Join-Path $env:USERPROFILE 'Desktop\CinebenchR23\Cinebench.exe'
New-Item -ItemType Directory -Force -Path $Out | Out-Null

function Read-Profiles { Get-Content $ProfilesPath -Raw | ConvertFrom-Json }

function Write-Profiles($profiles) {
  ($profiles | ConvertTo-Json -Depth 8) + "`n" | Set-Content -NoNewline -Encoding utf8 $ProfilesPath
}

# Every power scheme: GUID, name, and whether it's active (powercfg /list marks it with *).
function Get-Schemes {
  powercfg /list | ForEach-Object {
    if ($_ -match 'GUID:\s*([0-9a-fA-F-]{36})\s+\((.+?)\)(\s*\*)?\s*$') {
      [pscustomobject]@{ Guid = $Matches[1]; Name = $Matches[2]; Active = [bool]$Matches[3] }
    }
  }
}

function Get-ActiveScheme { Get-Schemes | Where-Object Active | Select-Object -First 1 }

function Get-Scheme([string]$Name) { Get-Schemes | Where-Object Name -eq $Name | Select-Object -First 1 }

# The scheme of a profile ('laptop' or 'throttled'), or a clear error if setup-emulation.ps1 hasn't made it.
function Get-ProfileScheme([string]$ProfileName) {
  $profiles = Read-Profiles
  $name = $profiles.profiles.$ProfileName.scheme
  $scheme = Get-Scheme $name
  if (-not $scheme) { throw "The power scheme `"$name`" doesn't exist. Run setup-emulation.ps1 first." }
  $scheme
}

# Sets both frequency caps (PROCFREQMAX for the P-cores' class 0 setting and PROCFREQMAX1 for class 1) on mains
# power, then re-applies the scheme so a change to the active one takes effect.
function Set-Cap([string]$Guid, [int]$MHz) {
  powercfg /setacvalueindex $Guid SUB_PROCESSOR PROCFREQMAX $MHz
  if ($LASTEXITCODE -ne 0) { throw "powercfg couldn't set PROCFREQMAX on $Guid (exit $LASTEXITCODE)." }
  powercfg /setacvalueindex $Guid SUB_PROCESSOR PROCFREQMAX1 $MHz
  if ($LASTEXITCODE -ne 0) { throw "powercfg couldn't set PROCFREQMAX1 on $Guid (exit $LASTEXITCODE)." }
  $active = Get-ActiveScheme
  if ($active -and $active.Guid -eq $Guid) { powercfg /setactive $Guid }
}

function Set-ActiveScheme([string]$Guid) {
  powercfg /setactive $Guid
  if ($LASTEXITCODE -ne 0) { throw "powercfg couldn't switch to $Guid (exit $LASTEXITCODE)." }
}

# Runs a script block with the given scheme active, and always switches back to the scheme that was active before,
# even on an error or Ctrl+C.
function Invoke-WithScheme([string]$Guid, [scriptblock]$Body) {
  $before = Get-ActiveScheme
  try {
    if ($Guid) { Set-ActiveScheme $Guid }
    & $Body
  } finally {
    if ($before) {
      powercfg /setactive $before.Guid
      Write-Host "Power scheme back to `"$($before.Name)`"."
    }
  }
}

# One Cinebench multi-core (or single-core) run pinned to the profile's twelve logical processors, through pinrun.
# Cinebench prints its result only to a console it attaches to ("parentconsole"), so it runs in its own console
# window with `start /wait`, and the score is read from the log file Cinebench is told to write.
# Returns the score as a number.
function Invoke-Cinebench([ValidateSet('2024', 'R23')][string]$Version, [string]$ProfileName, [switch]$Single) {
  $exe = if ($Version -eq '2024') { $Cinebench2024 } else { $CinebenchR23 }
  if (-not (Test-Path $exe)) { throw "Cinebench $Version isn't at $exe." }
  $test = if ($Single) { 'g_CinebenchCpu1Test=true' } else { 'g_CinebenchCpuXTest=true' }
  $kind = if ($Single) { 'single' } else { 'multi' }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $log = Join-Path $Out "cinebench-$Version-$kind-$ProfileName-$stamp.log"
  $report = Join-Path $Out "cinebench-$Version-$kind-$ProfileName-$stamp.pinrun.json"
  # g_CinebenchMinimumTestDuration=1: one pass, as the published scores are. `start /b /wait "parentconsole"` is how
  # Maxon documents getting the result on the console; through a batch file so the quotes survive. pinrun runs it on a
  # pseudo console and saves what Cinebench prints there.
  $batch = Join-Path $Out "cinebench-$stamp.cmd"
  "@echo off`r`nstart `"parentconsole`" /b /wait `"$exe`" $test g_CinebenchMinimumTestDuration=1`r`n" |
    Set-Content -NoNewline -Encoding ascii $batch
  & $PinRun --profile $ProfileName --report $report --capture-console $log -- cmd /c $batch | Out-Null
  Remove-Item -ErrorAction SilentlyContinue $batch
  $text = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
  # "CB 557.12 (0.00)" (2024) or "CB 10036.32 (0.00)" (R23)
  $m = [regex]::Matches($text, 'CB\s+([0-9]+(?:\.[0-9]+)?)')
  if ($m.Count -eq 0) { throw "No score in Cinebench $Version's output ($log)." }
  [double]$m[$m.Count - 1].Groups[1].Value
}
