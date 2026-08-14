import "server-only";
import fs from "node:fs";
import path from "node:path";
import pino from "pino";

/**
 * Satu-satunya file di modul logging yang menyentuh filesystem.
 *
 * Prinsip: logging TIDAK BOLEH menjatuhkan aplikasi. Semua kegagalan di sini
 * diturunkan menjadi "file logging mati, stdout tetap jalan".
 *
 * Rotasi dilakukan aplikasi sendiri (lihat createRotatingStream), jadi tidak
 * ada ketergantungan pada logrotate atau konfigurasi apa pun di sisi server.
 */

const isProduction = process.env.NODE_ENV === "production";

/** `next build` menyetel NEXT_PHASE; jangan buka file stream saat build. */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

/**
 * File logging aktif di produksi, mati di dev (menulis ke logs/ tiap request
 * bikin file watcher `next dev` churn). Paksa dengan LOG_TO_FILE=1 / matikan
 * dengan LOG_TO_FILE=0.
 */
const fileLoggingEnabled =
  process.env.LOG_TO_FILE === "1" ||
  (isProduction && process.env.LOG_TO_FILE !== "0");

export const logDirectory =
  process.env.LOG_DIR ?? path.join(process.cwd(), "logs");

/** Ukuran maksimum berkas aktif sebelum dirotasi. */
const maxBytes =
  Math.max(1, Number(process.env.LOG_MAX_SIZE_MB) || 10) * 1024 * 1024;

/** Jumlah arsip yang disimpan per berkas; sisanya dihapus otomatis. */
const maxArchives = Math.max(1, Number(process.env.LOG_MAX_FILES) || 30);

/** Peringatan dari dalam logger sendiri — tidak bisa lewat logger. */
function warnToStderr(message: string, detail: Record<string, unknown>): void {
  try {
    process.stderr.write(
      `${JSON.stringify({ subsystem: "logging", msg: message, ...detail })}\n`
    );
  } catch {
    // sudah tidak ada yang bisa dilakukan
  }
}

/** 2026-08-14_22-30-05 dalam WIB — aman sebagai nama berkas dan urut kronologis. */
function archiveStamp(): string {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
  return wib.slice(0, 19).replace("T", "_").replace(/:/g, "-");
}

function currentSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Menghapus arsip terlama sehingga tersisa `maxArchives` berkas.
 * Nama arsip berpola "<base>-<stamp><ext>" sehingga urutan leksikografis
 * sama dengan urutan kronologis.
 */
function pruneArchives(filePath: string): void {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const dir = path.dirname(filePath);

  try {
    const archives = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(`${base}-`) && name.endsWith(ext))
      .sort();

    for (const stale of archives.slice(0, Math.max(0, archives.length - maxArchives))) {
      fs.unlinkSync(path.join(dir, stale));
    }
  } catch (error) {
    warnToStderr("log archive prune failed", { file: filePath, err: String(error) });
  }
}

/**
 * Berkas aktif SELALU bernama sama (mis. logs/app.json) supaya `tail -f` dan
 * `grep` tidak perlu tahu nama yang berubah-ubah. Saat penuh, berkas itu
 * di-rename jadi arsip bertimestamp lalu stream membuka berkas baru di path
 * yang sama.
 */
function createRotatingStream(
  filename: string,
  options: { sync: boolean }
): pino.DestinationStream | null {
  const filePath = path.join(logDirectory, filename);

  try {
    fs.mkdirSync(logDirectory, { recursive: true });

    // Pre-flight WAJIB. Kalau SonicBoom dibuat di atas berkas yang gagal
    // dibuka, fd-nya tetap -1 dan timer periodicFlush akan melempar RangeError
    // dari luar jangkauan handler 'error' -> uncaughtException -> restart loop.
    // Membuka-lalu-menutup di sini memindahkan kegagalan itu ke dalam
    // try/catch, sekaligus menguji permission direktori DAN berkas sekaligus.
    fs.closeSync(fs.openSync(filePath, "a"));

    const destination = pino.destination({
      dest: filePath,
      mkdir: true,
      append: true,
      sync: options.sync,
      ...(options.sync ? {} : { minLength: 4096, periodicFlush: 1000 }),
    });

    // WAJIB. SonicBoom adalah EventEmitter: dengan sync:false, kegagalan
    // open()/write() (EACCES, ENOSPC) muncul sebagai event 'error' asinkron.
    // Tanpa listener, Node melempar uncaught exception dan pm2 masuk restart
    // loop. Ini failure mode paling realistis saat deploy pertama.
    destination.on("error", (error: unknown) => {
      warnToStderr("log destination error", {
        file: filename,
        err: String(error),
      });
    });

    // Hitung dari ukuran berkas yang sudah ada, bukan dari nol — kalau tidak,
    // restart berulang akan membuat berkas tumbuh melewati batas.
    let written = currentSize(filePath);
    let rotating = false;

    destination.on("write", (bytes: number) => {
      written += bytes;
      if (rotating || written < maxBytes) return;

      rotating = true;
      // Ditunda ke tick berikutnya: handler ini berjalan di tengah siklus
      // tulis SonicBoom, dan reopen() di sana rawan re-entrancy.
      setImmediate(() => {
        try {
          const ext = path.extname(filePath);
          const archive = path.join(
            logDirectory,
            `${path.basename(filePath, ext)}-${archiveStamp()}${ext}`
          );
          fs.renameSync(filePath, archive);
          // fd lama masih menunjuk berkas yang sudah di-rename, jadi tidak ada
          // baris yang hilang di antara rename dan reopen.
          destination.reopen();
          written = 0;
          pruneArchives(filePath);
        } catch (error) {
          warnToStderr("log rotation failed", {
            file: filename,
            err: String(error),
          });
          // Jangan biarkan tersangkut: kalau rotasi gagal (mis. disk penuh),
          // reset penghitung agar tidak mencoba rotasi tiap kali menulis.
          written = 0;
        } finally {
          rotating = false;
        }
      });
    });

    // Berguna kalau berkas dipindah dari luar (mis. dibersihkan manual).
    process.on("SIGUSR2", () => {
      try {
        destination.reopen();
        written = 0;
      } catch (error) {
        warnToStderr("log reopen failed", { file: filename, err: String(error) });
      }
    });

    process.on("exit", () => {
      try {
        destination.flushSync();
      } catch {
        // proses sudah mau mati
      }
    });

    return destination;
  } catch (error) {
    warnToStderr("file logging disabled (log dir not writable)", {
      dir: logDirectory,
      err: String(error),
    });
    return null;
  }
}

export function buildStreams(level: pino.Level): pino.StreamEntry[] {
  // stdout selalu aktif supaya `pm2 logs` tetap berguna.
  const streams: pino.StreamEntry[] = [
    { level, stream: pino.destination({ fd: 1, sync: false }) },
  ];

  if (!fileLoggingEnabled || isBuildPhase) return streams;

  const appStream = createRotatingStream("app.json", { sync: false });
  if (appStream) streams.push({ level, stream: appStream });

  // error.json sync: volumenya kecil dan jejak audit ini tidak boleh hilang
  // kalau proses dibunuh paksa.
  const errorStream = createRotatingStream("error.json", { sync: true });
  if (errorStream) streams.push({ level: "error", stream: errorStream });

  return streams;
}
