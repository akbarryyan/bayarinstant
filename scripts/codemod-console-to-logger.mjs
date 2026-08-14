/**
 * Codemod: mengganti console.* dengan logger terstruktur.
 *
 * HANYA menangani bentuk satu baris yang aman dikonversi mekanis:
 *
 *   console.error("[ADMIN BRANDS GET ERROR]", error);
 *     -> log.error({ err: error }, "brands get failed");
 *   console.log("[VIP] Generating dynamic signature");
 *     -> log.info("generating dynamic signature");
 *
 * Bentuk lain (template literal, panggilan multi-baris, argumen objek inline)
 * SENGAJA dilewati dan dilaporkan, karena memindahkan data dari pesan ke
 * binding object butuh penilaian manusia.
 *
 * Pakai:  node scripts/codemod-console-to-logger.mjs [--dry]
 */
import { readFileSync, writeFileSync, globSync } from "node:fs";

const DRY = process.argv.includes("--dry");

/** path prefix -> subsystem. Yang pertama cocok menang, jadi urutannya penting. */
const SUBSYSTEM_RULES = [
  ["app/api/webhook/poppay", "webhook.poppay"],
  ["app/api/webhook/pakasir", "webhook.pakasir"],
  ["app/api/webhook/vip", "webhook.vip"],
  ["app/api/webhooks/", "webhook.legacy"],
  ["app/api/admin/", "api.admin"],
  ["app/api/auth/", "api.auth"],
  ["app/api/checkout", "api.checkout"],
  ["app/api/orders/", "api.orders"],
  ["app/api/transaksi", "api.orders"],
  ["app/api/wallet/", "api.wallet"],
  ["app/api/merchant/", "api.merchant"],
  ["app/api/seller/", "api.seller"],
  ["app/api/catalog/", "api.catalog"],
  ["app/api/tickets/", "api.tickets"],
  ["app/api/vouchers/", "api.vouchers"],
  ["app/api/", "api.misc"],
  ["app/", "api.misc"],
  ["src/core/services/payment/", "webhook.pakasir"],
  ["src/core/services/provider/execute", "order.execute"],
  ["src/core/services/provider/reconcile", "order.reconcile"],
  ["src/core/services/provider/provider-management", "provider.mgmt"],
  ["src/core/services/order/", "order.expire"],
  ["src/core/services/checkout/", "checkout"],
  ["src/infra/providers/vip/", "provider.vip"],
  ["src/infra/providers/digiflazz/", "provider.digiflazz"],
  ["src/infra/providers/", "provider.mgmt"],
  ["src/infra/payment/pakasir/", "payment.pakasir"],
  ["src/infra/payment/poppay/", "payment.poppay"],
  ["src/infra/db/repositories/", "db.repo"],
  ["lib/wallet-topup-webhook", "wallet.topup"],
  ["lib/fonnte", "notify.fonnte"],
  ["lib/mailer", "notify.mailer"],
  ["lib/pricing", "pricing"],
  ["lib/site-config", "config"],
  ["lib/upload", "upload"],
  ["lib/seller", "seller"],
  ["lib/analytics", "api.misc"],
  ["lib/", "api.misc"],
];

// Dead code (tidak ada produsen job, Redis tidak dikonfigurasi) — jangan sentuh.
const IGNORED = ["src/infra/queue/"];

const LEVEL_OF = { error: "error", warn: "warn", log: "info", info: "info", debug: "debug" };

function subsystemOf(file) {
  const rule = SUBSYSTEM_RULES.find(([prefix]) => file.startsWith(prefix));
  return rule ? rule[1] : null;
}

/**
 * Menurunkan pesan statis dari argumen console.
 *
 *   "[ADMIN BRANDS GET ERROR]"      -> "admin brands get failed"
 *   "[GET /api/orders]"             -> "request failed"   (route & method sudah jadi field)
 *   "[VIP] Check balance request:"  -> "check balance request"
 *   "Failed to get products:"       -> "failed to get products"
 *
 * Prefix bracket TIDAK boleh dibuang begitu saja: pada banyak panggilan,
 * seluruh informasi justru ada di dalamnya.
 */
