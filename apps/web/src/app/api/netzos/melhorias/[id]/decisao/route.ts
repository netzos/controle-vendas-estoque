import { decideImprovement } from "@erp/core";
import { db } from "@/lib/db";
import { bridgeAuthorized, bridgeError, bridgeViewer, unauthorized } from "@/lib/netzos-bridge";

export const dynamic = "force-dynamic";

/**
 * Ponte NetzOS: aprovar ou recusar um pedido de melhoria, com as mesmas regras
 * do botão em Plataforma > Melhorias. Corpo: { "decisao": "aprovar" | "recusar", "nota": "..." }.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!bridgeAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    const v = await req.json();
    if (v && typeof v === "object") body = v as Record<string, unknown>;
  } catch {
    /* corpo vazio */
  }
  const decisao = String(body.decisao ?? "");
  if (decisao !== "aprovar" && decisao !== "recusar") {
    return Response.json({ ok: false, error: "Use decisao: aprovar ou recusar." }, { status: 400 });
  }
  try {
    const item = await decideImprovement(db(), await bridgeViewer(), id, decisao === "aprovar" ? "approve" : "reject", String(body.nota ?? ""));
    return Response.json({ ok: true, item });
  } catch (err) {
    return bridgeError(err);
  }
}
