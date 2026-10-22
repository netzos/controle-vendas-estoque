import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@erp/db";
import { withTenant, withTransaction } from "@erp/db";
import { AppError } from "../errors.ts";
import { dummyPasswordHash, verifyPassword } from "./password.ts";

export const SESSION_TTL_HOURS = 12;
const MAX_FAILED_LOGINS = 5;
const FAILED_LOGIN_WINDOW_MINUTES = 15;

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  userName: string;
  email: string;
  mustChangePassword: boolean;
  activeOrganizationId: string | null;
  expiresAt: Date;
}

export interface OrganizationChoice {
  id: string;
  name: string;
  roleName: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function login(
  db: Db,
  params: { email: string; password: string; ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; session: SessionInfo }> {
  const email = normalizeEmail(params.email);
  const recent = await db.query<{ failures: number }>(
    `SELECT count(*)::int AS failures FROM controle_vendas_estoque.login_attempts
      WHERE email = $1 AND NOT succeeded AND attempted_at > now() - make_interval(mins => $2)`,
    [email, FAILED_LOGIN_WINDOW_MINUTES],
  );
  if ((recent.rows[0]?.failures ?? 0) >= MAX_FAILED_LOGINS) {
    throw new AppError("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente de novo.");
  }

  const { rows } = await db.query<{ id: string; password_hash: string | null; status: string }>(
    "SELECT id, password_hash, status FROM controle_vendas_estoque.users WHERE email = $1",
    [email],
  );
  const user = rows[0];
  const ok = await verifyPassword(params.password, user?.password_hash ?? (await dummyPasswordHash()));
  const allowed = ok && user?.status === "active";
  await db.query("INSERT INTO controle_vendas_estoque.login_attempts (email, ip, succeeded) VALUES ($1, $2, $3)", [
    email,
    params.ip ?? null,
    allowed,
  ]);
  if (!user) {
    // Quem pediu conta pelo site e ainda não foi aprovado recebe a explicação,
    // desde que a senha confira com a do pedido (não revela e-mails a terceiros).
    const req = await db.query<{ status: string; password_hash: string }>(
      `SELECT status, password_hash FROM controle_vendas_estoque.signup_requests
        WHERE email = $1 AND status <> 'approved' ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    const r = req.rows[0];
    if (r && (await verifyPassword(params.password, r.password_hash))) {
      throw new AppError(
        "forbidden",
        r.status === "pending"
          ? "Seu cadastro está em análise. Avisaremos assim que for aprovado."
          : "Seu cadastro não foi aprovado. Fale com a gente se achar que foi engano.",
      );
    }
  }
  if (!allowed || !user) throw new AppError("unauthenticated", "E-mail ou senha incorretos.");

  const token = randomBytes(32).toString("base64url");
  const session = await withTransaction(db, async (tx) => {
    await tx.query("UPDATE controle_vendas_estoque.users SET last_login_at = now() WHERE id = $1", [user.id]);
    // Organização inicial: a última que o usuário usou; sem histórico, a primeira em que está ativo.
    await tx.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const org = await tx.query<{ organization_id: string }>(
      `SELECT m.organization_id FROM controle_vendas_estoque.memberships m
         JOIN controle_vendas_estoque.organizations o ON o.id = m.organization_id AND o.status = 'active'
        WHERE m.user_id = $1 AND m.status = 'active'
        ORDER BY (m.organization_id = (SELECT s.active_organization_id FROM controle_vendas_estoque.sessions s
                                        WHERE s.user_id = $1 AND s.active_organization_id IS NOT NULL
                                        ORDER BY s.created_at DESC LIMIT 1)) DESC NULLS LAST,
                 m.created_at
        LIMIT 1`,
      [user.id],
    );
    const { rows: s } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.sessions (user_id, token_hash, active_organization_id, ip, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6)) RETURNING id`,
      [user.id, hashToken(token), org.rows[0]?.organization_id ?? null, params.ip ?? null, params.userAgent ?? null, SESSION_TTL_HOURS],
    );
    return s[0]!.id;
  });
  const info = await getSession(db, token);
  if (!info || info.sessionId !== session) throw new Error("Sessão recém-criada não encontrada");
  return { token, session: info };
}

// Resolve a sessão a partir do token do cookie e renova a validade (expiração
// deslizante). Devolve null para token inválido, expirado ou revogado.
export async function getSession(db: Db, token: string | undefined | null): Promise<SessionInfo | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    name: string;
    email: string;
    must_change_password: boolean;
    active_organization_id: string | null;
    expires_at: Date;
  }>(
    `UPDATE controle_vendas_estoque.sessions s
        SET last_seen_at = now(),
            expires_at = GREATEST(s.expires_at, now() + make_interval(hours => $2))
       FROM controle_vendas_estoque.users u
      WHERE s.token_hash = $1 AND u.id = s.user_id
        AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'
      RETURNING s.id, s.user_id, u.name, u.email, u.must_change_password, s.active_organization_id, s.expires_at`,
    [hashToken(token), SESSION_TTL_HOURS],
  );
  const s = rows[0];
  if (!s) return null;
  return {
    sessionId: s.id,
    userId: s.user_id,
    userName: s.name,
    email: s.email,
    mustChangePassword: s.must_change_password,
    activeOrganizationId: s.active_organization_id,
    expiresAt: s.expires_at,
  };
}

export async function logout(db: Db, token: string): Promise<void> {
  await db.query("UPDATE controle_vendas_estoque.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [
    hashToken(token),
  ]);
}

export async function listUserOrganizations(db: Db, userId: string): Promise<OrganizationChoice[]> {
  return withTenant(db, { organizationId: null, userId }, async (tx) => {
    const { rows } = await tx.query<OrganizationChoice>(
      `SELECT o.id, o.name, r.name AS "roleName"
         FROM controle_vendas_estoque.memberships m
         JOIN controle_vendas_estoque.organizations o ON o.id = m.organization_id
         JOIN LATERAL (SELECT name FROM controle_vendas_estoque.roles WHERE id = m.role_id) r ON true
        WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
        ORDER BY o.name`,
      [userId],
    );
    return rows;
  });
}

export async function switchOrganization(db: Db, session: SessionInfo, organizationId: string): Promise<void> {
  const orgs = await listUserOrganizations(db, session.userId);
  // O administrador da plataforma pode olhar qualquer empresa (só consulta, ver resolveActor).
  const { rows: dev } = await db.query<{ ok: boolean }>(
    `SELECT controle_vendas_estoque.is_platform_developer($1)
            AND EXISTS (SELECT 1 FROM controle_vendas_estoque.organizations WHERE id = $2) AS ok`,
    [session.userId, organizationId],
  );
  if (!orgs.some((o) => o.id === organizationId) && !dev[0]?.ok) {
    throw new AppError("forbidden", "Você não tem acesso a esta empresa.");
  }
  await db.query("UPDATE controle_vendas_estoque.sessions SET active_organization_id = $2 WHERE id = $1", [session.sessionId, organizationId]);
}
