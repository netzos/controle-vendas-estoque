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
  return platformMemberPasswordLink(db, developerUserId, organizationId, org.ownerMembershipId);
}

/** Link de senha para qualquer pessoa da empresa (suporte: "esqueci a senha", "nunca entrei"). */
export async function platformMemberPasswordLink(db: Db, developerUserId: string, organizationId: string, membershipId: string) {
  const member = (await listPlatformOrganizationMembers(db, developerUserId, organizationId)).find((m) => m.membershipId === membershipId);
  if (!member) throw notFound("Pessoa");
  if (member.status !== "active") throw new AppError("conflict", `${member.name} está desativado(a) nesta empresa.`);
  return withTransaction(db, async (tx) => {
    await setTenant(tx, { organizationId, userId: developerUserId });
    const firstAccess = !member.lastLoginAt;
    const link = await issuePasswordLink(tx, member.userId, organizationId, firstAccess);
    await recordAudit(tx, { organizationId, userId: developerUserId, channel: "web" }, {
      action: "member.password_link",
      entityType: "membership",
      entityId: membershipId,
      summary: `Link de senha gerado pela plataforma para ${member.name}`,
    });
    return { ...link, name: member.name, firstAccess };
  });
}

export interface PlatformOverview {
  organizations: number;
  organizationsSuspended: number;
  pendingRequests: number;
  usersTotal: number;
  usersToday: number;
  users7d: number;
  users30d: number;
  usersNever: number;
  sales30d: number;
  revenue30d: string;
  netzMessages30d: number;
}

export async function platformOverview(db: Db, developerUserId: string): Promise<PlatformOverview> {
  await assertDeveloper(db, developerUserId);
  const { rows } = await db.query<PlatformOverview>(
    `SELECT organizations, organizations_suspended AS "organizationsSuspended", pending_requests AS "pendingRequests",
            users_total AS "usersTotal", users_today AS "usersToday", users_7d AS "users7d", users_30d AS "users30d",
            users_never AS "usersNever", sales_30d AS "sales30d", revenue_30d AS "revenue30d", netz_messages_30d AS "netzMessages30d"
       FROM controle_vendas_estoque.platform_overview($1)`,
    [developerUserId],
  );
  return rows[0]!;
}

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  status: "active" | "disabled";
  lastLoginAt: Date | null;
  createdAt: Date;
  organizations: string[];
  isDeveloper: boolean;
  netzMessages30d: number;
}

export async function listPlatformUsers(db: Db, developerUserId: string): Promise<PlatformUser[]> {
  await assertDeveloper(db, developerUserId);
  const { rows } = await db.query<PlatformUser>(
    `SELECT id, name, email, status, last_login_at AS "lastLoginAt", created_at AS "createdAt", organizations,
            is_developer AS "isDeveloper", netz_messages_30d AS "netzMessages30d"
       FROM controle_vendas_estoque.platform_users($1)`,
    [developerUserId],
  );
  return rows;
}

/** Suspende ou reativa uma empresa. Suspensa, ninguém entra nela (os dados ficam guardados). */
export async function setOrganizationStatus(
  db: Db,
  developer: { userId: string; userName: string },
  organizationId: string,
  status: "active" | "suspended",
): Promise<void> {
  await assertDeveloper(db, developer.userId);
  const org = (await listPlatformOrganizations(db, developer.userId)).find((o) => o.id === organizationId);
  if (!org) throw notFound("Empresa");
  if (org.status === status) return;
  await withTransaction(db, async (tx) => {
    await setTenant(tx, { organizationId, userId: developer.userId });
    await tx.query("UPDATE controle_vendas_estoque.organizations SET status = $2 WHERE id = $1", [organizationId, status]);
    await recordAudit(tx, { organizationId, userId: developer.userId, channel: "web" }, {
      action: status === "suspended" ? "organization.suspend" : "organization.reactivate",
      entityType: "organization",
      entityId: organizationId,
      summary: `Empresa ${org.name} ${status === "suspended" ? "suspensa" : "reativada"} por ${developer.userName}`,
    });
  });
}

/**
 * O administrador entra numa empresa de cliente para dar suporte, com o perfil
 * Administrador. Fica visível para a empresa em Ajustes › Usuários e na auditoria.
 */
export async function joinOrganizationForSupport(db: Db, developer: { userId: string; userName: string }, organizationId: string): Promise<void> {
  await assertDeveloper(db, developer.userId);
  const org = (await listPlatformOrganizations(db, developer.userId)).find((o) => o.id === organizationId);
  if (!org) throw notFound("Empresa");
  if (org.developerIsMember) return;
  await withTransaction(db, async (tx) => {
    await setTenant(tx, { organizationId, userId: developer.userId });
    const r = await tx.query(
      `INSERT INTO controle_vendas_estoque.memberships (organization_id, user_id, role_id, is_owner)
       SELECT $1, $2, r.id, false FROM controle_vendas_estoque.roles r WHERE r.organization_id = $1 AND r.key = 'admin'
       ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active'`,
      [organizationId, developer.userId],
    );
    if (!r.rowCount) throw new AppError("conflict", "A empresa não tem o perfil Administrador.");
    await recordAudit(tx, { organizationId, userId: developer.userId, channel: "web" }, {
      action: "member.support_join",
      entityType: "organization",
      entityId: organizationId,
      summary: `${developer.userName} (equipe netzsales) entrou para dar suporte`,
    });
  });
}

