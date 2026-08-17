param(
  [Parameter(Mandatory=$true)][string]$RunPath,
  [Parameter(Mandatory=$true)][string]$ApprovedBy
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$root = Split-Path -Parent $PSScriptRoot
$run = (Resolve-Path -LiteralPath $RunPath).Path
$validationPath = Join-Path $run "review\validation.json"
$manifestPath = Join-Path $run "manifest.json"
$readyDir = Join-Path $run "deliverables\ima-ready"
if (-not (Test-Path -LiteralPath $validationPath)) { throw "没有审核结果，请先生成三件成果。" }
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "批次清单不存在。" }
if (-not (Test-Path -LiteralPath $readyDir)) { throw "ima待同步目录不存在。" }
$validation = Get-Content -Raw -Encoding UTF8 -LiteralPath $validationPath | ConvertFrom-Json
$blocked = @($validation.companies | Where-Object { $_.status -ne "ready_for_review" })
if ($blocked.Count -gt 0) { throw ("仍有{0}家企业未通过质检，禁止正式同步。" -f $blocked.Count) }
$files = @(Get-ChildItem -LiteralPath $readyDir -Filter "*｜当前事实底稿.md" -File | Sort-Object Name)
if ($files.Count -eq 0) { throw "没有可同步的企业当前事实底稿。" }
$logDir = Join-Path $run "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$results = @()
for ($i = 0; $i -lt $files.Count; $i++) {
  $itemResult = Join-Path $logDir ("ima-sync-" + (Get-Date -Format "yyyyMMddHHmmssfff") + "-" + $i + ".json")
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "upload-note-worker.ps1") -ResultPath $itemResult -FileIndex $i -InputFolder ([IO.Path]::GetRelativePath($root, $readyDir))
  if (-not (Test-Path -LiteralPath $itemResult)) { throw "ima上传未返回结果：$($files[$i].Name)" }
  $result = Get-Content -Raw -Encoding UTF8 -LiteralPath $itemResult | ConvertFrom-Json
  if ($result.status -eq "skipped_existing") {
    $result | Add-Member -NotePropertyName next_action -NotePropertyValue "知识库中已有同名可编辑笔记；本地三件成果已更新，但官方OpenAPI未提供全文覆盖接口，需在ima界面确认替换后再核验。" -Force
  }
  $results += $result
  Write-Host ("[{0}/{1}] {2}: {3}" -f ($i + 1), $files.Count, $files[$i].Name, $result.status)
}
$summary = [ordered]@{
  approved_by = $ApprovedBy
  approved_at = (Get-Date).ToString("o")
  run_path = $run
  uploaded = @($results | Where-Object {$_.status -eq "uploaded"}).Count
  existing_requires_replace = @($results | Where-Object {$_.status -eq "skipped_existing"}).Count
  failed = @($results | Where-Object {$_.status -in @("failed","startup_failed","note_created_kb_add_failed")}).Count
  items = $results
}
$summaryPath = Join-Path $logDir ("approved-ima-sync-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
$summary | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath $summaryPath
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
$manifest.current_stage = if ($summary.failed -gt 0) { "ima_sync_failed" } elseif ($summary.existing_requires_replace -gt 0) { "ima_replace_required" } else { "complete" }
$manifest | Add-Member -NotePropertyName approval -NotePropertyValue ([ordered]@{approved_by=$ApprovedBy;approved_at=$summary.approved_at;sync_log=$summaryPath}) -Force
$manifest | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $manifestPath
Write-Host "IMA_SYNC_SUMMARY: $summaryPath"
