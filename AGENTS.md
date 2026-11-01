# Continuing work on ProxyKing

## Repository and user preference

- Canonical repository: https://github.com/flazedude/proxyking, default branch `main`.
- The owner requests that completed future iterations be committed and pushed to this repository. This preference applies when continuing this project on another computer. Honor newer user instructions and any narrower task scope.
- Fetch and inspect the current branch and working tree before editing. Preserve existing work. Do not force-push, rewrite shared history, or commit local credentials.
- Use `codex/` branches for changes when branch isolation is useful; publish the branch and open a PR if merging is outside the current authorization.
- Source pushes update GitHub. Installed applications update only from signed, published versioned GitHub Releases, never directly from branch contents.
- For installed-app feature/fix iterations, finish the signed versioned GitHub release and this PC's LAN mirror as well as pushing source; do not stop at a source-only push unless the user requests development-only work. Reuse the HappyCheats LAN server's separate `/proxyking/` namespace on port 17845, preserving its task, configuration, firewall scope and HappyCheats files. ProxyKing retains its own signing key. Follow docs/UPDATES.md; report offline peers honestly.

## Setup on another Windows x64 computer

```powershell
git clone https://github.com/flazedude/proxyking.git
cd proxyking
npm ci
npm run setup:engine
npm run desktop
```

Install Node.js 22.12+, Rust 1.90+ with MSVC, Microsoft C++ Build Tools, and WebView2 as described in README.md. The initial computer uses the GNU toolchain; GitHub Actions uses MSVC. No absolute paths from the original computer are required. Authenticate GitHub separately (`gh auth login` or Git Credential Manager). Never copy tokens into the repository.

## Read before changes

- README.md: behavior, setup, supported protocols and limitations.
- docs/ARCHITECTURE.md and docs/PROCESS_ROUTING.md: architecture and routing guarantees.
- docs/UPDATES.md: updater signing, release steps, and key backup.
- docs/VALIDATION.md: what was actually tested and remaining limitations.
- THIRD_PARTY_NOTICES.md: engine and distribution notices.

## Essential constraints

- Keep all installed-app and preview text plain and functional. Do not add slogans, promotional hero copy, or repeated ownership phrases such as "Your games. Your server."
- React/TypeScript UI in `src`; Tauri/Rust commands and engine supervision in `src-tauri/src`.
- Keep browser preview inert: no real proxy connections, native process enumeration, persistent credentials, or update downloads.
- Store credentials only through account-scoped DPAPI storage. Do not log share links, passwords, UUIDs, engine raw output, or private signing keys.
- Preserve explicit elevation, direct fallback, single-instance ownership, engine cleanup, and proxy restoration. Do not enable auto-connect or change Windows routing as a test without user authorization.
- The updater verifies signed downloads, then disconnects, then launches the installer. Windows updater exit bypasses normal shutdown events; never remove the explicit cleanup or ignore its errors.
- Never regenerate or replace the updater public key as routine setup. Existing installs trust that key. The private key is outside this checkout and stored in the repository's Actions secrets.
- Do not commit generated packages, engine executables, profiles, private keys, `.env` files, or application data. Keep lockfiles committed.

## Validation and publishing

Run relevant checks and record material limitations honestly:

```powershell
npm run version:check
npm test
npm run build
npm run format:check
cd src-tauri
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

Before finishing an iteration, update the relevant documentation, inspect `git diff --check` and the staged diff for secrets, commit, push to the correct origin, and verify the remote commit. Report the commit or PR and checks. Do not promise that unpushed changes are on GitHub.

For an installable update, increment the version using `npm run version:set -- X.Y.Z`, refresh Cargo.lock with `cargo check`, run checks, commit/push, and push a matching `vX.Y.Z` tag. Follow docs/UPDATES.md for releasing signed installer artifacts. A same-version rebuild will not update existing installations.
