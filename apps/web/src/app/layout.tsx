import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Controle de vendas e estoque", template: "%s · Controle de vendas e estoque" },
  description: "Gestão de vendas, estoque e financeiro com assistente de IA",
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
