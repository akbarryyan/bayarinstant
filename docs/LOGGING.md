# Logging

Implementasi WHUZPAY_CONSTITUTION pasal 9. Log JSON terstruktur ditulis ke
`logs/app.json` dan `logs/error.json`, sekaligus ke stdout supaya `pm2 logs`
tetap berguna.

## Cara memakai

```ts
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("webhook.poppay");   // sekali per file, di module scope

log.info({ orderId, aggRefId }, "callback received");
log.error({ err }, "callback gagal diproses");
```

**Aturan induk: data masuk ke argumen objek, bukan ke string pesan.**

```ts
log.info(`order ${id} lunas`);          // SALAH
log.info({ orderId: id }, "order lunas"); // BENAR
```

Dua alasan. Pertama, redaksi rahasia hanya bekerja pada binding object — string
`msg` tidak pernah diredaksi. Kedua, pesan statis bisa diagregasi dan di-`grep`;
pesan yang diinterpolasi tidak.

Objek error selalu memakai key `err` (itu yang dikenali serializer pino).

## Field otomatis

Tidak perlu menulis `orderId`/`provider`/`paymentMethod`/`userId` di setiap
panggilan. `mixin()` menyuntikkannya dari `AsyncLocalStorage`:

- `requestId`, `route`, `method` — diisi `withRequestLog()` di setiap route API
- `userId` — diisi `getSession()` ([lib/session.ts](../lib/session.ts))
- `orderId`, `provider`, `paymentMethod` — diisi `setRequestContext()` di jalur
  order, mis. [create-checkout.service.ts](../src/core/services/checkout/create-checkout.service.ts)

Artinya seluruh log dalam satu request berbagi `requestId` yang sama, dan bisa
ditarik utuh dengan satu `grep`.

## Route API

Semua handler dibungkus `withRequestLog()`, yang menulis satu baris `"access"`
per request berisi method, route, status, dan durasi:

```ts
async function GET_handler(request: Request) { /* ... */ }
export const GET = withRequestLog("/api/orders/[code]", GET_handler);
```

Argumen pertama adalah **pola** route (`/api/orders/[code]`), bukan URL konkret
— supaya log bisa diagregasi per-endpoint. URL konkretnya tetap ada di field
`path`.

⚠️ Route webhook menelan exception dan selalu membalas HTTP 200. Untuk jalur
itu, access log akan menunjukkan `status: 200` walau pemrosesan gagal total —
`log.error` di dalam `catch` adalah satu-satunya sinyal, jadi jangan dihapus.

## Rahasia

Dilarang keras me-log API key, token, `viewToken`, password hash. Ada dua lapis
pengaman di [redaction.ts](../src/infra/logging/redaction.ts): `redact.paths`
pino untuk bentuk yang diketahui, dan `scrubDeep()` rekursif untuk payload
gateway yang bentuknya tak terduga. Keduanya hanya menyentuh binding object —
lihat aturan induk di atas.

`scrubDeep()` adalah fungsi murni dan bisa dipakai di luar logging, mis.
sebelum menyimpan payload provider ke `ProviderLog.request`.

## Konfigurasi

| Env | Default | Keterangan |
|---|---|---|
| `LOG_LEVEL` | `info` (prod), `debug` (dev) | level minimum |
| `LOG_DIR` | `<cwd>/logs` | direktori berkas log |
| `LOG_TO_FILE` | aktif di produksi | `1` memaksa aktif, `0` mematikan |
| `LOG_MAX_SIZE_MB` | `10` | ukuran maksimum sebelum berkas dirotasi |
| `LOG_MAX_FILES` | `30` | jumlah arsip yang disimpan per berkas |

File logging mati di development supaya file watcher `next dev` tidak churn.
Aktifkan sementara dengan `LOG_TO_FILE=1` saat ingin menguji jalur file.

Kalau direktori log tidak bisa ditulis, file logging dimatikan dan aplikasi
tetap jalan — peringatan ditulis ke stderr. Ini diuji: lihat "Ketahanan" di
bawah.

## Rotasi

Aplikasi merotasi sendiri — **tidak perlu logrotate, cron, atau konfigurasi
apa pun di sisi server.** Cukup pull, build, restart.

Berkas aktif selalu bernama sama:

```
logs/app.json                        <- yang sedang ditulis, tail/grep ke sini
logs/app-2026-08-14_23-24-51.json    <- arsip, timestamp WIB saat dirotasi
logs/app-2026-08-14_18-02-10.json
logs/error.json
logs/error-2026-08-13_09-15-33.json
```

Begitu `app.json` melewati `LOG_MAX_SIZE_MB`, berkas itu di-rename jadi arsip
bertimestamp lalu stream membuka berkas baru di path yang sama. Arsip terlama
dihapus otomatis sehingga tersisa `LOG_MAX_FILES` berkas.

Karena nama arsip memakai timestamp, urutan leksikografis sama dengan urutan
kronologis — `ls logs/` sudah terurut, dan tidak ada rename berantai seperti
pola `.1`/`.2` yang rawan balapan.

Penghitung ukuran dibaca dari ukuran berkas yang sudah ada saat boot, jadi
restart berulang tidak membuat berkas tumbuh melewati batas.

Rotasi dijalankan tanpa worker thread (memakai event `write` dari sonic-boom),
sehingga `flushSync()` sinkron saat proses mati tetap bisa dipakai — penting
karena ini jejak audit pembayaran.

Kalau berkas dipindah dari luar, kirim `SIGUSR2` ke proses agar membuka berkas
baru: `pm2 sendSignal SIGUSR2 <nama-app>`.

## Membaca log

```bash
# semua log satu request
grep '"requestId":"<id>"' logs/app.json | jq .

# seluruh jalur satu order — termasuk arsip lama
grep -h '"orderId":"<id>"' logs/app*.json | jq -c '{time,subsystem,msg}'

# apa yang dikirim ke Poppay saat QRIS dibuat (termasuk callback_url)
grep '"msg":"poppay create incoming request"' logs/app.json | jq .

# request lambat
jq -c 'select(.msg=="access" and .durationMs > 1000)' logs/app.json
```

## Verifikasi

```bash
LOG_TO_FILE=1 npm run start
curl -s localhost:3000/api/payment-methods > /dev/null
tail -n 5 logs/app.json | jq .

# ketahanan: aplikasi harus tetap melayani walau logs/ tidak bisa ditulis
chmod 500 logs && LOG_TO_FILE=1 npm run start
```

## Yang sengaja tidak dimigrasi

`console.*` di client component (`app/admin/**/*.tsx`). Logger bersifat
server-only; mengimpornya dari browser akan menggagalkan build. Aturan ESLint
`no-console` karena itu hanya mencakup file `.ts`.
