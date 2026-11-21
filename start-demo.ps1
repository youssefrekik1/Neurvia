param([switch] $Fresh, [switch] $Offline, [switch] $Sqlite)

# Démonstration : 20 apprenants fictifs, une séance publiée et des réponses de départ.
# Par défaut, elle utilise une base PostgreSQL dédiée (neurvia_demo) dans le service `db` de
# compose.documents.yml, séparée des données réelles. -Sqlite conserve l’ancienne base SQLite locale.

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

function Start-DemoPostgres {
  # Docker writes progress to stderr; judge success by exit codes only.
  $ErrorActionPreference = 'Continue'
  $compose = @('compose', '-f', 'compose.documents.yml')
  $null = & docker @compose up -d --wait db 2>&1
  if ($LASTEXITCODE -ne 0) { return $null }
  $name = if ($Fresh) { 'neurvia_demo_' + [guid]::NewGuid().ToString('N').Substring(0, 12) } else { 'neurvia_demo' }
  $exists = & docker @compose exec -T db psql -U neurvia -d neurvia -tAc "SELECT 1 FROM pg_database WHERE datname = '$name'" 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  if ("$exists".Trim() -ne '1') {
    $null = & docker @compose exec -T db psql -U neurvia -d neurvia -c "CREATE DATABASE $name" 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
  }
  $password = if ($env:NEURVIA_POSTGRES_PASSWORD) { $env:NEURVIA_POSTGRES_PASSWORD } else { 'neurvia-local-db' }
  $url = "postgresql+psycopg://neurvia:$password@127.0.0.1:55432/$name"
  Push-Location -LiteralPath $api
  try {
    $env:DATABASE_URL = $url
    $null = & $python -m alembic upgrade head 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'La migration de la base de démonstration a échoué.' }
  } finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Pop-Location
  }
  Write-Host "Base de démonstration PostgreSQL : $name"
  return $url
}

$database = $null
if (-not $Sqlite) {
  try { $database = Start-DemoPostgres } catch { Write-Warning $_ }
  if (-not $database) { Write-Warning 'Docker ou PostgreSQL indisponible : la démonstration utilise SQLite.' }
}
if (-not $database) {
  $file = if ($Fresh) { 'fahm-demo-' + [guid]::NewGuid().ToString('N') + '.db' } else { 'fahm-demo.db' }
  $database = "sqlite:///./$file"
}

$backend = Start-Job -ArgumentList $api,$python,$database,[bool]$Offline -ScriptBlock {
  param($apiDir,$pythonExe,$databaseUrl,$offlineMode)
  Set-Location -LiteralPath $apiDir
  $env:DEMO_MODE = 'true'
  $env:DATABASE_URL = $databaseUrl
  if ($offlineMode) {
    $env:LLM_ENABLED = 'false'
    $env:DOCUMENT_VISION_ENABLED = 'false'
  }
  & $pythonExe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
}
try {
  $expires = [DateTime]::UtcNow.AddSeconds(30)
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
