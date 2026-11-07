import { listImprovements, type ImprovementStatus } from "@erp/core";
import { db } from "@/lib/db";
import { bridgeAuthorized, bridgeError, bridgeViewer, unauthorized } from "@/lib/netzos-bridge";

export const dynamic = "force-dynamic";

const STATUSES: ImprovementStatus[] = ["new", "analysis", "approved", "building", "published", "rejected"];

/** Ponte NetzOS: pedidos de melhoria (?situacao=new,analysis). */
export async function GET(req: Request) {
  if (!bridgeAuthorized(req)) return unauthorized();
  const wanted = (new URL(req.url).searchParams.get("situacao") ?? "")
    .split(",")
    .filter((s): s is ImprovementStatus => (STATUSES as string[]).includes(s));
  try {
    const items = await listImprovements(db(), await bridgeViewer(), { status: wanted.length ? wanted : undefined });
    return Response.json({ ok: true, items });
  } catch (err) {
    return bridgeError(err);
  }
}
