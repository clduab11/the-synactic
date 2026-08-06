<#
.SYNOPSIS
  Load the-synactic's app-scoped LM Studio model instances — without touching
  any other application's instances or LM Studio's per-model defaults.

.DESCRIPTION
  The chat model on this machine is shared with Msty Studio, which uses LM
  Studio's per-model default context length (e.g. 131072). the-synactic must
  neither inherit that window nor alter it. The isolation mechanism is a NAMED
  INSTANCE: this script loads the source model under the identifier the stack
  addresses (OLLAMA_MODEL in .env) with an explicit --context-length override.
  LM Studio's per-model config is never modified; instances whose identifier
  is not ours are never unloaded.

  Contract with the stack:
    .env OLLAMA_MODEL              = the INSTANCE IDENTIFIER seeders request
    .env SYNACTIC_CHAT_SOURCE_MODEL = the underlying model key to load
                                      (host-side only — not compose-plumbed)
    .env INTEL_EMBED_MODEL         = embedding model (identifier == model key)

  ⚠ A custom identifier is NOT JIT-loadable: if this script has not run,
  chat seeders reject as INSIGHTS_SYNTHESIS_PROVIDER and fall back to the
  legacy single-headline brief, and every embed hook reports
  skipped:'unconfigured'. Run this before (or with) `docker compose up` —
  start-the-synactic.ps1 does both.

  "Configured" is not "works": after loading, this script fires a 1-token
  completion at the chat identifier and an embedding request at the embedder,
  and fails loudly if either does not answer.
#>
[CmdletBinding()]
param(
  [int]$ContextLength = 16384,
  [int]$TtlSeconds = 86400,
  [string]$ApiBase = 'http://127.0.0.1:1234'
)

$ErrorActionPreference = 'Stop'
$lms = Join-Path $env:USERPROFILE '.lmstudio\bin\lms.exe'
if (-not (Test-Path $lms)) { Write-Error "lms.exe not found at $lms"; exit 1 }

# ── read the contract values from the repo .env ─────────────────────────────
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envPath = Join-Path $repoRoot '.env'
if (-not (Test-Path $envPath)) { Write-Error ".env not found at $envPath"; exit 1 }

$envMap = @{}
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $envMap[$Matches[1]] = $Matches[2].Trim()
  }
}
$chatId    = $envMap['OLLAMA_MODEL']
$chatModel = $envMap['SYNACTIC_CHAT_SOURCE_MODEL']
$embedId   = $envMap['INTEL_EMBED_MODEL']
foreach ($pair in @(@('OLLAMA_MODEL', $chatId), @('SYNACTIC_CHAT_SOURCE_MODEL', $chatModel), @('INTEL_EMBED_MODEL', $embedId))) {
  if (-not $pair[1]) { Write-Error ".env is missing $($pair[0])"; exit 1 }
}

function Get-LoadedInstances {
  $json = & $lms ps --json 2>$null
  if (-not $json) { return @() }
  return @($json | ConvertFrom-Json)
}

$instances = Get-LoadedInstances

# ── embedder: identifier == model key, fixed context ────────────────────────
$embed = $instances | Where-Object { $_.identifier -eq $embedId }
if ($embed -and $embed.contextLength -ne $ContextLength) {
  Write-Host "embedder loaded at context $($embed.contextLength), want $ContextLength — reloading OUR instance"
  & $lms unload $embedId | Out-Null
  $embed = $null
}
if (-not $embed) {
  Write-Host "loading embedder $embedId (context $ContextLength, ttl $TtlSeconds)"
  & $lms load $embedId --identifier $embedId --context-length $ContextLength --ttl $TtlSeconds --yes | Out-Null
}

# ── chat: app-scoped named instance ─────────────────────────────────────────
$chat = $instances | Where-Object { $_.identifier -eq $chatId }
if ($chat -and ($chat.contextLength -ne $ContextLength -or $chat.modelKey -ne $chatModel)) {
  Write-Host "instance '$chatId' is $($chat.modelKey)@$($chat.contextLength), want $chatModel@$ContextLength — reloading OUR instance"
  & $lms unload $chatId | Out-Null
  $chat = $null
}
if (-not $chat) {
  Write-Host "loading $chatModel as instance '$chatId' (context $ContextLength, ttl $TtlSeconds)"
  & $lms load $chatModel --identifier $chatId --context-length $ContextLength --ttl $TtlSeconds --yes | Out-Null
}

# ── verify state ─────────────────────────────────────────────────────────────
$instances = Get-LoadedInstances
$embed = $instances | Where-Object { $_.identifier -eq $embedId }
$chat  = $instances | Where-Object { $_.identifier -eq $chatId }
if (-not $embed -or $embed.contextLength -ne $ContextLength) { Write-Error "embedder not loaded at context $ContextLength"; exit 1 }
if (-not $chat -or $chat.contextLength -ne $ContextLength)   { Write-Error "chat instance '$chatId' not loaded at context $ContextLength"; exit 1 }

# ── positive controls: an instance that exists but cannot answer is not done ─
try {
  $null = Invoke-RestMethod -Method Post -Uri "$ApiBase/v1/embeddings" -ContentType 'application/json' -TimeoutSec 60 -Body (@{
    model = $embedId; input = 'ping'
  } | ConvertTo-Json)
} catch { Write-Error "embedding positive control failed: $_"; exit 1 }
try {
  $null = Invoke-RestMethod -Method Post -Uri "$ApiBase/v1/chat/completions" -ContentType 'application/json' -TimeoutSec 120 -Body (@{
    model = $chatId; max_tokens = 1; messages = @(@{ role = 'user'; content = 'ping' })
  } | ConvertTo-Json -Depth 4)
} catch { Write-Error "chat positive control failed for instance '$chatId': $_"; exit 1 }

Write-Host ''
Write-Host "OK — the-synactic instances ready (others untouched):"
foreach ($i in (Get-LoadedInstances)) {
  $mine = if ($i.identifier -in @($chatId, $embedId)) { '*' } else { ' ' }
  Write-Host ("  {0} {1,-42} ctx={2,-7} model={3}" -f $mine, $i.identifier, $i.contextLength, $i.modelKey)
}
exit 0
