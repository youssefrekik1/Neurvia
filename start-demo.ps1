param([switch] $Fresh, [switch] $Offline)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$api = Join-Path $PSScriptRoot 'apps/api'
$python = Join-Path $api '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  throw "Créez l’environnement Python et installez les dépendances comme indiqué dans README.md."
}
if (-not (Test-Path -LiteralPath 'node_modules/next/package.json')) {
  npm.cmd ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$database = if ($Fresh) { 'fahm-demo-' + [guid]::NewGuid().ToString('N') + '.db' } else { 'fahm-demo.db' }
$backend = Start-Job -ArgumentList $api,$python,$database,[bool]$Offline -ScriptBlock {
  param($apiDir,$pythonExe,$dbName,$offlineMode)
  Set-Location -LiteralPath $apiDir
  $env:DEMO_MODE = 'true'
  $env:DATABASE_URL = "sqlite:///./$dbName"
  if ($offlineMode) { $env:LLM_ENABLED = 'false' }
  & $pythonExe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
}
try {
  $expires = [DateTime]::UtcNow.AddSeconds(20)
  $ready = $false
  do {
    try {
      $health = Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:8000/health'
      $ready = $health.status -eq 'ok'
    } catch { Start-Sleep -Milliseconds 250 }
    if ($backend.State -in @('Failed', 'Completed', 'Stopped')) {
      Receive-Job -Job $backend
      throw 'FastAPI a quitté pendant le démarrage.'
    }
  } while (-not $ready -and [DateTime]::UtcNow -lt $expires)
  if (-not $ready) { throw 'FastAPI ne répond pas sur le port 8000.' }
  $env:BACKEND_URL = 'http://127.0.0.1:8000/api/v1'
  npm.cmd run dev -- --hostname 127.0.0.1 --port 3147
} finally {
  Stop-Job -Job $backend
  Receive-Job -Job $backend
  Remove-Job -Job $backend
}
