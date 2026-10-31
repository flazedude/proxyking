import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;
const output = join(root, "release", "assets");
mkdirSync(output, { recursive: true });
execFileSync(
  "git",
  [
    "archive",
    "--format=tar.gz",
    "-o",
    join(output, `proxyking-${version}-source.tar.gz`),
    "HEAD",
  ],
  { cwd: root, windowsHide: true },
);
for (const [source, name] of [
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
  ["src-tauri/resources/GPL-3.0.txt", "GPL-3.0.txt"],
  ["src-tauri/resources/sing-box-LICENSE.txt", "sing-box-LICENSE.txt"],
]) {
  copyFileSync(join(root, source), join(output, name));
}
const response = await fetch(
  "https://github.com/SagerNet/sing-box/archive/refs/tags/v1.14.2.tar.gz",
  { signal: AbortSignal.timeout(180000) },
);
if (!response.ok)
  throw new Error(`Engine source download failed: ${response.status}`);
writeFileSync(
  join(output, "sing-box-1.14.2-source.tar.gz"),
  Buffer.from(await response.arrayBuffer()),
);
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--format-version",
      "1",
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  ),
);
writeFileSync(
  join(output, "rust-dependencies.json"),
  JSON.stringify(
    metadata.packages.map(({ name, version, license, repository, source }) => ({
      name,
      version,
      license,
      repository,
      source,
    })),
    null,
    2,
  ) + "\n",
);
const npm = execFileSync(
  process.execPath,
  [process.env.npm_execpath, "ls", "--all", "--omit=dev", "--json"],
  { cwd: root, encoding: "utf8", windowsHide: true },
);
writeFileSync(join(output, "npm-dependencies.json"), npm);
const hash = createHash("sha256")
  .update(readFileSync(join(root, "src-tauri/resources/sing-box.exe")))
  .digest("hex");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
}).trim();
writeFileSync(
  join(output, "engine-provenance.txt"),
  `ProxyKing ${version}\nSource commit: ${sourceCommit}\nEngine: official sing-box 1.14.2 windows-amd64\nUpstream archive SHA-256: c2d8bfff918755808781dfdeeb8581b6c91eb3a243d9a7b55483cfc0c0684d32\nPackaged executable SHA-256: ${hash}\nSource: https://github.com/SagerNet/sing-box/tree/v1.14.2\nBuild/setup: scripts/setup-engine.mjs; no engine modifications.\n`,
);
console.log(`Prepared source, dependency inventories and notices in ${output}`);
