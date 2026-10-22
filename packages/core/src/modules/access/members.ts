import { z } from "zod";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../auth/password.ts";
import { sendInvite } from "../../auth/recovery.ts";
import { normalizeEmail } from "../../auth/session.ts";
import { mailConfigured } from "../../mail.ts";
import { AppError, forbidden, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";

export interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  isOwner: boolean;
  branchIds: string[] | null;
  status: "active" | "disabled";
  lastLoginAt: Date | null;
  createdAt: Date;
}

const MEMBER_SELECT = `
  SELECT m.id AS "membershipId", u.id AS "userId", u.name, u.email,
         r.id AS "roleId", r.key AS "roleKey", r.name AS "roleName",
         m.is_owner AS "isOwner", m.branch_ids AS "branchIds", m.status,
         u.last_login_at AS "lastLoginAt", m.created_at AS "createdAt"
    FROM controle_vendas_estoque.memberships m
    JOIN controle_vendas_estoque.users u ON u.id = m.user_id
    JOIN controle_vendas_estoque.roles r ON r.id = m.role_id`;

export const listMembers = defineService({
  name: "members.list",
  description: "Lista os usuários da empresa",
  permission: "users.view",
  risk: 1,
  input: z.object({ includeDisabled: z.boolean().default(true) }),
  async handler({ tx, actor }, input) {
    const { rows } = await tx.query<Member>(
      `${MEMBER_SELECT} WHERE m.organization_id = $1 AND ($2 OR m.status = 'active')
        ORDER BY m.is_owner DESC, u.name`,
      [actor.organizationId, input.includeDisabled],
    );
    return rows;
  },
});

const branchIds = z.array(z.string().uuid()).nullable().default(null);

async function assertBranches(tx: import("@erp/db").Tx, ids: string[] | null) {
  if (!ids) return;
  if (ids.length === 0) throw new AppError("invalid_input", "Selecione ao menos uma filial ou todas.");
  const { rows } = await tx.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM controle_vendas_estoque.branches WHERE id = ANY($1::uuid[])",
    [ids],
  );
  if (rows[0]!.n !== new Set(ids).size) throw new AppError("invalid_input", "Filial inválida.");
}

async function assertAssignableRole(tx: import("@erp/db").Tx, roleId: string, actorIsOwner: boolean) {
  const { rows } = await tx.query<{ key: string }>("SELECT key FROM controle_vendas_estoque.roles WHERE id = $1", [roleId]);
  const role = rows[0];
  if (!role) throw notFound("Perfil");
  // Apenas um proprietário pode criar outro proprietário.
  if (role.key === "owner" && !actorIsOwner) throw forbidden("Apenas o proprietário pode conceder o perfil Proprietário.");
  return role;
}

