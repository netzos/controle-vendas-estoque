import { z } from "zod";
import type { Tx } from "@erp/db";
import { AppError, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";
import type { CustomFieldType } from "../../labels.ts";
import { statusField, uuidOrNull } from "./fields.ts";

// Campos que cada empresa cria para os seus itens: IMEI e cor numa loja de
// eletrônicos, safra numa fazenda, chassi numa revenda de carros. Os valores
// ficam em products.custom_values, indexados pela chave do campo.

export interface CustomField {
  id: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  categoryId: string | null;
  categoryName: string | null;
  required: boolean;
  position: number;
  status: "active" | "inactive";
}

export type CustomValues = Record<string, string | number | boolean>;

const COLUMNS = `f.id, f.key, f.label, f.field_type AS "fieldType", f.options, f.category_id AS "categoryId",
  c.name AS "categoryName", f.required, f.position, f.status`;
const FROM = `controle_vendas_estoque.custom_fields f
  LEFT JOIN controle_vendas_estoque.categories c ON c.id = f.category_id`;

// "Cor do aparelho" → "cor_do_aparelho".
export function fieldKey(label: string): string {
  const k = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(k) ? k : `campo_${k}`.slice(0, 40);
}

const optionsField = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/[\n,;]/) : v),
  z.array(z.string().trim().max(60)).transform((a) => [...new Set(a.filter(Boolean))]).pipe(z.array(z.string()).max(50, "No máximo 50 opções.")),
);

const fieldInput = z.object({
  label: z.string().trim().min(1, "Informe o nome do campo.").max(60),
  options: optionsField.default([]),
  categoryId: uuidOrNull,
  required: z.boolean().default(false),
  position: z.number().int().min(0).max(999).default(0),
});

async function assertCategory(tx: Tx, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const c = await tx.query("SELECT 1 FROM controle_vendas_estoque.categories WHERE id = $1", [categoryId]);
  if (!c.rowCount) throw new AppError("invalid_input", "Categoria não encontrada.");
}

function assertOptions(type: CustomFieldType, options: string[]) {
  if (type === "select" && options.length === 0) {
    throw new AppError("invalid_input", "Informe as opções da lista, separadas por vírgula.", {
      details: { issues: [{ path: "options", message: "Informe pelo menos uma opção." }] },
    });
  }
}

