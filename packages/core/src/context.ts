import type { Db } from "@erp/db";
import { withTenant, type Tx } from "@erp/db";
import { AppError } from "./errors.ts";
import { PERMISSION_KEYS, type Permission } from "./permissions.ts";

const VIEW_PERMISSIONS: ReadonlySet<string> = new Set([...PERMISSION_KEYS].filter((k) => k.endsWith(".view")));

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
  /** Administrador da plataforma olhando uma empresa sem ser membro: só consulta. */
  platformView?: boolean;
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
         FROM controle_vendas_estoque.memberships m
         JOIN controle_vendas_estoque.users u ON u.id = m.user_id
         JOIN controle_vendas_estoque.roles r ON r.id = m.role_id
         JOIN controle_vendas_estoque.organizations o ON o.id = m.organization_id
        WHERE m.organization_id = $1 AND m.user_id = $2
          AND m.status = 'active' AND u.status = 'active' AND o.status = 'active'`,
      [params.organizationId, params.userId],
    );
    const m = rows[0];
    if (!m) return platformViewer(tx, params);
    const perms = await tx.query<{ permission_key: string }>(
      "SELECT permission_key FROM controle_vendas_estoque.role_permissions WHERE role_id = $1",
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

/**
 * O administrador da plataforma escolhe uma empresa no topo e vê os dados dela
 * sem entrar como membro: só as permissões de consulta (.view). Para mexer, ele
 * entra para dar suporte pela ficha da empresa.
 */
async function platformViewer(tx: Tx, params: { userId: string; organizationId: string; channel: Channel; requestId?: string }): Promise<Actor> {
  const { rows } = await tx.query<{ user_name: string }>(
    `SELECT u.name AS user_name FROM controle_vendas_estoque.users u
      WHERE u.id = $1 AND u.status = 'active' AND controle_vendas_estoque.is_platform_developer(u.id)
        AND EXISTS (SELECT 1 FROM controle_vendas_estoque.organizations o WHERE o.id = $2)`,
    [params.userId, params.organizationId],
  );
  if (!rows[0] || params.channel !== "web") throw new AppError("forbidden", "Você não tem acesso a esta empresa.");
  return {
    userId: params.userId,
    userName: rows[0].user_name,
    organizationId: params.organizationId,
    membershipId: "",
    roleKey: "platform_view",
    isOwner: false,
    branchIds: null,
    permissions: VIEW_PERMISSIONS,
    channel: params.channel,
    requestId: params.requestId,
    platformView: true,
  };
}
