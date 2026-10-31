# LAN and GitHub updates

ProxyKing 0.3.2 and newer check JACK-PC LAN, GPD-PC LAN and the public `flazedude/proxyking` GitHub Releases feed at startup and every six hours while running. The update bar also provides **Check for updates**. Every configured source is checked; a stale LAN feed cannot hide a newer GitHub version. Matching copies of the selected version are tried in LAN-first order. Transport failures can try another matching source; conflicting same-version signatures, invalid metadata, signature failures or signed-version failures stop installation. A completely offline check reports an error and can be retried; it does not prevent connections.

When a newer version is available, **Install VERSION and restart** downloads and verifies its signature, disconnects the engine and restores owned Windows proxy settings, then starts the per-user NSIS installer. Connection controls remain locked during installation. A failed download leaves the existing connection running; a failed disconnect stops installation. Updates preserve the account-encrypted application data. Connections do not automatically resume.

The browser preview never checks for updates. Versions older than 0.3.0 need one manual installation of the new installer. Portable copies transition to the installed per-user app when using the updater; use the installed app afterward.

The feeds, in download preference order, are:

```text
http://192.168.2.76:17845/proxyking/latest.json
http://192.168.2.59:17845/proxyking/latest.json
https://github.com/flazedude/proxyking/releases/latest/download/latest.json
```

Public downloads use HTTPS. HTTP is allowed only for the two pinned LAN addresses and exact versioned ProxyKing installer paths. Native checks bypass system/environment proxies and reject redirects for those LAN hosts. TLS certificate validation remains enabled for GitHub. Tauri verifies the installer signature and its signed version using the established public key before disconnecting; the native install command repeats verification and cleanup before launching the installer. Updater signatures are separate from Windows Authenticode certificates and do not remove SmartScreen prompts on first installation.

Versions 0.3.0–0.3.1 only check GitHub. They must first receive a newer **published** GitHub Release before using LAN updates. Pushing source, rebuilding the same version, or leaving a release in draft cannot update those installations.

## Shared LAN server and mirrors

HappyCheats' existing server hosts a separate `/proxyking/` namespace from `artifacts/lan-updates/public/proxyking`. Its port, firewall scope, scheduled startup task, HappyCheats signing identity, feed and packages stay unchanged. The shared server source in `flazedude/happycheats` must include the ProxyKing route and its published server executable must be deployed on each host. An older server returns 404. There is no upload API, directory listing, proxy service, or credential storage on this endpoint.

Build the public-key-only mirror verifier and refresh this PC's mirror from the published GitHub release:

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --release --locked --bin verify-release
node scripts/mirror-release.mjs --server-config ../happycheats/artifacts/lan-updates/server.json
```

If GitHub downloads require the Windows system proxy, use `./scripts/Run-LanMirror.ps1 -ServerConfiguration ../happycheats/artifacts/lan-updates/server.json`. This public-download wrapper honors the existing system proxy, stages the version-pinned files outside the served directory, and passes them through the same signature/version verifier. The scheduled mirror uses this wrapper. It does not change proxy settings or start a proxy connection.

The helper reads this host's existing address/public-directory settings, downloads the version-pinned installer, verifies its signature and signed version against ProxyKing's committed public key, refuses downgrades or changed same-version installer bytes, retains source/notices alongside the installer, then atomically exposes the LAN feed and `ProxyKing-Setup.exe`. LAN and GitHub installers use identical bytes and signatures. It never reads a private key. `--version X.Y.Z` pins a published release; `--from-directory PATH` uses a fully prepared local release directory with a canonical GitHub manifest for recovery.

Enable this separate mirror task from administrator PowerShell after the shared server route is installed:

```powershell
./scripts/Install-LanMirror.ps1 -ServerConfiguration ../happycheats/artifacts/lan-updates/server.json
```

**ProxyKing LAN Mirror** refreshes at startup and every five minutes. It runs the checked-out helper and compiled public verifier, with Node.js available in its environment; it does not mutate source or install client updates. Logs are in `%LOCALAPPDATA%/ProxyKingPublisher/mirror.log`. Keep those paths available. Install this separately on each host; publishing on JACK-PC does not prove GPD-PC has synchronized. No server, mirror task or client installs a release into another PC automatically.

## Keys and another computer

The public key is committed in `src-tauri/tauri.conf.json`. The initial private key is saved outside the repository at `%USERPROFILE%\.proxyking\updater.key` on the original computer. Keep a secure backup of that file. Do not paste it into chat, logs, commits, or release assets. Losing it prevents updates to existing installations. Do not generate a different key for a fresh checkout.

Repository Actions secret `TAURI_SIGNING_PRIVATE_KEY` stores the private key contents. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional; the initial generated key has an empty password. GitHub's workflow token publishes release assets. Normal contributors do not need the private key to develop or push source changes, and CI builds releases with the existing secret.

For a local signed installer build, provide the private key path through the environment:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Join-Path $env:USERPROFILE '.proxyking/updater.key'
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
npm run desktop:build
npm run package:windows
```

For local development without a signing key, use `npm run desktop`. To build an unsigned test installer without updater artifacts, use `npm run desktop:build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'`. Do not publish that unsigned build as an update.

## Publishing the next version

1. Pull the latest changes; implement and validate the iteration described in AGENTS.md.
2. Run `npm run version:set -- X.Y.Z` with the next unused version, then `cargo check --manifest-path src-tauri/Cargo.toml` to refresh Cargo.lock. The interface reads its version from package.json.
3. Run `npm run version:check`, frontend and native checks, and review the diff. Commit and push source changes to GitHub.
4. Push a matching `vX.Y.Z` tag. The Windows release workflow checks versions, builds and signs the NSIS installer, and creates a draft GitHub Release with its `.sig` and `latest.json` assets. It also runs `npm run release:prepare` and attaches the exact source archive, engine source/provenance, notices and dependency inventories. Do not replace an existing release's signed bytes.
5. Verify the workflow succeeded, the draft manifest uses the matching version-pinned asset URL, and the signature verifies with the committed key and matching signed version. Review source/notices required by THIRD_PARTY_NOTICES.md. Publish the completed draft as the latest release. Publishing activates the updater feed; do not leave the final release in draft or mark incomplete releases latest.
6. Run the mirror helper against this PC's saved LAN configuration. Verify its hosted feed, installer SHA-256 and signature match GitHub, the original HappyCheats feed is unchanged, and this host's mirror task has completed successfully. Copy the published installer to `release/ProxyKing-Setup.exe` for the local first-install link. Report an offline/unconfigured peer without claiming synchronization.

Drafts and prereleases are not offered by `/releases/latest`. A failed build does not replace the live feed. Never change a released version's installer or signature: fix the issue in a higher version. Use version tags for releases and normal commits for source iterations.
