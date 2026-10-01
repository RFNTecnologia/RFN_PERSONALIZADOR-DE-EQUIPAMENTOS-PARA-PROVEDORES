$ErrorActionPreference = "Stop"

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

Write-Output "MONGO_ROOT_PASSWORD=$(New-RandomHex 24)"
Write-Output "REDIS_PASSWORD=$(New-RandomHex 24)"
Write-Output "GENIEACS_UI_JWT_SECRET=$(New-RandomHex 64)"
Write-Output "API_SESSION_SECRET=$(New-RandomHex 64)"
Write-Output "API_ADMIN_PASSWORD=$(New-RandomHex 24)"