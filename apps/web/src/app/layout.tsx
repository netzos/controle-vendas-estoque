import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Controle de vendas e estoque", template: "%s · Controle de vendas e estoque" },
  description: "Gestão de vendas, estoque e financeiro com assistente de IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
