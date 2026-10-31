import { readFileSync, writeFileSync } from "node:fs";
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
  throw new Error("Usage: npm run version:set -- X.Y.Z");
for (const path of [
  "../package.json",
  "../package-lock.json",
  "../src-tauri/tauri.conf.json",
]) {
  const url = new URL(path, import.meta.url);
  const data = JSON.parse(readFileSync(url));
  data.version = version;
  if (data.packages?.[""]) data.packages[""].version = version;
  writeFileSync(url, JSON.stringify(data, null, 2) + "\n");
}
const cargo = new URL("../src-tauri/Cargo.toml", import.meta.url);
writeFileSync(
  cargo,
  readFileSync(cargo, "utf8").replace(
    /^version = "[^"]+"/m,
    `version = "${version}"`,
  ),
);
console.log(
  `Set application version to ${version}. Run cargo check in src-tauri to refresh Cargo.lock.`,
);
