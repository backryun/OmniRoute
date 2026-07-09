#!/usr/bin/env node
/**
 * Side-by-side typecheck bench: workspace TypeScript 6.x `tsc` vs TypeScript 7.
 *
 * Does NOT replace the project `typescript` dependency (eslint still needs the
 * 6.x programmatic API). TS7 is resolved in this order:
 *   1. .ts7-local/node_modules/typescript  (private prefix install)
 *   2. node_modules/typescript-7           (npm alias package)
 *   3. npx -p typescript@7.0.2 tsc         (fallback)
 *
 * Usage:
 *   npm run typecheck:bench:ts7
 *   node scripts/dev/bench-ts7.mjs
 *   node scripts/dev/bench-ts7.mjs --project tsconfig.typecheck-core.json
 *   node scripts/dev/bench-ts7.mjs --project tsconfig.typecheck-ts7-wide.json --diff
 *   node scripts/dev/bench-ts7.mjs --all
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wantDiff = process.argv.includes("--diff");
const wantAll = process.argv.includes("--all");

const DEFAULT_PROJECTS = [
  "tsconfig.typecheck-core.json",
  "tsconfig.typecheck-noimplicit-core.json",
  "tsconfig.typecheck-ts7-wide.json",
];

function resolveProjects() {
  if (wantAll) return DEFAULT_PROJECTS.filter((p) => fs.existsSync(path.join(root, p)));
  if (process.argv.includes("--project")) {
    return [process.argv[process.argv.indexOf("--project") + 1]];
  }
  return ["tsconfig.typecheck-core.json"];
}

function bin(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function resolveTsc6() {
  return path.join(root, "node_modules", ".bin", bin("tsc"));
}

function resolveTsc7() {
  const candidates = [
    path.join(root, ".ts7-local", "node_modules", "typescript", "bin", "tsc"),
    path.join(root, "node_modules", "typescript-7", "bin", "tsc"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return {
        mode: "local",
        command: process.platform === "win32" ? "node" : c,
        argsPrefix: process.platform === "win32" ? [c] : [],
        label: path.relative(root, c),
      };
    }
  }
  return {
    mode: "npx",
    command: "npx",
    argsPrefix: ["--yes", "-p", "typescript@7.0.2", "tsc"],
    label: "npx typescript@7.0.2",
  };
}

function run(label, command, args) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Math.round(performance.now() - started);
  const out = `${result.stdout || ""}${result.stderr || ""}`;
  const lines = out.split(/\r?\n/).filter((l) => /error TS\d+/.test(l));
  return {
    label,
    ms,
    exitCode: result.status ?? 1,
    errorCount: lines.length,
    errors: lines,
    sample: lines.slice(0, 8),
  };
}

function setDiff(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  return {
    only6: [...A].filter((x) => !B.has(x)).sort(),
    only7: [...B].filter((x) => !A.has(x)).sort(),
  };
}

const tsc6 = resolveTsc6();
const tsc7 = resolveTsc7();
const projects = resolveProjects();

console.log(`tsc6: ${tsc6}`);
console.log(`tsc7: ${tsc7.label} (${tsc7.mode})`);
console.log("");

let worstMismatch = false;

for (const projectArg of projects) {
  if (!fs.existsSync(path.join(root, projectArg))) {
    console.log(`SKIP missing project: ${projectArg}`);
    continue;
  }

  const r6 = run("TS6", tsc6, ["--pretty", "false", "-p", projectArg]);
  const r7 = run("TS7", tsc7.command, [
    ...tsc7.argsPrefix,
    "--pretty",
    "false",
    "-p",
    projectArg,
  ]);

  const speedup = r7.ms > 0 ? (r6.ms / r7.ms).toFixed(2) : "n/a";
  console.log(`=== ${projectArg} ===`);
  console.log(`TS6: exit=${r6.exitCode} errors=${r6.errorCount} ms=${r6.ms}`);
  console.log(`TS7: exit=${r7.exitCode} errors=${r7.errorCount} ms=${r7.ms}`);
  console.log(`speedup: ${speedup}x (wall time)`);

  if (r6.errorCount !== r7.errorCount) {
    worstMismatch = true;
    console.log("NOTE: error counts differ");
  }

  if (wantDiff) {
    const d = setDiff(r6.errors, r7.errors);
    console.log(`only-in-TS6: ${d.only6.length}`);
    for (const line of d.only6.slice(0, 20)) console.log(`  - ${line}`);
    console.log(`only-in-TS7: ${d.only7.length}`);
    for (const line of d.only7.slice(0, 20)) console.log(`  + ${line}`);
  } else if (r6.sample.length || r7.sample.length) {
    if (r6.sample.length) {
      console.log("TS6 sample:");
      for (const line of r6.sample) console.log(`  ${line}`);
    }
    if (r7.sample.length) {
      console.log("TS7 sample:");
      for (const line of r7.sample) console.log(`  ${line}`);
    }
  }
  console.log("");
}

if (worstMismatch) {
  console.log("Result: diagnostic mismatch — do not flip CI typecheck to TS7 yet.");
} else {
  console.log("Result: error counts match across projects (good for pilot).");
}

process.exit(0);
