import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/lib/brand";

// Ícone na tela de início do celular: abre como app, sem a barra do navegador,
// direto na conversa com a Netz.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: "Vendas e estoque com a Netz, sua assistente",
    lang: "pt-BR",
    start_url: "/netz?app=1",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eef1f6",
    theme_color: "#eef1f6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
