import { z } from "zod";
import type { Tx } from "@erp/db";
import { AppError, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";
import { decimalField, optionalText, statusField, uuidOrNull } from "../catalog/fields.ts";

// Custos do negócio. Cada empresa tem os seus tipos (entrega, mão de obra,
// embalagem...). Um lançamento pode apontar para a venda, a entrega, o
// produto ou o fornecedor a que se refere. O lucro real desconta tudo isso.

export interface CostType {
  id: string;
  name: string;
  status: "active" | "inactive";
  usage: number;
}

export interface Cost {
  id: string;
  costTypeId: string;
  costTypeName: string;
  amount: string;
  incurredOn: string;
  description: string | null;
  saleId: string | null;
  saleNumber: number | null;
  stepId: string | null;
  productId: string | null;
  productName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  status: "active" | "cancelled";
  userName: string;
  createdAt: Date;
}

export type CostPeriod = "7d" | "30d" | "month" | "last_month" | "90d";

// Data de hoje no fuso da empresa, como texto AAAA-MM-DD.
export async function orgToday(tx: Tx): Promise<string> {
  const { rows } = await tx.query<{ d: string }>(
    `SELECT (now() AT TIME ZONE timezone)::date::text AS d FROM controle_vendas_estoque.organizations WHERE id = controle_vendas_estoque.current_org()`,
  );
  return rows[0]!.d;
}

export const orgDate = defineService({
  name: "organization.today",
  description: "Data de hoje no fuso da empresa",
  permission: null,
  risk: 1,
  input: z.object({}),
  async handler({ tx }) {
    return orgToday(tx);
  },
});

// Intervalo de datas [from, to) e o período anterior de mesmo tamanho.
async function periodRange(tx: Tx, period: CostPeriod) {
  const { rows } = await tx.query<{ from: string; to: string; prevFrom: string; tz: string }>(
    `WITH t AS (SELECT (now() AT TIME ZONE timezone)::date AS d, timezone AS tz FROM controle_vendas_estoque.organizations
                 WHERE id = controle_vendas_estoque.current_org()),
          r AS (SELECT tz,
                       CASE $1 WHEN '7d' THEN d - 6 WHEN '30d' THEN d - 29 WHEN '90d' THEN d - 89
                               WHEN 'month' THEN date_trunc('month', d)::date
                               ELSE (date_trunc('month', d) - interval '1 month')::date END AS f,
                       CASE $1 WHEN 'last_month' THEN date_trunc('month', d)::date ELSE d + 1 END AS e
                  FROM t)
     SELECT f::text AS "from", e::text AS "to",
            (CASE WHEN $1 IN ('month', 'last_month') THEN (f - interval '1 month')::date ELSE f - (e - f) END)::text AS "prevFrom", tz
       FROM r`,
    [period],
  );
  return rows[0]!;
}

// Tipo de custo pelo nome, criado se ainda não existir. As etapas depois da
// venda lançam o custo no tipo de mesmo nome (Entrega, Instalação...).
export async function costTypeByName(tx: Tx, organizationId: string, name: string): Promise<string> {
  const found = await tx.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.cost_types WHERE lower(name) = lower($1)", [name]);
  if (found.rows[0]) return found.rows[0].id;
  const { rows } = await tx.query<{ id: string }>(
    "INSERT INTO controle_vendas_estoque.cost_types (organization_id, name) VALUES ($1, $2) RETURNING id",
    [organizationId, name],
  );
  return rows[0]!.id;
}

// Tipos de custo -------------------------------------------------------------------

export const listCostTypes = defineService({
  name: "costs.types.list",
  description: "Lista os tipos de custo da empresa",
  permission: "costs.view",
  risk: 1,
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<CostType>(
      `SELECT t.id, t.name, t.status,
              (SELECT count(*) FROM controle_vendas_estoque.costs c WHERE c.cost_type_id = t.id AND c.status = 'active')::int AS usage
         FROM controle_vendas_estoque.cost_types t
        WHERE $1 OR t.status = 'active' ORDER BY lower(t.name)`,
      [input.includeInactive],
    );
    return rows;
  },
});

