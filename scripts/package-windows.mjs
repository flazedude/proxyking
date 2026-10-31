import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Windows packaging currently supports Windows x64 only.");
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nativeRoot = join(root, "src-tauri");
const buildDir = join(nativeRoot, "target", "release");
const releaseDir = join(root, "release");
const portableDir = join(releaseDir, "ProxyKing");
const config = JSON.parse(
  readFileSync(join(nativeRoot, "tauri.conf.json"), "utf8"),
);

function within(base, path) {
  const target = resolve(base, path);
  const child = relative(base, target);
  if (
    child === ".." ||
    child.startsWith("..\\") ||
    child.startsWith("../") ||
    isAbsolute(child)
  ) {
    throw new Error(`Package path is outside its expected directory: ${path}`);
  }
  return target;
}

function requireFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(
      `Required build file is missing: ${path}\nRun npm run setup:engine and npm run desktop:build first.`,
    );
  }
}

const files = [
  {
    source: join(buildDir, "proxyking.exe"),
    destination: join(portableDir, "ProxyKing.exe"),
  },
];
requireFile(files[0].source);

// Use the same explicit resource map as the installer. Do not copy the build
// tree, test fixtures, or the user's application data into the portable folder.
const resources = config.bundle?.resources;
if (!resources || Array.isArray(resources) || typeof resources !== "object") {
  throw new Error("Expected an explicit resource map in tauri.conf.json.");
}
for (const [source, destination] of Object.entries(resources)) {
  const sourcePath = within(root, resolve(nativeRoot, source));
  requireFile(sourcePath);
  files.push({
    source: sourcePath,
    destination: within(portableDir, destination),
  });
}
for (const entry of readdirSync(buildDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.toLowerCase().endsWith(".dll")) {
    files.push({
      source: join(buildDir, entry.name),
      destination: join(portableDir, entry.name),
    });
  }
}

const installer = join(
  buildDir,
  "bundle",
  "nsis",
  `${config.productName}_${config.version}_x64-setup.exe`,
);
if (existsSync(installer)) {
  requireFile(installer);
  files.push({
    source: installer,
    destination: join(releaseDir, "ProxyKing-Setup.exe"),
  });
}

// Refresh known package files only; never remove existing files or profiles.
for (const { source, destination } of files) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  console.log(`Packaged ${relative(root, destination)}`);
}
console.log(`\nPortable app: ${join(portableDir, "ProxyKing.exe")}`);
console.log("Keep the entire ProxyKing folder together when moving the app.");
if (existsSync(installer)) {
  console.log(`Installer: ${join(releaseDir, "ProxyKing-Setup.exe")}`);
} else {
  console.log(
    "No matching NSIS installer was found; only the portable app was packaged.",
  );
  if (existsSync(join(releaseDir, "ProxyKing-Setup.exe"))) {
    console.warn(
      "An existing ProxyKing-Setup.exe was preserved and has not been updated.",
    );
  }
}
