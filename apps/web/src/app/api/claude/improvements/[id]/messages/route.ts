import { claudeCommentImprovement } from "@erp/core";
import { db } from "@/lib/db";
import { apiError, claudeAuthorized, jsonBody, unauthorized } from "@/lib/claude-api";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!claudeAuthorized(req)) return unauthorized();
  const b = await jsonBody(req);
  try {
    await claudeCommentImprovement(db(), (await params).id, String(b.body ?? ""));
    return Response.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
