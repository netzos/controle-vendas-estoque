import { claudeGetImprovement } from "@erp/core";
import { db } from "@/lib/db";
import { apiError, claudeAuthorized, unauthorized } from "@/lib/claude-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!claudeAuthorized(req)) return unauthorized();
  try {
    return Response.json(await claudeGetImprovement(db(), (await params).id));
  } catch (err) {
    return apiError(err);
  }
}
