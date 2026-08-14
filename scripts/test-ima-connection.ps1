$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$agentRoot = Split-Path -Parent $PSScriptRoot
$credPath = Join-Path $agentRoot ".secure\ima-credentials.json"
if (-not (Test-Path -LiteralPath $credPath)) {
  throw "Credentials not found. Run setup-ima-credentials.ps1 first."
}

$cred = Get-Content -Raw -Encoding UTF8 -LiteralPath $credPath | ConvertFrom-Json
$secure = ConvertTo-SecureString $cred.api_key_dpapi
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

$headers = @{
  "ima-openapi-clientid" = $cred.client_id
  "ima-openapi-apikey" = $apiKey
  "Content-Type" = "application/json"
}
$body = @{ cursor = ""; limit = 20 } | ConvertTo-Json

try {
  $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "https://ima.qq.com/openapi/wiki/v1/get_addable_knowledge_base_list" -Headers $headers -Body $body
  $stream = $response.RawContentStream
  if ($stream.CanSeek) { $stream.Position = 0 }
  $memory = New-Object System.IO.MemoryStream
  $stream.CopyTo($memory)
  $jsonText = [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
  $result = $jsonText | ConvertFrom-Json
  Write-Host "IMA_CONNECTION_OK"
  $list = @($result.data.addable_knowledge_base_list)
  for ($i = 0; $i -lt $list.Count; $i++) {
    Write-Host ("[{0}] {1}" -f ($i + 1), $list[$i].name)
    Write-Host ("    ID: {0}" -f $list[$i].id)
  }
} finally {
  $apiKey = $null
}
