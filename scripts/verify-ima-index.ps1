param(
  [string]$DossierPath = ""
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$root = Split-Path -Parent $PSScriptRoot
$cred = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root ".secure\ima-credentials.json") | ConvertFrom-Json
$config = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root "config\ima.json") | ConvertFrom-Json
$secure = ConvertTo-SecureString $cred.api_key_dpapi
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$headers = @{
  "ima-openapi-clientid" = $cred.client_id
  "ima-openapi-apikey" = $key
  "Content-Type" = "application/json; charset=utf-8"
}
$dossierDir = if ($DossierPath) {
  (Resolve-Path -LiteralPath $DossierPath).Path
} else {
  $formal = Join-Path $root "outputs\ima-v3\current-dossiers"
  if (Test-Path -LiteralPath $formal) {
    $formal
  } else {
    $latest = Get-ChildItem -LiteralPath (Join-Path $root "runs") -Recurse -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like "*deliverables*ima-ready" } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if (-not $latest) { throw "No ima-ready dossier directory found. Pass -DossierPath explicitly." }
    $latest.FullName
  }
}
$separator = [char]0xFF5C
$queries = @(Get-ChildItem -LiteralPath $dossierDir -Filter "*.md" -File | Sort-Object Name | ForEach-Object {
  $baseName = $_.BaseName
  $query = ($baseName -split [regex]::Escape([string]$separator), 2)[0]
  [PSCustomObject]@{
    query = $query
    expected_file_name = $_.Name
    expected_base_name = $baseName
  }
})
if ($queries.Count -eq 0) { throw "No current dossier found for index verification." }
$results = @()
try {
  foreach ($queryItem in $queries) {
    $q = $queryItem.query
    $body = @{ query=$q; cursor=""; knowledge_base_id=$config.knowledge_base_id } | ConvertTo-Json -Compress
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "https://ima.qq.com/openapi/wiki/v1/search_knowledge" -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
    $stream = $response.RawContentStream
    if ($stream.CanSeek) { $stream.Position = 0 }
    $memory = New-Object IO.MemoryStream
    $stream.CopyTo($memory)
    $jsonText = [Text.Encoding]::UTF8.GetString($memory.ToArray())
    $r = $jsonText | ConvertFrom-Json
    $status = if ($null -ne $r.retcode) { $r.retcode } else { $r.code }
    $items = @(if ($r.data.info_list) { $r.data.info_list })
    $matchCount = @($items).Count
    $titles = @($items | Select-Object -First 5 -ExpandProperty title)
    $exactTitleMatch = @($titles | Where-Object {
      $_ -eq $queryItem.expected_file_name -or $_ -eq $queryItem.expected_base_name
    }).Count -gt 0
    $results += [PSCustomObject]@{ query=$q; expected_file_name=$queryItem.expected_file_name; api_status=$status; matches=$matchCount; exact_title_match=$exactTitleMatch; titles=$titles }
    Write-Host ("{0}: {1} match(es), exact title: {2}" -f $q,$matchCount,$exactTitleMatch)
    $items | Select-Object -First 3 | ForEach-Object { Write-Host ("  - " + $_.title) }
  }
} finally { $key=$null }
$path = Join-Path $root ("outputs\sync\index-verification-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
$results | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $path
Write-Host ("Verified {0} current dossier name(s)." -f $results.Count)
Write-Host "Verification log: $path"
