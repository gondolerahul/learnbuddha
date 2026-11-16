import { build } from "esbuild";
await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/cli.mjs",
  external: ["@napi-rs/canvas"],
  sourcemap: true,
  logLevel: "info",
});
// Keep the illustration catalog the backend prompts from in sync with the code.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
writeFileSync("stylekit/props.json", execFileSync(process.execPath, ["dist/cli.mjs", "props"]));
