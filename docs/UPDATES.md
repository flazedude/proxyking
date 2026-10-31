# GitHub updates and releases

ProxyKing 0.3.0 and newer check the public `flazedude/proxyking` GitHub Releases feed at startup and every six hours while running. The update bar also provides **Check for updates**. An offline check reports an error and can be retried; it does not prevent connections.

When a newer version is available, **Install VERSION and restart** downloads and verifies its signature, disconnects the engine and restores owned Windows proxy settings, then starts the per-user NSIS installer. Connection controls remain locked during installation. A failed download leaves the existing connection running; a failed disconnect stops installation. Updates preserve the account-encrypted application data. Connections do not automatically resume.

The browser preview never checks for updates. Versions older than 0.3.0 need one manual installation of the new installer. Portable copies transition to the installed per-user app when using the updater; use the installed app afterward.

The feed is:

```text
https://github.com/flazedude/proxyking/releases/latest/download/latest.json
```

This follows [Tauri's signed updater](https://v2.tauri.app/plugin/updater/) and [GitHub release pipeline](https://v2.tauri.app/distribute/pipelines/github/) guidance. HTTPS and signature verification are enabled. Updater signatures verify update provenance; they are separate from Windows Authenticode certificates and do not remove SmartScreen prompts on first installation.

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
2. Run `npm run version:set -- 0.3.1` (choose the next unused version), then `cargo check --manifest-path src-tauri/Cargo.toml` to refresh Cargo.lock. The interface reads its version from package.json.
3. Run `npm run version:check`, frontend and native checks, and review the diff. Commit and push source changes to GitHub.
4. Push a matching tag, for example `git tag v0.3.1` then `git push origin v0.3.1`. The Windows release workflow checks versions, builds and signs the NSIS installer, and creates a draft GitHub Release with its `.sig` and `latest.json` assets.
5. Verify the workflow succeeded and review the draft artifacts and third-party source/notices required by THIRD_PARTY_NOTICES.md. Publish the completed draft with `gh release edit v0.3.1 --draft=false --latest` (or GitHub's release page). Publishing activates the updater feed. Do not mark incomplete releases latest.

Drafts and prereleases are not offered by `/releases/latest`. A failed build does not replace the live feed. Never change a released version's installer or signature: fix the issue in a higher version. Use version tags for releases and normal commits for source iterations.
