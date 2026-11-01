# Windows preview validation

## Game accelerator prototype — no installed-app release

Checked on Windows x64 on 2026-11-01:

- Frontend: 218 tests passed, including 41 new tests for explicit executable scope, case/separator path deduplication, path validation, safe metadata-only Clash YAML handling, secret-safe errors, external/inline providers, duplicate labels, YAML aliases/tags/complex keys, and byte/nesting/node/server limits. An initial full run while native tests were also starting engines hit the existing five-second Shadowsocks configuration-test timeout; two subsequent full frontend runs passed. No timeout or production-engine code was changed.
- Normal production build and the separately configured accelerator build passed. The normal output contains only the existing app entry and unchanged app asset hashes; the preview is emitted separately under `dist-accelerator`, including the pinned YAML package's ISC license. CI now checks both builds. Version consistency remains 0.3.5 because this milestone does not change or publish installed functionality. Frontend formatting and `git diff --check` passed.
- Native regression checks passed: 31 tests, one separately invoked routing fixture marked ignored by the harness, Rust formatting, and strict locked Clippy. Native source, the updater configuration/key, installed-app data, release feeds, and LAN mirrors were not changed. Routing tests use existing loopback fixtures without TUN capture.
- Browser inspection verified game selection, Battle.net specific-game scope without implicitly selecting the launcher, custom executable entry and exact-path review, keyboard tab navigation, launcher search, server/Activity/Settings views, the inert logging switch, Clash metadata inspection, unresolved-provider warnings, and adding labels without connecting. Reload resets selections, custom entries, imported labels, and preferences. The acceleration control stays disabled.
- Responsive layouts were visually inspected at 1440 and 320 pixels and checked for horizontal overflow at 1440, 850, and 320 pixels. A narrow hero layout was corrected. Desktop evidence is kept outside the repository in the chat's visualization artifacts. The covers use original CSS geometry; the sample library is not installed-game detection.
- Routing feasibility consists of upstream documentation and read-only source inspection, with ProxyBridge pinned to `2eb007671c82c972821e8e9bd404bc82499ebb4f`. No candidate driver or proxy helper was built, run, installed, or loaded. The owner chose open-source-only components. See [GAME_ACCELERATOR.md](GAME_ACCELERATOR.md) for findings and the required qualification gates.

This milestone is an interactive design prototype, not a working accelerator update. YAML import retains labels only; native game discovery, encrypted full-profile import, a new engine adapter, live executable routing, anti-cheat compatibility, real game latency/UDP behavior, and simultaneous Clash TUN operation remain unimplemented or unverified. No Windows proxy, route, DNS, firewall, service, or Clash configuration was changed. There is no new signed installer or release to mirror yet.

## Version 0.3.5 — activity on reused connections

Checked on Windows x64 on 2026-11-01:

- Frontend: 177 tests passed; production build, version consistency and formatting passed. Native: 31 tests passed, with the routing fixture separately invoked by the real-engine tests; Rust formatting and strict Clippy passed.
- The encrypted forwarding/lifecycle test makes two HTTP keep-alive requests through Shadowsocks on the same SOCKS/TCP connection and verifies that both traffic bursts produce usage entries. This uses the bundled engine's actual cumulative byte counters and the production decoder/filter/logger.
- Regression tests cover per-connection throttling with accumulated deltas, repeated traffic on the same ID, idle suppression, a final delta on closure, duplicate closed-history suppression, counter resets, Clear baselines and exclusion after removing selections. Existing selected-path/child filtering, stale-sample rejection, authenticated API access and bounded-history checks pass.
- One repeat run failed while starting the loopback Shadowsocks fixture; an isolated rerun passed. The fixture now reserves distinct client/upstream ports until each is needed, reducing reuse races.

Testing uses loopback and does not alter Windows proxy, routing, DNS or firewall settings. Live Steam traffic in the installed application has not been exercised; the real-engine regression reproduces reuse of a persistent connection. Byte deltas describe sampled activity, not lifetime totals or individual page requests. Missing process attribution, child-discovery delays and bounded engine history can still leave gaps.

## Version 0.3.4 — XP split view and completed-connection activity

Checked on Windows x64 on 2026-11-01:

- Frontend: 177 tests passed; production build, version consistency and formatting passed. Native: 29 tests passed, plus the separately invoked routing fixture; Rust formatting and strict Clippy passed.
- Real-engine routing tests now complete the client request, wait longer than the monitor interval, then verify selected executable attribution and Proxy/Direct labels from closed-connection metadata. The encrypted forwarding/lifecycle test verifies authenticated access and exclusion after removing all selections. Unit tests cover gRPC-Web frame bounds/malformed input, IPv6, legacy domain/account suffixes, filtering, deduplication, Clear, and exclusion of connections closed while logging was off.
- Browser UI checks cover adding/renaming profiles, every tab, logging on/off, inert reload behavior, and layouts at 1220, 850 and 320 pixels. The XP title bar, profiles pane, Connection and Processes pages were visually inspected. Existing credentials and native update/cleanup flows are preserved.
- An isolated native build with a separate temporary app identifier opened with no profiles, Engine Ready and disconnected startup. Custom maximize/restore and Close controls were exercised; the validation app exited with code 0 while the installed instance remained running. No test connection was started.
- GitHub Windows release workflow `41285621382` succeeded and v0.3.4 was published from `dc4802c8eb2280ca2250072dc7784f4d47cd4c0f`. All 11 required assets were downloaded and checked. The installer signature and signed version verified with the established public key, both Windows manifest aliases use the canonical versioned asset, the application source archive exactly matches the tagged commit, and engine source/notices match their expected bytes. Installer SHA-256: `4b0e9962c3d43b71e55862727307ab1bb53e9a310bc41919171a8d7ab8c87af2`.
- JACK-PC's mirror was refreshed with the verified published installer, and a fresh LAN download was byte-identical and passed signature/version verification. A fresh anonymous GitHub feed request and the LAN feed reported 0.3.4 with matching signatures; the unversioned GitHub redirect initially retained 0.3.3 in cache. `release/ProxyKing-Setup.exe` contains the verified installer. The HappyCheats feed remained byte-identical across the ProxyKing refresh; its server/task/configuration and firewall scope were retained. GPD-PC's ProxyKing feed was unavailable, so peer synchronization is not claimed. No installation was started.
- Local build outputs disappeared during release verification. The public-only verifier was restored from unchanged `src-tauri/src/bin/verify-release.rs` with the repository's locked dependency versions, then used to verify the GitHub and LAN installers. No private signing key was accessed locally.
- The normal anonymous GitHub feed subsequently reported 0.3.4, and the existing **ProxyKing LAN Mirror** task completed with result 0 after the verifier was restored. Both update sources and the local first-install link now serve the verified release.

No Windows proxy, route, DNS, or firewall settings were changed for testing. The existing connected installed app was left running. Live Steam/TUN capture has not been exercised in the installed update; use the published update and reconnect to validate that session. Missing process attribution, child-discovery delays and bounded engine history can still leave gaps.

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
