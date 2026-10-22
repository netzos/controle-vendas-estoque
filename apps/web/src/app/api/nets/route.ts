import { after } from "next/server";
import { listNetsMessages, postNetsMessage, processNetsTurn } from "@erp/core";
import { db } from "@/lib/db";
import { apiError, jsonBody, unauthorized } from "@/lib/claude-api";
import { netsActor } from "@/lib/nets-api";

export const dynamic = "force-dynamic";
// A resposta da Netz roda depois da requisição (after) e pode levar alguns minutos.
export const maxDuration = 300;

export async function GET(req: Request) {
  const actor = await netsActor(req);
  if (!actor) return unauthorized();
  try {
    return Response.json(await listNetsMessages(db(), actor));
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: Request) {
  const actor = await netsActor(req);
  if (!actor) return unauthorized();
  const b = await jsonBody(req);
  try {
    const r = await postNetsMessage(db(), actor, {
      requestId: String(b.requestId ?? ""),
      text: String(b.text ?? ""),
      context: typeof b.context === "string" ? b.context : null,
    });
    if (r.queued) after(() => processNetsTurn(db(), { organizationId: actor.organizationId, userId: actor.userId, messageId: r.id }));
    return Response.json(r, { status: 202 });
  } catch (err) {
    return apiError(err);
  }
}
