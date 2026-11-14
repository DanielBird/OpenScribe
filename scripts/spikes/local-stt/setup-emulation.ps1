# Phase 33 spike, maintainer task 2: makes the two power schemes the emulated laptop runs under.
#
# What it changes: it adds two power schemes, copies of Balanced, named "DeScribe laptop emulation" and
# "DeScribe laptop emulation (throttled)", each with a maximum processor frequency on mains power (PROCFREQMAX and
# PROCFREQMAX1). It doesn't switch to them and doesn't touch any existing scheme. It saves a copy of Balanced's
# settings to out\balanced-before.txt so the end of the phase can show Balanced is unchanged.
#
# Undo: setup-emulation.ps1 -Remove (switches back to the scheme that was active at setup if one of these is
# active, then deletes both).
#
# Usage: pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\setup-emulation.ps1 [-Remove]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'emulation.ps1')

$profiles = Read-Profiles
$wanted = [ordered]@{ laptop = 3200; throttled = 1950 }
$activeBeforePath = Join-Path $Out 'active-scheme-before.txt'

if ($Remove) {
  $active = Get-ActiveScheme
  $ours = $wanted.Keys | ForEach-Object { Get-Scheme $profiles.profiles.$_.scheme } | Where-Object { $_ }
  if ($active -and ($ours.Guid -contains $active.Guid)) {
    $back = if (Test-Path $activeBeforePath) { (Get-Content $activeBeforePath -Raw).Trim() } else { 'SCHEME_BALANCED' }
    Set-ActiveScheme $back
    Write-Host "Switched back to $back."
  }
  foreach ($s in $ours) {
    powercfg /delete $s.Guid
    Write-Host "Deleted `"$($s.Name)`" ($($s.Guid))."
  }
  return
}

$balancedBefore = Join-Path $Out 'balanced-before.txt'
if (-not (Test-Path $balancedBefore)) {
  powercfg /qh SCHEME_BALANCED | Set-Content -Encoding utf8 $balancedBefore
  Write-Host "Saved Balanced's settings to out\balanced-before.txt."
}
$active = Get-ActiveScheme
if (-not (Test-Path $activeBeforePath)) { $active.Guid | Set-Content -Encoding ascii $activeBeforePath }

foreach ($key in $wanted.Keys) {
  $name = $profiles.profiles.$key.scheme
  $scheme = Get-Scheme $name
  if (-not $scheme) {
    $line = powercfg /duplicatescheme SCHEME_BALANCED
    if ($LASTEXITCODE -ne 0 -or -not ("$line" -match '([0-9a-fA-F-]{36})')) { throw "powercfg couldn't copy Balanced: $line" }
    $guid = $Matches[1]
    powercfg /changename $guid $name "DeScribe Phase 33: the emulated work laptop. Safe to delete."
    $scheme = [pscustomobject]@{ Guid = $guid; Name = $name }
    Write-Host "Made `"$name`" ($guid)."
  } else {
    Write-Host "`"$name`" already exists ($($scheme.Guid))."
  }
  $mhz = if ($profiles.profiles.$key.capMHz) { [int]$profiles.profiles.$key.capMHz } else { $wanted[$key] }
  Set-Cap $scheme.Guid $mhz
  Write-Host "  maximum processor frequency on mains power: $mhz MHz (calibrate.ps1 finds the right value)."
  $profiles.profiles.$key | Add-Member -NotePropertyName schemeGuid -NotePropertyValue $scheme.Guid -Force
}
Write-Profiles $profiles
Write-Host "Done. The active scheme is still `"$((Get-ActiveScheme).Name)`"."
