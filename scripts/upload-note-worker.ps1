param(
  [Parameter(Mandatory=$true)][string]$ResultPath,
  [int]$FileIndex = 0,
  [string]$InputFolder = "outputs\ima\pilot"
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$root = Split-Path -Parent $PSScriptRoot

function Write-Result([hashtable]$Value) {
  $Value.time = (Get-Date).ToString("o")
  $Value | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $ResultPath
}

try {
  $cred = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root ".secure\ima-credentials.json") | ConvertFrom-Json
  $config = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root "config\ima.json") | ConvertFrom-Json
  $files = @(Get-ChildItem -LiteralPath (Join-Path $root $InputFolder) -Filter "*.md" -File | Sort-Object Name)
  if ($FileIndex -lt 0 -or $FileIndex -ge $files.Count) { throw "Markdown index is out of range: $FileIndex" }
  $file = $files[$FileIndex]
  if ($file.Length -gt 10MB) { throw "Markdown note exceeds ima 10 MB limit." }
  $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
  if ([string]::IsNullOrWhiteSpace($content)) { throw "Markdown note is empty: $($file.Name)" }
  $title = $file.BaseName
} catch {
  Write-Result @{status="startup_failed";error=$_.Exception.Message}
  exit 1
}

$secure = ConvertTo-SecureString $cred.api_key_dpapi
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

function Api([string]$Path, [hashtable]$Body) {
  $json = $Body | ConvertTo-Json -Depth 15 -Compress
  $handler = New-Object Net.Http.HttpClientHandler
  $client = New-Object Net.Http.HttpClient($handler)
  $client.Timeout = [Threading.Timeout]::InfiniteTimeSpan
  $cancel = New-Object Threading.CancellationTokenSource
  $requestContent = $null
  try {
    $client.DefaultRequestHeaders.Add("ima-openapi-clientid", [string]$cred.client_id)
    $client.DefaultRequestHeaders.Add("ima-openapi-apikey", [string]$key)
    $requestContent = New-Object Net.Http.StringContent($json, [Text.Encoding]::UTF8, "application/json")
    $task = $client.PostAsync(("https://ima.qq.com/" + $Path), $requestContent, $cancel.Token)
    if (-not $task.Wait(30000)) {
      $cancel.Cancel()
      throw "IMA request timed out after 30 seconds: $Path"
    }
    $response = $task.GetAwaiter().GetResult()
    $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { throw "IMA HTTP $([int]$response.StatusCode): $responseText" }
    $result = $responseText | ConvertFrom-Json
    $status = if ($null -ne $result.retcode) { $result.retcode } else { $result.code }
    if ($status -ne 0) {
      $message = if ($result.errmsg) { $result.errmsg } else { $result.msg }
      throw "IMA API failed ($status): $message"
    }
    return $result
  } finally {
    if ($requestContent) { $requestContent.Dispose() }
    $cancel.Dispose()
    $client.Dispose()
    $handler.Dispose()
  }
}

$noteId = ""
try {
  # check_repeated_names is file-only; notes must be checked through KB search.
  $existing = Api "openapi/wiki/v1/search_knowledge" @{
    query = $title
    cursor = ""
    knowledge_base_id = $config.knowledge_base_id
  }
  $existingItems = if ($existing.data.info_list) { @($existing.data.info_list) } else { @() }
  if ($existingItems | Where-Object { $_.title -eq $file.Name }) {
    Write-Result @{status="legacy_file_replace_required";enterprise=$file.BaseName;legacy_title=$file.Name;target_title=$title;media_type=7;editable_note=$false}
    exit 0
  }
  if ($existingItems | Where-Object { $_.title -eq $title }) {
    Write-Result @{status="skipped_existing";enterprise=$file.BaseName;title=$title;media_type=11;editable_note=$true}
    exit 0
  }

  $imported = Api "openapi/note/v1/import_doc" @{
    title = $title
    content_format = 1
    content = $content
  }
  $noteId = $imported.data.note_id
  if (-not $noteId) { $noteId = $imported.data.content_id }
  if (-not $noteId) { $noteId = $imported.data.doc_id }
  if (-not $noteId) { throw "import_doc returned no note ID." }

  $null = Api "openapi/wiki/v1/add_knowledge" @{
    media_type = 11
    title = $title
    knowledge_base_id = $config.knowledge_base_id
    note_info = @{content_id=$noteId}
  }
  Write-Result @{status="uploaded";enterprise=$file.BaseName;title=$title;note_id=$noteId;media_type=11;editable_note=$true}
} catch {
  $status = if ($noteId) { "note_created_kb_add_failed" } else { "failed" }
  Write-Result @{status=$status;enterprise=$file.BaseName;title=$title;note_id=$noteId;error=$_.Exception.Message;editable_note=$true}
  exit 1
} finally {
  $key = $null
}
