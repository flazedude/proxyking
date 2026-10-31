import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error(
    "This engine package targets Windows x64. Other platforms are on the roadmap.",
  );
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = "1.14.2";
const asset = `sing-box-${version}-windows-amd64.zip`;
// Published SHA-256 from the official SagerNet GitHub release asset metadata.
const expectedHash =
  "c2d8bfff918755808781dfdeeb8581b6c91eb3a243d9a7b55483cfc0c0684d32";
const cache = join(root, ".engine-download");
const resources = join(root, "src-tauri", "resources");
const archive = join(cache, asset);
const extract = join(cache, `extracted-${version}`);
for (const path of [cache, resources, extract])
  mkdirSync(path, { recursive: true });
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
if (!existsSync(archive) || hash(archive) !== expectedHash) {
  console.log(`Downloading sing-box ${version} for Windows x64…`);
  writeFileSync(
    archive,
    await download(
      `https://github.com/SagerNet/sing-box/releases/download/v${version}/${asset}`,
    ),
  );
}
if (hash(archive) !== expectedHash)
  throw new Error("Engine checksum mismatch; refusing to install.");
execFileSync("tar.exe", ["-xf", archive, "-C", extract], { windowsHide: true });
const executable = join(
  extract,
  `sing-box-${version}-windows-amd64`,
  "sing-box.exe",
);
copyFileSync(executable, join(resources, "sing-box.exe"));
writeFileSync(
  join(resources, "sing-box-LICENSE.txt"),
  await download(
    `https://raw.githubusercontent.com/SagerNet/sing-box/v${version}/LICENSE`,
  ),
);
console.log(`Installed verified sing-box ${version}.`);
console.log(
  execFileSync(join(resources, "sing-box.exe"), ["version"], {
    encoding: "utf8",
    windowsHide: true,
  }),
);
