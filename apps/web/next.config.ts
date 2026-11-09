import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@erp/core", "@erp/db"],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  // Fotos chegam já reduzidas no navegador; 5 MB cabe o PDF de comprovante (até 4 MB).
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
