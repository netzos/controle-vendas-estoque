import { after } from "next/server";
import { handleWhatsAppEvent, verifyWhatsAppSignature, type WhatsAppEvent } from "@erp/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
// A Netz responde depois de devolver 200 à ponte (after) e pode levar alguns minutos.
export const maxDuration = 300;

// A ponte do WhatsApp (GOWA) assina cada aviso com o WHATSAPP_WEBHOOK_SECRET
// (cabeçalho X-Hub-Signature-256), como no NetzOS.
export async function POST(req: Request) {
  const body = await req.text();
  if (!verifyWhatsAppSignature(body, req.headers.get("x-hub-signature-256"))) return new Response("forbidden", { status: 403 });
  let event: WhatsAppEvent | null = null;
  try {
    event = JSON.parse(body) as WhatsAppEvent;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  after(() => handleWhatsAppEvent(db(), event));
  return new Response("ok");
}
