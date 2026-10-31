[CmdletBinding()]
param([Parameter(Mandatory)][string]$ServerConfiguration)
$ErrorActionPreference = 'Stop'
$pkRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pkConfiguration = (Resolve-Path -LiteralPath $ServerConfiguration).Path
$pkServer = Get-Content -LiteralPath $pkConfiguration -Raw | ConvertFrom-Json
if ($pkServer.Address -notin @('192.168.2.76','192.168.2.59') -or $pkServer.Port -ne 17845 -or !(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $pkServer.Address)) { throw 'Use this PC''s existing HappyCheats LAN host configuration.' }
if (!(Test-Path -LiteralPath (Join-Path $pkRoot 'src-tauri/target/release/verify-release.exe'))) { throw 'Build the public verifier first: cargo build --manifest-path src-tauri/Cargo.toml --release --locked --bin verify-release' }
$pkPowerShell = (Get-Process -Id $PID).Path
$pkEntry = Join-Path $PSScriptRoot 'Run-LanMirror.ps1'
$pkArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "' + $pkEntry + '" -ServerConfiguration "' + $pkConfiguration + '"'
$pkTaskName = 'ProxyKing LAN Mirror'
$pkOld = Get-ScheduledTask -TaskName $pkTaskName -ErrorAction SilentlyContinue
if ($pkOld -and ($pkOld.Actions.Count -ne 1 -or $pkOld.Actions[0].Arguments -ne $pkArguments)) { throw 'An unrelated task already uses the ProxyKing LAN Mirror name.' }
$pkIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$pkPrincipal = New-ScheduledTaskPrincipal -UserId $pkIdentity.Name -LogonType S4U -RunLevel Limited
$pkAction = New-ScheduledTaskAction -Execute $pkPowerShell -Argument $pkArguments -WorkingDirectory $pkRoot
$pkBoot = New-ScheduledTaskTrigger -AtStartup
$pkBoot.Delay = 'PT1M'
$pkRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$pkSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $pkTaskName -Action $pkAction -Trigger @($pkBoot,$pkRepeat) -Principal $pkPrincipal -Settings $pkSettings -Force | Out-Null
Start-ScheduledTask -TaskName $pkTaskName
Write-Output 'ProxyKing LAN mirror enabled at startup and every five minutes. Serving and client installation remain separate.'
