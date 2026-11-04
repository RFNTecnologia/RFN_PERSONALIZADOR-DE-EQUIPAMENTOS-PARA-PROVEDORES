param(
    [Parameter(Mandatory = $true)]
    [string] $Domain
)

$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $workspace ".env"
if (-not (Test-Path $envPath)) {
    throw "Arquivo .env não encontrado. Crie-o a partir de .env.example e configure-o."
}
if ($Domain -notmatch '^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$') {
    throw "Informe um domínio DNS válido em -Domain."
}

$trackedEnv = git -C $workspace ls-files --error-unmatch -- .env 2>$null
if ($LASTEXITCODE -eq 0) {
    throw "O .env ainda está versionado. Remova-o do índice Git antes de liberar produção."
}

$settings = @{}
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
    }
}

$required = @(
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "MONGO_ROOT_PASSWORD",
    "POSTGRES_PASSWORD",
    "REDIS_PASSWORD",
    "GENIEACS_UI_JWT_SECRET",
    "API_ADMIN_PASSWORD",
    "API_SESSION_SECRET",
    "CPE_ADMIN_PASSWORD"
)
foreach ($name in $required) {
    if (-not $settings.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($settings[$name])) {
        throw "Configure $name no .env antes de continuar."
    }
}

$secretNames = @(
    "MONGO_ROOT_PASSWORD",
    "POSTGRES_PASSWORD",
    "REDIS_PASSWORD",
    "GENIEACS_UI_JWT_SECRET",
    "API_ADMIN_PASSWORD",
    "API_SESSION_SECRET",
    "CPE_ADMIN_PASSWORD"
)
$seenSecrets = @{}
foreach ($name in $secretNames) {
    $value = $settings[$name]
    if ($value.Length -lt 32) {
        throw "$name deve ter pelo menos 32 caracteres. Execute scripts/bootstrap-local.ps1 e revise a configuração."
    }
    if ($seenSecrets.ContainsKey($value)) {
        throw "Os segredos $name e $($seenSecrets[$value]) não podem ser iguais."
    }
    $seenSecrets[$value] = $name
}

if ($settings["API_COOKIE_SECURE"] -ne "true") {
    throw "Defina API_COOKIE_SECURE=true para produção."
}

$frontendConfig = Get-Content (Join-Path $workspace "frontend\index.html") -Raw
$frontendUrl = [regex]::Match($frontendConfig, 'window\.RFN_SUPABASE_URL\s*=\s*"([^"]+)"')
$frontendKey = [regex]::Match($frontendConfig, 'window\.RFN_SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"')
if (-not $frontendUrl.Success -or -not $frontendKey.Success) {
    throw "Não foi possível validar a configuração Supabase publicada no frontend."
}
if ($settings["SUPABASE_URL"].TrimEnd("/") -ne $frontendUrl.Groups[1].Value.TrimEnd("/") -or
    $settings["SUPABASE_PUBLISHABLE_KEY"] -ne $frontendKey.Groups[1].Value) {
    throw "SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY devem corresponder à configuração do frontend/index.html."
}

$nginxConfig = Get-Content (Join-Path $workspace "nginx\nginx.production.conf") -Raw
$serverNames = [regex]::Matches($nginxConfig, '(?m)^\s*server_name\s+([^;]+);')
if ($serverNames.Count -ne 2) {
    throw "Configure o domínio em ambos os blocos server_name de nginx/nginx.production.conf."
}
foreach ($match in $serverNames) {
    if ($match.Groups[1].Value.Trim() -ne $Domain) {
        throw "Os dois blocos server_name devem corresponder ao domínio informado em -Domain."
    }
}

foreach ($certificate in @("fullchain.pem", "privkey.pem")) {
    $certificatePath = Join-Path $workspace "certs\$certificate"
    if (-not (Test-Path $certificatePath) -or (Get-Item $certificatePath).Length -eq 0) {
        throw "Certificado ausente ou vazio: certs\$certificate"
    }
}

Push-Location $workspace
try {
    & docker compose -f docker-compose.yml -f docker-compose.production.yml config -q
    if ($LASTEXITCODE -ne 0) {
        throw "A configuração Docker Compose de produção é inválida."
    }
}
finally {
    Pop-Location
}

Write-Output "Pré-requisitos locais validados para $Domain."
Write-Warning "Isso não valida DNS, emissão/renovação do certificado, rotação de credenciais já expostas, backups/restauração, firewall, CWMP TLS nem testes de CPE."
