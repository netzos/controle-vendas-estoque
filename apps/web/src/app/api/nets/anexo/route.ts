import { after } from "next/server";
import { MAX_ATTACHMENT_BYTES, postNetsMessage, processNetsTurn, runService, stashSaleAttachment } from "@erp/core";
import { db } from "@/lib/db";
import { apiError, unauthorized } from "@/lib/claude-api";
import { netsActor } from "@/lib/nets-api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Comprovante mandado na conversa com a Netz (foto já reduzida no navegador, ou PDF).
// Fica guardado sem venda; a Netz lê, confere e propõe ligar à venda certa.
export async function POST(req: Request) {
  const actor = await netsActor(req);
  if (!actor) return unauthorized();
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) return Response.json({ error: "Escolha uma foto ou um PDF." }, { status: 400 });
    if (file.size > MAX_ATTACHMENT_BYTES) return Response.json({ error: "Arquivo grande demais. O limite é 4 MB." }, { status: 413 });
    const stashed = await runService(db(), stashSaleAttachment, actor, {
      data: new Uint8Array(await file.arrayBuffer()),
      fileName: typeof form.get("name") === "string" ? String(form.get("name")) : null,
      source: "netz",
    });
    const typed = String(form.get("text") ?? "").trim();
    const r = await postNetsMessage(db(), actor, {
      requestId: String(form.get("requestId") ?? ""),
      text: typed || (stashed.contentType === "application/pdf" ? "Mandei um PDF de comprovante." : "Mandei uma foto de comprovante."),
      context: typeof form.get("context") === "string" ? String(form.get("context")) : null,
      attachmentId: stashed.id,
    });
    if (r.queued) after(() => processNetsTurn(db(), { organizationId: actor.organizationId, userId: actor.userId, messageId: r.id }));
    return Response.json({ ...r, attachmentId: stashed.id, attachmentType: stashed.contentType }, { status: 202 });
  } catch (err) {
    return apiError(err);
  }
}