/** O administrador sai de uma empresa em que entrou para dar suporte. */
export async function leaveOrganizationSupport(db: Db, developer: { userId: string; userName: string }, organizationId: string): Promise<void> {
  const me = (await listPlatformOrganizationMembers(db, developer.userId, organizationId)).find((m) => m.userId === developer.userId);
  if (!me || me.status !== "active") return;
  if (me.isOwner) throw new AppError("conflict", "Você é proprietário desta empresa. Para sair, outro proprietário precisa tirar você em Ajustes › Usuários.");
  await withTransaction(db, async (tx) => {
    await setTenant(tx, { organizationId, userId: developer.userId });
    await tx.query("UPDATE controle_vendas_estoque.memberships SET status = 'disabled', updated_at = now() WHERE id = $1", [me.membershipId]);
    await tx.query(
      "UPDATE controle_vendas_estoque.sessions SET active_organization_id = NULL WHERE user_id = $1 AND active_organization_id = $2",
      [developer.userId, organizationId],
    );
    await recordAudit(tx, { organizationId, userId: developer.userId, channel: "web" }, {
      action: "member.support_leave",
      entityType: "organization",
      entityId: organizationId,
      summary: `${developer.userName} (equipe netzsales) encerrou o suporte e saiu da empresa`,
    });
  });
}

// Ficha da empresa ------------------------------------------------------------

export type OrganizationHealth = "active" | "cooling" | "idle" | "never" | "suspended" | "team";

export const HEALTH_LABELS: Record<OrganizationHealth, string> = {
  active: "Em uso",
  cooling: "Esfriando",
  idle: "Parada",
  never: "Nunca usou",
  suspended: "Suspensa",
  team: "Equipe netzsales",
};

const DAY = 24 * 60 * 60 * 1000;

/** Em uso: alguém da empresa usou nos últimos 3 dias. Esfriando: até 14 dias. Parada: mais que isso. */
export function organizationHealth(status: string, lastActivityAt: Date | null, now = Date.now()): OrganizationHealth {
  if (status === "suspended") return "suspended";
  if (!lastActivityAt) return "never";
  const days = (now - new Date(lastActivityAt).getTime()) / DAY;
  if (days <= 3) return "active";
  if (days <= 14) return "cooling";
  return "idle";
}

export interface PlatformOrganizationStats {
  sales30d: number;
  revenue30d: string;
  salesPrev30d: number;
  revenuePrev30d: string;
  salesTotal: number;
  usersTotal: number;
  usersActive7d: number;
  lastActivityAt: Date | null;
  products: number;
  customers: number;
  netzMessages30d: number;
  telegramLinks: number;
  improvementsOpen: number;
}

export interface PlatformOrganizationRow extends PlatformOrganization, PlatformOrganizationStats {
  health: OrganizationHealth;
}

/** Empresas com os números de uso, para a lista e a ficha. */
export async function listPlatformOrganizationRows(db: Db, developerUserId: string): Promise<PlatformOrganizationRow[]> {
  const orgs = await listPlatformOrganizations(db, developerUserId);
  const { rows } = await db.query<PlatformOrganizationStats & { organizationId: string }>(
    `SELECT organization_id AS "organizationId", sales_30d AS "sales30d", revenue_30d AS "revenue30d",
            sales_prev_30d AS "salesPrev30d", revenue_prev_30d AS "revenuePrev30d", sales_total AS "salesTotal",
            users_total AS "usersTotal", users_active_7d AS "usersActive7d", last_activity_at AS "lastActivityAt",
            products, customers, netz_messages_30d AS "netzMessages30d", telegram_links AS "telegramLinks",
            improvements_open AS "improvementsOpen"
       FROM controle_vendas_estoque.platform_organization_stats($1)`,
    [developerUserId],
  );
  const stats = new Map(rows.map((r) => [r.organizationId, r]));
  return orgs.map((o) => {
    const { organizationId: _, ...s } = stats.get(o.id)!;
    // Sem ninguém de fora da equipe: é a empresa da própria equipe (ex.: netzsales).
    const health = s.usersTotal === 0 && o.status === "active" ? "team" : organizationHealth(o.status, s.lastActivityAt);
    return { ...o, ...s, health };
  });
}

export interface PlatformOrganizationMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleName: string;
  isOwner: boolean;
  status: "active" | "disabled";
  isDeveloper: boolean;
  hasPassword: boolean;
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
  netzMessages30d: number;
  sales30d: number;
  createdAt: Date;
}