const typeName = z.string().trim().min(2, "Informe o nome do tipo de custo.").max(60);

export const createCostType = defineService({
  name: "costs.types.create",
  description: "Cria um tipo de custo (ex.: aluguel da máquina, frete)",
  permission: "costs.manage",
  risk: 2,
  input: z.object({ name: typeName }),
  async handler({ tx, actor, audit }, input) {
    const dup = await tx.query("SELECT 1 FROM controle_vendas_estoque.cost_types WHERE lower(name) = lower($1)", [input.name]);
    if (dup.rowCount) throw new AppError("conflict", `Já existe o tipo ${input.name}.`);
    const { rows } = await tx.query<{ id: string }>(
      "INSERT INTO controle_vendas_estoque.cost_types (organization_id, name) VALUES ($1, $2) RETURNING id",
      [actor.organizationId, input.name],
    );
    await audit({ action: "cost_type.create", entityType: "cost_type", entityId: rows[0]!.id, summary: `Tipo de custo ${input.name} criado` });
    return { id: rows[0]!.id, name: input.name };
  },
});

export const updateCostType = defineService({
  name: "costs.types.update",
  description: "Renomeia ou desativa um tipo de custo",
  permission: "costs.manage",
  risk: 2,
  input: z.object({ id: z.string().uuid(), name: typeName, status: statusField }),
  async handler({ tx, audit }, input) {
    const cur = await tx.query<{ name: string }>("SELECT name FROM controle_vendas_estoque.cost_types WHERE id = $1 FOR UPDATE", [input.id]);
    if (!cur.rows[0]) throw notFound("Tipo de custo");
    const dup = await tx.query("SELECT 1 FROM controle_vendas_estoque.cost_types WHERE lower(name) = lower($1) AND id <> $2", [input.name, input.id]);
    if (dup.rowCount) throw new AppError("conflict", `Já existe o tipo ${input.name}.`);
    await tx.query("UPDATE controle_vendas_estoque.cost_types SET name = $2, status = $3 WHERE id = $1", [input.id, input.name, input.status]);
    await audit({ action: "cost_type.update", entityType: "cost_type", entityId: input.id, summary: `Tipo de custo ${cur.rows[0].name} → ${input.name} (${input.status})` });
    return { id: input.id };
  },
});

// Lançamentos -----------------------------------------------------------------------

const COST_COLUMNS = `c.id, c.cost_type_id AS "costTypeId", t.name AS "costTypeName", c.amount::text AS amount,
  c.incurred_on::text AS "incurredOn", c.description, c.sale_id AS "saleId", s.number AS "saleNumber",
  c.step_id AS "stepId", c.product_id AS "productId", p.name AS "productName",
  c.supplier_id AS "supplierId", f.name AS "supplierName", c.status, u.name AS "userName", c.created_at AS "createdAt"`;
const COST_FROM = `controle_vendas_estoque.costs c
  JOIN controle_vendas_estoque.cost_types t ON t.id = c.cost_type_id
  JOIN controle_vendas_estoque.users u ON u.id = c.created_by
  LEFT JOIN controle_vendas_estoque.sales s ON s.id = c.sale_id
  LEFT JOIN controle_vendas_estoque.products p ON p.id = c.product_id
  LEFT JOIN controle_vendas_estoque.suppliers f ON f.id = c.supplier_id`;

