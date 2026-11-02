$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $root 'docker-compose.yml') -PathType Leaf)) { throw 'Execute este instalador na pasta principal do projeto, junto de docker-compose.yml.' }
$files = @(@{Source='patch_files\frontend\app.js';Target='frontend\app.js'},@{Source='patch_files\frontend\index.html';Target='frontend\index.html'})
foreach ($f in $files) { if (-not (Test-Path -LiteralPath (Join-Path $root $f.Source) -PathType Leaf)) { throw "Arquivo do patch ausente: $($f.Source)" }; if (-not (Test-Path -LiteralPath (Join-Path $root $f.Target) -PathType Leaf)) { throw "Arquivo original ausente: $($f.Target)" } }
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $backup=Join-Path $root "backup-v12.5.0-$stamp"
foreach ($f in $files) { $target=Join-Path $root $f.Target; $dest=Join-Path $backup $f.Target; New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null; Copy-Item -LiteralPath $target -Destination $dest }
try { foreach ($f in $files) { Copy-Item -LiteralPath (Join-Path $root $f.Source) -Destination (Join-Path $root $f.Target) -Force } } catch { foreach ($f in $files) { $src=Join-Path $backup $f.Target; if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $root $f.Target) -Force } }; throw 'Falha ao instalar. Os arquivos anteriores foram restaurados.' }
Write-Host 'Patch V12.5.0 instalado: Painel Operacional do Técnico.' -ForegroundColor Green
Write-Host "Backup dos arquivos anteriores: $backup"
Write-Host 'Somente frontend/app.js e frontend/index.html foram alterados. .env, banco e configuração do CPE não foram alterados.'
Write-Host 'Agora execute: docker compose up -d --build api nginx'