function normalizeMessage(raw) {
  const bracket = raw.match(/\[([^\]]*)\]/)?.[1]?.trim() ?? "";
  const outside = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:\-–]\s*$/, "")
    .trim();

  let msg = outside;

  if (!msg) {
    // Prefix bergaya route: method + path sudah tersedia sebagai field
    // terstruktur dari access log, jadi mengulangnya di pesan tidak berguna.
    if (/^(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(bracket)) {
      msg = "request failed";
    } else {
      // Prefix bracket lazimnya SCREAMING_CASE; turunkan seluruhnya, bukan
      // hanya huruf pertama.
      msg = bracket
        .toLowerCase()
        .replace(/\s*error\s*$/, " failed")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  if (!msg) msg = "error";
  if (msg === msg.toUpperCase() && /[A-Z]/.test(msg)) msg = msg.toLowerCase();
  else msg = msg.charAt(0).toLowerCase() + msg.slice(1);
  return msg.replace(/"/g, "'");
}

const files = globSync("{app,src,lib}/**/*.ts").sort();

let touchedFiles = 0;
let converted = 0;
const manual = [];

for (const file of files) {
  if (IGNORED.some((p) => file.startsWith(p))) continue;

  const original = readFileSync(file, "utf8");
  if (!original.includes("console.")) continue;

  const subsystem = subsystemOf(file);
  if (!subsystem) {
    manual.push(`${file} (subsystem tidak terpetakan)`);
    continue;
  }

  const lines = original.split("\n");
  let changed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("console.")) continue;

    // console.X("pesan literal", ident);   |   console.X("pesan literal");
    const m = line.match(
      /^(\s*)console\.(error|warn|log|info|debug)\(\s*"((?:[^"\\]|\\.)*)"\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\)\s*;\s*$/
    );
    if (!m) {
      manual.push(`${file}:${i + 1}  ${line.trim().slice(0, 80)}`);
      continue;
    }

    const [, indent, method, rawMsg, ident] = m;
    const level = LEVEL_OF[method];
    const msg = normalizeMessage(rawMsg);

    if (!ident) {
      lines[i] = `${indent}log.${level}("${msg}");`;
    } else if (/^(error|err|e|ex|execErr|error2)$/i.test(ident)) {
      // pino stdSerializers memakai key `err`
      lines[i] =
        ident === "err"
          ? `${indent}log.${level}({ err }, "${msg}");`
          : `${indent}log.${level}({ err: ${ident} }, "${msg}");`;
    } else {
      lines[i] = `${indent}log.${level}({ ${ident} }, "${msg}");`;
    }
    changed++;
  }

  if (changed === 0) continue;

  let source = lines.join("\n");

  // Sisipkan import + instance logger setelah import terakhir.
  if (!source.includes("createLogger")) {
    const imports = [...source.matchAll(/^import [\s\S]*?;$/gm)];
    const decl =
      `\nimport { createLogger } from "@/src/infra/logging/logger";\n` +
      `\nconst log = createLogger("${subsystem}");`;
    if (imports.length > 0) {
      const last = imports[imports.length - 1];
      const at = last.index + last[0].length;
      source = source.slice(0, at) + decl + source.slice(at);
    } else {
      source = decl.trimStart() + "\n" + source;
    }
  }

  if (!DRY) writeFileSync(file, source);
  touchedFiles++;
  converted += changed;
}

console.log(`${DRY ? "[DRY] " : ""}file diubah: ${touchedFiles}, panggilan dikonversi: ${converted}`);
console.log(`perlu penanganan manual: ${manual.length}`);
for (const m of manual) console.log("  - " + m);