// Adiciona um usuário à empresa. Se o e-mail ainda não existe, cria a conta
// com uma senha provisória que deve ser trocada no primeiro acesso.
export const addMember = defineService({
  name: "members.add",
  description: "Adiciona um usuário à empresa com um perfil de acesso",
  permission: "users.manage",
  risk: 4,
  input: z.object({
    email: z.string().trim().email("E-mail inválido."),
    name: z.string().trim().min(2, "Informe o nome.").max(120),
    roleId: z.string().uuid("Selecione um perfil."),
    branchIds,
    temporaryPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `A senha provisória precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
      .max(200)
      .optional(),
  }),
  async handler({ tx, actor, audit, emit }, input) {
    const role = await assertAssignableRole(tx, input.roleId, actor.isOwner);
    await assertBranches(tx, input.branchIds);
    const email = normalizeEmail(input.email);

    const existing = await tx.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.users WHERE email = $1", [email]);
    let userId = existing.rows[0]?.id;
    let createdAccount = false;
    let invited = false;
    if (!userId) {
      // Sem senha provisória, a pessoa recebe um convite por e-mail e cria a
      // própria senha. Enquanto o e-mail não estiver ativo, a senha é exigida.
      if (!input.temporaryPassword && !mailConfigured()) {
        throw new AppError("invalid_input", "O envio de convite por e-mail ainda não está ativo. Defina uma senha provisória.", {
          details: { issues: [{ path: "temporaryPassword", message: "Obrigatória enquanto o e-mail não estiver ativo." }] },
        });
      }
      const u = await tx.query<{ id: string }>(
        "INSERT INTO controle_vendas_estoque.users (email, name, password_hash, must_change_password) VALUES ($1, $2, $3, $4) RETURNING id",
        [email, input.name, input.temporaryPassword ? await hashPassword(input.temporaryPassword) : null, Boolean(input.temporaryPassword)],
      );
      userId = u.rows[0]!.id;
      createdAccount = true;
      if (!input.temporaryPassword) {
        const org = await tx.query<{ name: string }>("SELECT name FROM controle_vendas_estoque.organizations WHERE id = $1", [actor.organizationId]);
        await sendInvite(tx, { userId, email, name: input.name, organizationId: actor.organizationId, organizationName: org.rows[0]!.name });
        invited = true;
      }
    }

    const dup = await tx.query("SELECT 1 FROM controle_vendas_estoque.memberships WHERE organization_id = $1 AND user_id = $2", [
      actor.organizationId,
      userId,
    ]);
    if (dup.rowCount) throw new AppError("conflict", "Este usuário já faz parte da empresa.");

    const m = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.memberships (organization_id, user_id, role_id, is_owner, branch_ids)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [actor.organizationId, userId, input.roleId, role.key === "owner", input.branchIds],
    );
    const membershipId = m.rows[0]!.id;
    await audit({
      action: "member.add",
      entityType: "membership",
      entityId: membershipId,
      summary: `${input.name} <${email}> adicionado com perfil ${role.key}`,
      after: { email, roleKey: role.key, branchIds: input.branchIds, createdAccount, invited },
    });
    await emit("member.added", { membershipId, userId, roleKey: role.key }, { type: "membership", id: membershipId });
    return { membershipId, userId, createdAccount, invited };
  },
});

export const updateMember = defineService({
  name: "members.update",
  description: "Altera perfil, filiais ou situação de um usuário da empresa",
  permission: "users.manage",
  risk: 4,
  input: z.object({
    membershipId: z.string().uuid(),
    roleId: z.string().uuid(),
    branchIds,
    status: z.enum(["active", "disabled"]),
  }),
  async handler({ tx, actor, audit, emit }, input) {
    const current = await tx.query<Member>(`${MEMBER_SELECT} WHERE m.id = $1 FOR UPDATE OF m`, [input.membershipId]);
    const before = current.rows[0];
    if (!before) throw notFound("Usuário");
    if (before.userId === actor.userId) {
      throw new AppError("conflict", "Você não pode alterar o próprio acesso. Peça a outro administrador.");
    }
    if (before.isOwner && !actor.isOwner) throw forbidden("Apenas um proprietário pode alterar outro proprietário.");
    const role = await assertAssignableRole(tx, input.roleId, actor.isOwner);
    await assertBranches(tx, input.branchIds);

    const willBeOwner = role.key === "owner" && input.status === "active";
    if (before.isOwner && !willBeOwner) {
      const owners = await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM controle_vendas_estoque.memberships WHERE is_owner AND status = 'active' AND id <> $1",
        [input.membershipId],
      );
      if (owners.rows[0]!.n === 0) throw new AppError("conflict", "A empresa precisa de ao menos um proprietário ativo.");
    }

    await tx.query(
      `UPDATE controle_vendas_estoque.memberships SET role_id = $2, is_owner = $3, branch_ids = $4, status = $5 WHERE id = $1`,
      [input.membershipId, input.roleId, role.key === "owner", input.branchIds, input.status],
    );
    const fields: string[] = [];
    if (before.roleId !== input.roleId) fields.push("role");
    if (JSON.stringify(before.branchIds) !== JSON.stringify(input.branchIds)) fields.push("branches");
    if (before.status !== input.status) fields.push("status");
    if (fields.length > 0) {
      await audit({
        action: "member.update",
        entityType: "membership",
        entityId: input.membershipId,
        summary: `Acesso de ${before.name} alterado (${fields.join(", ")})`,
        before: { roleKey: before.roleKey, branchIds: before.branchIds, status: before.status },
        after: { roleKey: role.key, branchIds: input.branchIds, status: input.status },
      });
      await emit("member.updated", { membershipId: input.membershipId, userId: before.userId, fields }, { type: "membership", id: input.membershipId });
    }
    // Desativar o acesso encerra as sessões do usuário nesta empresa.
    if (input.status === "disabled" && before.status === "active") {
      await tx.query(
        "UPDATE controle_vendas_estoque.sessions SET revoked_at = now() WHERE user_id = $1 AND active_organization_id = $2 AND revoked_at IS NULL",
        [before.userId, actor.organizationId],
      );
    }
    return { membershipId: input.membershipId, fields };
  },
});
