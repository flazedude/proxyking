import { readFileSync } from "node:fs";
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url)),
);
const lock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url)),
);
const config = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
);
const cargo = readFileSync(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const rustVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
if (
  ![lock.version, lock.packages[""].version, config.version, rustVersion].every(
    (v) => v === pkg.version,
  )
) {
  throw new Error(
    "Version mismatch. Run npm run version:set -- X.Y.Z and cargo check in src-tauri.",
  );
}
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== `v${pkg.version}`
) {
  throw new Error(`Release tag must be v${pkg.version}.`);
}
console.log(`All application versions match ${pkg.version}.`);
