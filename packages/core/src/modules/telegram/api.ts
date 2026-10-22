import { createHmac } from "node:crypto";

// Chamadas à API oficial de bots do Telegram (https://core.telegram.org/bots/api).
// O token fica só na Vercel (TELEGRAM_BOT_TOKEN); os testes trocam a API por uma falsa.

export interface TelegramApi {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/** Segredo que o Telegram manda em cada webhook; derivado do token, sem outra variável. */
export function telegramWebhookSecret(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN ausente");
  return createHmac("sha256", token).update("netzsales-telegram-webhook").digest("hex");
}

export const telegramApi: TelegramApi = {
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
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
};
