import { after } from "next/server";
import { decideNetsAction, processNetsTurn } from "@erp/core";
import { db } from "@/lib/db";
import { apiError, jsonBody, unauthorized } from "@/lib/claude-api";
import { netsActor } from "@/lib/nets-api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Confirmar ou cancelar a ação que a Nets propôs.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await netsActor(req);
  if (!actor) return unauthorized();
  const { id } = await params;
  const b = await jsonBody(req);
  try {
    const r = await decideNetsAction(db(), actor, { id, decision: b.decision === "confirm" ? "confirm" : "cancel" });
    if (r.queued) after(() => processNetsTurn(db(), { organizationId: actor.organizationId, userId: actor.userId, messageId: id }));
    return Response.json(r);
  } catch (err) {
    return apiError(err);
  }
}
