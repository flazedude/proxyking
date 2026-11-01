import { defineConfig, mergeConfig } from "vite";
import { readFileSync } from "node:fs";
import base from "./vite.config";

export default mergeConfig(
  base,
  defineConfig({
    server: { port: 1421 },
    plugins: [
      {
        name: "accelerator-yaml-notice",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "yaml-LICENSE.txt",
            source: readFileSync(
              new URL("./node_modules/yaml/LICENSE", import.meta.url),
              "utf8",
            ),
          });
        },
      },
    ],
    build: {
      outDir: "dist-accelerator",
      rollupOptions: { input: "accelerator.html" },
    },
  }),
);
