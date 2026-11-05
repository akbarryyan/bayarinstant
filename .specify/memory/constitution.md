<!--
Sync Impact Report
- Version change: none (unfilled template) → 1.0.0
- Bump rationale: initial ratification; every placeholder replaced with concrete,
  project-specific governance derived from docs/WHUZPAY_CONSTITUTION.md and the codebase.
- Modified principles:
  - [PRINCIPLE_1_NAME] → I. Layered Separation & Service Layer First
  - [PRINCIPLE_2_NAME] → II. Ports & Adapters for Every External System
  - [PRINCIPLE_3_NAME] → III. Idempotency & State Machine Discipline (NON-NEGOTIABLE)
  - [PRINCIPLE_4_NAME] → IV. Ledger & Order Access Integrity (NON-NEGOTIABLE)
  - [PRINCIPLE_5_NAME] → V. Deterministic & Testable by Default
- Added sections:
  - [SECTION_2_NAME] → Security & Data Handling Standards
  - [SECTION_3_NAME] → Development Workflow & Quality Gates
  - Governance rules populated (amendment procedure, versioning policy, compliance review)
- Removed sections: none
- Deferred TODOs: none
- Note: RATIFICATION_DATE derived from commit 11fedf7 (2026-03-29), which introduced
  docs/WHUZPAY_CONSTITUTION.md — the first adoption of these engineering rules.
-->

# Whuzpay Constitution

## Core Principles

### I. Layered Separation & Service Layer First

Seluruh business logic transaksi MUST berada di `src/core/services` sebagai service/usecase
(contoh: `create-checkout.service.ts`, `handle-pakasir-webhook.service.ts`,
`execute-provider-purchase.service.ts`). Route handler MUST terbatas pada empat langkah: parse
input, validasi, panggil service, kembalikan response. Komponen UI MUST NOT memuat logic
transaksi. `src/core` MUST NOT mengimpor apa pun dari `src/infra`; arah dependensi selalu
`infra → core`.

Rationale: logic yang tersebar di route handler dan komponen tidak bisa dites tanpa HTTP dan
tidak bisa dipakai ulang oleh worker queue, sementara alur transaksi Whuzpay dijalankan dari
dua entry point berbeda (request dan job).

### II. Ports & Adapters for Every External System

Setiap sistem eksternal — payment gateway, provider PPOB, queue, dan repository database — MUST
diakses melalui port di `src/core/ports`. Service MUST NOT mengimpor SDK payment atau SDK
provider secara langsung. Implementasi nyata MUST tinggal di `src/infra` (misalnya
`src/infra/payment/pakasir`, `src/infra/providers/digiflazz`) dan dipilih lewat factory.

Rationale: provider dan payment gateway berganti mode antara `mock` dan `real` per environment;
tanpa port, setiap pergantian menyentuh business logic dan mock tidak bisa disuntikkan saat test.

### III. Idempotency & State Machine Discipline (NON-NEGOTIABLE)

- Semua webhook, semua purchase provider, dan semua job queue MUST idempotent.
- Setiap webhook MUST tercatat dengan `eventId` di `WebhookEvent`, dan percobaan yang belum
  tuntas MUST dapat diproses ulang tanpa menimbulkan efek ganda.
- Provider purchase MUST NOT dieksekusi di dalam HTTP request. Checkout hanya membuat order dan
  payment invoice; eksekusi provider selalu lewat worker queue.
- Status order MUST hanya berpindah mengikuti alur berikut, dan MUST NOT melompati status:

```text
CREATED → WAITING_PAYMENT → PAID → PROCESSING_PROVIDER → SUCCESS
CREATED → WAITING_PAYMENT → EXPIRED
PAID → PROCESSING_PROVIDER → FAILED
FAILED → REFUNDED (wallet)
```

- Semua request dan response provider MUST dicatat di `ProviderLog`.

Rationale: webhook dikirim ulang oleh payment gateway dan job queue melakukan retry. Tanpa
idempotensi dan batas transisi status yang tegas, satu pembayaran bisa memicu pembelian ganda
ke provider — kerugian uang nyata yang tidak bisa dibatalkan.

### IV. Ledger & Order Access Integrity (NON-NEGOTIABLE)

- `LedgerEntry` adalah source of truth untuk saldo. `Wallet.balance` hanya untuk quick read dan
  MUST NOT dipakai sebagai dasar audit atau rekonsiliasi.
- Transaksi wallet MUST mengikuti urutan HOLD → eksekusi provider → DEBIT finalize saat SUCCESS
  atau RELEASE saat FAILED. Saldo MUST NOT didebit sebelum provider sukses.
- Guest MUST NOT membayar dengan wallet; guest hanya lewat payment gateway.
- Akses order guest MUST tertokenisasi: `order_code` bersifat publik, `view_token` bersifat
  rahasia, dan database MUST menyimpan `view_token_hash`. Detail order MUST NOT terekspos hanya
  dengan `order_code`.
- Setiap route admin MUST memverifikasi session admin sebelum mengembalikan atau mengubah data.

Rationale: saldo dan detail order adalah data bernilai uang dan data pribadi. Keduanya pernah
menjadi sumber cacat nyata di repo ini (redaksi detail order tanpa token, pengikatan callback ke
invoice), sehingga aturannya dinaikkan menjadi non-negotiable.

