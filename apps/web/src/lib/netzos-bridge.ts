import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isAppError, isPlatformDeveloper, listPlatformOrganizations, type ImprovementViewer } from "@erp/core";
import { db } from "./db";

// Ponte NetzOS -> netzsales (2026-11-07). O NetzOS publicado (netzos.app) lê o
// que acontece no netzsales e dá ordens daqui, de servidor para servidor.
// Protegida por NETZOS_BRIDGE_TOKEN: sem a variável (ou com menos de 32
// caracteres) a ponte fica fechada. Tudo o que a ponte faz é feito em nome de
// um administrador da plataforma (NETZOS_BRIDGE_EMAIL, padrão
// acesso@netzcode.com.br), com as mesmas regras do painel: se a conta deixar de
// ser administradora, a ponte para de funcionar.

export function bridgeAuthorized(req: Request): boolean {
  const expected = process.env.NETZOS_BRIDGE_TOKEN ?? "";
  if (expected.length < 32) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

class BridgeClosed extends Error {}

/** O administrador em nome de quem a ponte age. */
export async function bridgeViewer(): Promise<ImprovementViewer> {
  const email = (process.env.NETZOS_BRIDGE_EMAIL || "acesso@netzcode.com.br").trim().toLowerCase();
  const { rows } = await db().query<{ id: string; name: string }>(
    "SELECT id, name FROM controle_vendas_estoque.users WHERE email = $1 AND status = 'active'",
    [email],
  );
  const u = rows[0];
  if (!u || !(await isPlatformDeveloper(db(), u.id))) throw new BridgeClosed();
  // Empresa de onde o administrador age: a dele, senão a da equipe, senão a primeira.
  const orgs = await listPlatformOrganizations(db(), u.id);
  const org = orgs.find((o) => o.developerIsMember) ?? orgs.find((o) => o.kind === "internal") ?? orgs[0];
  if (!org) throw new BridgeClosed();
  return { userId: u.id, userName: `${u.name} (pelo NetzOS)`, organizationId: org.id, isDeveloper: true };
}

export function unauthorized() {
  return Response.json({ ok: false, error: "Não autorizado." }, { status: 401 });
}

const STATUS: Record<string, number> = { not_found: 404, invalid_input: 400, conflict: 409, forbidden: 403, rate_limited: 429 };

export function bridgeError(err: unknown) {
  if (err instanceof BridgeClosed) {
    return Response.json(
      { ok: false, error: "A ponte com o NetzOS está fechada: a conta configurada não é administradora da plataforma." },
      { status: 503 },
    );
  }
  if (isAppError(err)) return Response.json({ ok: false, error: err.message, code: err.code }, { status: STATUS[err.code] ?? 400 });
  console.error("[api/netzos] erro", err);
  return Response.json({ ok: false, error: "Erro interno." }, { status: 500 });
}