export const listCosts = defineService({
  name: "costs.list",
  description: "Lista os custos lançados num período, por tipo, produto ou venda",
  permission: "costs.view",
  risk: 1,
  input: z.object({
    period: z.enum(["7d", "30d", "month", "last_month", "90d"]).default("month"),
    costTypeId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    saleId: z.string().uuid().optional(),
    includeCancelled: z.boolean().default(false),
    limit: z.number().int().min(1).max(1000).default(300),
  }),
  async handler({ tx }, input) {
    const r = await periodRange(tx, input.period);
    const { rows } = await tx.query<Cost>(
      `SELECT ${COST_COLUMNS} FROM ${COST_FROM}
        WHERE ($1::uuid IS NOT NULL OR (c.incurred_on >= $2::date AND c.incurred_on < $3::date))
          AND ($1::uuid IS NULL OR c.sale_id = $1) AND ($4::uuid IS NULL OR c.cost_type_id = $4)
          AND ($5::uuid IS NULL OR c.product_id = $5) AND ($6 OR c.status = 'active')
        ORDER BY c.incurred_on DESC, c.created_at DESC LIMIT $7`,
      [input.saleId ?? null, r.from, r.to, input.costTypeId ?? null, input.productId ?? null, input.includeCancelled, input.limit],
    );
    return rows;
  },
});

export const costInput = z.object({
  costTypeId: z.string().uuid("Escolha o tipo de custo."),
  amount: decimalField(2, "Valor"),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.").optional(),
  description: optionalText(300),
  saleId: uuidOrNull,
  productId: uuidOrNull,
  supplierId: uuidOrNull,
});

// Também usado pelas entregas: grava um custo já validado.
export async function insertCost(
  tx: Tx,
  actor: { organizationId: string; userId: string },
  c: { costTypeId: string; amount: string; incurredOn: string; description?: string | null; saleId?: string | null; stepId?: string | null; productId?: string | null; supplierId?: string | null },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO controle_vendas_estoque.costs
       (organization_id, cost_type_id, amount, incurred_on, description, sale_id, step_id, product_id, supplier_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [actor.organizationId, c.costTypeId, c.amount, c.incurredOn, c.description ?? null, c.saleId ?? null, c.stepId ?? null,
      c.productId ?? null, c.supplierId ?? null, actor.userId],
  );
  return rows[0]!.id;
}

export const createCost = defineService({
  name: "costs.create",
  description: "Lança um custo: valor, tipo, data e, se quiser, a venda, o produto ou o fornecedor ligado a ele",
  permission: "costs.manage",
  risk: 3,
  input: costInput,
  async handler({ tx, actor, audit }, input) {
    if (Number(input.amount) <= 0) throw new AppError("invalid_input", "O valor do custo deve ser maior que zero.");
    const type = await tx.query<{ name: string; status: string }>("SELECT name, status FROM controle_vendas_estoque.cost_types WHERE id = $1", [input.costTypeId]);
    if (!type.rows[0] || type.rows[0].status !== "active") throw new AppError("invalid_input", "Tipo de custo não encontrado ou inativo.");
    const refs: [string, string | null | undefined, string][] = [
      ["sales", input.saleId, "Venda"], ["products", input.productId, "Produto"], ["suppliers", input.supplierId, "Fornecedor"],
    ];
    for (const [table, id, label] of refs) {
      if (!id) continue;
      const r = await tx.query(`SELECT 1 FROM controle_vendas_estoque.${table} WHERE id = $1`, [id]);
      if (!r.rowCount) throw new AppError("invalid_input", `${label} não encontrado(a).`);
    }
    const incurredOn = input.incurredOn ?? (await orgToday(tx));
    if (incurredOn > (await orgToday(tx))) throw new AppError("invalid_input", "A data do custo não pode ser no futuro.");
    const id = await insertCost(tx, actor, { ...input, incurredOn });
    await audit({ action: "cost.create", entityType: "cost", entityId: id, summary: `Custo de R$ ${input.amount} (${type.rows[0].name}) em ${incurredOn}`, after: { ...input, incurredOn } });
    return { id };
  },
});

