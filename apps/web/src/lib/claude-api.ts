import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isAppError } from "@erp/core";

// Rota do Claude para o quadro Melhorias. Protegida por CLAUDE_IMPROVEMENTS_TOKEN;
// sem a variável, a rota fica fechada.
export function claudeAuthorized(req: Request): boolean {
  const expected = process.env.CLAUDE_IMPROVEMENTS_TOKEN ?? "";
  if (expected.length < 32) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function unauthorized() {
  return Response.json({ error: "Não autorizado." }, { status: 401 });
}

const STATUS: Record<string, number> = { not_found: 404, invalid_input: 400, conflict: 409, forbidden: 403, rate_limited: 429 };

export function apiError(err: unknown) {
  if (isAppError(err)) return Response.json({ error: err.message, code: err.code }, { status: STATUS[err.code] ?? 400 });
  console.error("[api/claude] erro", err);
  return Response.json({ error: "Erro interno." }, { status: 500 });
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
