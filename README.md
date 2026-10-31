# ProxyKing

A Windows-first desktop client for your own **Shadowsocks, VLESS, Trojan, HTTP/HTTPS, and SOCKS5** servers. Built with React, TypeScript, Tauri 2, Rust, and a pinned sing-box engine.

Source: [flazedude/proxyking](https://github.com/flazedude/proxyking). Download published installers from [GitHub Releases](https://github.com/flazedude/proxyking/releases). For development on another computer, start with [AGENTS.md](AGENTS.md).

## Open the Windows app

Double-click `release/ProxyKing/ProxyKing.exe`, or the **ProxyKing** desktop shortcut when available. This is the real desktop app and does not need Node.js or a browser to run. Keep its `resources` folder alongside the executable. Add your server, choose processes, and connect as described below.

For an installed copy, run `release/ProxyKing-Setup.exe` when present. The browser preview is only for interface development and cannot connect.

## Run on Windows x64

Install Node.js 22.12+ (or a supported newer LTS), Rust 1.90+, and the [Windows prerequisites for Tauri](https://v2.tauri.app/start/prerequisites/#windows). WebView2 is normally included with Windows 10/11. Tauri recommends the MSVC Rust toolchain and Microsoft C++ Build Tools for release development.

```powershell
npm ci
npm run setup:engine
npm run desktop
```

The engine setup downloads the official **sing-box 1.14.2 Windows amd64** archive, verifies its pinned SHA-256, and installs the executable into `src-tauri/resources`. It does not change your Windows network settings. `tar.exe`, included with modern Windows, extracts the archive. Selected-process routing requires administrator access. System-proxy and local-only modes work without elevation.

To build an installer:

```powershell
npm run desktop:build
```

The NSIS installer is written to `src-tauri/target/release/bundle/nsis`. Locally generated builds are unsigned.

After building, run `npm run package:windows` to collect the app and its engine in `release/ProxyKing`, and the installer in `release/ProxyKing-Setup.exe`.

For an interface-only browser preview:

```powershell
npm run dev
```

Open [the local preview](http://127.0.0.1:1420). Browser preview profiles live only in memory; it cannot connect, test servers, or change your network.

## First connection

1. Choose **Add server** to enter an HTTP/HTTPS or SOCKS5 server address, port, and optional credentials. Alternatively, import provider share links (`ss://`, `vless://`, `trojan://`, `http://`, `https://`, or `socks5://` with an explicit port).
2. Select the profile you want to use. **Test** measures TCP reachability only.
3. Open **Processes → Add from process list**. Search by name, PID, or path and select the executables to tunnel. Rules apply to all instances, including later launches. Enable **Include child processes** for a launcher such as Steam or Battle.net to automatically discover its games and helpers, including grandchildren. Newly selected executables enable this by default; existing selections retain their previous behavior.
4. Choose **Use selected processes** if another mode is active. Click **Restart as administrator**, approve Windows' prompt yourself, then press **Connect** in Overview. The app never connects automatically after restarting.
5. Selected processes use the proxy; unmatched and unidentified processes go direct. Windows DNS is unchanged. Disconnect before editing servers, modes, or process rules.
6. Press **Disconnect**, or close the app, to stop the engine. System-proxy mode restores settings still owned by ProxyKing.

**Settings → Routing mode** also offers Windows system proxy (for apps that honor Windows proxy preferences) and local proxy (manual per-app configuration at `127.0.0.1:2080`). Existing installs keep their previous mode; new installs default to selected processes.

**Proxy running** means the local engine is listening. TCP tests only check server reachability. Neither proves that remote credentials work; server authentication happens when traffic is sent through the proxy. You must supply a working server; no servers or subscriptions are included.

## Included in this milestone

- Overview, searchable profile library, rename/delete, activity, and connection settings.
- Manual HTTP/HTTPS and SOCKS5 servers with optional authentication.
- Native running-process picker, saved executable-path rules, and selected-process TUN routing with direct fallback.
- Recursive launcher child tracking with temporary rules updated while connected, and a visible list of automatically included child executables. Discovery is asynchronous; initial connections can go direct. Service-launched games and very short-lived intermediary launchers may need explicit selection.
- Explicit administrator restart for Windows TUN access; no automatic elevation or connection.
- Strict share-link parsing, percent/Base64 decoding, Unicode names, IPv6, and duplicate detection.
- Shadowsocks SIP002/legacy and supported 2022 variants; VLESS/Trojan TLS and Reality; TCP, WebSocket, and standard gRPC.
- Unsupported transports and query options fail visibly rather than silently changing a profile.
- Windows account-scoped DPAPI encryption for stored profiles. Browser local storage is never used for credentials.
- Loopback-only mixed HTTP/SOCKS5 proxy on configurable port 2080 by default.
- Per-user Windows proxy snapshot/restore, encrypted crash-recovery journal, single-instance guard, and supervised engine lifetime.
- Configuration passed to the engine over stdin; credentials are not written to a temporary config or command line.

## Current boundaries

This is an early Windows x64 build. Selected-process mode uses a Windows TUN interface to handle traffic and route matching executable paths through the proxy. Other traffic goes direct. It does not isolate DNS per app, enforce a kill switch, or prevent traffic from taking a direct path when process identification fails. HTTP proxies carry TCP only; UDP support depends on the chosen protocol and server. See [process-routing details](docs/PROCESS_ROUTING.md).

Force-killing ProxyKing or restarting Windows prevents normal cleanup. Its engine is terminated with the app; launch ProxyKing again to recover the previous settings. If recovery fails, the app shows an error with **Retry cleanup**. If Internet access is unavailable before relaunch, check Windows **Settings → Network & internet → Proxy** for a stale `127.0.0.1` entry. ProxyKing preserves unrelated newer proxy changes.

Version 0.3.0 adds automatic signed-update checks through GitHub Releases at startup and every six hours, a manual check button, and installation after explicit selection. Installation verifies the download, disconnects the proxy, and restarts the installed app. Older builds need one manual installation. See [updates and release instructions](docs/UPDATES.md).

Subscription URL fetching, QR scanning, traffic accounting, auto-connect, tray mode, and a kill switch are future features. No remote telemetry or account service is implemented.

The shared interface and native service boundaries are intended for macOS, Android, and iOS. Those platforms are **not implemented yet**. Android needs a native `VpnService`; iOS needs a Network Extension and a macOS/Xcode build environment. See the [architecture and platform roadmap](docs/ARCHITECTURE.md).

## Checks

```powershell
npm test
npm run build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

Importer tests cover malformed and credential-bearing input. Real-engine checks validate protocol configurations without changing the network. Rust tests cover validation, encryption, restoration decisions, and local engine lifecycle. Engine-dependent tests require `npm run setup:engine` and Windows; they skip when the bundled engine is absent. The tests never apply Windows proxy settings.

## Project layout

```text
src/                   React interface and native command adapter
src/lib/profiles.ts    Share-link parser and sing-box outbound mapping
src-tauri/src/         Rust lifecycle, WinINet proxy adapter, DPAPI storage
src-tauri/resources/   Verified engine and upstream license
scripts/              Reproducible engine setup
docs/                 Architecture and platform roadmap
```

Read [third-party notices](THIRD_PARTY_NOTICES.md) before public distribution. sing-box is GPL-3.0-or-later; an installer distribution needs the required notices and corresponding source. A distribution license for ProxyKing itself has not been assigned.
