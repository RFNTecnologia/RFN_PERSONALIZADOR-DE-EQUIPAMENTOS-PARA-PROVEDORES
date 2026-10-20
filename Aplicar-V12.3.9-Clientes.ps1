$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$files = @(
  @{ Source = 'patch_files\backend\server.js'; Target = 'backend\server.js' },
  @{ Source = 'patch_files\frontend\app.js'; Target = 'frontend\app.js' },
  @{ Source = 'patch_files\frontend\index.html'; Target = 'frontend\index.html' }
)
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'docker-compose.yml'))) {
  throw 'Extraia este ZIP na pasta principal RFN_Personalizar-roteadores, onde fica docker-compose.yml.'
}
foreach ($item in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $item.Source))) { throw "Arquivo do patch ausente: $($item.Source)" }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $item.Target))) { throw "Arquivo original não encontrado: $($item.Target). Nenhum arquivo foi substituído." }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $projectRoot "backup-v12.3.9-$stamp"
New-Item -ItemType Directory -Path $backupRoot | Out-Null
foreach ($item in $files) {
  $source = Join-Path $projectRoot $item.Source
  $target = Join-Path $projectRoot $item.Target
  $backupTarget = Join-Path $backupRoot $item.Target
  New-Item -ItemType Directory -Force -Path (Split-Path $backupTarget -Parent) | Out-Null
  Copy-Item -LiteralPath $target -Destination $backupTarget
}
try {
  foreach ($item in $files) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $item.Source) -Destination (Join-Path $projectRoot $item.Target) -Force
  }
} catch {
  foreach ($item in $files) {
    $backupTarget = Join-Path $backupRoot $item.Target
    if (Test-Path -LiteralPath $backupTarget) { Copy-Item -LiteralPath $backupTarget -Destination (Join-Path $projectRoot $item.Target) -Force }
  }
  throw 'Falha ao instalar; os arquivos anteriores foram restaurados a partir do backup.'
}
Write-Host 'Patch V12.3.9 instalado: cadastro e associação de clientes.' -ForegroundColor Green
Write-Host "Backup dos arquivos anteriores: $backupRoot"
Write-Host 'O arquivo .env e os demais arquivos do projeto não foram alterados.'
Write-Host 'Agora execute: docker compose up -d --build api nginx'
