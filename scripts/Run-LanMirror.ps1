[CmdletBinding()]
param([Parameter(Mandatory)][string]$ServerConfiguration)
$ErrorActionPreference = 'Stop'
$pkRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pkLogs = Join-Path $env:LOCALAPPDATA 'ProxyKingPublisher'
New-Item -ItemType Directory -Force -Path $pkLogs | Out-Null
try {
    $pkNode = (Get-Command node -ErrorAction Stop).Source
    & $pkNode (Join-Path $PSScriptRoot 'mirror-release.mjs') --server-config $ServerConfiguration 2>&1 | Out-File -LiteralPath (Join-Path $pkLogs 'mirror.log') -Append -Encoding utf8
    exit $LASTEXITCODE
} catch {
    $_.Exception.Message | Out-File -LiteralPath (Join-Path $pkLogs 'mirror.log') -Append -Encoding utf8
    exit 1
}
