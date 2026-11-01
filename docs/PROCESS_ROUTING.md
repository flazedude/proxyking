# Selected-app routing on Windows

Version 0.4.0 adds installed-game cards and explicit executable selection in Library. Fresh game/process choices exclude children until explicitly enabled; saved child preferences are preserved. Known Clash GUI/engine names block selected-process/system-proxy connect before engine startup or networking changes. Supervision polls for those names every two seconds and stops ProxyKing's owned session if detected or inspection fails. The guard neither stops Clash nor edits its configuration. It is conservative conflict avoidance, not proven simultaneous TUN isolation; renamed/unknown tunnels and transitions between polls remain outside its guarantee. Local proxy mode does not add a TUN/system proxy and is exempt, but follows the underlying network. No new driver is installed.

ProxyKing can route selected Windows applications through a saved proxy server. Add the server manually or import a supported share link, open **Processes**, select applications from the running-process picker, and enable **Use selected processes** if another mode is active. This mode needs administrator access to create the virtual network adapter. Use **Restart as administrator**, approve Windows' UAC prompt yourself, then connect from Overview.

The selection is an executable path, not a process ID. All instances of that executable match, including instances started later. Enable **Include child processes** on a launcher such as Steam or Battle.net to discover its games and helpers automatically. New selections leave this off until you opt in; existing saved preferences are preserved. After changing the selection or connecting, restart the target app or make a new connection; existing connections are not migrated reliably.

## Launcher child processes

Child inclusion recursively follows Windows parent IDs and process creation times, including grandchildren. It detects existing descendants when connecting and samples for new children every 250 ms while connected. A discovered child remains included if its launcher exits, and can bring in its own children while it remains alive. Creation times prevent an unrelated process from inheriting a reused PID. Unknown or inaccessible processes remain direct.

The **Automatically included children** panel lists discovered executable paths and their selected launcher. These are temporary path rules, not permanent additions to your saved selection. As with explicit selections, all instances of a discovered executable path match, including instances started independently. A child path is removed when its last tracked instance exits; all child rules are cleared on disconnect. Existing connections are not migrated or cut off by a rule change.

This feature updates a local [sing-box rule set](https://sing-box.sagernet.org/configuration/rule-set/), which the engine reloads without restarting the tunnel. The runtime file contains executable-path patterns only; it contains no proxy credentials and is removed on ordinary cleanup. An interrupted app can leave a harmless unused rules file behind.

Discovery and rule reloading are asynchronous and can take a few seconds. Initial connections can go direct. A very short-lived intermediate launcher can disappear between samples, and a game started by an independent Windows service is not necessarily a child of the visible launcher. Add those executables explicitly, or start the game before connecting so its readable ancestry is present at connection time. Child inclusion is a convenience feature, not strict per-process network isolation.

## Routing behavior

- The Windows TUN adapter receives traffic according to the engine's automatic routes. Selected executable paths use the chosen proxy outbound; unmatched or unidentified processes use the direct outbound.
- Path rules are anchored, escaped, and case insensitive. Selecting `C:\Apps\Example\app.exe` does not select another `app.exe` elsewhere.
- The process picker uses Windows process-image queries. Protected processes and processes whose paths cannot be read are omitted. ProxyKing and its connection engine are excluded.
- This mode does not enable the Windows system HTTP proxy. **System proxy** and **Local proxy** remain separate routing modes.
- A direct outbound means sing-box connects directly to the destination it receives. An application's own proxy configuration or another VPN can still affect that destination or the underlying network route.

Process ownership is determined when a connection is routed. Services, helper processes, inaccessible process metadata, and connections created before the tunnel starts can affect attribution. Unknown ownership goes direct. Selected-app mode is not a kill switch or a guarantee that every packet from an application can be identified.

## Engine configuration

The implementation targets the bundled sing-box 1.14.2 engine:

| Setting                       | Value and purpose                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| TUN `address`                 | IPv4 and IPv6 addresses for the virtual adapter                                                         |
| `auto_route`                  | `true`, so traffic reaches the TUN adapter                                                              |
| `route.auto_detect_interface` | `true`, so engine outbounds use the underlying default interface and avoid routing back into the tunnel |
| `process_path_regex`          | Escaped, anchored, case-insensitive rules for selected executable paths                                 |
| `route.final`                 | `direct`, so other and unidentified applications do not use the selected proxy                          |
| `dns_mode`                    | `disabled`, preserving the existing system DNS setup instead of configuring or hijacking it             |
| `strict_route`                | `false`, avoiding the engine's additional strict-routing restrictions                                   |
| Local listener                | HTTP/SOCKS on `127.0.0.1`; its connections use the same process-routing rules                           |

The [versioned TUN documentation](https://github.com/SagerNet/sing-box/blob/v1.14.2/docs/configuration/inbound/tun.md) describes these adapter options. The [route documentation](https://sing-box.sagernet.org/configuration/route/) explains interface detection, and the [process-path matcher source](https://github.com/SagerNet/sing-box/blob/v1.14.2/route/rule/rule_item_process_path_regex.go) shows how regex rules are applied.

Windows DNS is often performed by a shared system process, so this mode does not promise per-application DNS isolation. DNS generated by an application's own networking code follows whichever process rule applies to that connection. HTTP proxies generally support TCP traffic; a selected application that needs UDP also needs an upstream protocol and server that support it.

## Driver and lifecycle

The pinned engine already embeds Wintun 0.14.1; ProxyKing does not require a separately downloaded `wintun.dll`. This is visible in sing-tun's [embedded AMD64 DLL declaration](https://github.com/SagerNet/sing-tun/blob/ddaa4ca25e3b/internal/wintun/dll_windows_amd64.go) and [version record](https://github.com/SagerNet/sing-tun/blob/ddaa4ca25e3b/internal/wintun/README.md). Recheck this assumption when upgrading the engine.

Windows requires elevation for [software-device creation](https://learn.microsoft.com/en-us/windows/win32/api/swdevice/nf-swdevice-swdevicecreate) and [route creation](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/nf-netioapi-createipforwardentry2). Local proxy and system proxy modes do not require TUN elevation.

The engine is supervised by ProxyKing and attached to a Windows Job Object so it does not remain running after the app process exits. Wintun's software device uses a handle-based lifetime. Actual adapter removal, routing restoration, and reconnect behavior still need verification in an elevated Windows session; the automated tests below deliberately do not create an adapter.

## Automated verification

From the repository root, after `npm run setup:engine`:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib routing_tests::real_engine_routes_only_selected_executable_without_tun -- --exact --nocapture
```

This test builds the production selected-app configuration and asks the real engine to validate it with `check`. It then removes only the TUN inbound before starting the engine, retaining the production routing rules and direct fallback. Two separate executable paths connect through the local SOCKS listener: the selected path must receive a response from a local mock HTTP proxy, and the other path must receive a different response directly from a local origin. The selected path deliberately uses different letter casing.

All traffic stays on loopback. The test does not change Windows routes, proxies, firewall rules, or DNS. It verifies real process attribution and outbound selection, but not TUN packet capture or live upstream credentials. Its ignored client-fixture test is invoked automatically in child processes and is not intended to be run on its own.

An elevated end-to-end check should additionally verify a selected app's proxy exit address, an unselected app's direct exit address, IPv4/IPv6 behavior, disconnect, app exit, engine failure, and reconnect after a network change. Test against servers you control and check that the temporary adapter and its routes disappear afterward.
