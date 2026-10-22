import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@erp/core", "@erp/db"],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  // Fotos chegam já reduzidas no navegador; 3 MB dá folga para PNG.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
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
