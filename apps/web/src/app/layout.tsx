import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
  description: "Gestão de vendas, estoque e financeiro com assistente de IA",
  applicationName: BRAND_NAME,
  // iPhone: "Adicionar à Tela de Início" vira app com o nome e a logo do netzsales
  // (a logo vem de app/apple-icon.png; o resto, de app/manifest.ts).
  appleWebApp: { capable: true, title: BRAND_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // iPhones mais antigos só abrem sem a barra do Safari com esta etiqueta.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Como app: tocar num campo não dá zoom e a tela não "pinça".
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#eef1f6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
