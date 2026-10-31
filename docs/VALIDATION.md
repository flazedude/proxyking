# Windows preview validation

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
