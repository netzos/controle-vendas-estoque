import { claudeCreateImprovement, claudeListImprovements, type ImprovementModule, type ImprovementStatus } from "@erp/core";
import { db } from "@/lib/db";
import { apiError, claudeAuthorized, jsonBody, unauthorized } from "@/lib/claude-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!claudeAuthorized(req)) return unauthorized();
  const status = new URL(req.url).searchParams.get("status");
  try {
    const items = await claudeListImprovements(db(), { status: status ? [status as ImprovementStatus] : undefined });
    return Response.json({ items });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: Request) {
  if (!claudeAuthorized(req)) return unauthorized();
  const b = await jsonBody(req);
  try {
    const item = await claudeCreateImprovement(db(), {
      title: String(b.title ?? ""),
      body: String(b.body ?? ""),
      module: (b.module as ImprovementModule) ?? "geral",
    });
    return Response.json({ item }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
