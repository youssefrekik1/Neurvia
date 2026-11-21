$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $portable = Join-Path $env:LOCALAPPDATA 'NeurviaTooling/PFiles64/nodejs'
  if (Test-Path (Join-Path $portable 'node.exe')) { $env:Path = "$portable;$env:Path" }
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'Installez Node.js 22.12 ou 24, puis relancez ce script.'
}
if (-not (Test-Path 'node_modules/next/package.json')) {
  npm.cmd ci
  if ($LASTEXITCODE -ne 0) {exit $LASTEXITCODE}
}
npm.cmd run dev -- --hostname 127.0.0.1 --port 3147
