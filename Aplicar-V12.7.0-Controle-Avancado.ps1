$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$required = @('docker-compose.yml', 'frontend\app.js', 'frontend\index.html', 'backend\server.js')
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $root $rel))) { throw "Execute este instalador na raiz do projeto RFN. Arquivo ausente: $rel" }
}
$source = Join-Path $PSScriptRoot 'patch_files'
if (-not (Test-Path $source)) { throw 'Pasta patch_files não encontrada. Extraia o ZIP completo antes de executar.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $root "backup-v12.7.0-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($rel in @('frontend\app.js','frontend\index.html','backend\server.js')) {
  $dest = Join-Path $backup $rel
  New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
  Copy-Item (Join-Path $root $rel) $dest -Force
}
Copy-Item (Join-Path $source 'frontend\app.js') (Join-Path $root 'frontend\app.js') -Force
Copy-Item (Join-Path $source 'frontend\index.html') (Join-Path $root 'frontend\index.html') -Force
Copy-Item (Join-Path $source 'backend\server.js') (Join-Path $root 'backend\server.js') -Force
Write-Host ''
Write-Host 'Patch V12.7.0 instalado: Controle avançado do MR60X.' -ForegroundColor Green
Write-Host "Backup criado em: $backup"
Write-Host 'O .env, as migrações, as contas PPPoE e o roteador não foram alterados durante a instalação.'
Write-Host 'Próximo passo: docker compose up -d --build api nginx'
Write-Host 'Depois, atualize o navegador com Ctrl+F5 e abra Equipamentos > MR60X > Laboratório MR60X.'