### V. Deterministic & Testable by Default

- Setiap service MUST dapat dites tanpa database nyata, menggunakan repository mock, provider
  mock, dan payment mock.
- Mock provider MUST mampu mensimulasikan skenario `success`, `failed`, `pending`, delay, dan
  retry.
- Perubahan pada alur transaksi, webhook, wallet, atau akses order MUST disertai test otomatis.
- Test MUST deterministik: tidak bergantung pada jaringan, waktu nyata, atau urutan eksekusi.

Rationale: alur transaksi hanya bisa diverifikasi sebelum menyentuh uang sungguhan bila jalur
gagal dan jalur pending dapat direproduksi sesuai permintaan.

## Security & Data Handling Standards

- **Validasi**: semua input request MUST divalidasi dengan Zod, dan semua input service MUST
  typed. Input MUST dinormalisasi sebelum dipakai — nomor HP `08xxx` → `628xxx`, gameID dan
  server divalidasi format, nomor PLN divalidasi panjangnya.
- **Webhook payment**: MUST memverifikasi `order_id`, `amount`, dan `status`, MUST melakukan
  cross-check ke `detailPayment(order_id, amount)`, dan callback MUST terikat pada invoice yang
  memang diterbitkan oleh sistem ini. Webhook provider MUST memvalidasi signature bila tersedia.
- **Rate limit**: endpoint `/api/auth/*`, `/api/checkout`, dan lookup `/api/orders/:code` MUST
  dibatasi lajunya.
- **Rahasia**: API key, `view_token`, dan password hash MUST NOT pernah masuk log. Redaksi
  MUST diterapkan di layer logging, bukan diserahkan ke pemanggil.
- **Logging**: log MUST berbentuk JSON terstruktur dan menyertakan `orderId`, `provider`,
  `paymentMethod`, serta `userId` bila ada.
- **Error**: response ke client MUST ramah dan MUST NOT membocorkan error internal; detail
  disimpan di log. Kegagalan domain MUST memakai error class yang ada — `ValidationError`,
  `InsufficientBalanceError`, `ProviderDownError`, `PaymentNotCompletedError`.
- **Environment**: produksi MUST memakai HTTPS. Mode provider MUST eksplisit lewat
  `PROVIDER_DIGIFLAZZ_MODE` dan `PROVIDER_VIP_MODE`; produksi MUST bernilai `real`.

## Development Workflow & Quality Gates

- **Penamaan**: file `kebab-case.ts`, folder huruf kecil, service `*.service.ts`, job `*.job.ts`.
  Model Prisma memakai PascalCase dan field memakai camelCase.
- **Git**: commit MUST mengikuti conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`),
  branch memakai prefiks `feature/`, `fix/`, atau `hotfix/`.
- **Dependency**: setiap paket yang diimpor kode MUST dideklarasikan di `package.json`; aturan
  ini dijaga otomatis oleh `test/dependencies.test.ts` dan MUST NOT dilewati.
- **Gate sebelum merge**: `npm run lint` dan `npm test` MUST hijau. PR yang menyentuh alur
  transaksi MUST menyertakan test yang gagal sebelum perbaikan dan lulus sesudahnya.
- **Definition of Done**: sebuah fitur selesai hanya bila flow sukses berjalan, flow gagal
  tertangani, idempotensi aman, transisi status benar, log tersedia, dan mode mock dapat
  mensimulasikan skenarionya.
- **Penyimpangan**: perubahan yang melanggar prinsip mana pun MUST didokumentasikan beserta
  justifikasinya di deskripsi PR, atau diajukan sebagai amandemen konstitusi.

## Governance

Konstitusi ini menggantikan praktik lain yang bertentangan dengannya. Dokumen
`docs/WHUZPAY_CONSTITUTION.md` tetap menjadi buku pegangan teknis dengan penjelasan yang lebih
rinci; bila keduanya berbeda, dokumen ini yang berlaku, dan amandemen yang mengubah sebuah aturan
MUST memperbarui keduanya dalam PR yang sama.

**Prosedur amandemen**: perubahan diajukan lewat PR tersendiri yang memuat aturan lama, aturan
baru, alasan perubahan, dampaknya terhadap kode yang sudah ada, dan rencana migrasi bila aturan
tersebut membuat kode berjalan menjadi non-compliant. Amandemen berlaku setelah PR-nya di-merge.

**Kebijakan versi**: versi konstitusi mengikuti semantic versioning. MAJOR untuk penghapusan atau
redefinisi prinsip yang tidak backward compatible, MINOR untuk penambahan prinsip atau perluasan
panduan yang material, PATCH untuk klarifikasi kata dan perbaikan non-semantik.

**Peninjauan kepatuhan**: setiap review PR MUST memverifikasi kepatuhan terhadap prinsip di atas,
dan setiap perencanaan fitur MUST melewati Constitution Check pada `.specify/templates/plan-template.md`.
Kompleksitas tambahan MUST dijustifikasi; bila tidak bisa dijustifikasi, ia harus dihapus.

**Version**: 1.0.0 | **Ratified**: 2026-03-29 | **Last Amended**: 2026-09-09
