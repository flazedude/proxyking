import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
}
const configPath = option("--server-config");
if (!configPath)
  throw new Error(
    "Pass --server-config with this PC's HappyCheats artifacts/lan-updates/server.json.",
  );
const server = JSON.parse(readFileSync(resolve(configPath), "utf8"));
if (
  !["192.168.2.76", "192.168.2.59"].includes(server.Address) ||
  server.Port !== 17845
)
  throw new Error("Expected an existing official LAN host on port 17845.");
const local = option("--from-directory");
const pinned = option("--version");
if (pinned && !/^\d+\.\d+\.\d+$/.test(pinned))
  throw new Error("Use a stable three-part release version.");
const base = pinned
  ? `https://github.com/flazedude/proxyking/releases/download/v${pinned}/`
  : "https://github.com/flazedude/proxyking/releases/latest/download/";
async function download(url, max = 160 * 1024 * 1024) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok)
    throw new Error(`Release download failed: HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max)
      throw new Error("Release download exceeded its size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const manifest = JSON.parse(
  local
    ? readFileSync(join(resolve(local), "latest.json"), "utf8")
    : (await download(base + "latest.json", 1024 * 1024)).toString("utf8"),
);
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version) || (pinned && pinned !== version))
  throw new Error("Unexpected release version.");
const filename = `ProxyKing_${version}_x64-setup.exe`;
const github = `https://github.com/flazedude/proxyking/releases/download/v${version}/`;
const platform =
  manifest.platforms?.["windows-x86_64"] ??
  manifest.platforms?.["windows-x86_64-nsis"];
if (
  !platform ||
  platform.url !== github + filename ||
  typeof platform.signature !== "string"
)
  throw new Error("Unexpected signed Windows release metadata.");
const destination = join(resolve(server.PublicDirectory), "proxyking");
const cache = join(root, "release", "mirror-cache", version);
mkdirSync(cache, { recursive: true });
const installer = local
  ? readFileSync(join(resolve(local), filename))
  : await download(platform.url);
writeFileSync(join(cache, filename), installer);
writeFileSync(join(cache, filename + ".sig"), platform.signature);
const verifier = join(
  root,
  "src-tauri",
  "target",
  "release",
  process.platform === "win32" ? "verify-release.exe" : "verify-release",
);
if (!existsSync(verifier))
  throw new Error(
    "Build the public verifier first: cargo build --manifest-path src-tauri/Cargo.toml --release --locked --bin verify-release",
  );
execFileSync(
  verifier,
  [
    join(root, "src-tauri", "tauri.conf.json"),
    join(cache, filename + ".sig"),
    join(cache, filename),
    version,
  ],
  { windowsHide: true, stdio: "inherit" },
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const compareVersion = (a, b) => {
  for (let i = 0; i < 3; i++) {
    const diff = BigInt(a.split(".")[i]) - BigInt(b.split(".")[i]);
    if (diff) return diff > 0n ? 1 : -1;
  }
  return 0;
};
mkdirSync(destination, { recursive: true });
const feedPath = join(destination, "latest.json");
if (existsSync(feedPath)) {
  const previous = JSON.parse(readFileSync(feedPath, "utf8"));
  if (compareVersion(previous.version, version) > 0)
    throw new Error("Refusing to downgrade the LAN mirror.");
  const previousPlatform =
    previous.platforms?.["windows-x86_64"] ??
    previous.platforms?.["windows-x86_64-nsis"];
  if (
    previous.version === version &&
    previousPlatform?.signature !== platform.signature
  )
    throw new Error("Refusing conflicting same-version signed packages.");
}
const target = join(destination, filename);
if (existsSync(target) && hash(readFileSync(target)) !== hash(installer))
  throw new Error("Refusing to replace immutable installer bytes.");
function atomicFile(name, bytes) {
  const path = join(destination, name);
  writeFileSync(path + ".tmp", bytes);
  renameSync(path + ".tmp", path);
}
if (!existsSync(target)) atomicFile(filename, installer);
atomicFile(filename + ".sig", platform.signature);
// Keep corresponding source and notices alongside the downloadable binary.
for (const name of [
  "THIRD_PARTY_NOTICES.md",
  "GPL-3.0.txt",
  "sing-box-LICENSE.txt",
  "engine-provenance.txt",
  "npm-dependencies.json",
  "rust-dependencies.json",
  "sing-box-1.14.2-source.tar.gz",
  `proxyking-${version}-source.tar.gz`,
]) {
  const bytes = local
    ? readFileSync(join(resolve(local), name))
    : await download(github + name);
  if (name.endsWith("-source.tar.gz") && existsSync(join(destination, name))) {
    if (hash(readFileSync(join(destination, name))) !== hash(bytes))
      throw new Error("Refusing to replace immutable source archive bytes.");
    continue;
  }
  atomicFile(name, bytes);
}
atomicFile("ProxyKing-Setup.exe", installer);
const lan = `http://${server.Address}:${server.Port}/proxyking/${filename}`;
for (const entry of Object.values(manifest.platforms)) {
  if (entry.url !== platform.url || entry.signature !== platform.signature)
    throw new Error("Manifest platforms disagree about the Windows package.");
  entry.url = lan;
}
if (existsSync(feedPath))
  copyFileSync(feedPath, join(cache, `previous-${server.Address}.json`));
atomicFile("latest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `Mirrored ProxyKing ${version}: http://${server.Address}:${server.Port}/proxyking/ProxyKing-Setup.exe`,
);
console.log(`Installer SHA-256: ${hash(installer)}`);