export const listCustomFields = defineService({
  name: "custom_fields.list",
  description: "Lista os campos personalizados dos itens da empresa",
  permission: "products.view",
  risk: 1,
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<CustomField>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE f.entity = 'product' AND ($1 OR f.status = 'active')
        ORDER BY f.position, lower(f.label)`,
      [input.includeInactive],
    );
    return rows;
  },
});

export const createCustomField = defineService({
  name: "custom_fields.create",
  description: "Cria um campo personalizado para os itens (ex.: IMEI, cor, safra)",
  permission: "custom_fields.manage",
  risk: 3,
  input: fieldInput.extend({ fieldType: z.enum(["text", "number", "date", "select", "boolean"]) }),
  async handler({ tx, actor, audit }, input) {
    assertOptions(input.fieldType, input.options);
    await assertCategory(tx, input.categoryId);
    const key = fieldKey(input.label);
    const dup = await tx.query("SELECT 1 FROM controle_vendas_estoque.custom_fields WHERE entity = 'product' AND key = $1", [key]);
    if (dup.rowCount) throw new AppError("conflict", `Já existe um campo chamado ${input.label}.`);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.custom_fields (organization_id, key, label, field_type, options, category_id, required, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [actor.organizationId, key, input.label, input.fieldType, input.fieldType === "select" ? input.options : [],
        input.categoryId ?? null, input.required, input.position],
    );
    const field = (await tx.query<CustomField>(`SELECT ${COLUMNS} FROM ${FROM} WHERE f.id = $1`, [rows[0]!.id])).rows[0]!;
    await audit({ action: "custom_field.create", entityType: "custom_field", entityId: field.id, summary: `Campo ${field.label} criado`, after: field });
    return field;
  },
});

// O tipo não muda depois de criado, para não invalidar valores já gravados.
export const updateCustomField = defineService({
  name: "custom_fields.update",
  description: "Altera, reordena ou desativa um campo personalizado",
  permission: "custom_fields.manage",
  risk: 3,
  input: fieldInput.extend({ id: z.string().uuid(), status: statusField }),
  async handler({ tx, audit }, input) {
    const current = (await tx.query<CustomField>(`SELECT ${COLUMNS} FROM ${FROM} WHERE f.id = $1 FOR UPDATE OF f`, [input.id])).rows[0];
    if (!current) throw notFound("Campo");
    assertOptions(current.fieldType, input.options);
    await assertCategory(tx, input.categoryId);
    await tx.query(
      `UPDATE controle_vendas_estoque.custom_fields
          SET label = $2, options = $3, category_id = $4, required = $5, position = $6, status = $7
        WHERE id = $1`,
      [input.id, input.label, current.fieldType === "select" ? input.options : [], input.categoryId ?? null, input.required, input.position, input.status],
    );
    const after = (await tx.query<CustomField>(`SELECT ${COLUMNS} FROM ${FROM} WHERE f.id = $1`, [input.id])).rows[0]!;
    await audit({ action: "custom_field.update", entityType: "custom_field", entityId: after.id, summary: `Campo ${after.label} alterado`, before: current, after });
    return after;
  },
});

/**
 * Confere os valores contra os campos ativos que valem para a categoria do
 * item e devolve só o que é válido, já convertido. Valores de campos
 * desativados são mantidos como estavam.
 */
export async function cleanCustomValues(
  tx: Tx,
  categoryId: string | null | undefined,
  input: Record<string, unknown>,
  previous: CustomValues = {},
): Promise<CustomValues> {
  const { rows: fields } = await tx.query<CustomField>(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE f.entity = 'product' AND f.status = 'active'
       AND (f.category_id IS NULL OR f.category_id = $1)`,
    [categoryId ?? null],
  );
  const active = new Set(fields.map((f) => f.key));
  const out: CustomValues = Object.fromEntries(Object.entries(previous).filter(([k]) => !active.has(k)));
  const issues: { path: string; message: string }[] = [];
  for (const f of fields) {
    const raw = input[f.key];
    const text = typeof raw === "string" ? raw.trim() : raw;
    const empty = text === undefined || text === null || text === "" || (f.fieldType === "boolean" && text === false);
    if (empty) {
      if (f.required && f.fieldType !== "boolean") issues.push({ path: `cf_${f.key}`, message: `Preencha ${f.label}.` });
      if (f.fieldType === "boolean" && text === false) out[f.key] = false;
      continue;
    }
    const s = String(text);
    switch (f.fieldType) {
      case "text":
        if (s.length > 500) issues.push({ path: `cf_${f.key}`, message: `${f.label}: até 500 caracteres.` });
        else out[f.key] = s;
        break;
      case "number": {
        const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
        if (!Number.isFinite(n)) issues.push({ path: `cf_${f.key}`, message: `${f.label}: informe um número.` });
        else out[f.key] = n;
        break;
      }
      case "date": {
        const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
        const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : s;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(iso))) issues.push({ path: `cf_${f.key}`, message: `${f.label}: data inválida.` });
        else out[f.key] = iso;
        break;
      }
      case "select":
        if (!f.options.includes(s)) issues.push({ path: `cf_${f.key}`, message: `${f.label}: escolha uma das opções.` });
        else out[f.key] = s;
        break;
      case "boolean":
        out[f.key] = text === true || s === "true" || s === "on" || s === "sim";
        break;
    }
  }
  if (issues.length) throw new AppError("invalid_input", issues[0]!.message, { details: { issues } });
  return out;
}
