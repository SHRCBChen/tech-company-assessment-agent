param(
  [string]$SkillInstallPath = ""
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $SkillInstallPath) {
  $SkillInstallPath = Join-Path $env:USERPROFILE ".codex\skills\batch-tech-company-assessment"
}
New-Item -ItemType Directory -Force -Path $SkillInstallPath | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "skill\SKILL.md") -Destination (Join-Path $SkillInstallPath "SKILL.md") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $SkillInstallPath "agents"),(Join-Path $SkillInstallPath "references") | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "skill\agents\openai.yaml") -Destination (Join-Path $SkillInstallPath "agents\openai.yaml") -Force
Get-ChildItem -LiteralPath (Join-Path $repoRoot "skill\references") -File | Copy-Item -Destination (Join-Path $SkillInstallPath "references") -Force
[Environment]::SetEnvironmentVariable("TECH_COMPANY_AGENT_ROOT", $repoRoot, "User")
$imaConfig = Join-Path $repoRoot "config\ima.json"
if (-not (Test-Path -LiteralPath $imaConfig)) {
  Copy-Item -LiteralPath (Join-Path $repoRoot "config\ima.example.json") -Destination $imaConfig
}
Write-Host "Installed skill: $SkillInstallPath"
Write-Host "Saved TECH_COMPANY_AGENT_ROOT for the current Windows user: $repoRoot"
Write-Host "Restart Codex or the terminal before first use."

