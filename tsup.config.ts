import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  minify: false,
  // Ensure the built CLI is directly executable on Unix systems.
  banner: {
    js: "#!/usr/bin/env node",
  },
});
