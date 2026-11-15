# Phase 33 spike: builds NVIDIA's NeMo-Speech.cpp v0.3.0 for the emulated work laptop (M1).
#
# CPU only (no CUDA, no Vulkan: the RTX 2070 SUPER can't be used even by accident) and only the instructions the
# laptop's Ryzen 5 PRO 215 has: AVX2, FMA, F16C, BMI2, with AVX-VNNI, AVX-512 and native tuning off. The i7-13700K
# lacks AVX-512, which the laptop has, so this errs on the slow side, and the same binaries would run on the laptop.
#
# Everything goes in vendor/ (gitignored): the source, vcpkg (which NVIDIA's build script bootstraps and uses for
# sentencepiece) and the build tree. Writes out/runtime-build.json: the flags CMake actually used and the size of
# every file in bin/.
#
# Usage: pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\build-runtime.ps1 [-Clean]
param([switch]$Clean)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Vendor = Join-Path $Here 'vendor'
$Out = Join-Path $Here 'out'
$Src = Join-Path $Vendor 'nemo-speech'
$Tag = 'v0.3.0'
$Commit = '20999cc921d2b14aa58708f61756a8b2e787ba20'
$LlamaCommit = 'bd4f514db14d87fded667787a7a963bfbaa98e89'
$BuildDir = Join-Path $Vendor 'build-cpu-asr'
$VcpkgRoot = Join-Path $Vendor 'vcpkg'
$Flags = @(
  '-DGGML_NATIVE=OFF',
  '-DGGML_SSE42=ON', '-DGGML_AVX=ON', '-DGGML_AVX2=ON', '-DGGML_FMA=ON', '-DGGML_F16C=ON', '-DGGML_BMI2=ON',
  '-DGGML_AVX_VNNI=OFF', '-DGGML_AVX512=OFF',
  '-DGGML_CUDA=OFF', '-DGGML_VULKAN=OFF'
)

New-Item -ItemType Directory -Force -Path $Vendor, $Out | Out-Null
if (-not (Test-Path $Src)) {
  git clone --branch $Tag --depth 1 https://github.com/NVIDIA/NeMo-Speech.cpp.git $Src
  if ($LASTEXITCODE -ne 0) { throw "git clone failed ($LASTEXITCODE)" }
}
$head = (git -C $Src rev-parse HEAD).Trim()
if ($head -ne $Commit) { throw "vendor/nemo-speech is at $head, expected $Tag ($Commit)" }
if (-not (Test-Path (Join-Path $Src 'llama.cpp\ggml\CMakeLists.txt'))) {
  git -C $Src submodule update --init --depth 1 llama.cpp
  if ($LASTEXITCODE -ne 0) { throw "git submodule update failed ($LASTEXITCODE)" }
}
$llama = (git -C (Join-Path $Src 'llama.cpp') rev-parse HEAD).Trim()
if ($llama -ne $LlamaCommit) { throw "llama.cpp is at $llama, expected $LlamaCommit" }
if ($Clean -and (Test-Path $BuildDir)) { Remove-Item -Recurse -Force $BuildDir }

# vcpkg builds its libraries with the newest MSVC toolset installed, but vcvars64.bat picks VS's pinned v143 default,
# which can be older (here 14.38 against 14.44); the link then fails on STL symbols such as __std_search_1. vcvars
# honours VCVARS_USER_VERSION, so point it at the newest toolset too.
$vsPath = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$toolsets = Get-ChildItem (Join-Path $vsPath 'VC\Tools\MSVC') -Directory |
  Sort-Object { [version]$_.Name } -Descending
$env:VCVARS_USER_VERSION = $toolsets[0].Name
Write-Host "==> MSVC toolset $($env:VCVARS_USER_VERSION) (newest in $vsPath)"

$started = Get-Date
& (Join-Path $Src 'scripts\windows\build.ps1') -Backend cpu -Profile asr -Compiler msvc -Config Release `
  -VcpkgRoot $VcpkgRoot -BuildDir $BuildDir -CMakeArgs $Flags
if (-not $?) { throw 'NeMo-Speech.cpp build failed' }
$minutes = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)

# What CMake actually used, not what was asked for.
$cache = Get-Content (Join-Path $BuildDir 'CMakeCache.txt')
$used = [ordered]@{}
foreach ($line in $cache) {
  if ($line -match '^(GGML_[A-Z0-9_]+|NEMO_SPEECH_[A-Z0-9_]+|CMAKE_BUILD_TYPE|CMAKE_CXX_COMPILER|BUILD_SHARED_LIBS):[A-Z]+=(.*)$') {
    $used[$Matches[1]] = $Matches[2]
  }
}
$bin = Join-Path $BuildDir 'bin'
$files = Get-ChildItem $bin -File | Sort-Object Name | ForEach-Object { [ordered]@{ name = $_.Name; bytes = $_.Length } }
$report = [ordered]@{
  runtime = "NeMo-Speech.cpp $Tag"
  commit = $Commit
  llamaCppCommit = $LlamaCommit
  builtAt = (Get-Date).ToString('o')
  buildMinutes = $minutes
  msvcToolset = $env:VCVARS_USER_VERSION
  requestedFlags = $Flags
  cmakeCache = $used
  bin = $bin
  files = $files
  totalBytes = ($files | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum
}
$report | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $Out 'runtime-build.json')
Write-Host "Built in $minutes min. $($files.Count) files in $bin, $([math]::Round($report.totalBytes / 1MB, 1)) MB. Report: out\runtime-build.json"
