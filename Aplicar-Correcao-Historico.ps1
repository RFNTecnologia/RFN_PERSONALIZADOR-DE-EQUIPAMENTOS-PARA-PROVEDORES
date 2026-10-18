$ErrorActionPreference = 'Stop'
$serverFile = Join-Path $PSScriptRoot 'backend\server.js'

if (-not (Test-Path -LiteralPath $serverFile)) {
    throw 'Não encontrei backend\server.js. Extraia o ZIP na pasta principal do projeto RFN e execute novamente.'
}

$content = [System.IO.File]::ReadAllText($serverFile)
$pattern = '          set status=\$1, status_note=\$2, observed_summary=\$3::jsonb,\r?\n              last_observed_at=now\(\),\r?\n              confirmed_at=case when \$1=''confirmed'' then coalesce\(confirmed_at, now\(\)\) else null end,\r?\n              updated_at=now\(\)\r?\n        where id=\$4`,\r?\n      \[status, note, JSON\.stringify\(\{ \.\.\.snapshot, mismatchedPaths: mismatches \}\), operation\.id\]'

$count = [regex]::Matches($content, $pattern).Count
if ($count -ne 1) {
    throw "Não apliquei nenhuma alteração: esperava encontrar exatamente 1 bloco conhecido, mas encontrei $count. O arquivo foi preservado."
}

$newBlock = @'
          set status=$1, status_note=$2, observed_summary=$3::jsonb,
              last_observed_at=now(),
              confirmed_at=case when $5::boolean then coalesce(confirmed_at, now()) else null end,
              updated_at=now()
        where id=$4`,
      [status, note, JSON.stringify({ ...snapshot, mismatchedPaths: mismatches }), operation.id, confirmed]
'@
$newBlock = $newBlock.TrimEnd("`r", "`n")
$regex = [System.Text.RegularExpressions.Regex]::new($pattern)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = "$serverFile.bak-$stamp"
Copy-Item -LiteralPath $serverFile -Destination $backupFile
$updated = $regex.Replace($content, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $newBlock }, 1)
[System.IO.File]::WriteAllText($serverFile, $updated, [System.Text.UTF8Encoding]::new($false))

Write-Host 'Correção aplicada ao histórico de provisionamento.' -ForegroundColor Green
Write-Host "Backup salvo em: $backupFile"
Write-Host 'Próximo passo: docker compose up -d --build api nginx'
