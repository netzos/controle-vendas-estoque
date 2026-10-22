import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { handleTelegramUpdate, telegramConfigured, telegramWebhookSecret, type TelegramUpdate } from "@erp/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
// A Netz responde depois de devolver 200 ao Telegram (after) e pode levar alguns minutos.
export const maxDuration = 300;

// O Telegram manda o segredo combinado no setWebhook em cada chamada.
function trusted(req: Request): boolean {
  if (!telegramConfigured()) return false;
  const got = Buffer.from(req.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const want = Buffer.from(telegramWebhookSecret());
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(req: Request) {
  if (!trusted(req)) return new Response("forbidden", { status: 403 });
  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  if (update) after(() => handleTelegramUpdate(db(), update));
  return new Response("ok");
}
