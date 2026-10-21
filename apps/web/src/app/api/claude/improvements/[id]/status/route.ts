import { claudeMoveImprovement, type ImprovementStatus } from "@erp/core";
import { db } from "@/lib/db";
import { apiError, claudeAuthorized, jsonBody, unauthorized } from "@/lib/claude-api";

export const dynamic = "force-dynamic";

// O Claude move: novo → análise, aprovado → desenvolvimento, desenvolvimento → publicado.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!claudeAuthorized(req)) return unauthorized();
  const b = await jsonBody(req);
  try {
    const item = await claudeMoveImprovement(db(), (await params).id, String(b.status ?? "") as ImprovementStatus, {
      link: typeof b.link === "string" ? b.link : undefined,
      body: typeof b.body === "string" ? b.body : undefined,
    });
    return Response.json({ item });
  } catch (err) {
    return apiError(err);
  }
}
