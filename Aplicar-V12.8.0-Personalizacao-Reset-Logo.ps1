$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$required = @('docker-compose.yml', 'frontend\app.js', 'frontend\index.html', 'backend\server.js')
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $root $rel))) { throw "Execute este instalador na raiz do projeto RFN. Arquivo ausente: $rel" }
}
$source = Join-Path $PSScriptRoot 'patch_files'
foreach ($rel in @('backend\server.js','frontend\app.js','frontend\index.html')) {
  if (-not (Test-Path (Join-Path $source $rel))) { throw "Arquivo do patch ausente: $rel. Extraia o ZIP completo." }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $root "backup-v12.8.0-$stamp"
foreach ($rel in @('backend\server.js','frontend\app.js','frontend\index.html')) {
  $dest = Join-Path $backup $rel
  New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
  Copy-Item (Join-Path $root $rel) $dest -Force
}
Copy-Item (Join-Path $source 'backend\server.js') (Join-Path $root 'backend\server.js') -Force
Copy-Item (Join-Path $source 'frontend\app.js') (Join-Path $root 'frontend\app.js') -Force
Copy-Item (Join-Path $source 'frontend\index.html') (Join-Path $root 'frontend\index.html') -Force
Write-Host ''
Write-Host 'Patch V12.8.0 instalado: identidade visual, upload de logo e reset de fábrica confirmado.' -ForegroundColor Green
Write-Host "Backup criado em: $backup"
Write-Host 'O .env, banco de dados, credenciais PPPoE e roteador não foram alterados durante a instalação.'
Write-Host 'Próximo passo: docker compose up -d --build api nginx'
Write-Host 'Depois, atualize o navegador com Ctrl+F5.'
