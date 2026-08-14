param(
  [Parameter(Mandatory=$true)][string]$ResultPath,
  [int]$FileIndex = 0,
  [string]$InputFolder = "outputs\ima\pilot"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
try {
  $cred = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root ".secure\ima-credentials.json") | ConvertFrom-Json
  $config = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root "config\ima.json") | ConvertFrom-Json
  $pilotFiles = @(Get-ChildItem -LiteralPath (Join-Path $root $InputFolder) -Filter "*.md" -File | Sort-Object Name)
  if ($FileIndex -lt 0 -or $FileIndex -ge $pilotFiles.Count) { throw "Pilot file index is out of range: $FileIndex" }
  $file = $pilotFiles[$FileIndex]
  if ($file.Length -gt 10MB) { throw "Markdown file exceeds ima 10 MB limit." }
} catch {
  @{status="startup_failed";error=$_.Exception.Message;time=(Get-Date).ToString("o")}|ConvertTo-Json|Set-Content -Encoding UTF8 -LiteralPath $ResultPath
  exit 1
}

$secure = ConvertTo-SecureString $cred.api_key_dpapi
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$headers = @{ "ima-openapi-clientid"=$cred.client_id; "ima-openapi-apikey"=$key; "Content-Type"="application/json; charset=utf-8" }

function Api([string]$path, [hashtable]$body) {
  $json = $body | ConvertTo-Json -Depth 15 -Compress
  $r = Invoke-RestMethod -Method Post -Uri ("https://ima.qq.com/" + $path) -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($json))
  $status = if ($null -ne $r.retcode) { $r.retcode } else { $r.code }
  if ($status -ne 0) { throw ("API failed: " + ($r.errmsg, $r.msg -ne $null | Select-Object -First 1)) }
  return $r
}

try {
  $dup = Api "openapi/wiki/v1/check_repeated_names" @{ params=@(@{name=$file.Name;media_type=7}); knowledge_base_id=$config.knowledge_base_id }
  $dupItems = if ($dup.data.results) { @($dup.data.results) } else { @() }
  if ($dupItems | Where-Object { $_.is_repeated }) {
    @{status="skipped_existing";enterprise=$file.BaseName;file_name=$file.Name;time=(Get-Date).ToString("o")}|ConvertTo-Json|Set-Content -Encoding UTF8 -LiteralPath $ResultPath
    exit 0
  }

  $created = Api "openapi/wiki/v1/create_media" @{
    file_name=$file.Name; file_size=$file.Length; content_type="text/markdown";
    knowledge_base_id=$config.knowledge_base_id; file_ext="md"
  }
  $d = $created.data
  $c = $d.cos_credential
  if (-not $d.media_id -or -not $c.cos_key) { throw "create_media returned incomplete upload credentials." }

  $node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (-not (Test-Path -LiteralPath $node)) { throw "Bundled Node.js runtime not found: $node" }
  $uploader = Join-Path $root "vendor\ima-skills-1.1.2\ima-skill\knowledge-base\scripts\cos-upload.cjs"
  if (-not (Test-Path -LiteralPath $uploader)) { throw "Official ima COS uploader not found: $uploader" }
  $args = @($uploader,"--file",$file.FullName,"--secret-id",$c.secret_id,"--secret-key",$c.secret_key,"--token",$c.token,"--bucket",$c.bucket_name,"--region",$c.region,"--cos-key",$c.cos_key,"--content-type","text/markdown","--start-time",[string]$c.start_time,"--expired-time",[string]$c.expired_time)
  & $node @args | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Official COS uploader failed with exit code $LASTEXITCODE." }

  $added = Api "openapi/wiki/v1/add_knowledge" @{
    media_type=7; media_id=$d.media_id; title=$file.Name; knowledge_base_id=$config.knowledge_base_id;
    file_info=@{cos_key=$c.cos_key;file_size=$file.Length;last_modify_time=[DateTimeOffset]::Now.ToUnixTimeSeconds();file_name=$file.Name}
  }
  @{status="uploaded";enterprise=$file.BaseName;file_name=$file.Name;time=(Get-Date).ToString("o")} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $ResultPath
} catch {
  @{status="failed";enterprise=$file.BaseName;error=$_.Exception.Message;time=(Get-Date).ToString("o")} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $ResultPath
  exit 1
} finally { $key=$null }
