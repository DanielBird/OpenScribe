# Phase 33 spike, maintainer task 3: finds each profile's frequency cap, so that Cinebench pinned to the profile's
# twelve logical processors scores what the work laptop scores (Laptop: 557 in 2024 and 10,036 in R23; Throttled:
# 60 % of that).
#
# What it changes: it switches to the profile's power scheme, changes that scheme's maximum processor frequency
# between rounds, and switches back to the scheme that was active before when it ends, however it ends. Only the two
# schemes setup-emulation.ps1 made are ever edited.
#
# The two benchmarks don't agree on how much faster this PC is than the laptop: pinned at full clock it was 1.37×
# in 2024 and 1.62× in R23 (part A). No single cap brings both within 5 %, so the cap errs on the slow side: it is the
# one at which NEITHER benchmark is more than 5 % faster than the laptop. That matches R23 and leaves 2024 below the
# laptop. The result records both errors, and whether both are within 5 % (`bothWithin5Percent`).
#
# Each round runs Cinebench 2024 (about 10 minutes) and R23 (about 2) once each; the next cap is the last one scaled
# by the smaller target ÷ score. It writes the cap and the scores to profiles.json. Leave the PC alone while it runs.
#
# Usage: pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\calibrate.ps1 -Profile Laptop
#        … -Profile Throttled
#        … -DryRun   (no scheme change: one round at the full clock, to check Cinebench starts and its score is read)
param(
  [ValidateSet('Laptop', 'Throttled')][string]$Profile = 'Laptop',
  [switch]$DryRun,
  [switch]$SkipSingle,
  [int]$StartMHz = 0,
  [double]$Tolerance = 0.05,
  [int]$MaxRounds = 5
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'emulation.ps1')

$key = $Profile.ToLower()
$profiles = Read-Profiles
$target2024 = [double]$profiles.profiles.$key.targetCinebench2024Multi
$targetR23 = [double]$profiles.profiles.$key.targetCinebenchR23Multi
$scheme = if ($DryRun) { $null } else { Get-ProfileScheme $key }
$pinProfile = if ($DryRun) { 'uncapped' } else { $key }
$cap = if ($StartMHz -gt 0) { $StartMHz } elseif ($profiles.profiles.$key.capMHz) { [int]$profiles.profiles.$key.capMHz } elseif ($key -eq 'laptop') { 3200 } else { 1950 }
$rounds = @()

Invoke-WithScheme ($scheme.Guid) {
  for ($round = 1; $round -le $MaxRounds; $round++) {
    if (-not $DryRun) { Set-Cap $scheme.Guid $cap }
    Write-Host "Round $round$(if (-not $DryRun) { " at $cap MHz" }): Cinebench 2024 …"
    $s2024 = Invoke-Cinebench -Version 2024 -ProfileName $pinProfile
    Write-Host "  2024 multi: $s2024 (target $target2024). Cinebench R23 …"
    $sR23 = Invoke-Cinebench -Version R23 -ProfileName $pinProfile
    Write-Host "  R23 multi: $sR23 (target $targetR23)."
    $e2024 = $s2024 / $target2024 - 1
    $eR23 = $sR23 / $targetR23 - 1
    # The faster of the two, against the laptop: the cap is right when it's within the tolerance of 0.
    $eFaster = [math]::Max($e2024, $eR23)
    $script:rounds += [ordered]@{ round = $round; capMHz = $(if ($DryRun) { $null } else { $cap }); cinebench2024Multi = $s2024; cinebenchR23Multi = $sR23; error2024 = [math]::Round($e2024, 4); errorR23 = [math]::Round($eR23, 4) }
    if ($DryRun) { break }
    if ([math]::Abs($eFaster) -le $Tolerance) { break }
    # Scores scale about linearly with the clock: bring the faster benchmark to the laptop, in 25 MHz steps.
    $cap = [int]([math]::Round($cap / (1 + $eFaster) / 25) * 25)
  }
  if (-not $SkipSingle) {
    Write-Host 'Single-core scores at that cap (recorded, not matched; 2024 takes about 10 minutes) …'
    $script:single2024 = Invoke-Cinebench -Version 2024 -ProfileName $pinProfile -Single
    $script:singleR23 = Invoke-Cinebench -Version R23 -ProfileName $pinProfile -Single
  }
}

$last = $rounds[-1]
$fasterError = [math]::Max($last.error2024, $last.errorR23)
$result = [ordered]@{
  calibratedAt = (Get-Date).ToString('o')
  dryRun = [bool]$DryRun
  policy = 'neither benchmark more than 5 % faster than the laptop'
  capMHz = $last.capMHz
  cinebench2024Multi = $last.cinebench2024Multi
  cinebenchR23Multi = $last.cinebenchR23Multi
  error2024 = $last.error2024
  errorR23 = $last.errorR23
  cinebench2024Single = $single2024
  cinebenchR23Single = $singleR23
  withinTolerance = ([math]::Abs($fasterError) -le $Tolerance)
  bothWithin5Percent = ([math]::Abs($last.error2024) -le 0.05 -and [math]::Abs($last.errorR23) -le 0.05)
  rounds = $rounds
}
if ($DryRun) {
  $result | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $Out 'calibrate-dryrun.json')
  Write-Host 'Dry run: nothing changed. Result in out\calibrate-dryrun.json.'
} else {
  foreach ($k in $result.Keys) { $profiles.profiles.$key | Add-Member -NotePropertyName $k -NotePropertyValue $result[$k] -Force }
  Write-Profiles $profiles
  $verdict = if (-not $result.withinTolerance) { 'NOT settled after the last round: see profiles.json' }
    elseif ($result.bothWithin5Percent) { 'both within 5 %' }
    else { ('2024 is {0:P0} and R23 {1:P0} from the laptop: the slow-side cap' -f $result.error2024, $result.errorR23) }
  Write-Host "$Profile calibrated: $($result.capMHz) MHz, 2024 $($result.cinebench2024Multi), R23 $($result.cinebenchR23Multi) ($verdict)."
}