export const cancelCost = defineService({
  name: "costs.cancel",
  description: "Cancela um custo lançado por engano",
  permission: "costs.manage",
  risk: 3,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx, audit }, input) {
    const { rows } = await tx.query<{ amount: string }>(
      `UPDATE controle_vendas_estoque.costs SET status = 'cancelled', cancelled_at = now()
        WHERE id = $1 AND status = 'active' AND step_id IS NULL RETURNING amount::text AS amount`,
      [input.id],
    );
    // Custo de etapa (entrega, instalação) se muda na própria etapa.
    if (!rows[0]) throw new AppError("not_found", "Custo não encontrado ou ligado a uma etapa da venda; mude o custo na etapa.");
    await audit({ action: "cost.cancel", entityType: "cost", entityId: input.id, summary: `Custo de R$ ${rows[0].amount} cancelado` });
    return { ok: true };
  },
});

// Painel de custos e lucro real ---------------------------------------------------------

export interface CostsOverview {
  period: CostPeriod;
  from: string;
  to: string;
  revenue: string;
  productCost: string;
  costs: string;
  grossProfit: string;
  realProfit: string;
  realMargin: string | null;
  previous: { costs: string; realProfit: string };
  byType: { costTypeId: string; name: string; amount: string; share: number; count: number }[];
  byProduct: { productId: string; name: string; amount: string }[];
}

export const costsOverview = defineService({
  name: "costs.overview",
  description: "Custos do período por tipo e lucro real: faturamento menos custo dos produtos menos os custos lançados",
  permission: "costs.view",
  risk: 1,
  input: z.object({ period: z.enum(["7d", "30d", "month", "last_month", "90d"]).default("month") }),
  async handler({ tx }, input) {
    const r = await periodRange(tx, input.period);
    const totals = async (from: string, to: string) => {
      const { rows } = await tx.query<{ revenue: string; productCost: string; costs: string }>(
        `SELECT
           (SELECT coalesce(sum(total), 0) FROM controle_vendas_estoque.sales
             WHERE status = 'completed' AND sold_at >= ($1::date)::timestamp AT TIME ZONE $3 AND sold_at < ($2::date)::timestamp AT TIME ZONE $3)::text AS revenue,
           (SELECT coalesce(sum(cost_total), 0) FROM controle_vendas_estoque.sales
             WHERE status = 'completed' AND sold_at >= ($1::date)::timestamp AT TIME ZONE $3 AND sold_at < ($2::date)::timestamp AT TIME ZONE $3)::text AS "productCost",
           (SELECT coalesce(sum(amount), 0) FROM controle_vendas_estoque.costs
             WHERE status = 'active' AND incurred_on >= $1::date AND incurred_on < $2::date)::text AS costs`,
        [from, to, r.tz],
      );
      return rows[0]!;
    };
    const cur = await totals(r.from, r.to);
    const prev = await totals(r.prevFrom, r.from);
    const money = (n: number) => n.toFixed(2);
    const gross = Number(cur.revenue) - Number(cur.productCost);
    const real = gross - Number(cur.costs);
    const byType = await tx.query<{ costTypeId: string; name: string; amount: string; count: number }>(
      `SELECT t.id AS "costTypeId", t.name, sum(c.amount)::text AS amount, count(*)::int AS count
         FROM controle_vendas_estoque.costs c JOIN controle_vendas_estoque.cost_types t ON t.id = c.cost_type_id
        WHERE c.status = 'active' AND c.incurred_on >= $1::date AND c.incurred_on < $2::date
        GROUP BY t.id, t.name ORDER BY sum(c.amount) DESC`,
      [r.from, r.to],
    );
    const byProduct = await tx.query<{ productId: string; name: string; amount: string }>(
      `SELECT p.id AS "productId", p.name, sum(c.amount)::text AS amount
         FROM controle_vendas_estoque.costs c JOIN controle_vendas_estoque.products p ON p.id = c.product_id
        WHERE c.status = 'active' AND c.incurred_on >= $1::date AND c.incurred_on < $2::date
        GROUP BY p.id, p.name ORDER BY sum(c.amount) DESC LIMIT 8`,
      [r.from, r.to],
    );
    const total = Number(cur.costs);
    return {
      period: input.period,
      from: r.from,
      to: r.to,
      revenue: cur.revenue,
      productCost: cur.productCost,
      costs: cur.costs,
      grossProfit: money(gross),
      realProfit: money(real),
      realMargin: Number(cur.revenue) > 0 ? ((real / Number(cur.revenue)) * 100).toFixed(1) : null,
      previous: { costs: prev.costs, realProfit: money(Number(prev.revenue) - Number(prev.productCost) - Number(prev.costs)) },
      byType: byType.rows.map((t) => ({ ...t, share: total > 0 ? Number(t.amount) / total : 0 })),
      byProduct: byProduct.rows,
    } satisfies CostsOverview;
  },
});

