import { build } from "esbuild";
await build({
  entryPoints: ["src/main/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "dist/main.cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["src/main/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "dist/preload.cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["worker/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/worker.mjs",
  packages: "external",
});
