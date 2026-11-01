# ProxyKing

A Windows game accelerator for your own **Shadowsocks, VLESS, Trojan, HTTP/HTTPS, and SOCKS5** servers. Discover installed games, select exact executable paths, and choose your server. Built with React, TypeScript, Tauri 2, Rust, and a pinned sing-box engine.

Source: [flazedude/proxyking](https://github.com/flazedude/proxyking). Download published installers from [GitHub Releases](https://github.com/flazedude/proxyking/releases). For development on another computer, start with [AGENTS.md](AGENTS.md).

## Game accelerator v0.4.0

The installed app now uses the dark game library. It scans Steam library manifests, Epic installation manifests, and Windows registrations for Battle.net, Ubisoft, Riot, EA and GOG. Only entries with existing executable candidates appear; discovery does not launch or select games automatically. Choose each game's exact `.exe` files in its scope dialog. Add other apps from **Library → Processes**, or **Add .exe**. Launcher child inclusion is opt-in; existing saved choices are preserved.

Cards show store/publisher posters where available, falling back to locally extracted executable icons or bundled brand logos. Artwork loads from a small image-host allowlist without a referrer; publisher availability and network access can affect covers. No publisher artwork is bundled. The native scan is bounded to known installation roots, skips reparse points and common support tools, and never searches personal document folders. Manifest/registry discovery can miss portable games or unregistered launchers; add those executables manually.

**Import YAML / links** accepts self-contained Clash YAML and supported share links. The review shows supported server count, rejected entries and unresolved providers. This version imports supported Shadowsocks, VLESS, Trojan, HTTP/HTTPS and SOCKS5 node options; VMess, Hysteria/TUIC, plugins, external provider fetching, scripts and group execution are not implemented. Confirm importing the supported nodes; their credentials use the existing account-scoped DPAPI store. Imported TUN, DNS, proxy ports, controllers and routing rules are never applied.

**Clash coexistence:** this first version retains the existing TUN routing backend. While a recognized Clash GUI/engine is running, native connect blocks selected-process and Windows system-proxy modes before starting the engine or changing networking. If detected during such a session, ProxyKing stops its own engine and restores its own settings. Detection polls every two seconds and is not strict simultaneous-tunnel isolation. ProxyKing does not stop Clash or edit its configuration. Local proxy mode remains available but follows the underlying Windows/Clash network route and requires manual per-app configuration. The future open-source process-routing replacement remains under evaluation; see [the design and routing review](docs/GAME_ACCELERATOR.md).

Run `npm run dev` for the current inert browser interface. The earlier standalone concept remains at `npm run dev:accelerator` / [the concept preview](http://127.0.0.1:1421/accelerator.html), with sample content and metadata-only import. Neither browser entry scans the PC, persists credentials, connects, or downloads updates.

On the home LAN, download [ProxyKing setup from JACK-PC](http://192.168.2.76:17845/proxyking/ProxyKing-Setup.exe). GPD-PC uses the same `/proxyking/` path at `192.168.2.59:17845` once its shared server and mirror are set up. GitHub remains available when the LAN hosts are off.

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

Version 0.4.0 uses Play, Library, Servers, Activity and Settings navigation with an independent session panel. The updater remains available below the workspace content. Existing profiles, selected executable paths, routing preferences and the updater trust key are preserved.

## First connection

1. Choose **Add server** to enter an HTTP/HTTPS or SOCKS5 server address, port, and optional credentials. Alternatively, import provider share links (`ss://`, `vless://`, `trojan://`, `http://`, `https://`, or `socks5://` with an explicit port).
2. Select the profile you want to use. **Test** measures TCP reachability only.
3. Open **Library**, scan installed games, and select their exact executables. Alternatively open **Processes → Add from process list** and search by name, PID, or path. Rules apply to all instances, including later launches. Enable **Include child processes** explicitly to include descendants of a launcher; existing selections retain their previous behavior.
4. Choose **Use selected processes** if another mode is active. Exit Clash yourself if its GUI/engine is running. Click **Restart as administrator** if shown, approve Windows' prompt yourself, then press **Start acceleration** in the session panel. The app never connects automatically after restarting.
5. Selected processes use the proxy; unmatched and unidentified processes go direct. Windows DNS is unchanged. Disconnect before editing servers, modes, or process rules.
6. Press **Disconnect**, or close the app, to stop the engine. System-proxy mode restores settings still owned by ProxyKing.

**Settings → Routing mode** also offers Windows system proxy (for apps that honor Windows proxy preferences) and local proxy (manual per-app configuration at `127.0.0.1:2080`). Existing installs keep their previous mode; new installs default to selected processes.

**Proxy running** means the local engine is listening. TCP tests only check server reachability. Neither proves that remote credentials work; server authentication happens when traffic is sent through the proxy. You must supply a working server; no servers or subscriptions are included.

Open **Activity → Usage logging** to turn connection logging on or off, including while connected. It defaults to off and remembers your choice. Activity records only apps added in **Processes**, including their automatically included children while child tracking is active. This filter applies in every routing mode; an empty process list records no app connections. Entries show executable names, destination host/IP and port, TCP/UDP, and **Proxy** or **Direct** routing. Reused connections add entries when traffic increases, showing uploaded (↑) and downloaded (↓) bytes since the previous entry, at most once every two seconds per connection while active. Idle connections add nothing. Unrelated and unidentified processes are omitted. A log entry records an observed route, not proof of successful delivery. Only traffic handled by ProxyKing's engine is visible; this is not a device-wide browsing history.

The logger reads active and recently closed engine connections, so short requests can appear after they finish. The engine keeps up to 1,000 closed connections in memory; unavailable process attribution, child-discovery delays, or heavy traffic can still leave gaps. Connections already closed before enabling or clearing logging are excluded. Initial observations establish byte baselines; Clear resets them on the next sample, so byte changes are sampled activity rather than lifetime totals. The latest 300 usage entries stay in memory, alongside session events. **Off** stops collecting new entries and keeps existing history; **Clear** removes the displayed history. Closing the app discards it. URLs, page contents, executable directory/account paths, proxy credentials, and raw engine logs are not recorded. Browser preview never monitors connections.

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

Version 0.3.2 checks both LAN hosts and GitHub Releases at startup and every six hours, with a manual check button. It selects the newest available version and prefers matching LAN downloads. Installation verifies the signature and signed version, disconnects the proxy, and restarts the installed app. Versions 0.3.0–0.3.1 receive this first update through GitHub; older builds need one manual installation. See [updates and release instructions](docs/UPDATES.md).

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
