param(
    [switch] $InstallSchedule
)

$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $workspace ".env"
if (-not (Test-Path $envPath)) {
    throw "Arquivo .env não encontrado."
}

$settings = @{}
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^\s*([^#=\s]+)=(.*)$') {
        $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'").Replace('$$', '$')
    }
}
$databaseUrl = $settings["DATABASE_URL"]
if (-not $databaseUrl) { $databaseUrl = $settings["SUPABASE_DB_URL"] }
if (-not $databaseUrl -or $databaseUrl -notmatch '^postgres(ql)?://') {
    throw "Configure uma URI PostgreSQL em DATABASE_URL ou SUPABASE_DB_URL no .env."
}

$uri = [uri]$databaseUrl
$userInfo = $uri.UserInfo -split ":", 2
if ($userInfo.Count -ne 2) { throw "A URI PostgreSQL precisa conter usuário e senha." }
$databaseName = [uri]::UnescapeDataString($uri.AbsolutePath.TrimStart("/"))
if (-not $databaseName) { throw "A URI PostgreSQL não contém o nome do banco." }

$backupDirectory = Join-Path $env:LOCALAPPDATA "RFN_Personalizar-roteadores\backups"
$temporaryDirectory = Join-Path $env:TEMP ("rfn-db-backup-" + [guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
[System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null

$originalPgEnvironment = @{}
foreach ($name in @("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE")) {
    $originalPgEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
    $env:PGHOST = $uri.Host
    $env:PGPORT = if ($uri.IsDefaultPort) { "5432" } else { [string]$uri.Port }
    $env:PGUSER = [uri]::UnescapeDataString($userInfo[0])
    $env:PGPASSWORD = [uri]::UnescapeDataString($userInfo[1])
    $env:PGDATABASE = $databaseName
    $sslMode = $uri.Query.TrimStart("?").Split("&") | Where-Object { $_ -match '^sslmode=' } | Select-Object -First 1
    if ($sslMode) { $env:PGSSLMODE = [uri]::UnescapeDataString(($sslMode -split "=", 2)[1]) }

    $timestamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
    $archiveName = "database-$timestamp.dump"
    $archivePath = Join-Path $temporaryDirectory $archiveName
    $dockerRun = @(
        "run", "--rm", "--add-host=host.docker.internal:host-gateway",
        "--env", "PGHOST", "--env", "PGPORT", "--env", "PGUSER", "--env", "PGPASSWORD", "--env", "PGDATABASE",
        "--mount", "type=bind,source=$temporaryDirectory,target=/backup",
        "postgres:18-alpine", "pg_dump", "--format=custom", "--no-owner", "--no-acl",
        "--file=/backup/$archiveName"
    )
    if ($sslMode) { $dockerRun = $dockerRun[0..($dockerRun.Count - 3)] + @("--env", "PGSSLMODE") + $dockerRun[($dockerRun.Count - 2)..($dockerRun.Count - 1)] }
    & docker @dockerRun
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $archivePath)) { throw "pg_dump falhou; nenhum backup foi gravado." }

    $verifyRun = @(
        "run", "--rm", "--mount", "type=bind,source=$temporaryDirectory,target=/backup",
        "postgres:18-alpine", "pg_restore", "--list", "/backup/$archiveName"
    )
    & docker @verifyRun | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "O arquivo de backup não passou na verificação pg_restore --list." }

    Add-Type -AssemblyName System.Security
    $bytes = [System.IO.File]::ReadAllBytes($archivePath)
    $protected = [System.Security.Cryptography.ProtectedData]::Protect(
        $bytes,
        [System.Text.Encoding]::UTF8.GetBytes("RFN_Personalizar-roteadores database backup v1"),
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $encryptedPath = Join-Path $backupDirectory "$archiveName.dpapi"
    [System.IO.File]::WriteAllBytes($encryptedPath, $protected)

    Get-ChildItem $backupDirectory -Filter "database-*.dump.dpapi" -File |
    Where-Object { $_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddDays(-30) } |
    Remove-Item -Force

    Write-Output "Backup criptografado e verificado: $encryptedPath"
}
finally {
    foreach ($name in $originalPgEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $originalPgEnvironment[$name], "Process")
    }
    if (Test-Path $temporaryDirectory) { Remove-Item -Recurse -Force $temporaryDirectory }
}

if ($InstallSchedule) {
    $taskName = "RFN Personalizar Roteadores - Backup PostgreSQL"
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        throw "A tarefa '$taskName' já existe e não foi substituída."
    }
    $powershell = Join-Path $PSHOME "powershell.exe"
    $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Daily -At "2:15 AM"
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Backup diário criptografado do banco da plataforma RFN." | Out-Null
    Write-Output "Agendamento diário instalado para 02:15; Docker Desktop e esta conta precisam estar ativos."
}