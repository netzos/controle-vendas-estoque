import type { Db } from "@erp/db";
import { setTenant, withTransaction } from "@erp/db";
import { z } from "zod";
import { recordAudit } from "../../audit.ts";
import { issuePasswordLink } from "../../auth/recovery.ts";
import { normalizeEmail } from "../../auth/session.ts";
import { AppError, forbidden, notFound, parseInput } from "../../errors.ts";
import { createOrganizationTx } from "./bootstrap.ts";

// Empresas da plataforma: só o desenvolvedor (controle_vendas_estoque.platform_developers)
// vê a lista de empresas e cria empresa nova com o dono dela.

export interface PlatformOrganization {
  id: string;
  name: string;
  status: "active" | "suspended";
  createdAt: Date;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerMembershipId: string | null;
  ownerLastLoginAt: Date | null;
  members: number;
  sales: number;
  lastSaleAt: Date | null;
  developerIsMember: boolean;
}

export async function isPlatformDeveloper(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ dev: boolean }>("SELECT controle_vendas_estoque.is_platform_developer($1) AS dev", [userId]);
  return rows[0]!.dev;
}

async function assertDeveloper(db: Db, userId: string) {
  if (!(await isPlatformDeveloper(db, userId))) throw forbidden("Só o administrador da plataforma pode fazer isso.");
}

export async function listPlatformOrganizations(db: Db, developerUserId: string): Promise<PlatformOrganization[]> {
  await assertDeveloper(db, developerUserId);
  const { rows } = await db.query<PlatformOrganization>(
    `SELECT id, name, status, created_at AS "createdAt", owner_name AS "ownerName", owner_email AS "ownerEmail",
            owner_membership_id AS "ownerMembershipId", owner_last_login_at AS "ownerLastLoginAt",
            members, sales, last_sale_at AS "lastSaleAt", developer_is_member AS "developerIsMember"
       FROM controle_vendas_estoque.platform_organizations($1)`,
    [developerUserId],
  );
  return rows;
}

export const platformOrganizationInput = z.object({
  organizationName: z.string().trim().min(2, "Informe o nome da empresa.").max(120),
  ownerName: z.string().trim().min(2, "Informe o nome do dono.").max(120),
  ownerEmail: z.string().trim().email("E-mail inválido."),
  // O desenvolvedor também entra como proprietário, para ajudar a configurar.
  joinAsOwner: z.boolean().default(false),
});

export interface CreatedPlatformOrganization {
  organizationId: string;
  ownerName: string;
  /** Link para o dono criar a senha. Vazio quando ele já tinha conta com senha. */
  link: { url: string; validFor: string } | null;
}

/**
 * Cria a empresa com matriz, perfis, unidades e etapas padrão, e o dono como
 * proprietário. Se o e-mail ainda não tem conta, a conta nasce sem senha e
 * volta um link para o dono criar a senha (para mandar pelo WhatsApp).
 */
export async function createPlatformOrganization(
  db: Db,
  developer: { userId: string; userName: string },
  raw: z.input<typeof platformOrganizationInput>,
): Promise<CreatedPlatformOrganization> {
  const input = parseInput(platformOrganizationInput, raw);
  // A lista passa pela função da plataforma: pelo RLS, a transação não enxerga as outras empresas.
  const all = await listPlatformOrganizations(db, developer.userId);
  if (all.some((o) => o.name.toLowerCase() === input.organizationName.toLowerCase())) {
    throw new AppError("conflict", `Já existe uma empresa chamada ${input.organizationName}.`, {
      details: { issues: [{ path: "organizationName", message: "Já existe uma empresa com este nome." }] },
    });
  }
  const email = normalizeEmail(input.ownerEmail);
  return withTransaction(db, async (tx) => {
    const existing = await tx.query<{ id: string; name: string; hasPassword: boolean; status: string }>(
      `SELECT id, name, password_hash IS NOT NULL AS "hasPassword", status FROM controle_vendas_estoque.users WHERE email = $1`,
      [email],
    );
    let owner = existing.rows[0];
    if (owner && owner.status !== "active") throw new AppError("conflict", "A conta deste e-mail está desativada.");
    if (!owner) {
      const u = await tx.query<{ id: string }>(
        "INSERT INTO controle_vendas_estoque.users (email, name, password_hash, must_change_password) VALUES ($1, $2, NULL, false) RETURNING id",
        [email, input.ownerName],
      );
      owner = { id: u.rows[0]!.id, name: input.ownerName, hasPassword: false, status: "active" };
    }

    const { organizationId } = await createOrganizationTx(tx, owner.id, { name: input.organizationName });

    // A partir daqui, quem age é o desenvolvedor.
    await setTenant(tx, { organizationId, userId: developer.userId });
    if (input.joinAsOwner && developer.userId !== owner.id) {
      await tx.query(
        `INSERT INTO controle_vendas_estoque.memberships (organization_id, user_id, role_id, is_owner)
         SELECT $1, $2, r.id, true FROM controle_vendas_estoque.roles r WHERE r.organization_id = $1 AND r.key = 'owner'`,
        [organizationId, developer.userId],
      );
    }
    await recordAudit(tx, { organizationId, userId: developer.userId, channel: "web" }, {
      action: "organization.platform_create",
      entityType: "organization",
      entityId: organizationId,
      summary: `Empresa ${input.organizationName} criada por ${developer.userName} para ${owner.name} <${email}>`,
      after: { ownerEmail: email, joinAsOwner: input.joinAsOwner, newAccount: !existing.rows[0] },
    });
    const link = owner.hasPassword ? null : await issuePasswordLink(tx, owner.id, organizationId, true);
    return { organizationId, ownerName: owner.name, link };
  });
}

/** Novo link de senha para o dono de uma empresa (quando o anterior venceu ou se perdeu). */
export async function platformOwnerPasswordLink(db: Db, developerUserId: string, organizationId: string) {
  await assertDeveloper(db, developerUserId);
  const orgs = await listPlatformOrganizations(db, developerUserId);
  const org = orgs.find((o) => o.id === organizationId);
  if (!org?.ownerMembershipId) throw notFound("Dono da empresa");
  return withTransaction(db, async (tx) => {
    await setTenant(tx, { organizationId, userId: developerUserId });
    const m = await tx.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM controle_vendas_estoque.memberships WHERE id = $1`,
      [org.ownerMembershipId],
    );
    const firstAccess = !org.ownerLastLoginAt;
    const link = await issuePasswordLink(tx, m.rows[0]!.userId, organizationId, firstAccess);
    await recordAudit(tx, { organizationId, userId: developerUserId, channel: "web" }, {
      action: "member.password_link",
      entityType: "membership",
      entityId: org.ownerMembershipId!,
      summary: `Link de senha gerado pela plataforma para ${org.ownerName}`,
    });
    return { ...link, name: org.ownerName!, firstAccess };
  });
}
