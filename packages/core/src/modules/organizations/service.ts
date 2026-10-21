import { z } from "zod";
import { AppError, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";

export interface Organization {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  timezone: string;
  currency: string;
  createdAt: Date;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  document: string | null;
  isHeadquarters: boolean;
  status: "active" | "inactive";
}

const ORG_COLUMNS = `id, name, legal_name AS "legalName", document, timezone, currency, created_at AS "createdAt"`;
const BRANCH_COLUMNS = `id, name, code, document, is_headquarters AS "isHeadquarters", status`;

const timezone = z
  .string()
  .trim()
  .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Fuso horário inválido.");

export const getOrganization = defineService({
  name: "organization.get",
  description: "Consulta os dados da empresa ativa",
  permission: null,
  risk: 1,
  input: z.object({}),
  async handler({ tx, actor }) {
    const { rows } = await tx.query<Organization>(`SELECT ${ORG_COLUMNS} FROM erp.organizations WHERE id = $1`, [
      actor.organizationId,
    ]);
    if (!rows[0]) throw notFound("Empresa");
    return rows[0];
  },
});

export const updateOrganization = defineService({
  name: "organization.update",
  description: "Altera nome, razão social, documento e fuso horário da empresa",
  permission: "organization.update",
  risk: 3,
  input: z.object({
    name: z.string().trim().min(2).max(120),
    legalName: z.string().trim().max(200).nullable(),
    document: z.string().trim().max(20).nullable(),
    timezone,
  }),
  async handler({ tx, actor, audit, emit }, input) {
    const before = await tx.query<Organization>(
      `SELECT ${ORG_COLUMNS} FROM erp.organizations WHERE id = $1 FOR UPDATE`,
      [actor.organizationId],
    );
    if (!before.rows[0]) throw notFound("Empresa");
    const { rows } = await tx.query<Organization>(
      `UPDATE erp.organizations SET name = $2, legal_name = $3, document = $4, timezone = $5
        WHERE id = $1 RETURNING ${ORG_COLUMNS}`,
      [actor.organizationId, input.name, input.legalName || null, input.document || null, input.timezone],
    );
    const after = rows[0]!;
    const fields = (["name", "legalName", "document", "timezone"] as const).filter(
      (f) => before.rows[0]![f] !== after[f],
    );
    if (fields.length === 0) return after;
    await audit({
      action: "organization.update",
      entityType: "organization",
      entityId: actor.organizationId,
      summary: "Dados da empresa alterados",
      before: before.rows[0],
      after,
    });
    await emit("organization.updated", { organizationId: actor.organizationId, fields }, { type: "organization", id: actor.organizationId });
    return after;
  },
});

export const listBranches = defineService({
  name: "branches.list",
  description: "Lista as filiais da empresa",
  permission: "branches.view",
  risk: 1,
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<Branch>(
      `SELECT ${BRANCH_COLUMNS} FROM erp.branches
        WHERE ($1 OR status = 'active') ORDER BY is_headquarters DESC, name`,
      [input.includeInactive],
    );
    return rows;
  },
});

const branchFields = z.object({
  name: z.string().trim().min(2, "Informe o nome da filial.").max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, "Use até 20 letras, números, - ou _."),
  document: z.string().trim().max(20).nullable().optional(),
});

export const createBranch = defineService({
  name: "branches.create",
  description: "Cadastra uma filial",
  permission: "branches.manage",
  risk: 3,
  input: branchFields,
  async handler({ tx, actor, audit, emit }, input) {
    const dup = await tx.query("SELECT 1 FROM erp.branches WHERE code = $1", [input.code]);
    if (dup.rowCount) throw new AppError("conflict", `Já existe uma filial com o código ${input.code}.`);
    const { rows } = await tx.query<Branch>(
      `INSERT INTO erp.branches (organization_id, name, code, document)
       VALUES ($1, $2, $3, $4) RETURNING ${BRANCH_COLUMNS}`,
      [actor.organizationId, input.name, input.code, input.document || null],
    );
    const branch = rows[0]!;
    await audit({ action: "branch.create", entityType: "branch", entityId: branch.id, summary: `Filial ${branch.name} criada`, after: branch });
    await emit("branch.created", { branchId: branch.id }, { type: "branch", id: branch.id });
    return branch;
  },
});

export const updateBranch = defineService({
  name: "branches.update",
  description: "Altera ou desativa uma filial",
  permission: "branches.manage",
  risk: 3,
  input: branchFields.extend({
    id: z.string().uuid(),
    status: z.enum(["active", "inactive"]),
  }),
  async handler({ tx, audit, emit }, input) {
    const before = await tx.query<Branch>(`SELECT ${BRANCH_COLUMNS} FROM erp.branches WHERE id = $1 FOR UPDATE`, [input.id]);
    const current = before.rows[0];
    if (!current) throw notFound("Filial");
    if (current.isHeadquarters && input.status === "inactive") {
      throw new AppError("conflict", "A matriz não pode ser desativada.");
    }
    const dup = await tx.query("SELECT 1 FROM erp.branches WHERE code = $1 AND id <> $2", [input.code, input.id]);
    if (dup.rowCount) throw new AppError("conflict", `Já existe uma filial com o código ${input.code}.`);
    const { rows } = await tx.query<Branch>(
      `UPDATE erp.branches SET name = $2, code = $3, document = $4, status = $5 WHERE id = $1 RETURNING ${BRANCH_COLUMNS}`,
      [input.id, input.name, input.code, input.document || null, input.status],
    );
    const after = rows[0]!;
    const fields = (["name", "code", "document", "status"] as const).filter((f) => current[f] !== after[f]);
    if (fields.length > 0) {
      await audit({ action: "branch.update", entityType: "branch", entityId: after.id, summary: `Filial ${after.name} alterada`, before: current, after });
      await emit("branch.updated", { branchId: after.id, fields }, { type: "branch", id: after.id });
    }
    return after;
  },
});
