# Windows preview validation

## Version 0.3.3 — selected-process activity

Checked on Windows x64 on 2026-11-01:

- Frontend: 177 tests passed; production TypeScript/Vite build, version consistency, and formatting passed. Native: 27 tests passed with one separately invoked routing fixture; Rust formatting and strict Clippy passed.
- Usage collection now accepts only full paths selected in Processes and currently inherited launcher children, in every routing mode. Regression tests cover unrelated same-name executables, missing attribution, empty selections, Windows case/separator and extended/UNC paths, appended account labels, and stale samples after scope changes.
- The real-engine encrypted loopback test verifies selected traffic remains visible, then removes the selection while connected and verifies that traffic is excluded in local mode. Existing routing tests continue checking real executable attribution and both Proxy and Direct labels.
- GitHub Windows release workflow `41281909741` succeeded and v0.3.3 was published from `1ffbfae2b231318e69495589c6dad3bfd3092a41`. Installer signature and signed version verified with the established key; both Windows manifest aliases use the canonical versioned asset. Exact application source matches the tagged commit, pinned engine source matches its checksum, and notices match the checkout. Installer SHA-256: `c0db3ea851bd1bd39437e2ef21a6f8d43dc5b45b49bf13a9b487da60d8936dc2`.
- Anonymous GitHub and JACK-PC LAN feeds reported 0.3.3 with matching signatures. A fresh LAN download was byte-identical to the verified GitHub installer and passed signature/version verification; `release/ProxyKing-Setup.exe` contains the same bytes. A repeat ProxyKing mirror refresh preserved the current HappyCheats feed byte for byte. The initial HappyCheats baseline changed during the publishing interval while its separate mirror reported 0.3.64; no HappyCheats files, configuration, server task, or firewall settings were modified by this iteration. GPD-PC's feed was unavailable, so peer synchronization is not claimed. No installation was started.
- The existing **ProxyKing LAN Mirror** startup/five-minute task completed with result 0 against the published release.

These checks use loopback only and do not alter Windows proxy, routing, DNS, or firewall settings. Live elevated TUN capture and external provider traffic remain unverified. Very short or unidentified connections are omitted. Existing session status/error events remain visible.

## Version 0.3.2 — usage activity and LAN updates

Checked on Windows x64 on 2026-11-01:

- Frontend: 177 tests passed; production TypeScript/Vite build and formatting passed. New adapter tests cover old-settings migration, the logging preference, and inert in-memory browser/update behavior.
- Native: 25 tests passed; one self-spawn fixture is invoked by the routing tests. Strict Clippy and Rust formatting passed. Update tests cover newest-source selection, same-version signature conflicts and exact official installer URLs.
- The real-engine selected-process loopback test now enables the production usage controller and checks executable attribution plus both Proxy and Direct labels. The production TUN configuration, including the controller and process discovery, passes engine validation before only the TUN inbound is removed for traffic tests.
- The encrypted forwarding/lifecycle test reads authenticated metadata from an active Shadowsocks connection, rejects unauthenticated controller access, verifies the saved on/off preference, and checks stale-sample rejection after Clear, Off, and disconnect. Unit tests cover duplicate suppression, bounded history, IPv6, unknown apps, Unicode names, rejecting credential-bearing URLs, and fixed monitor-failure warnings.
- Browser Activity layout and accessible switch checked in both On and Off states. Preview does not collect traffic, and no browser console errors were observed.

- The HappyCheats LAN server's separate `/proxyking/` route passed HTTP feed, range/cache, namespace isolation, path rejection and read-only checks. JACK-PC's existing server/task was retained and its HappyCheats feed was byte-identical before and after deployment. GPD-PC did not respond during this check; its ProxyKing route/mirror is not claimed as deployed.
- GitHub Windows release workflow `41223232267` completed successfully and v0.3.2 was published from `aaea4ee5ec72f6404f55f6235062399a62a115cd`, with installer/signature, manifests, exact source, engine source/provenance, dependency inventories and notices. The downloaded installer verified against the original public key and signed version. Its SHA-256 is `82036499980d3b4623fbfdda5f28f00dde12f76c9f4a61f49433c4300572b4df`.
- Anonymous GitHub and JACK-PC LAN feeds both reported 0.3.2 with matching signatures. A fresh LAN installer download was byte-identical to the verified GitHub asset and passed signature/version verification. `release/ProxyKing-Setup.exe` contains that same installer. The separate **ProxyKing LAN Mirror** startup/five-minute task completed with result 0.
- Packaged native 0.3.2 smoke check confirmed engine Ready, disconnected startup, preserved profile/process counts, the Activity logging control and a completed multi-source update check. The existing 0.3.1 app then displayed **Install 0.3.2 and restart** against the published GitHub feed. No connection or installation was started.
- Hosting follow-up checks cover the manifest's two Windows platform aliases, repeat refresh, tampered installer rejection, signed-version mismatch rejection, and downgrade rejection without changing the active feed. The Windows mirror wrapper honors the account's existing system proxy and re-verifies current packages before skipping a redundant download. Future source preparation reuses a pinned immutable engine-source archive.

Routing and forwarding tests use loopback only and do not change Windows proxy, routing, DNS, or firewall settings. Live elevated TUN capture and external provider traffic remain unverified. Usage is sampled from active connections, so very short connections may be missed; process attribution can be unavailable. The published package and update offer were verified; the installer itself was not run.

