import { createHmac } from "node:crypto";

// Chamadas à API oficial de bots do Telegram (https://core.telegram.org/bots/api).
// O token fica só na Vercel (TELEGRAM_BOT_TOKEN); os testes trocam a API por uma falsa.

export interface TelegramApi {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Baixa um arquivo pelo file_path que o getFile devolve. */
  download(filePath: string): Promise<Uint8Array<ArrayBuffer>>;
}

// Tira espaços e quebras de linha que vêm junto quando o token é colado.
function botToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

export function telegramConfigured(): boolean {
  return !!botToken();
}

/** Segredo que o Telegram manda em cada webhook; derivado do token, sem outra variável. */
export function telegramWebhookSecret(): string {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN ausente");
  return createHmac("sha256", token).update("netzsales-telegram-webhook").digest("hex");
}

export const telegramApi: TelegramApi = {
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const token = botToken();
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN ausente");
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = (await res.json().catch(() => null)) as { ok: boolean; result: T; description?: string } | null;
    if (!data?.ok) throw new Error(`Telegram ${method}: ${data?.description ?? res.status}`);
    return data.result;
  },
  async download(filePath: string): Promise<Uint8Array<ArrayBuffer>> {
    const token = botToken();
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN ausente");
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!res.ok) throw new Error(`Telegram download: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
};
