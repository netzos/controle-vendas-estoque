import { z } from "zod";
import type { Tx } from "@erp/db";
import type { Actor } from "../../context.ts";
import { AppError, forbidden, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";
import { MAX_IMAGE_BYTES, sniff } from "./images.ts";
import { daysField, documentField, emailField, optionalText, stateField, statusField, uuidOrNull, whatsappField, zipField } from "./fields.ts";

// Clientes e fornecedores. Não são apagados: são desativados, para que vendas
// e compras antigas continuem apontando para eles.

export interface Customer {
  id: string;
  kind: "person" | "company";
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  zipCode: string | null;
  street: string | null;
  streetNumber: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  /** Código que a empresa já usava para o cliente (planilha antiga, outro sistema). */
  code: string | null;
  /** Desde quando é cliente (data do cadastro original), "AAAA-MM-DD". */
  customerSince: string | null;
  /** Filial do cliente; null = da empresa toda. */
  branchId: string | null;
  branchName: string | null;
  status: "active" | "inactive";
  /** Muda a cada foto nova; null = sem foto. */
  photoId: string | null;
  createdAt: Date;
}

/** Endereço em uma linha: "Rua A, 10 - apto 2 - Centro, Belém/PA - CEP 66000-000". */
export function addressLine(a: Pick<Customer, "street" | "streetNumber" | "complement" | "district" | "city" | "state" | "zipCode">): string {
  const street = [a.street, a.streetNumber].filter(Boolean).join(", ");
  const place = [a.city, a.state].filter(Boolean).join("/");
  const zip = a.zipCode ? `CEP ${a.zipCode.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : "";
  return [street, a.complement, a.district].filter(Boolean).join(" - ") + (place ? `${street || a.district ? ", " : ""}${place}` : "") + (zip ? ` - ${zip}` : "");
}

export interface Supplier {
  id: string;
  name: string;
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  whatsapp: string | null;
  zipCode: string | null;
  street: string | null;
  streetNumber: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  leadTimeDays: number | null;
  notes: string | null;
  status: "active" | "inactive";
  createdAt: Date;
}

const CUSTOMER_COLUMNS = `id, kind, name, document, email, phone, zip_code AS "zipCode", street, street_number AS "streetNumber",
  complement, district, city, state, notes, code, to_char(customer_since, 'YYYY-MM-DD') AS "customerSince", branch_id AS "branchId",
  (SELECT b.name FROM controle_vendas_estoque.branches b WHERE b.id = branch_id) AS "branchName",
  status, photo_id AS "photoId", created_at AS "createdAt"`;
const SUPPLIER_COLUMNS = `id, name, trade_name AS "tradeName", document, email, phone, contact_name AS "contactName",
  whatsapp, zip_code AS "zipCode", street, street_number AS "streetNumber", complement, district,
  city, state, lead_time_days AS "leadTimeDays", notes, status, created_at AS "createdAt"`;

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

/** Quem só trabalha em algumas filiais vê os clientes delas e os da empresa toda. */
function branchScope(actor: Pick<Actor, "branchIds">, params: unknown[], column = "branch_id"): string {
  if (!actor.branchIds) return "";
  params.push(actor.branchIds);
  return ` AND (${column} IS NULL OR ${column} = ANY($${params.length}::uuid[]))`;
}

async function assertBranch(tx: Tx, actor: Pick<Actor, "branchIds">, branchId: string | null | undefined) {
  if (!branchId) return;
  if (actor.branchIds && !actor.branchIds.includes(branchId)) throw forbidden("Você não trabalha nesta filial.");
  const { rowCount } = await tx.query("SELECT 1 FROM controle_vendas_estoque.branches WHERE id = $1", [branchId]);
  if (!rowCount) throw new AppError("invalid_input", "Filial inválida.");
}

const sinceField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de cadastro inválida.").refine((d) => !Number.isNaN(Date.parse(d)), "Data de cadastro inválida.").nullable().optional(),
);

const customerFields = z.object({
  kind: z.enum(["person", "company"]).default("person"),
  name: z.string().trim().min(2, "Informe o nome.").max(160),
  document: documentField,
  email: emailField,
  phone: optionalText(30),
  zipCode: zipField,
  street: optionalText(160),
  streetNumber: optionalText(20),
  complement: optionalText(80),
  district: optionalText(80),
  city: optionalText(80),
  state: stateField,
  notes: optionalText(2000),
  code: optionalText(40),
  customerSince: sinceField,
  branchId: uuidOrNull,
});

export const listCustomers = defineService({
  name: "customers.list",
  description: "Lista e busca clientes por nome, CPF/CNPJ ou e-mail",
  permission: "customers.view",
  risk: 1,
  input: listInput.extend({
    // Uma filial: os clientes dela e os da empresa toda.
    branchId: z.string().uuid().optional(),
  }),
  async handler({ tx, actor }, input) {
    const params: unknown[] = [input.includeInactive];
    let where = searchClause(input.search, params);
    // O código antigo do cliente também acha ele.
    if (where && /^[\w-]{1,40}$/.test(input.search!)) {
      params.push(input.search!.toLowerCase());
      where = where.replace(/\)$/, ` OR lower(code) = $${params.length})`);
    }
    where += branchScope(actor, params);
    if (input.branchId) {
      params.push(input.branchId);
      where += ` AND (branch_id IS NULL OR branch_id = $${params.length})`;
    }
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
    await assertBranch(tx, actor, input.branchId);
    const customer = await insertCustomer(tx, actor, input);
    await audit({ action: "customer.create", entityType: "customer", entityId: customer.id, summary: `Cliente ${customer.name} cadastrado`, after: customer });
    await emit("customer.created", { customerId: customer.id }, { type: "customer", id: customer.id });
    return customer;
  },
});

type CustomerInput = z.output<typeof customerFields>;

async function insertCustomer(tx: Tx, actor: Pick<Actor, "organizationId">, input: CustomerInput): Promise<Customer> {
  const { rows } = await tx.query<Customer>(
    `INSERT INTO controle_vendas_estoque.customers
       (organization_id, kind, name, document, email, phone, city, state, notes, zip_code, street, street_number, complement, district,
        code, customer_since, branch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING ${CUSTOMER_COLUMNS}`,
    [actor.organizationId, input.kind, input.name, input.document ?? null, input.email ?? null, input.phone ?? null,
      input.city ?? null, input.state ?? null, input.notes ?? null, input.zipCode ?? null, input.street ?? null,
      input.streetNumber ?? null, input.complement ?? null, input.district ?? null, input.code ?? null, input.customerSince ?? null,
      input.branchId ?? null],
  );
  return rows[0]!;
}

// Importar clientes de uma planilha ----------------------------------------------

export interface CustomerImportRow {
  /** Linha na planilha (a 1 é o cabeçalho). */
  line: number;
  name: string;
  status: "new" | "duplicate" | "error";
  message: string | null;
  data: CustomerInput | null;
}

export interface CustomerImportResult {
  columns: Array<{ header: string; field: string | null }>;
  rows: CustomerImportRow[];
  created: number;
}

const HEADER_FIELDS: Record<string, keyof CustomerInput> = {
  codigo: "code", cod: "code", code: "code", id_cliente: "code", codigo_cliente: "code",
  nome: "name", name: "name", cliente: "name", nome_cliente: "name", razao_social: "name", nome_completo: "name",
  telefone: "phone", fone: "phone", celular: "phone", whatsapp: "phone", tel: "phone", contato: "phone",
  email: "email", e_mail: "email",
  cpf_cnpj: "document", cpf: "document", cnpj: "document", documento: "document", doc: "document", cpfcnpj: "document",
  cidade: "city", municipio: "city",
  uf: "state", estado: "state",
  endereco: "street", rua: "street", logradouro: "street",
  numero: "streetNumber", num: "streetNumber",
  complemento: "complement",
  bairro: "district",
  cep: "zipCode",
  data_cadastro: "customerSince", cadastro: "customerSince", cliente_desde: "customerSince", data: "customerSince", desde: "customerSince", data_de_cadastro: "customerSince",
  observacoes: "notes", observacao: "notes", obs: "notes", notas: "notes", anotacoes: "notes",
};

function headerKey(h: string): string {
  return h.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Lê CSV ou texto colado de planilha (separado por ; , ou tab, com aspas). */
export function parseSheet(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const first = clean.split("\n", 1)[0] ?? "";
  const counts = [";", "\t", ","].map((d) => [d, first.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// "25/03/2021", "25/03/21" ou "2021-03-25" viram "2021-03-25".
function isoDate(v: string): string {
  const t = v.trim();
  const br = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (br) {
    const year = br[3]!.length === 2 ? `20${br[3]}` : br[3]!;
    return `${year}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}`;
  }
  return t.slice(0, 10);
}

export const importCustomers = defineService({
  name: "customers.import",
  description: "Importa clientes de uma planilha (CSV ou texto colado): mostra a prévia e, confirmado, cadastra todos de uma vez, pulando os repetidos",
  permission: "customers.manage",
  risk: 2,
  input: z.object({
    text: z.string().min(1, "Cole a planilha ou escolha o arquivo.").max(2_000_000, "Planilha grande demais (até 2 MB)."),
    branchId: uuidOrNull,
    // false: só a prévia, nada é gravado.
    confirm: z.boolean().default(false),
  }),
  async handler({ tx, actor, audit, emit }, input): Promise<CustomerImportResult> {
    await assertBranch(tx, actor, input.branchId);
    const [header, ...lines] = parseSheet(input.text);
    if (!header || lines.length === 0) throw new AppError("invalid_input", "A planilha precisa de uma linha de cabeçalho (nome, telefone…) e pelo menos um cliente.");
    if (lines.length > 2000) throw new AppError("invalid_input", "Importe até 2.000 clientes por vez.");
    const columns = header.map((h) => ({ header: h.trim(), field: (HEADER_FIELDS[headerKey(h)] as string | undefined) ?? null }));
    if (!columns.some((c) => c.field === "name")) throw new AppError("invalid_input", "Não achei a coluna do nome. Chame a coluna de \"nome\".");

    const existing = await tx.query<{ name: string; document: string | null; code: string | null }>(
      "SELECT lower(name) AS name, document, lower(code) AS code FROM controle_vendas_estoque.customers",
    );
    const names = new Set(existing.rows.map((r) => r.name));
    const docs = new Set(existing.rows.map((r) => r.document).filter(Boolean));
    const codes = new Set(existing.rows.map((r) => r.code).filter(Boolean));

    const rows: CustomerImportRow[] = lines.map((cells, i) => {
      const raw: Record<string, string> = {};
      columns.forEach((c, j) => {
        const v = (cells[j] ?? "").trim();
        if (!c.field || !v) return;
        raw[c.field] = raw[c.field] ? `${raw[c.field]} ${v}` : v;
      });
      if (raw.customerSince) raw.customerSince = isoDate(raw.customerSince);
      if (raw.document && raw.document.replace(/\D/g, "").length === 14) raw.kind = "company";
      const line = i + 2;
      const parsed = customerFields.safeParse({ ...raw, branchId: input.branchId ?? null });
      if (!parsed.success) {
        return { line, name: raw.name ?? "", status: "error", message: parsed.error.issues.map((x) => x.message).join(" "), data: null };
      }
      const d = parsed.data;
      const dup =
        (d.document && docs.has(d.document) && "mesmo CPF/CNPJ") ||
        (d.code && codes.has(d.code.toLowerCase()) && "mesmo código") ||
        (names.has(d.name.toLowerCase()) && "mesmo nome");
      if (dup) return { line, name: d.name, status: "duplicate", message: `Já cadastrado (${dup}).`, data: d };
      names.add(d.name.toLowerCase());
      if (d.document) docs.add(d.document);
      if (d.code) codes.add(d.code.toLowerCase());
      return { line, name: d.name, status: "new", message: null, data: d };
    });

    let created = 0;
    if (input.confirm) {
      for (const r of rows) {
        if (r.status !== "new" || !r.data) continue;
        const customer = await insertCustomer(tx, actor, r.data);
        await audit({ action: "customer.create", entityType: "customer", entityId: customer.id, summary: `Cliente ${customer.name} importado da planilha`, after: customer });
        await emit("customer.created", { customerId: customer.id }, { type: "customer", id: customer.id });
        created++;
      }
    }
    return { columns, rows, created };
  },
});

export const updateCustomer = defineService({
  name: "customers.update",
  description: "Altera ou desativa um cliente",
  permission: "customers.manage",
  risk: 2,
  input: customerFields.extend({ id: z.string().uuid(), status: statusField }),
  async handler({ tx, actor, audit, emit }, input) {
    const before = await tx.query<Customer>(`SELECT ${CUSTOMER_COLUMNS} FROM controle_vendas_estoque.customers WHERE id = $1 FOR UPDATE`, [input.id]);
    const current = before.rows[0];
    if (!current) throw notFound("Cliente");
    await assertDocumentFree(tx, "customers", input.document, input.id);
    // Campo novo que não veio (tela ou Netz antiga) fica como estava.
    const code = input.code === undefined ? current.code : input.code;
    const since = input.customerSince === undefined ? current.customerSince : input.customerSince;
    const branchId = input.branchId === undefined ? current.branchId : input.branchId;
    if (branchId !== current.branchId) await assertBranch(tx, actor, branchId);
    const { rows } = await tx.query<Customer>(
      `UPDATE controle_vendas_estoque.customers SET kind = $2, name = $3, document = $4, email = $5, phone = $6,
              city = $7, state = $8, notes = $9, status = $10, zip_code = $11, street = $12, street_number = $13,
              complement = $14, district = $15, code = $16, customer_since = $17, branch_id = $18
        WHERE id = $1 RETURNING ${CUSTOMER_COLUMNS}`,
      [input.id, input.kind, input.name, input.document ?? null, input.email ?? null, input.phone ?? null,
        input.city ?? null, input.state ?? null, input.notes ?? null, input.status, input.zipCode ?? null, input.street ?? null,
        input.streetNumber ?? null, input.complement ?? null, input.district ?? null, code ?? null, since ?? null, branchId ?? null],
    );
    const after = rows[0]!;
    const fields = changed(current, after, ["kind", "name", "document", "email", "phone", "zipCode", "street", "streetNumber", "complement", "district", "city", "state", "notes", "code", "customerSince", "branchId", "status"]);
    if (fields.length > 0) {
      await audit({ action: "customer.update", entityType: "customer", entityId: after.id, summary: `Cliente ${after.name} alterado`, before: current, after });
      await emit("customer.updated", { customerId: after.id, fields }, { type: "customer", id: after.id });
    }
    return after;
  },
});

// Foto do cliente ----------------------------------------------------------------

export const setCustomerPhoto = defineService({
  name: "customers.photo.set",
  description: "Coloca ou troca a foto de um cliente",
  permission: "customers.manage",
  risk: 2,
  input: z.object({ customerId: z.string().uuid(), data: z.instanceof(Uint8Array) }),
  async handler({ tx, audit }, input) {
    if (input.data.byteLength === 0) throw new AppError("invalid_input", "Arquivo vazio.");
    if (input.data.byteLength > MAX_IMAGE_BYTES) throw new AppError("invalid_input", "Foto muito grande. O limite é 2 MB.");
    const contentType = sniff(input.data);
    if (!contentType) throw new AppError("invalid_input", "Formato não aceito. Envie JPG, PNG ou WebP.");
    const { rows } = await tx.query<{ name: string; photoId: string }>(
      `UPDATE controle_vendas_estoque.customers SET photo = $2, photo_type = $3, photo_id = gen_random_uuid()
        WHERE id = $1 RETURNING name, photo_id AS "photoId"`,
      [input.customerId, Buffer.from(input.data), contentType],
    );
    if (!rows[0]) throw notFound("Cliente");
    await audit({ action: "customer.photo", entityType: "customer", entityId: input.customerId, summary: `Foto de ${rows[0].name} atualizada` });
    return { photoId: rows[0].photoId };
  },
});

export const removeCustomerPhoto = defineService({
  name: "customers.photo.remove",
  description: "Tira a foto de um cliente",
  permission: "customers.manage",
  risk: 2,
  input: z.object({ customerId: z.string().uuid() }),
  async handler({ tx, audit }, input) {
    const { rows } = await tx.query<{ name: string }>(
      "UPDATE controle_vendas_estoque.customers SET photo = NULL, photo_type = NULL, photo_id = NULL WHERE id = $1 RETURNING name",
      [input.customerId],
    );
    if (!rows[0]) throw notFound("Cliente");
    await audit({ action: "customer.photo", entityType: "customer", entityId: input.customerId, summary: `Foto de ${rows[0].name} removida` });
    return { ok: true };
  },
});

export const getCustomerPhoto = defineService({
  name: "customers.photo.get",
  description: "Devolve o arquivo da foto de um cliente",
  permission: "customers.view",
  risk: 1,
  input: z.object({ photoId: z.string().uuid() }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<{ contentType: string; data: Buffer }>(
      `SELECT photo_type AS "contentType", photo AS data FROM controle_vendas_estoque.customers WHERE photo_id = $1 AND photo IS NOT NULL`,
      [input.photoId],
    );
    if (!rows[0]) throw notFound("Foto");
    return rows[0];
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
  whatsapp: whatsappField,
  zipCode: zipField,
  street: optionalText(160),
  streetNumber: optionalText(20),
  complement: optionalText(80),
  district: optionalText(80),
  city: optionalText(80),
  state: stateField,
  leadTimeDays: daysField,
  notes: optionalText(2000),
});

// Mesma ordem das colunas em INSERT e UPDATE, a partir do 2º parâmetro.
const supplierValues = (i: z.output<typeof supplierFields>) => [
  i.name, i.tradeName ?? null, i.document ?? null, i.email ?? null, i.phone ?? null, i.contactName ?? null,
  i.whatsapp ?? null, i.zipCode ?? null, i.street ?? null, i.streetNumber ?? null, i.complement ?? null, i.district ?? null,
  i.city ?? null, i.state ?? null, i.leadTimeDays ?? null, i.notes ?? null,
];

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
         (organization_id, name, trade_name, document, email, phone, contact_name, whatsapp, zip_code, street,
          street_number, complement, district, city, state, lead_time_days, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING ${SUPPLIER_COLUMNS}`,
      [actor.organizationId, ...supplierValues(input)],
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
              contact_name = $7, whatsapp = $8, zip_code = $9, street = $10, street_number = $11, complement = $12,
              district = $13, city = $14, state = $15, lead_time_days = $16, notes = $17, status = $18
        WHERE id = $1 RETURNING ${SUPPLIER_COLUMNS}`,
      [input.id, ...supplierValues(input), input.status],
    );
    const after = rows[0]!;
    const fields = changed(current, after, ["name", "tradeName", "document", "email", "phone", "contactName", "whatsapp",
      "zipCode", "street", "streetNumber", "complement", "district", "city", "state", "leadTimeDays", "notes", "status"]);
    if (fields.length > 0) {
      await audit({ action: "supplier.update", entityType: "supplier", entityId: after.id, summary: `Fornecedor ${after.name} alterado`, before: current, after });
      await emit("supplier.updated", { supplierId: after.id, fields }, { type: "supplier", id: after.id });
    }
    return after;
  },
});