// Custo de obtenção --------------------------------------------------------------

export interface CostPart {
  id: string;
  productId: string;
  costTypeId: string;
  costTypeName: string;
  amount: string;
  validFrom: string;
  notes: string | null;
  userName: string;
  current: boolean;
}

export interface ObtainingCost {
  productId: string;
  productName: string;
  unitCode: string;
  costPrice: string;
  salePrice: string;
  total: string;
  parts: CostPart[];
}

const PART_COLUMNS = `pc.id, pc.product_id AS "productId", pc.cost_type_id AS "costTypeId", t.name AS "costTypeName",
  pc.amount::text AS amount, pc.valid_from::text AS "validFrom", pc.notes, u.name AS "userName",
  pc.id = (SELECT x.id FROM controle_vendas_estoque.product_cost_parts x
            WHERE x.product_id = pc.product_id AND x.cost_type_id = pc.cost_type_id AND x.valid_from <= $2::date
            ORDER BY x.valid_from DESC, x.created_at DESC LIMIT 1) AS current`;
const PART_FROM = `controle_vendas_estoque.product_cost_parts pc
  JOIN controle_vendas_estoque.cost_types t ON t.id = pc.cost_type_id
  JOIN controle_vendas_estoque.users u ON u.id = pc.created_by`;

// Soma das partes vigentes de um produto.
async function currentPartsTotal(tx: Tx, productId: string, today: string): Promise<string | null> {
  const { rows } = await tx.query<{ total: string | null }>(
    `SELECT sum(amount)::text AS total FROM (
       SELECT DISTINCT ON (cost_type_id) amount FROM controle_vendas_estoque.product_cost_parts
        WHERE product_id = $1 AND valid_from <= $2::date ORDER BY cost_type_id, valid_from DESC, created_at DESC) x`,
    [productId, today],
  );
  return rows[0]?.total ?? null;
}

export const listObtainingCosts = defineService({
  name: "costs.obtaining.list",
  description: "Custo de obtenção de cada produto: as partes vigentes (ex.: mão de obra, transporte) e o histórico de mudanças",
  permission: "costs.view",
  risk: 1,
  input: z.object({ productId: z.string().uuid().optional() }),
  async handler({ tx }, input) {
    const today = await orgToday(tx);
    const parts = await tx.query<CostPart>(
      `SELECT ${PART_COLUMNS} FROM ${PART_FROM} WHERE ($1::uuid IS NULL OR pc.product_id = $1)
        ORDER BY t.name, pc.valid_from DESC, pc.created_at DESC`,
      [input.productId ?? null, today],
    );
    // Produtos ativos (com ou sem partes) e os inativos que já têm partes.
    const ids = [...new Set(parts.rows.map((p) => p.productId))];
    const products = await tx.query<{ id: string; name: string; unitCode: string; costPrice: string; salePrice: string }>(
      `SELECT p.id, p.name, u.code AS "unitCode", p.cost_price::text AS "costPrice", p.sale_price::text AS "salePrice"
         FROM controle_vendas_estoque.products p JOIN controle_vendas_estoque.units u ON u.id = p.unit_id
        WHERE ($2::uuid IS NULL OR p.id = $2) AND (p.status = 'active' OR p.id = ANY($1::uuid[])) ORDER BY lower(p.name)`,
      [ids, input.productId ?? null],
    );
    return products.rows.map((p): ObtainingCost => {
      const mine = parts.rows.filter((x) => x.productId === p.id);
      const total = mine.filter((x) => x.current).reduce((a, x) => a + Number(x.amount), 0);
      return { productId: p.id, productName: p.name, unitCode: p.unitCode, costPrice: p.costPrice, salePrice: p.salePrice, total: total.toFixed(4), parts: mine };
    });
  },
});

