// Envio de e-mail. Fica desligado até RESEND_API_KEY e MAIL_FROM serem
// configurados na Vercel; enquanto isso, quem chama é avisado e oferece outro
// caminho (senha provisória, falar com o administrador).

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailTransport = (message: MailMessage) => Promise<void>;

let override: MailTransport | null = null;

// Para testes: substitui o envio real.
export function setMailTransport(transport: MailTransport | null) {
  override = transport;
}

export function mailConfigured(): boolean {
  return override !== null || Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

// Endereço público do painel, para montar links nos e-mails.
export function appUrl(): string {
  return (process.env.APP_URL ?? "https://controle-vendas-estoque.vercel.app").replace(/\/+$/, "");
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (override) return override(message);
  if (!mailConfigured()) throw new Error("Envio de e-mail não configurado");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
  });
  if (!res.ok) throw new Error(`Falha ao enviar e-mail (${res.status})`);
}