## Version 0.3.1 — launcher children

Checked on Windows x64 on 2026-10-31:

- Frontend: 174 tests passed; production TypeScript/Vite build passed.
- Native: 20 tests passed and one self-spawn fixture was invoked by the routing tests. Strict Clippy passed.
- The real-engine launcher test starts a child executable after engine startup, discovers it using Windows parent IDs and creation times, atomically updates the production child rule set, and verifies its request reaches the mock proxy. The engine PID stays the same. After child exit and rule removal, a subsequent request reaches the direct origin.
- Hierarchy tests cover grandchildren, surviving launcher exit, excluding the engine, disabling expansion, and PID reuse. Old saved selections deserialize with child inclusion disabled.
- Signed updater installer and portable executable built as 0.3.1. Native smoke check confirmed version, engine Ready, process-list loading, and new child-inclusion guidance. No profiles or process selections were changed during the smoke check.

Routing tests use loopback and remove the TUN inbound before starting an engine. No Windows proxy, routing, DNS, or firewall settings were changed. Live game launchers, elevated TUN capture, and cleanup remain unverified. Child detection is asynchronous: initial connections can go direct, very short-lived intermediary launchers can be missed, and service-launched games may need explicit selection. Discovered rules match executable paths and therefore include every instance of those paths.

## Version 0.3.0 — GitHub updates and development handoff

Checked on Windows x64 on 2026-10-31:

- Frontend: 174 tests passed, including signature/download failure and proxy cleanup failure behavior for updates; production build passed.
- Rust: 19 tests passed; one routing fixture is invoked separately by an integration test. Strict Clippy passed.
- Native updater plugin, HTTPS GitHub Releases feed, embedded public key, and per-user installer artifacts are configured. The private signing key is outside the repository and encrypted in GitHub Actions secrets.
- Windows x64 release executable, NSIS installer, and updater signature built successfully. The running older portable copy was preserved; the new installer is available separately.
- Vite, Vitest, and source-map-js were patched; npm audit reported zero vulnerabilities afterward. Git line endings are pinned to LF so Windows checkouts pass the same formatting checks.
- AGENTS.md records setup on another computer, future commit/push expectations, validation, and signing-key continuity. Version scripts check and update the frontend, Tauri, npm lockfile, and Rust manifest together.

A real upgrade to a higher published version, Windows installer restart, and retention of encrypted profiles across an installed upgrade have not yet been exercised. Update tests do not modify Windows proxy settings or install software.

## Version 0.2.0 — selected processes and manual servers

Checked on Windows x64 on 2026-10-31 with the existing pinned engine and GNU Rust toolchain:

- Frontend: 171 tests passed, including 30 real-engine configuration checks; production build passed.
- Rust: 16 tests passed. One client-fixture helper is marked ignored and is explicitly run by the integration test under two executable paths.
- Real-engine routing: the selected executable, with different path casing, reached a loopback HTTP proxy; a copied executable reached a separate origin directly. Production route rules and direct fallback were preserved; only the TUN inbound was removed before starting this test engine.
- Full production TUN configuration passed engine validation without creating an adapter.
- Native process enumeration, legacy settings migration, manual proxy authentication validation, and full-start readiness detection passed.
- Strict Clippy (`--all-targets -- -D warnings`), Rust formatting, and frontend formatting passed.
- Windows release executable and NSIS installer built; portable package refreshed at `release/ProxyKing/ProxyKing.exe`.
- Native UI smoke check: version 0.2.0 and engine Ready displayed; manual SOCKS5/HTTP forms and HTTP port switching inspected; running-process picker loaded actual executable names, paths, and PIDs. Test dialogs were canceled without adding profiles or rules.

These checks did not create a TUN adapter or change Windows proxy, route, firewall, or DNS settings. Elevated packet capture, adapter cleanup, UAC approval/relaunch, and authentication against a live provider remain unverified. No live server credentials were supplied.

## Earlier version 0.1 validation

Validated on Windows x64 on 2026-09-27 with Node 22.16.0, Rust 1.94.1 (`x86_64-pc-windows-gnu`), Tauri 2, and sing-box 1.14.2. MSVC remains the recommended Tauri development toolchain.

- Frontend production build: passed.
- Vitest: 103 tests passed. Includes 82 share-link parser cases and 21 checks against the bundled engine.
- Rust: 9 tests passed. Includes profile validation, DPAPI encryption and saved-state replacement, read-only WinINet snapshots, restoration decision logic, engine lifecycle, and an encrypted Shadowsocks request between local test endpoints.
- `cargo clippy --all-targets -- -D warnings`: passed.
- `cargo fmt --check` and frontend formatting: passed.
- npm dependency audit: no reported vulnerabilities at validation time.
- NSIS installer: built for Windows x64.
- Release executable startup: process remained running and responsive with a ProxyKing window.
- Browser interface: import, atomic rejection of malformed batches, search, selection, rename, settings validation/save, empty state, and desktop/compact layouts checked. Preview connections remain disabled. No browser console errors observed during these checks.

The tests did not modify Windows proxy settings. Actual WinINet apply/restore and provider authentication require a controlled user connection test; they have not been represented as live-tested here. No provider credentials were supplied. Full-device traffic capture, DNS/UDP protection, kill switch behavior, signing, and macOS/mobile support are outside this milestone.

The built app is an unsigned local preview. Installer generation and executable startup were verified; installation and uninstallation were not performed on the user's machine.
