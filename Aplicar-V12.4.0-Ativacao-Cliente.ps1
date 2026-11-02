$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot

$files = @(
  @{ Source = 'patch_files\backend\server.js'; Target = 'backend\server.js' },
  @{ Source = 'patch_files\frontend\app.js'; Target = 'frontend\app.js' },
  @{ Source = 'patch_files\frontend\index.html'; Target = 'frontend\index.html' }
)
$migrationSource = 'patch_files\backend\migrations\006_customer_pppoe_username.sql'
$migrationTarget = 'backend\migrations\006_customer_pppoe_username.sql'

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'docker-compose.yml'))) {
  throw 'Extraia este ZIP na pasta principal RFN_Personalizar-roteadores, onde fica docker-compose.yml.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'backend\migrations') -PathType Container)) {
  throw 'Pasta backend\migrations não encontrada. Nenhum arquivo foi alterado.'
}
foreach ($item in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $item.Source) -PathType Leaf)) {
    throw "Arquivo do patch ausente: $($item.Source)"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $item.Target) -PathType Leaf)) {
    throw "Arquivo original não encontrado: $($item.Target). Nenhum arquivo foi substituído."
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $migrationSource) -PathType Leaf)) {
  throw "Migration do patch ausente: $migrationSource"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $projectRoot "backup-v12.4.0-$stamp"
New-Item -ItemType Directory -Path $backupRoot | Out-Null
foreach ($item in $files) {
  $target = Join-Path $projectRoot $item.Target
  $backupTarget = Join-Path $backupRoot $item.Target
  New-Item -ItemType Directory -Force -Path (Split-Path $backupTarget -Parent) | Out-Null
  Copy-Item -LiteralPath $target -Destination $backupTarget
}

$targetMigrationPath = Join-Path $projectRoot $migrationTarget
$migrationExisted = Test-Path -LiteralPath $targetMigrationPath -PathType Leaf
if ($migrationExisted) {
  $migrationBackup = Join-Path $backupRoot $migrationTarget
  New-Item -ItemType Directory -Force -Path (Split-Path $migrationBackup -Parent) | Out-Null
  Copy-Item -LiteralPath $targetMigrationPath -Destination $migrationBackup
}

try {
  foreach ($item in $files) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $item.Source) -Destination (Join-Path $projectRoot $item.Target) -Force
  }
  Copy-Item -LiteralPath (Join-Path $projectRoot $migrationSource) -Destination $targetMigrationPath -Force
} catch {
  foreach ($item in $files) {
    $backupTarget = Join-Path $backupRoot $item.Target
    if (Test-Path -LiteralPath $backupTarget -PathType Leaf) {
      Copy-Item -LiteralPath $backupTarget -Destination (Join-Path $projectRoot $item.Target) -Force
    }
  }
  if ($migrationExisted) {
    $migrationBackup = Join-Path $backupRoot $migrationTarget
    if (Test-Path -LiteralPath $migrationBackup -PathType Leaf) {
      Copy-Item -LiteralPath $migrationBackup -Destination $targetMigrationPath -Force
    }
  } elseif (Test-Path -LiteralPath $targetMigrationPath -PathType Leaf) {
    Remove-Item -LiteralPath $targetMigrationPath -Force
  }
  throw 'Falha ao instalar; os arquivos anteriores foram restaurados a partir do backup.'
}

Write-Host 'Patch V12.4.0 instalado: pré-checagem de ativação e validação de usuário PPPoE por cliente.' -ForegroundColor Green
Write-Host "Backup dos arquivos anteriores: $backupRoot"
Write-Host 'O arquivo .env e a configuração atual do roteador não foram alterados.'
Write-Host 'A migration 006 será aplicada automaticamente ao iniciar a API.'
Write-Host 'Agora execute: docker compose up -d --build api nginx'
