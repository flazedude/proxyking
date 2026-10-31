[CmdletBinding()]
param([Parameter(Mandatory)][string]$ServerConfiguration)
$ErrorActionPreference = 'Stop'
$pkRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pkLogs = Join-Path $env:LOCALAPPDATA 'ProxyKingPublisher'
New-Item -ItemType Directory -Force -Path $pkLogs | Out-Null
try {
    $pkNode = (Get-Command node -ErrorAction Stop).Source
    # PowerShell's HTTP client honors this Windows account's existing system proxy.
    # Node's built-in fetch does not, so stage public GitHub assets here first.
    $pkFeed = Invoke-RestMethod 'https://github.com/flazedude/proxyking/releases/latest/download/latest.json' -TimeoutSec 30
    $pkVersion = [string]$pkFeed.version
    if ($pkVersion -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Invalid GitHub release version.' }
    $pkName = "ProxyKing_${pkVersion}_x64-setup.exe"
    $pkBase = "https://github.com/flazedude/proxyking/releases/download/v${pkVersion}/"
    $pkPlatform = $pkFeed.platforms.'windows-x86_64'
    if ($pkPlatform.url -ne ($pkBase + $pkName) -or !$pkPlatform.signature) { throw 'Unexpected GitHub installer metadata.' }
    $pkServer = Get-Content -LiteralPath $ServerConfiguration -Raw | ConvertFrom-Json
    $pkPublic = Join-Path $pkServer.PublicDirectory 'proxyking'
    $pkCurrent = Join-Path $pkPublic 'latest.json'
    $pkPublicSignature = Join-Path $pkPublic ($pkName + '.sig')
    $pkPublicInstaller = Join-Path $pkPublic $pkName
    if ((Test-Path -LiteralPath $pkCurrent) -and (Test-Path -LiteralPath $pkPublicSignature) -and (Test-Path -LiteralPath $pkPublicInstaller)) {
        $pkSavedFeed = Get-Content -LiteralPath $pkCurrent -Raw | ConvertFrom-Json
        if ($pkSavedFeed.version -eq $pkVersion -and $pkSavedFeed.platforms.'windows-x86_64'.signature -eq $pkPlatform.signature -and (Get-Content -LiteralPath $pkPublicSignature -Raw).Trim() -eq $pkPlatform.signature) {
            & (Join-Path $pkRoot 'src-tauri/target/release/verify-release.exe') (Join-Path $pkRoot 'src-tauri/tauri.conf.json') $pkPublicSignature $pkPublicInstaller $pkVersion 2>&1 | Out-File -LiteralPath (Join-Path $pkLogs 'mirror.log') -Append -Encoding utf8
            if ($LASTEXITCODE -eq 0) { Write-Output "ProxyKing $pkVersion LAN mirror is already verified and current."; exit 0 }
        }
    }
    $pkStage = Join-Path $pkRoot "release/mirror-downloads/$pkVersion"
    New-Item -ItemType Directory -Force -Path $pkStage | Out-Null
    [IO.File]::WriteAllText((Join-Path $pkStage 'latest.json'), ($pkFeed | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    foreach ($pkAsset in @($pkName,'THIRD_PARTY_NOTICES.md','GPL-3.0.txt','sing-box-LICENSE.txt','engine-provenance.txt','npm-dependencies.json','rust-dependencies.json','sing-box-1.14.2-source.tar.gz',"proxyking-${pkVersion}-source.tar.gz")) {
        Invoke-WebRequest -Uri ($pkBase + $pkAsset) -OutFile (Join-Path $pkStage $pkAsset) -TimeoutSec 180
    }
    & $pkNode (Join-Path $PSScriptRoot 'mirror-release.mjs') --server-config $ServerConfiguration --from-directory $pkStage 2>&1 | Out-File -LiteralPath (Join-Path $pkLogs 'mirror.log') -Append -Encoding utf8
    exit $LASTEXITCODE
} catch {
    $_.Exception.Message | Out-File -LiteralPath (Join-Path $pkLogs 'mirror.log') -Append -Encoding utf8
    exit 1
}
