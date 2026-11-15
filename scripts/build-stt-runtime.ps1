# Builds the speech engine the desktop app ships (DECISIONS.md D51, D53) into src-tauri/stt-runtime/ (gitignored),
# as src-tauri/stt-runtime.json defines it: NVIDIA's NeMo-Speech.cpp at a pinned commit, CPU only, for the work
# laptop's instruction sets (AVX2, FMA, F16C, BMI2; no AVX-512, AVX-VNNI, native tuning, CUDA or Vulkan). The same
# build Phase 33 benchmarked (scripts/spikes/local-stt/build-runtime.ps1).
#
# Also copies the MSVC and OpenMP runtimes the DLLs import (msvcp140, vcruntime140, vcruntime140_1, vcomp140) from
# Visual Studio's redistributable folder, so the app carries its own. Writes src-tauri/stt-runtime/built.json: each
# file's size and SHA-256, which pack-desktop.mjs checks before staging them.
#
# Needs: Visual Studio 2022 with the C++ tools, CMake and Ninja (reference/local-stt.md, Prerequisites), git.
# The first build takes about 10 minutes (vcpkg builds sentencepiece and protobuf); later ones about 2.
#
# Usage: npm run desktop:stt-runtime                        (clones and builds in .stt-runtime-build/)
#        npm run desktop:stt-runtime -- -From <bin folder>  (copies an existing build of the same commit instead,
#                                                            such as scripts\spikes\local-stt\vendor\build-cpu-asr\bin)
param([string]$From, [switch]$Clean)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Definition = Get-Content (Join-Path $Root 'src-tauri\stt-runtime.json') -Raw | ConvertFrom-Json
$Out = Join-Path $Root 'src-tauri\stt-runtime'
$Work = Join-Path $Root '.stt-runtime-build'

$vsPath = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw 'Visual Studio with the C++ tools is needed (vswhere found none).' }

if ($From) {
  $bin = (Resolve-Path $From).Path
  $source = "copied from $bin"
} else {
  $src = Join-Path $Work 'nemo-speech'
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  if (-not (Test-Path $src)) {
    git clone --branch $Definition.tag --depth 1 "$($Definition.repository).git" $src
    if ($LASTEXITCODE -ne 0) { throw "git clone failed ($LASTEXITCODE)" }
  }
  $head = (git -C $src rev-parse HEAD).Trim()
  if ($head -ne $Definition.commit) { throw "$src is at $head, expected $($Definition.commit)" }
  if (-not (Test-Path (Join-Path $src 'llama.cpp\ggml\CMakeLists.txt'))) {
    git -C $src submodule update --init --depth 1 llama.cpp
    if ($LASTEXITCODE -ne 0) { throw "git submodule update failed ($LASTEXITCODE)" }
  }
  $llama = (git -C (Join-Path $src 'llama.cpp') rev-parse HEAD).Trim()
  if ($llama -ne $Definition.llamaCppCommit) { throw "llama.cpp is at $llama, expected $($Definition.llamaCppCommit)" }
  $buildDir = Join-Path $Work 'build-cpu-asr'
  if ($Clean -and (Test-Path $buildDir)) { Remove-Item -Recurse -Force $buildDir }

  # vcpkg builds with the newest MSVC toolset installed while vcvars64.bat picks VS's pinned default, which can be
  # older; the link then fails on STL symbols (__std_search_1). vcvars honours VCVARS_USER_VERSION.
  $toolsets = Get-ChildItem (Join-Path $vsPath 'VC\Tools\MSVC') -Directory | Sort-Object { [version]$_.Name } -Descending
  $env:VCVARS_USER_VERSION = $toolsets[0].Name
  Write-Host "==> MSVC toolset $($env:VCVARS_USER_VERSION)"
  & (Join-Path $src 'scripts\windows\build.ps1') -Backend cpu -Profile asr -Compiler msvc -Config Release `
    -VcpkgRoot (Join-Path $Work 'vcpkg') -BuildDir $buildDir -CMakeArgs $Definition.cmakeArgs
  if (-not $?) { throw 'NeMo-Speech.cpp build failed' }

  # What CMake actually used: refuse a build that turned on anything the laptop lacks, or a GPU.
  $cache = Get-Content (Join-Path $buildDir 'CMakeCache.txt')
  foreach ($flag in 'GGML_NATIVE', 'GGML_AVX512', 'GGML_AVX_VNNI', 'GGML_CUDA', 'GGML_VULKAN') {
    $line = $cache | Where-Object { $_ -match "^${flag}:BOOL=" }
    if ($line -and $line -notmatch '=(OFF|FALSE|0)$') { throw "CMake used $line; the engine must be built without it" }
  }
  $bin = Join-Path $buildDir 'bin'
  $source = "built from $($Definition.repository) $($Definition.tag) ($($Definition.commit))"
}

# The newest redistributable at least as new as the toolset the DLLs were built with.
$redist = Get-ChildItem (Join-Path $vsPath 'VC\Redist\MSVC') -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $redist -or [version]$redist.Name -lt [version]"$($Definition.msvcRuntime.minimumVersion).0") {
  throw "Visual Studio's redistributable MSVC runtime $($Definition.msvcRuntime.minimumVersion) or newer is needed."
}
$runtimeFrom = @{
  'msvcp140.dll' = 'x64\Microsoft.VC143.CRT'
  'vcruntime140.dll' = 'x64\Microsoft.VC143.CRT'
  'vcruntime140_1.dll' = 'x64\Microsoft.VC143.CRT'
  'vcomp140.dll' = 'x64\Microsoft.VC143.OpenMP'
}

if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
foreach ($name in $Definition.engineFiles) {
  $file = Join-Path $bin $name
  if (-not (Test-Path $file)) { throw "$name isn't in $bin" }
  Copy-Item $file $Out
}
foreach ($name in $Definition.msvcRuntime.files) {
  Copy-Item (Join-Path $redist.FullName (Join-Path $runtimeFrom[$name] $name)) $Out
}

$files = Get-ChildItem $Out -File -Filter *.dll | Sort-Object Name | ForEach-Object {
  [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() }
}
$built = [ordered]@{
  name = $Definition.name
  version = $Definition.version
  commit = $Definition.commit
  source = $source
  msvcRuntime = $redist.Name
  builtAt = (Get-Date).ToString('o')
  files = $files
}
$built | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $Out 'built.json')
$total = ($files | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum
Write-Host "$($files.Count) files in src-tauri\stt-runtime, $([math]::Round($total / 1MB, 1)) MB ($source; MSVC runtime $($redist.Name))."
