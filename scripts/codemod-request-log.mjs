/**
 * Codemod: membungkus setiap route handler App Router dengan withRequestLog().
 *
 * Strategi sengaja MINIM-DIFF: body handler tidak disentuh sama sekali.
 *
 *   export async function GET(req: Request) { ... }
 *
 * menjadi
 *
 *   async function GET_handler(req: Request) { ... }        <- body identik
 *   export const GET = withRequestLog("/api/foo", GET_handler);
 *
 * Dengan begitu indentasi, komentar, dan seluruh isi handler tetap utuh, dan
 * diff-nya cuma 2 baris + 1 import per handler.
 *
 * Pakai:  node scripts/codemod-request-log.mjs [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";

const DRY = process.argv.includes("--dry");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const files = globSync("app/api/**/route.ts").sort();

/** app/api/orders/[code]/route.ts -> /api/orders/[code] */
function routePatternOf(file) {
  return "/" + path.dirname(file).split(path.sep).slice(1).join("/");
}

let changedFiles = 0;
let changedHandlers = 0;
const skipped = [];

for (const file of files) {
  const original = readFileSync(file, "utf8");

  if (original.includes("withRequestLog")) {
    skipped.push(`${file} (sudah dibungkus)`);
    continue;
  }

  const route = routePatternOf(file);
  let source = original;
  const wrapped = [];

  for (const method of METHODS) {
    const declaration = new RegExp(`^export async function ${method}\\(`, "m");
    if (!declaration.test(source)) continue;

    source = source.replace(declaration, `async function ${method}_handler(`);
    wrapped.push(method);
  }

  if (wrapped.length === 0) {
    skipped.push(`${file} (tidak ada handler berbentuk 'export async function')`);
    continue;
  }

  // Import disisipkan setelah pernyataan import terakhir, atau di paling atas
  // kalau file tidak punya import sama sekali.
  const importLine = `import { withRequestLog } from "@/src/infra/logging/with-request-log";`;
  const imports = [...source.matchAll(/^import [\s\S]*?;$/gm)];
  if (imports.length > 0) {
    const at = imports[imports.length - 1].index + imports[imports.length - 1][0].length;
    source = source.slice(0, at) + "\n" + importLine + source.slice(at);
  } else {
    source = importLine + "\n" + source;
  }

  const exports = wrapped
    .map((m) => `export const ${m} = withRequestLog("${route}", ${m}_handler);`)
    .join("\n");
  source = source.replace(/\s*$/, "\n") + "\n" + exports + "\n";

  if (!DRY) writeFileSync(file, source);
  changedFiles++;
  changedHandlers += wrapped.length;
}

console.log(`${DRY ? "[DRY] " : ""}file diubah: ${changedFiles}, handler dibungkus: ${changedHandlers}`);
if (skipped.length) {
  console.log(`\ndilewati (${skipped.length}):`);
  for (const s of skipped) console.log("  - " + s);
}
