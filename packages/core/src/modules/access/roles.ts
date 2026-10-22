import { z } from "zod";
import type { Tx } from "@erp/db";
import { AppError, forbidden, notFound } from "../../errors.ts";
import { PERMISSION_KEYS } from "../../permissions.ts";
import { defineService } from "../../service.ts";

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
}

const ROLE_SELECT = `
  SELECT r.id, r.key, r.name, r.description, r.is_system AS "isSystem",
         coalesce(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
         (SELECT count(*)::int FROM controle_vendas_estoque.memberships m WHERE m.role_id = r.id) AS "memberCount"
    FROM controle_vendas_estoque.roles r
    LEFT JOIN controle_vendas_estoque.role_permissions rp ON rp.role_id = r.id`;

// A política roles_own_membership deixa ver o perfil da pessoa em outras
// empresas (para o seletor de empresa); as telas de perfis ficam só nesta.
const THIS_ORG = "r.organization_id = controle_vendas_estoque.current_org()";

async function loadRole(tx: Tx, id: string): Promise<Role> {
  const { rows } = await tx.query<Role>(`${ROLE_SELECT} WHERE r.id = $1 AND ${THIS_ORG} GROUP BY r.id`, [id]);
  if (!rows[0]) throw notFound("Perfil");
  return rows[0];
}

export const listRoles = defineService({
  name: "roles.list",
  description: "Lista os perfis de acesso e suas permissões",
  permission: "roles.view",
  risk: 1,
  input: z.object({}),
  async handler({ tx }) {
    const { rows } = await tx.query<Role>(`${ROLE_SELECT} WHERE ${THIS_ORG} GROUP BY r.id ORDER BY r.is_system DESC, r.name`);
    return rows;
  },
});

const permissionList = z
  .array(z.string())
  .transform((keys) => [...new Set(keys)])
  .refine((keys) => keys.every((k) => PERMISSION_KEYS.has(k)), "Permissão desconhecida.");

// Ninguém concede uma permissão que não possui.
function assertCanGrant(actor: { isOwner: boolean; permissions: ReadonlySet<string> }, keys: string[]) {
  if (actor.isOwner) return;
  const missing = keys.filter((k) => !actor.permissions.has(k));
  if (missing.length) throw forbidden(`Você não pode conceder permissões que não possui: ${missing.join(", ")}.`);
}

export const createRole = defineService({
  name: "roles.create",
  description: "Cria um perfil de acesso personalizado",
  permission: "roles.manage",
  risk: 4,
  input: z.object({
    name: z.string().trim().min(2, "Informe o nome do perfil.").max(60),
    description: z.string().trim().max(200).nullable().optional(),
    permissions: permissionList,
  }),
  async handler({ tx, actor, audit, emit }, input) {
    assertCanGrant(actor, input.permissions);
    const base = input.name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 30) || "perfil";
    let key = `custom_${base}`.slice(0, 40);
    for (let i = 2; (await tx.query(`SELECT 1 FROM controle_vendas_estoque.roles r WHERE key = $1 AND ${THIS_ORG}`, [key])).rowCount; i++) {
      key = `custom_${base}_${i}`.slice(0, 40);
    }
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.roles (organization_id, key, name, description) VALUES ($1, $2, $3, $4) RETURNING id`,
      [actor.organizationId, key, input.name, input.description || null],
    );
    const roleId = rows[0]!.id;
    if (input.permissions.length) {
      await tx.query(
        `INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key) SELECT $1, $2, unnest($3::text[])`,
        [actor.organizationId, roleId, input.permissions],
      );
    }
    const role = await loadRole(tx, roleId);
    await audit({ action: "role.create", entityType: "role", entityId: roleId, summary: `Perfil ${role.name} criado`, after: role });
    await emit("role.created", { roleId, key }, { type: "role", id: roleId });
    return role;
  },
});

export const updateRole = defineService({
  name: "roles.update",
  description: "Altera nome e permissões de um perfil de acesso",
  permission: "roles.manage",
  risk: 4,
  input: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(200).nullable().optional(),
    permissions: permissionList,
  }),
  async handler({ tx, actor, audit, emit }, input) {
    await tx.query("SELECT 1 FROM controle_vendas_estoque.roles WHERE id = $1 FOR UPDATE", [input.id]);
    const before = await loadRole(tx, input.id);
    if (before.key === "owner") throw new AppError("conflict", "O perfil Proprietário sempre tem acesso total.");
    if (before.isSystem && input.name !== before.name) {
      throw new AppError("conflict", "Perfis padrão não podem ser renomeados.");
    }
    const added = input.permissions.filter((k) => !before.permissions.includes(k));
    const removed = before.permissions.filter((k) => !input.permissions.includes(k));
    assertCanGrant(actor, [...added, ...removed]);
    if (actor.roleKey === before.key && removed.length && !actor.isOwner) {
      throw new AppError("conflict", "Você não pode remover permissões do próprio perfil.");
    }

    await tx.query("UPDATE controle_vendas_estoque.roles SET name = $2, description = $3 WHERE id = $1", [
      input.id,
      input.name,
      input.description || null,
    ]);
    if (removed.length) {
      await tx.query("DELETE FROM controle_vendas_estoque.role_permissions WHERE role_id = $1 AND permission_key = ANY($2::text[])", [
        input.id,
        removed,
      ]);
    }
    if (added.length) {
      await tx.query(
        `INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key) SELECT $1, $2, unnest($3::text[])`,
        [actor.organizationId, input.id, added],
      );
    }
    const after = await loadRole(tx, input.id);
    const fields = [
      ...(before.name !== after.name || before.description !== after.description ? ["details"] : []),
      ...(added.length || removed.length ? ["permissions"] : []),
    ];
    if (fields.length) {
      await audit({
        action: "role.update",
        entityType: "role",
        entityId: input.id,
        summary: `Perfil ${after.name} alterado`,
        before,
        after,
        metadata: { added, removed },
      });
      await emit("role.updated", { roleId: input.id, fields }, { type: "role", id: input.id });
    }
    return after;
  },
});

export const deleteRole = defineService({
  name: "roles.delete",
  description: "Exclui um perfil personalizado sem usuários",
  permission: "roles.manage",
  risk: 4,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx, audit, emit }, input) {
    await tx.query("SELECT 1 FROM controle_vendas_estoque.roles WHERE id = $1 FOR UPDATE", [input.id]);
    const role = await loadRole(tx, input.id);
    if (role.isSystem) throw new AppError("conflict", "Perfis padrão não podem ser excluídos.");
    if (role.memberCount > 0) throw new AppError("conflict", "Há usuários com este perfil. Troque o perfil deles antes.");
    await tx.query("DELETE FROM controle_vendas_estoque.roles WHERE id = $1", [input.id]);
    await audit({ action: "role.delete", entityType: "role", entityId: input.id, summary: `Perfil ${role.name} excluído`, before: role });
    await emit("role.deleted", { roleId: input.id, key: role.key }, { type: "role", id: input.id });
    return { id: input.id };
  },
});
