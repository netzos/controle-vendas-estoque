import type { Db } from "@erp/db";
import { withTenant } from "@erp/db";
import { AppError } from "./errors.ts";
import { PERMISSION_KEYS, type Permission } from "./permissions.ts";

export type Channel = "web" | "telegram" | "api" | "system" | "whatsapp";

// Quem executa uma operação. Sempre resolvido pelo backend a partir da sessão
// autenticada ou da conexão de canal vinculada; nunca de texto do usuário.
export interface Actor {
  userId: string;
  userName: string;
  organizationId: string;
  membershipId: string;
  roleKey: string;
  isOwner: boolean;
  branchIds: string[] | null;
  permissions: ReadonlySet<string>;
  channel: Channel;
  requestId?: string;
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.isOwner || actor.permissions.has(permission);
}

export async function resolveActor(
  db: Db,
  params: { userId: string; organizationId: string; channel: Channel; requestId?: string },
): Promise<Actor> {
  return withTenant(db, { organizationId: params.organizationId, userId: params.userId }, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string;
      is_owner: boolean;
      branch_ids: string[] | null;
      role_id: string;
      role_key: string;
      user_name: string;
    }>(
      `SELECT m.id AS membership_id, m.is_owner, m.branch_ids, r.id AS role_id, r.key AS role_key, u.name AS user_name
         FROM erp.memberships m
         JOIN erp.users u ON u.id = m.user_id
         JOIN erp.roles r ON r.id = m.role_id
         JOIN erp.organizations o ON o.id = m.organization_id
        WHERE m.organization_id = $1 AND m.user_id = $2
          AND m.status = 'active' AND u.status = 'active' AND o.status = 'active'`,
      [params.organizationId, params.userId],
    );
    const m = rows[0];
    if (!m) throw new AppError("forbidden", "Você não tem acesso a esta empresa.");
    const perms = await tx.query<{ permission_key: string }>(
      "SELECT permission_key FROM erp.role_permissions WHERE role_id = $1",
      [m.role_id],
    );
    const permissions = m.is_owner
      ? PERMISSION_KEYS
      : new Set(perms.rows.map((r) => r.permission_key).filter((k) => PERMISSION_KEYS.has(k)));
    return {
      userId: params.userId,
      userName: m.user_name,
      organizationId: params.organizationId,
      membershipId: m.membership_id,
      roleKey: m.role_key,
      isOwner: m.is_owner,
      branchIds: m.branch_ids,
      permissions,
      channel: params.channel,
      requestId: params.requestId,
    };
  });
}
