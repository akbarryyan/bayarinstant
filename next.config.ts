import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Jangan bundle logger ke server chunk. `pino` sebetulnya sudah ada di
  // daftar external bawaan Next, tapi ditulis eksplisit sebagai pagar kalau
  // daftar itu berubah. `sonic-boom` tidak ada di daftar bawaan.
  serverExternalPackages: ["pino", "sonic-boom"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.vcgamers.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "i.ibb.co.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
