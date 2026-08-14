$ErrorActionPreference = "Stop"

$agentRoot = Split-Path -Parent $PSScriptRoot
$secureDir = Join-Path $agentRoot ".secure"
New-Item -ItemType Directory -Force -Path $secureDir | Out-Null

$clientId = Read-Host "Enter ima Client ID"
$apiKey = Read-Host "Enter ima API Key (input is hidden)" -AsSecureString

if ([string]::IsNullOrWhiteSpace($clientId)) {
  throw "Client ID cannot be empty."
}

$payload = [PSCustomObject]@{
  client_id = $clientId.Trim()
  api_key_dpapi = ConvertFrom-SecureString $apiKey
  created_at = (Get-Date).ToString("o")
}

$path = Join-Path $secureDir "ima-credentials.json"
$payload | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $path

Write-Host "Credentials saved for the current Windows account: $path"
Write-Host "Do not copy this file to another computer or Windows account."