export const setCostPart = defineService({
  name: "costs.obtaining.set",
  description: "Muda uma parte do custo de obtenção de um produto a partir de uma data (ex.: apanhador agora custa R$ 12 por lata). Guarda o histórico e atualiza o custo do produto.",
  permission: "costs.manage",
  risk: 3,
  input: z.object({
    productId: z.string().uuid("Escolha o produto."),
    costTypeId: z.string().uuid("Escolha o tipo de custo."),
    amount: decimalField(4, "Valor por unidade"),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.").optional(),
    notes: optionalText(300),
  }),
  async handler({ tx, actor, audit, emit }, input) {
    const today = await orgToday(tx);
    const validFrom = input.validFrom ?? today;
    if (validFrom > today) throw new AppError("invalid_input", "A data de início não pode ser no futuro. Lance no dia em que o valor mudar.");
    const product = await tx.query<{ name: string; cost: string; price: string }>(
      "SELECT name, cost_price::text AS cost, sale_price::text AS price FROM controle_vendas_estoque.products WHERE id = $1 FOR UPDATE",
      [input.productId],
    );
    if (!product.rows[0]) throw notFound("Produto");
    const type = await tx.query<{ name: string }>("SELECT name FROM controle_vendas_estoque.cost_types WHERE id = $1 AND status = 'active'", [input.costTypeId]);
    if (!type.rows[0]) throw new AppError("invalid_input", "Tipo de custo não encontrado ou inativo.");
    await tx.query(
      `INSERT INTO controle_vendas_estoque.product_cost_parts (organization_id, product_id, cost_type_id, amount, valid_from, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, product_id, cost_type_id, valid_from) DO UPDATE SET amount = EXCLUDED.amount, notes = EXCLUDED.notes`,
      [actor.organizationId, input.productId, input.costTypeId, input.amount, validFrom, input.notes ?? null, actor.userId],
    );
    // O custo do produto passa a ser a soma das partes vigentes. Vendas antigas
    // guardaram o custo do dia em que foram feitas.
    const total = (await currentPartsTotal(tx, input.productId, today))!;
    await tx.query("UPDATE controle_vendas_estoque.products SET cost_price = $2 WHERE id = $1", [input.productId, total]);
    await audit({
      action: "product.cost_part",
      entityType: "product",
      entityId: input.productId,
      summary: `${type.rows[0].name} de ${product.rows[0].name}: R$ ${input.amount} por unidade desde ${validFrom}; custo ${product.rows[0].cost} → ${total}`,
      before: { costPrice: product.rows[0].cost },
      after: { costPrice: total, part: { costTypeId: input.costTypeId, amount: input.amount, validFrom } },
    });
    if (Number(total) !== Number(product.rows[0].cost)) {
      await emit("product.price_changed", {
        productId: input.productId, salePrice: product.rows[0].price, costPrice: total,
        previousSalePrice: product.rows[0].price, previousCostPrice: product.rows[0].cost,
      }, { type: "product", id: input.productId });
    }
    return { productId: input.productId, costPrice: total };
  },
});
