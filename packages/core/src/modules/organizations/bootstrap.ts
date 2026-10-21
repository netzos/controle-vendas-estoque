import { randomUUID } from "node:crypto";
import type { Db, Tx } from "@erp/db";
import { setTenant, withTransaction } from "@erp/db";
import { z } from "zod";
import { recordAudit } from "../../audit.ts";
import { AppError, parseInput } from "../../errors.ts";
import { emitEvent } from "../../outbox.ts";
import { PERMISSIONS, SYSTEM_ROLES } from "../../permissions.ts";

// Unidades de medida com que toda empresa começa: código, nome, casas decimais.
const DEFAULT_UNITS: ReadonlyArray<readonly [string, string, number]> = [
  ["UN", "Unidade", 0], ["KG", "Quilograma", 3], ["G", "Grama", 0], ["L", "Litro", 3],
  ["ML", "Mililitro", 0], ["CX", "Caixa", 0], ["PCT", "Pacote", 0], ["M", "Metro", 2],
];
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../auth/password.ts";
import { normalizeEmail } from "../../auth/session.ts";

export const organizationInput = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa.").max(120),
  legalName: z.string().trim().max(200).optional().nullable(),
  document: z.string().trim().max(20).optional().nullable(),
  timezone: z.string().trim().default("America/Sao_Paulo"),
});

// Cria a organização com matriz, perfis padrão e o criador como proprietário.
// Roda dentro da transação recebida, com o contexto RLS da nova organização.
export async function createOrganizationTx(
  tx: Tx,
  ownerUserId: string,
  raw: z.input<typeof organizationInput>,
): Promise<{ organizationId: string; branchId: string }> {
  const input = parseInput(organizationInput, raw);
  if (!Intl.supportedValuesOf("timeZone").includes(input.timezone)) {
    throw new AppError("invalid_input", "Fuso horário inválido.");
  }
  const organizationId = randomUUID();
  await setTenant(tx, { organizationId, userId: ownerUserId });

  await tx.query(
    `INSERT INTO controle_vendas_estoque.organizations (id, name, legal_name, document, timezone) VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, input.name, input.legalName ?? null, input.document ?? null, input.timezone],
  );
  const branch = await tx.query<{ id: string }>(
    `INSERT INTO controle_vendas_estoque.branches (organization_id, name, code, is_headquarters)
     VALUES ($1, $2, 'MATRIZ', true) RETURNING id`,
    [organizationId, "Matriz"],
  );

  await tx.query(
    `INSERT INTO controle_vendas_estoque.units (organization_id, code, name, decimals)
     SELECT $1, code, name, decimals FROM unnest($2::text[], $3::text[], $4::smallint[]) AS u(code, name, decimals)`,
    [organizationId, DEFAULT_UNITS.map((u) => u[0]), DEFAULT_UNITS.map((u) => u[1]), DEFAULT_UNITS.map((u) => u[2])],
  );

  let ownerRoleId = "";
  for (const role of SYSTEM_ROLES) {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.roles (organization_id, key, name, description, is_system)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [organizationId, role.key, role.name, role.description],
    );
    const roleId = r.rows[0]!.id;
    if (role.key === "owner") ownerRoleId = roleId;
    const keys = role.permissions === "all" ? PERMISSIONS.map((p) => p.key) : role.permissions;
    if (keys.length > 0) {
      await tx.query(
        `INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
         SELECT $1, $2, unnest($3::text[])`,
        [organizationId, roleId, keys],
      );
    }
  }

  await tx.query(
    `INSERT INTO controle_vendas_estoque.memberships (organization_id, user_id, role_id, is_owner) VALUES ($1, $2, $3, true)`,
    [organizationId, ownerUserId, ownerRoleId],
  );

  const who = { organizationId, userId: ownerUserId, channel: "web" as const };
  await recordAudit(tx, who, {
    action: "organization.create",
    entityType: "organization",
    entityId: organizationId,
    summary: `Empresa ${input.name} criada`,
    after: input,
  });
  await emitEvent(tx, organizationId, {
    type: "organization.created",
    payload: { organizationId, name: input.name },
    aggregateType: "organization",
    aggregateId: organizationId,
    actorUserId: ownerUserId,
  });
  return { organizationId, branchId: branch.rows[0]!.id };
}

export const setupInput = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().email("E-mail inválido."),
  password: z.string().min(MIN_PASSWORD_LENGTH, `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`).max(200),
  organization: organizationInput,
});

export async function isSetupDone(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM controle_vendas_estoque.users) AS exists");
  return rows[0]!.exists;
}

// Configuração inicial: só funciona enquanto não existe nenhum usuário.
// Cria o primeiro usuário e a primeira empresa na mesma transação.
export async function setupFirstAdmin(db: Db, raw: z.input<typeof setupInput>) {
  const input = parseInput(setupInput, raw);
  const passwordHash = await hashPassword(input.password);
  return withTransaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(727002)");
    const { rows } = await tx.query("SELECT 1 FROM controle_vendas_estoque.users LIMIT 1");
    if (rows.length > 0) throw new AppError("conflict", "O sistema já foi configurado.");
    const user = await tx.query<{ id: string }>(
      "INSERT INTO controle_vendas_estoque.users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [normalizeEmail(input.email), input.name, passwordHash],
    );
    const userId = user.rows[0]!.id;
    const org = await createOrganizationTx(tx, userId, input.organization);
    return { userId, ...org };
  });
}

// Cria mais uma empresa para um usuário existente (que vira proprietário dela).
export async function createOrganization(db: Db, userId: string, raw: z.input<typeof organizationInput>) {
  return withTransaction(db, (tx) => createOrganizationTx(tx, userId, raw));
}
