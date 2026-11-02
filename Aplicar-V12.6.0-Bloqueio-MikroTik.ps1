$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $root "backup-v12.6.0-$timestamp"

$files = @(
    @{ Source = 'patch_files/backend/server.js'; Target = 'backend/server.js' },
    @{ Source = 'patch_files/backend/mikrotik.js'; Target = 'backend/mikrotik.js' },
    @{ Source = 'patch_files/backend/migrations/007_mikrotik_service_actions.sql'; Target = 'backend/migrations/007_mikrotik_service_actions.sql' },
    @{ Source = 'patch_files/frontend/app.js'; Target = 'frontend/app.js' },
    @{ Source = 'patch_files/frontend/index.html'; Target = 'frontend/index.html' }
)
$composeTarget = Join-Path $root 'docker-compose.yml'
$composeNeedle = '      API_COOKIE_SECURE: ${API_COOKIE_SECURE:-false}'
$composeAddition = @'
      API_COOKIE_SECURE: ${API_COOKIE_SECURE:-false}
      MIKROTIK_HOST: ${MIKROTIK_HOST:-}
      MIKROTIK_PORT: ${MIKROTIK_PORT:-8728}
      MIKROTIK_USERNAME: ${MIKROTIK_USERNAME:-}
      MIKROTIK_PASSWORD: ${MIKROTIK_PASSWORD:-}
      MIKROTIK_TIMEOUT_MS: ${MIKROTIK_TIMEOUT_MS:-7000}
'@
$composeAddition = $composeAddition.TrimEnd()

foreach ($item in $files) {
    if (-not (Test-Path (Join-Path $root $item.Source))) { throw "Arquivo do patch ausente: $($item.Source)" }
    if (-not (Test-Path (Join-Path $root $item.Target)) -and $item.Target -notin @('backend/mikrotik.js', 'backend/migrations/007_mikrotik_service_actions.sql')) {
        throw "Arquivo do projeto não encontrado: $($item.Target). Execute na pasta RFN_Personalizar-roteadores."
    }
}
if (-not (Test-Path $composeTarget)) { throw 'docker-compose.yml não encontrado. Execute na pasta RFN_Personalizar-roteadores.' }

New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($item in $files) {
    $targetPath = Join-Path $root $item.Target
    if (Test-Path $targetPath) {
        $backupPath = Join-Path $backup $item.Target
        New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
        Copy-Item $targetPath $backupPath -Force
    }
}
Copy-Item $composeTarget (Join-Path $backup 'docker-compose.yml') -Force

try {
    foreach ($item in $files) {
        $targetPath = Join-Path $root $item.Target
        New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
        Copy-Item (Join-Path $root $item.Source) $targetPath -Force
    }
    $compose = Get-Content $composeTarget -Raw
    if ($compose -notmatch 'MIKROTIK_HOST:') {
        if (-not $compose.Contains($composeNeedle)) { throw 'Não encontrei a linha esperada em docker-compose.yml; o arquivo não foi alterado pelo patch.' }
        $compose = $compose.Replace($composeNeedle, $composeAddition)
        Set-Content -Path $composeTarget -Value $compose -Encoding utf8
    }
    Write-Host ''
    Write-Host 'Patch V12.6.0 instalado: Bloqueio/Desbloqueio via MikroTik.' -ForegroundColor Green
    Write-Host "Backup: $backup"
    Write-Host 'Nenhum valor foi enviado ao roteador durante a instalação.'
    Write-Host 'O arquivo .env não foi alterado.'
    Write-Host 'Próximo passo: configurar as variáveis MIKROTIK_* no .env e reconstruir a API.'
} catch {
    Write-Host "Falha na instalação: $($_.Exception.Message)" -ForegroundColor Red
    foreach ($item in $files) {
        $backupPath = Join-Path $backup $item.Target
        $targetPath = Join-Path $root $item.Target
        if (Test-Path $backupPath) { Copy-Item $backupPath $targetPath -Force }
        elseif ($item.Target -in @('backend/mikrotik.js', 'backend/migrations/007_mikrotik_service_actions.sql') -and (Test-Path $targetPath)) { Remove-Item $targetPath -Force }
    }
    if (Test-Path (Join-Path $backup 'docker-compose.yml')) { Copy-Item (Join-Path $backup 'docker-compose.yml') $composeTarget -Force }
    throw
}
