#!/usr/bin/env node
/**
 * Side-by-side typecheck bench: workspace TypeScript (6.x `tsc`) vs TypeScript 7.
 *
 * Does NOT replace the project typescript dependency (eslint still needs 6.x API).
 * Uses `npx -p typescript@7.0.2 tsc` for the TS7 side.
 *
 * Usage:
 *   npm run typecheck:bench:ts7
 *   node scripts/dev/bench-ts7.mjs
 *   node scripts/dev/bench-ts7.mjs --project tsconfig.typecheck-core.json
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectArg = process.argv.includes("--project")
  ? process.argv[process.argv.indexOf("--project") + 1]
  : "tsconfig.typecheck-core.json";

function run(label, command, args) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024,
  });
  const ms = Math.round(performance.now() - started);
  const out = `${result.stdout || ""}${result.stderr || ""}`;
  const errorCount = (out.match(/error TS\d+/g) || []).length;
  return {
    label,
    ms,
    exitCode: result.status ?? 1,
    errorCount,
    sample: out
      .split(/\r?\n/)
      .filter((l) => /error TS\d+/.test(l))
      .slice(0, 5),
  };
}

const tsc6 =
  process.platform === "win32"
    ? path.join(root, "node_modules", ".bin", "tsc.cmd")
    : path.join(root, "node_modules", ".bin", "tsc");

const r6 = run("TS6 (workspace tsc)", tsc6, ["--pretty", "false", "-p", projectArg]);
const r7 = run("TS7 (npx typescript@7.0.2)", "npx", [
  "--yes",
  "-p",
  "typescript@7.0.2",
  "tsc",
  "--pretty",
  "false",
  "-p",
  projectArg,
]);

const speedup = r7.ms > 0 ? (r6.ms / r7.ms).toFixed(2) : "n/a";

console.log(`project: ${projectArg}`);
console.log(`TS6: exit=${r6.exitCode} errors=${r6.errorCount} ms=${r6.ms}`);
console.log(`TS7: exit=${r7.exitCode} errors=${r7.errorCount} ms=${r7.ms}`);
console.log(`speedup: ${speedup}x (wall time)`);
if (r6.errorCount !== r7.errorCount) {
  console.log("NOTE: error counts differ — inspect diagnostics before switching CI.");
}
if (r6.sample.length) {
  console.log("TS6 sample:");
  for (const line of r6.sample) console.log(`  ${line}`);
}
if (r7.sample.length) {
  console.log("TS7 sample:");
  for (const line of r7.sample) console.log(`  ${line}`);
}

// Non-zero only if TS7 failed to run at all (missing binary / spawn fail).
process.exit(r7.exitCode === null ? 1 : 0);
