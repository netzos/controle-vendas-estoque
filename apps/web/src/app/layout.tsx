import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Netz ERP", template: "%s · Netz ERP" },
  description: "Gestão de vendas, estoque e financeiro com assistente de IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
