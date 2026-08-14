import { NextRequest, NextResponse } from "next/server";
import { isRegisterOtpRequired } from "@/lib/auth-config";
import { prisma } from "@/src/infra/db/prisma";
import { generateOTP } from "@/lib/fonnte";
import { sendOtpEmail } from "@/lib/mailer";
import { getSiteName } from "@/lib/site-config";
import { withRequestLog } from "@/src/infra/logging/with-request-log";
import { createLogger } from "@/src/infra/logging/logger";

const log = createLogger("api.auth");

async function POST_handler(req: NextRequest) {
  try {
    await getSiteName();
    const body = await req.json();
    const { email, purpose } = body;
    // OTP hanya via email
    const target = "email";

    if (!purpose) {
      return NextResponse.json(
        { success: false, message: "Data tidak lengkap." },
        { status: 400 }
      );
    }

    if (!["REGISTER", "RESET_PASSWORD"].includes(purpose)) {
      return NextResponse.json(
        { success: false, message: "Tujuan tidak valid." },
        { status: 400 }
      );
    }

    if (purpose === "REGISTER" && !(await isRegisterOtpRequired())) {
      return NextResponse.json(
        { success: false, message: "Verifikasi OTP saat daftar sedang dinonaktifkan." },
        { status: 503 }
      );
    }

    // --- Validasi email ---
    if (!email) {
      return NextResponse.json(
        { success: false, message: "Email wajib diisi." },
        { status: 400 }
      );
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail.includes("@")) {
      return NextResponse.json(
        { success: false, message: "Format email tidak valid." },
        { status: 400 }
      );
    }

    // --- Rate limit: max 5 OTP per email per jam ---
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await prisma.otpCode.count({
      where: { email: normalizedEmail, createdAt: { gte: oneHourAgo } },
    });

    if (recentCount >= 5) {
      return NextResponse.json(
        { success: false, message: "Terlalu banyak percobaan. Coba lagi dalam 1 jam." },
        { status: 429 }
      );
    }

    // --- Cooldown: minimal 60 detik antar OTP ---
    const lastOtp = await prisma.otpCode.findFirst({
      where: { email: normalizedEmail },
      orderBy: { createdAt: "desc" },
    });

    if (lastOtp && Date.now() - lastOtp.createdAt.getTime() < 60000) {
      const remaining = Math.ceil(
        (60000 - (Date.now() - lastOtp.createdAt.getTime())) / 1000
      );
      return NextResponse.json(
        { success: false, message: `Tunggu ${remaining} detik sebelum mengirim OTP baru.` },
        { status: 429 }
      );
    }

    // --- Cek berdasarkan purpose ---
    if (purpose === "RESET_PASSWORD") {
      const user = await prisma.user.findFirst({
        where: { email: normalizedEmail },
        select: { id: true, isActive: true },
      });

      if (!user) {
        return NextResponse.json(
          { success: false, message: "Email belum terdaftar. Silakan daftar terlebih dahulu." },
          { status: 404 }
        );
      }

      if (!user.isActive) {
        return NextResponse.json(
          { success: false, message: "Akun dinonaktifkan. Hubungi admin." },
          { status: 403 }
        );
      }
    } else {
      // REGISTER — pastikan email belum terdaftar
      const existing = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (existing) {
        return NextResponse.json(
          { success: false, message: "Email sudah terdaftar. Silakan login." },
          { status: 409 }
        );
      }
    }

    // --- Generate & simpan OTP ---
    const code = generateOTP();

    await prisma.otpCode.create({
      data: {
        phone: null,
        email: normalizedEmail,
        target,
        code,
        purpose,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      } as Parameters<typeof prisma.otpCode.create>[0]["data"],
    });

    // --- Kirim OTP via email ---
    const result = await sendOtpEmail(normalizedEmail, code, purpose);

    if (!result.success) {
      log.error({ detail: result.detail }, "otp email send failed");
      return NextResponse.json(
        { success: false, message: "Gagal mengirim OTP ke email. Coba lagi nanti." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Kode OTP berhasil dikirim ke email Anda.",
    });
  } catch (error) {
    log.error({ err: error }, "otp send failed");
    return NextResponse.json(
      { success: false, message: "Terjadi kesalahan server. Coba lagi." },
      { status: 500 }
    );
  }
}

export const POST = withRequestLog("/api/auth/otp/send", POST_handler);