export async function listPlatformOrganizationMembers(db: Db, developerUserId: string, organizationId: string): Promise<PlatformOrganizationMember[]> {
  await assertDeveloper(db, developerUserId);
  if (!z.string().uuid().safeParse(organizationId).success) throw notFound("Empresa");
  const { rows } = await db.query<PlatformOrganizationMember>(
    `SELECT membership_id AS "membershipId", user_id AS "userId", name, email, role_name AS "roleName", is_owner AS "isOwner",
            status, is_developer AS "isDeveloper", has_password AS "hasPassword", last_login_at AS "lastLoginAt",
            last_seen_at AS "lastSeenAt", netz_messages_30d AS "netzMessages30d", sales_30d AS "sales30d", created_at AS "createdAt"
       FROM controle_vendas_estoque.platform_organization_members($1, $2)`,
    [developerUserId, organizationId],
  );
  return rows;
}

export interface PlatformOrganizationDetail {
  organization: PlatformOrganizationRow & { legalName: string | null; document: string | null; timezone: string };
  members: PlatformOrganizationMember[];
  dailySales: Array<{ day: string; sales: number; revenue: string }>;
  activity: Array<{ id: string; createdAt: Date; actorName: string | null; channel: string; action: string; summary: string | null }>;
  notes: { notes: string; contact: string | null; updatedAt: Date | null; updatedByName: string | null };
  signup: { whatsapp: string | null; business: string | null; createdAt: Date } | null;
}

/** Tudo o que a ficha da empresa mostra, numa ida só. */
export async function platformOrganizationDetail(db: Db, developerUserId: string, organizationId: string): Promise<PlatformOrganizationDetail> {
  if (!z.string().uuid().safeParse(organizationId).success) throw notFound("Empresa");
  const row = (await listPlatformOrganizationRows(db, developerUserId)).find((o) => o.id === organizationId);
  if (!row) throw notFound("Empresa");
  const [members, daily, activity, extra] = await Promise.all([
    listPlatformOrganizationMembers(db, developerUserId, organizationId),
    db.query<{ day: string; sales: number; revenue: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, sales, revenue FROM controle_vendas_estoque.platform_organization_daily_sales($1, $2)`,
      [developerUserId, organizationId],
    ),
    db.query<PlatformOrganizationDetail["activity"][number]>(
      `SELECT id::text, created_at AS "createdAt", actor_name AS "actorName", channel, action, summary
         FROM controle_vendas_estoque.platform_organization_activity($1, $2, 40)`,
      [developerUserId, organizationId],
    ),
    withTransaction(db, async (tx) => {
      await setTenant(tx, { organizationId, userId: developerUserId });
      const org = await tx.query<{ legalName: string | null; document: string | null; timezone: string }>(
        `SELECT legal_name AS "legalName", document, timezone FROM controle_vendas_estoque.organizations WHERE id = $1`,
        [organizationId],
      );
      const notes = await tx.query<PlatformOrganizationDetail["notes"]>(
        `SELECT n.notes, n.contact, n.updated_at AS "updatedAt", u.name AS "updatedByName"
           FROM controle_vendas_estoque.platform_organization_notes n
           LEFT JOIN controle_vendas_estoque.users u ON u.id = n.updated_by
          WHERE n.organization_id = $1`,
        [organizationId],
      );
      return { org: org.rows[0]!, notes: notes.rows[0] };
    }),
  ]);
  // O pedido de cadastro que deu origem à empresa, se houver (WhatsApp e ramo do negócio).
  const signup = await db.query<NonNullable<PlatformOrganizationDetail["signup"]>>(
    `SELECT whatsapp, business, created_at AS "createdAt" FROM controle_vendas_estoque.signup_requests
      WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [organizationId],
  );
  return {
    organization: { ...row, ...extra.org },
    members,
    dailySales: daily.rows,
    activity: activity.rows,
    notes: extra.notes ?? { notes: "", contact: null, updatedAt: null, updatedByName: null },
    signup: signup.rows[0] ?? null,
  };
}

export const organizationNotesInput = z.object({
  notes: z.string().trim().max(5000, "Use até 5.000 caracteres."),
  contact: z.string().trim().max(200, "Use até 200 caracteres.").optional(),
});

/** Anotações internas da equipe sobre a empresa (a empresa não vê). */
export async function savePlatformOrganizationNotes(
  db: Db,
  developer: { userId: string; userName: string },
  organizationId: string,
  raw: z.input<typeof organizationNotesInput>,
): Promise<void> {
  await assertDeveloper(db, developer.userId);
  const input = parseInput(organizationNotesInput, raw);
  if (!(await listPlatformOrganizations(db, developer.userId)).some((o) => o.id === organizationId)) throw notFound("Empresa");
  await withTransaction(db, async (tx) => {
    await setTenant(tx, { organizationId, userId: developer.userId });
    await tx.query(
      `INSERT INTO controle_vendas_estoque.platform_organization_notes (organization_id, notes, contact, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id) DO UPDATE SET notes = EXCLUDED.notes, contact = EXCLUDED.contact,
                                                   updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [organizationId, input.notes, input.contact || null, developer.userId],
    );
  });
}
