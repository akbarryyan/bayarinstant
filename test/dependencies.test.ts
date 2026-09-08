import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Setiap paket yang diimpor kode ini harus tercatat di package.json.
 *
 * Paket yang tidak dideklarasikan bisa tetap "jalan" selama ia kebetulan
 * ter-hoist ke node_modules sebagai dependency transitif milik paket lain —
 * sampai paket induknya naik versi dan menjatuhkannya, atau sampai server
 * memasang tanpa devDependencies. Kegagalannya muncul saat install, bukan saat
 * ditulis, dan bentuknya adalah build produksi yang mati total.
 *
 * Test ini memindai sumber sungguhan, bukan daftar yang harus dirawat manual,
 * supaya paket baru ikut terjaga tanpa ada yang perlu ingat memperbarui apa pun.
 */

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".codegraph", "logs", "public"]);
const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|mjs)$/;

/** Menangkap bentuk `from`, bare `import`, dan `require` — cukup untuk basis kode ini. */
const IMPORT_PATTERN = /(?:from\s+|import\s+|require\()\s*["']([^"']+)["']/g;

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** `[^:]` menjaga agar `https://` di dalam string tidak ikut terpotong. */
const LINE_COMMENT = /(^|[^:])\/\/.*$/gm;

/**
 * Komentar dibuang lebih dulu supaya contoh sintaks import yang ditulis di
 * dalam dokumentasi — termasuk di file ini sendiri — tidak terbaca sebagai
 * dependency sungguhan.
 */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "$1");
}

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, found);
    else if (SOURCE_EXTENSIONS.test(entry.name)) found.push(full);
  }
  return found;
}

/** "@scope/pkg/sub" -> "@scope/pkg", "pkg/sub" -> "pkg" */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isLocalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") || // alias tsconfig ke root repo
    specifier.startsWith("node:")
  );
}

function findUndeclaredImports(): Map<string, string[]> {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  const builtins = new Set(builtinModules);

  const undeclared = new Map<string, string[]>();

  for (const file of collectSourceFiles(ROOT)) {
    const source = stripComments(readFileSync(file, "utf8"));

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      if (isLocalSpecifier(specifier)) continue;

      const name = packageNameOf(specifier);
      if (builtins.has(name) || declared.has(name)) continue;

      const relative = path.relative(ROOT, file);
      const files = undeclared.get(name) ?? [];
      if (!files.includes(relative)) files.push(relative);
      undeclared.set(name, files);
    }
  }

  return undeclared;
}

describe("deklarasi dependency", () => {
  it("mendeklarasikan setiap paket yang diimpor kode ini", () => {
    const undeclared = findUndeclaredImports();

    // Nama paket beserta contoh file-nya ikut ditampilkan supaya kegagalan
    // langsung memberi tahu apa yang harus ditambahkan dan di mana dipakainya.
    const report = [...undeclared].map(
      ([name, files]) => `${name} (dipakai di ${files.length} file, mis. ${files[0]})`
    );

    expect(report).toEqual([]);
  });

  it("memindai kode sumber, bukan direktori kosong", () => {
    // Penjaga untuk test di atas: kalau pemindaian rusak dan tidak menemukan
    // file apa pun, ia akan lolos tanpa memeriksa apa-apa.
    expect(collectSourceFiles(ROOT).length).toBeGreaterThan(100);
  });
});
