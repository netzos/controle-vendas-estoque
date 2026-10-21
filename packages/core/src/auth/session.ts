import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@erp/db";
import { withTenant, withTransaction } from "@erp/db";
import { AppError } from "../errors.ts";
import { dummyPasswordHash, verifyPassword } from "./password.ts";

export const SESSION_TTL_HOURS = 12;
const MAX_FAILED_LOGINS = 5;
const FAILED_LOGIN_WINDOW_MINUTES = 15;

function hashToken(token: string): Buffer {
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
    `SELECT count(*)::int AS failures FROM erp.login_attempts
      WHERE email = $1 AND NOT succeeded AND attempted_at > now() - make_interval(mins => $2)`,
    [email, FAILED_LOGIN_WINDOW_MINUTES],
  );
  if ((recent.rows[0]?.failures ?? 0) >= MAX_FAILED_LOGINS) {
    throw new AppError("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente de novo.");
  }

  const { rows } = await db.query<{ id: string; password_hash: string | null; status: string }>(
    "SELECT id, password_hash, status FROM erp.users WHERE email = $1",
    [email],
  );
  const user = rows[0];
  const ok = await verifyPassword(params.password, user?.password_hash ?? (await dummyPasswordHash()));
  const allowed = ok && user?.status === "active";
  await db.query("INSERT INTO erp.login_attempts (email, ip, succeeded) VALUES ($1, $2, $3)", [
    email,
    params.ip ?? null,
    allowed,
  ]);
  if (!allowed || !user) throw new AppError("unauthenticated", "E-mail ou senha incorretos.");

  const token = randomBytes(32).toString("base64url");
  const session = await withTransaction(db, async (tx) => {
    await tx.query("UPDATE erp.users SET last_login_at = now() WHERE id = $1", [user.id]);
    // Organização inicial: a primeira em que o usuário está ativo.
    await tx.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const org = await tx.query<{ organization_id: string }>(
      `SELECT m.organization_id FROM erp.memberships m
        WHERE m.user_id = $1 AND m.status = 'active' ORDER BY m.created_at LIMIT 1`,
      [user.id],
    );
    const { rows: s } = await tx.query<{ id: string }>(
      `INSERT INTO erp.sessions (user_id, token_hash, active_organization_id, ip, user_agent, expires_at)
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
    `UPDATE erp.sessions s
        SET last_seen_at = now(),
            expires_at = GREATEST(s.expires_at, now() + make_interval(hours => $2))
       FROM erp.users u
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
  await db.query("UPDATE erp.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [
    hashToken(token),
  ]);
}

export async function listUserOrganizations(db: Db, userId: string): Promise<OrganizationChoice[]> {
  return withTenant(db, { organizationId: null, userId }, async (tx) => {
    const { rows } = await tx.query<OrganizationChoice>(
      `SELECT o.id, o.name, r.name AS "roleName"
         FROM erp.memberships m
         JOIN erp.organizations o ON o.id = m.organization_id
         JOIN LATERAL (SELECT name FROM erp.roles WHERE id = m.role_id) r ON true
        WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
        ORDER BY o.name`,
      [userId],
    );
    return rows;
  });
}

export async function switchOrganization(db: Db, session: SessionInfo, organizationId: string): Promise<void> {
  const orgs = await listUserOrganizations(db, session.userId);
  if (!orgs.some((o) => o.id === organizationId)) {
    throw new AppError("forbidden", "Você não tem acesso a esta empresa.");
  }
  await db.query("UPDATE erp.sessions SET active_organization_id = $2 WHERE id = $1", [session.sessionId, organizationId]);
}
