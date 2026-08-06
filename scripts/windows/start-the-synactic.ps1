<#
.SYNOPSIS
  Launch the-synactic: app-scoped LM Studio instances first, then the stack.

.DESCRIPTION
  1. ensure-local-models.ps1 — loads the chat instance (identifier from
     OLLAMA_MODEL) and the embedder at the-synactic's context length WITHOUT
     touching LM Studio per-model defaults or other apps' instances.
  2. docker compose up -d — twelve services.
  3. A short health probe so a broken boot is loud, not discovered later.

  Msty Studio keeps using the model under its own name at LM Studio's
  configured default context; the-synactic only ever addresses its named
  instance.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

& (Join-Path $PSScriptRoot 'ensure-local-models.ps1')
if ($LASTEXITCODE -ne 0) { Write-Error 'model ensure failed — not starting the stack'; exit 1 }

Push-Location $repoRoot
try {
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { Write-Error 'docker compose up failed'; exit 1 }
} finally { Pop-Location }

Write-Host 'waiting for the app to answer…'
$deadline = (Get-Date).AddSeconds(90)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 5
    if ($r.summary) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 3 }
}
if (-not $healthy) { Write-Error 'stack did not answer /api/health within 90s'; exit 1 }
Write-Host ("stack up — {0} ok / {1} warn / {2} crit of {3} checks" -f $r.summary.ok, $r.summary.warn, $r.summary.crit, $r.summary.total)
Write-Host 'open the installed PWA, or http://127.0.0.1:3000/dashboard'
exit 0
