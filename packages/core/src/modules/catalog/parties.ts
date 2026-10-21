import { z } from "zod";
import type { Tx } from "@erp/db";
import { AppError, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";
import { documentField, emailField, optionalText, stateField, statusField } from "./fields.ts";

// Clientes e fornecedores. Não são apagados: são desativados, para que vendas
// e compras antigas continuem apontando para eles.

export interface Customer {
  id: string;
  kind: "person" | "company";
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  status: "active" | "inactive";
  createdAt: Date;
}

export interface Supplier {
  id: string;
  name: string;
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  status: "active" | "inactive";
  createdAt: Date;
}

const CUSTOMER_COLUMNS = `id, kind, name, document, email, phone, city, state, notes, status, created_at AS "createdAt"`;
const SUPPLIER_COLUMNS = `id, name, trade_name AS "tradeName", document, email, phone, contact_name AS "contactName",
  city, state, notes, status, created_at AS "createdAt"`;

const listInput = z.object({
  search: z.string().trim().max(100).optional(),
  includeInactive: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(200),
});

// Busca por nome, documento (só dígitos) ou e-mail.
function searchClause(search: string | undefined, params: unknown[]) {
  if (!search) return "";
  params.push(`%${search.toLowerCase()}%`);
  const digits = search.replace(/\D/g, "");
  if (digits.length >= 3) {
    params.push(`%${digits}%`);
    return ` AND (lower(name) LIKE $${params.length - 1} OR lower(coalesce(email, '')) LIKE $${params.length - 1} OR document LIKE $${params.length})`;
  }
  return ` AND (lower(name) LIKE $${params.length} OR lower(coalesce(email, '')) LIKE $${params.length})`;
}

function changed<T extends object>(before: T, after: T, keys: (keyof T)[]): string[] {
  return keys.filter((k) => before[k] !== after[k]).map(String);
}

async function assertDocumentFree(tx: Tx, table: "customers" | "suppliers", document: string | null | undefined, id?: string) {
  if (!document) return;
  const { rows } = await tx.query<{ name: string }>(
    `SELECT name FROM controle_vendas_estoque.${table} WHERE document = $1 AND ($2::uuid IS NULL OR id <> $2)`,
    [document, id ?? null],
  );
  if (rows[0]) throw new AppError("conflict", `Este CPF/CNPJ já está cadastrado para ${rows[0].name}.`);
}

// Clientes ---------------------------------------------------------------------

const customerFields = z.object({
  kind: z.enum(["person", "company"]).default("person"),
  name: z.string().trim().min(2, "Informe o nome.").max(160),
  document: documentField,
  email: emailField,
  phone: optionalText(30),
  city: optionalText(80),
  state: stateField,
  notes: optionalText(2000),
});

export const listCustomers = defineService({
  name: "customers.list",
  description: "Lista e busca clientes por nome, CPF/CNPJ ou e-mail",
  permission: "customers.view",
  risk: 1,
  input: listInput,
  async handler({ tx }, input) {
    const params: unknown[] = [input.includeInactive];
    const where = searchClause(input.search, params);
    params.push(input.limit);
    const { rows } = await tx.query<Customer>(
      `SELECT ${CUSTOMER_COLUMNS} FROM controle_vendas_estoque.customers
        WHERE ($1 OR status = 'active')${where} ORDER BY lower(name) LIMIT $${params.length}`,
      params,
    );
    return rows;
  },
});

export const createCustomer = defineService({
  name: "customers.create",
  description: "Cadastra um cliente",
  permission: "customers.manage",
  risk: 2,
  input: customerFields,
  async handler({ tx, actor, audit, emit }, input) {
    await assertDocumentFree(tx, "customers", input.document);
    const { rows } = await tx.query<Customer>(
      `INSERT INTO controle_vendas_estoque.customers (organization_id, kind, name, document, email, phone, city, state, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${CUSTOMER_COLUMNS}`,
      [actor.organizationId, input.kind, input.name, input.document ?? null, input.email ?? null, input.phone ?? null,
        input.city ?? null, input.state ?? null, input.notes ?? null],
    );
    const customer = rows[0]!;
    await audit({ action: "customer.create", entityType: "customer", entityId: customer.id, summary: `Cliente ${customer.name} cadastrado`, after: customer });
    await emit("customer.created", { customerId: customer.id }, { type: "customer", id: customer.id });
    return customer;
  },
});

export const updateCustomer = defineService({
  name: "customers.update",
  description: "Altera ou desativa um cliente",
  permission: "customers.manage",
  risk: 2,
  input: customerFields.extend({ id: z.string().uuid(), status: statusField }),
  async handler({ tx, audit, emit }, input) {
    const before = await tx.query<Customer>(`SELECT ${CUSTOMER_COLUMNS} FROM controle_vendas_estoque.customers WHERE id = $1 FOR UPDATE`, [input.id]);
    const current = before.rows[0];
    if (!current) throw notFound("Cliente");
    await assertDocumentFree(tx, "customers", input.document, input.id);
    const { rows } = await tx.query<Customer>(
      `UPDATE controle_vendas_estoque.customers SET kind = $2, name = $3, document = $4, email = $5, phone = $6,
              city = $7, state = $8, notes = $9, status = $10
        WHERE id = $1 RETURNING ${CUSTOMER_COLUMNS}`,
      [input.id, input.kind, input.name, input.document ?? null, input.email ?? null, input.phone ?? null,
        input.city ?? null, input.state ?? null, input.notes ?? null, input.status],
    );
    const after = rows[0]!;
    const fields = changed(current, after, ["kind", "name", "document", "email", "phone", "city", "state", "notes", "status"]);
    if (fields.length > 0) {
      await audit({ action: "customer.update", entityType: "customer", entityId: after.id, summary: `Cliente ${after.name} alterado`, before: current, after });
      await emit("customer.updated", { customerId: after.id, fields }, { type: "customer", id: after.id });
    }
    return after;
  },
});

// Fornecedores -----------------------------------------------------------------

const supplierFields = z.object({
  name: z.string().trim().min(2, "Informe a razão social ou o nome.").max(160),
  tradeName: optionalText(160),
  document: documentField,
  email: emailField,
  phone: optionalText(30),
  contactName: optionalText(120),
  city: optionalText(80),
  state: stateField,
  notes: optionalText(2000),
});

export const listSuppliers = defineService({
  name: "suppliers.list",
  description: "Lista e busca fornecedores por nome, CPF/CNPJ ou e-mail",
  permission: "suppliers.view",
  risk: 1,
  input: listInput,
  async handler({ tx }, input) {
    const params: unknown[] = [input.includeInactive];
    const where = searchClause(input.search, params);
    params.push(input.limit);
    const { rows } = await tx.query<Supplier>(
      `SELECT ${SUPPLIER_COLUMNS} FROM controle_vendas_estoque.suppliers
        WHERE ($1 OR status = 'active')${where} ORDER BY lower(name) LIMIT $${params.length}`,
      params,
    );
    return rows;
  },
});

export const createSupplier = defineService({
  name: "suppliers.create",
  description: "Cadastra um fornecedor",
  permission: "suppliers.manage",
  risk: 2,
  input: supplierFields,
  async handler({ tx, actor, audit, emit }, input) {
    await assertDocumentFree(tx, "suppliers", input.document);
    const { rows } = await tx.query<Supplier>(
      `INSERT INTO controle_vendas_estoque.suppliers
         (organization_id, name, trade_name, document, email, phone, contact_name, city, state, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${SUPPLIER_COLUMNS}`,
      [actor.organizationId, input.name, input.tradeName ?? null, input.document ?? null, input.email ?? null,
        input.phone ?? null, input.contactName ?? null, input.city ?? null, input.state ?? null, input.notes ?? null],
    );
    const supplier = rows[0]!;
    await audit({ action: "supplier.create", entityType: "supplier", entityId: supplier.id, summary: `Fornecedor ${supplier.name} cadastrado`, after: supplier });
    await emit("supplier.created", { supplierId: supplier.id }, { type: "supplier", id: supplier.id });
    return supplier;
  },
});

export const updateSupplier = defineService({
  name: "suppliers.update",
  description: "Altera ou desativa um fornecedor",
  permission: "suppliers.manage",
  risk: 2,
  input: supplierFields.extend({ id: z.string().uuid(), status: statusField }),
  async handler({ tx, audit, emit }, input) {
    const before = await tx.query<Supplier>(`SELECT ${SUPPLIER_COLUMNS} FROM controle_vendas_estoque.suppliers WHERE id = $1 FOR UPDATE`, [input.id]);
    const current = before.rows[0];
    if (!current) throw notFound("Fornecedor");
    await assertDocumentFree(tx, "suppliers", input.document, input.id);
    const { rows } = await tx.query<Supplier>(
      `UPDATE controle_vendas_estoque.suppliers SET name = $2, trade_name = $3, document = $4, email = $5, phone = $6,
              contact_name = $7, city = $8, state = $9, notes = $10, status = $11
        WHERE id = $1 RETURNING ${SUPPLIER_COLUMNS}`,
      [input.id, input.name, input.tradeName ?? null, input.document ?? null, input.email ?? null, input.phone ?? null,
        input.contactName ?? null, input.city ?? null, input.state ?? null, input.notes ?? null, input.status],
    );
    const after = rows[0]!;
    const fields = changed(current, after, ["name", "tradeName", "document", "email", "phone", "contactName", "city", "state", "notes", "status"]);
    if (fields.length > 0) {
      await audit({ action: "supplier.update", entityType: "supplier", entityId: after.id, summary: `Fornecedor ${after.name} alterado`, before: current, after });
      await emit("supplier.updated", { supplierId: after.id, fields }, { type: "supplier", id: after.id });
    }
    return after;
  },
});
