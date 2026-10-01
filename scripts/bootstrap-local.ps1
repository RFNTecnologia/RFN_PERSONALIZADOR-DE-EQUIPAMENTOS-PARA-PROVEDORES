$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $workspace ".env"
if (-not (Test-Path $envPath)) {
    throw "Arquivo .env não encontrado. Copie .env.example para .env primeiro."
}

$lines = [System.Collections.Generic.List[string]]::new()
[System.IO.File]::ReadAllLines($envPath) | ForEach-Object { $lines.Add($_) }

function Get-EnvValue([string] $Name) {
    $pattern = "^\s*$([regex]::Escape($Name))=(.*)$"
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match $pattern) {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Set-EnvValue([string] $Name, [string] $Value) {
    $pattern = "^\s*$([regex]::Escape($Name))="
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match $pattern) {
            $lines[$index] = "$Name=$Value"
            return
        }
    }
    $lines.Add("$Name=$Value")
}

function New-RandomHex([int] $ByteCount) {
    $bytes = [byte[]]::new($ByteCount)
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return [System.BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
}

if (-not (Get-EnvValue "DATABASE_URL") -and -not (Get-EnvValue "SUPABASE_DB_URL")) {
    $apiContainer = docker ps -q --filter "label=com.docker.compose.project=rfn_personalizar-roteadores" --filter "label=com.docker.compose.service=api" | Select-Object -First 1
    if (-not $apiContainer) {
        throw "DATABASE_URL ausente e API antiga não encontrada para recuperar a conexão atual."
    }

    $container = (docker inspect $apiContainer | ConvertFrom-Json)[0]
    $databaseEntry = $container.Config.Env | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1
    if (-not $databaseEntry) {
        throw "A API ativa não possui DATABASE_URL. Configure o banco manualmente no .env."
    }

    $databaseUrl = ($databaseEntry -split "=", 2)[1]
    if ($databaseUrl -notmatch '^postgres(ql)?://') {
        throw "A DATABASE_URL da API ativa não é uma URI PostgreSQL reconhecida."
    }
    if ($databaseUrl.Contains('"') -or $databaseUrl.Contains("`n") -or $databaseUrl.Contains("`r")) {
        throw "A DATABASE_URL atual não pode ser copiada com segurança para o .env."
    }

    Set-EnvValue "DATABASE_URL" ('"' + $databaseUrl.Replace('$', '$$') + '"')
}

if (-not (Get-EnvValue "API_ADMIN_USERNAME")) {
    Set-EnvValue "API_ADMIN_USERNAME" "admin"
}
if (-not (Get-EnvValue "API_ADMIN_PASSWORD")) {
    Set-EnvValue "API_ADMIN_PASSWORD" (New-RandomHex 24)
}
if (-not (Get-EnvValue "API_SESSION_SECRET")) {
    Set-EnvValue "API_SESSION_SECRET" (New-RandomHex 64)
}
if (-not (Get-EnvValue "API_COOKIE_SECURE")) {
    Set-EnvValue "API_COOKIE_SECURE" "false"
}

[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output "Configuração local salva sem exibir segredos. Usuário administrativo: $(Get-EnvValue 'API_ADMIN_USERNAME')."
Write-Output "Consulte API_ADMIN_PASSWORD no .env para entrar no painel local."