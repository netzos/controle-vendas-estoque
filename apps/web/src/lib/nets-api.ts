import "server-only";
import { headers } from "next/headers";
import { getSession, resolveActor, type Actor } from "@erp/core";
import { db } from "./db";
import { sessionToken } from "./auth";

// Ator das rotas da Netz: mesma sessão do painel, mas responde 401 em vez de redirecionar.
export async function netsActor(req: Request): Promise<Actor | null> {
  // Só aceita chamadas da própria página (o navegador manda Origin nos POST).
  const origin = req.headers.get("origin");
  if (req.method !== "GET" && origin && new URL(origin).host !== (await headers()).get("host")) return null;
  const session = await getSession(db(), await sessionToken());
  if (!session?.activeOrganizationId || session.mustChangePassword) return null;
  try {
    return await resolveActor(db(), { userId: session.userId, organizationId: session.activeOrganizationId, channel: "web" });
  } catch {
    return null;
  }
}
