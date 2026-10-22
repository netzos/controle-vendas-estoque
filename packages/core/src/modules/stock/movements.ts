import { z } from "zod";
import type { Tx } from "@erp/db";
import type { Actor } from "../../context.ts";
import { AppError, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";
import { decimalField, optionalText } from "../catalog/fields.ts";

export type MovementKind = "in" | "out" | "adjust" | "sale" | "sale_cancel" | "trade_in";

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  in: "Entrada",
  out: "Saída",
  adjust: "Ajuste",
  sale: "Venda",
  sale_cancel: "Venda cancelada",
  trade_in: "Recebido na troca",
};

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  unitCode: string;
  kind: MovementKind;
  quantity: string;
  balanceAfter: string;
  unitCost: string | null;
  saleId: string | null;
  saleNumber: number | null;
  notes: string | null;
  userName: string;
  createdAt: Date;
}

/**
 * Lança uma movimentação e atualiza o saldo do produto na mesma transação.
 * quantity é texto com sinal: positivo entra, negativo sai. O UPDATE bloqueia a
 * linha do produto, então vendas simultâneas do mesmo item não perdem baixa.
 */
export async function applyMovement(
  tx: Tx,
  actor: Actor,
  m: { productId: string; kind: MovementKind; quantity: string; unitCost?: string | null; saleId?: string | null; notes?: string | null },
): Promise<{ balance: string }> {
  const { rows } = await tx.query<{ balance: string }>(
    `UPDATE controle_vendas_estoque.products SET stock_qty = stock_qty + $2::numeric
      WHERE id = $1 AND track_stock RETURNING stock_qty::text AS balance`,
    [m.productId, m.quantity],
  );
  if (!rows[0]) throw new AppError("invalid_input", "Este produto não controla estoque.");
  await tx.query(
    `INSERT INTO controle_vendas_estoque.stock_movements
       (organization_id, product_id, kind, quantity, balance_after, unit_cost, sale_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [actor.organizationId, m.productId, m.kind, m.quantity, rows[0].balance, m.unitCost ?? null, m.saleId ?? null, m.notes ?? null, actor.userId],
  );
  return rows[0];
}

// Custo médio ponderado após uma entrada de quantity unidades a unitCost.
// Com saldo zerado ou negativo, vale o custo da entrada.
export async function averageCost(tx: Tx, productId: string, quantity: string, unitCost: string): Promise<void> {
  await tx.query(
    `UPDATE controle_vendas_estoque.products
        SET cost_price = CASE WHEN stock_qty <= 0 THEN $2::numeric
                              ELSE round((stock_qty * cost_price + $3::numeric * $2::numeric) / (stock_qty + $3::numeric), 4) END
      WHERE id = $1`,
    [productId, unitCost, quantity],
  );
}

export const listMovements = defineService({
  name: "stock.movements",
  description: "Lista as movimentações de estoque, de todos os produtos ou de um só",
  permission: "stock.view",
  risk: 1,
  input: z.object({
    productId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<StockMovement>(
      `SELECT m.id, m.product_id AS "productId", p.name AS "productName", p.sku AS "productSku", u.code AS "unitCode",
              m.kind, m.quantity::text AS quantity, m.balance_after::text AS "balanceAfter", m.unit_cost::text AS "unitCost",
              m.sale_id AS "saleId", s.number AS "saleNumber", m.notes, us.name AS "userName", m.created_at AS "createdAt"
         FROM controle_vendas_estoque.stock_movements m
         JOIN controle_vendas_estoque.products p ON p.id = m.product_id
         JOIN controle_vendas_estoque.units u ON u.id = p.unit_id
         JOIN controle_vendas_estoque.users us ON us.id = m.created_by
         LEFT JOIN controle_vendas_estoque.sales s ON s.id = m.sale_id
        WHERE ($1::uuid IS NULL OR m.product_id = $1)
        ORDER BY m.created_at DESC, m.id DESC LIMIT $2`,
      [input.productId ?? null, input.limit],
    );
    return rows;
  },
});

export const createMovement = defineService({
  name: "stock.move",
  description:
    "Lança entrada (compra, produção), saída (perda, consumo) ou ajuste de inventário. No ajuste, quantity é o saldo contado.",
  permission: "stock.manage",
  risk: 3,
  input: z.object({
    productId: z.string().uuid("Escolha o produto."),
    kind: z.enum(["in", "out", "adjust"]),
    quantity: decimalField(3, "Quantidade"),
    unitCost: z.preprocess((v) => (v === "" ? null : v), decimalField(4, "Custo unitário").nullable().optional()),
    notes: optionalText(500),
  }),
  async handler({ tx, actor, audit, emit }, input) {
    const product = await tx.query<{ name: string; stock: string; track: boolean }>(
      "SELECT name, stock_qty::text AS stock, track_stock AS track FROM controle_vendas_estoque.products WHERE id = $1 FOR UPDATE",
      [input.productId],
    );
    const p = product.rows[0];
    if (!p) throw notFound("Produto");
    if (!p.track) throw new AppError("invalid_input", `${p.name} não controla estoque. Ative o controle no cadastro do produto.`);

    let delta: string;
    if (input.kind === "adjust") {
      const diff = await tx.query<{ d: string }>("SELECT ($1::numeric - $2::numeric)::text AS d", [input.quantity, p.stock]);
      delta = diff.rows[0]!.d;
      if (Number(delta) === 0) throw new AppError("invalid_input", `O saldo de ${p.name} já é ${p.stock}.`);
    } else {
      if (Number(input.quantity) <= 0) throw new AppError("invalid_input", "Informe uma quantidade maior que zero.");
      delta = input.kind === "in" ? input.quantity : `-${input.quantity}`;
    }

    // Entrada com custo informado atualiza o custo médio do produto.
    if (input.kind === "in" && input.unitCost != null) await averageCost(tx, input.productId, input.quantity, input.unitCost);

    const { balance } = await applyMovement(tx, actor, {
      productId: input.productId,
      kind: input.kind,
      quantity: delta,
      unitCost: input.unitCost ?? null,
      notes: input.notes ?? null,
    });
    await audit({
      action: `stock.${input.kind}`,
      entityType: "product",
      entityId: input.productId,
      summary: `${MOVEMENT_LABELS[input.kind]} de ${delta.replace(/^-/, "")} em ${p.name}: saldo ${p.stock} → ${balance}`,
      before: { stock: p.stock },
      after: { stock: balance },
    });
    await emit("stock.moved", { productId: input.productId, kind: input.kind, quantity: delta, balance }, { type: "product", id: input.productId });
    return { balance };
  },
});

// Painel do estoque ---------------------------------------------------------------

export type StockStatus = "out" | "low" | "ok" | "idle";

export interface StockRow {
  id: string;
  name: string;
  sku: string;
  unitCode: string;
  categoryName: string | null;
  stockQty: string;
  minStock: string;
  costPrice: string;
  salePrice: string;
  costValue: string;
  soldQty30: string;
  avgDaily: string;
  /** Dias até acabar no ritmo dos últimos 30 dias; null quando não vendeu. */
  coverageDays: number | null;
  lastSaleAt: Date | null;
  status: StockStatus;
}

export interface StockOverview {
  kpis: {
    products: number;
    costValue: string;
    saleValue: string;
    potentialProfit: string;
    outCount: number;
    lowCount: number;
    idleCount: number;
    /** Custo do que saiu em vendas nos últimos 30 dias ÷ valor atual em estoque. */
    turnover30: string | null;
    avgCoverageDays: number | null;
  };
  rows: StockRow[];
}

export const stockOverview = defineService({
  name: "stock.overview",
  description: "Painel do estoque: valor parado, itens zerados ou abaixo do mínimo, cobertura em dias e giro por produto",
  permission: "stock.view",
  risk: 1,
  input: z.object({}),
  async handler({ tx }) {
    const { rows } = await tx.query<Omit<StockRow, "status" | "coverageDays"> & { coverage: string | null }>(
      `WITH sold AS (
         SELECT i.product_id, sum(i.quantity) AS qty, max(s.sold_at) AS last_at
           FROM controle_vendas_estoque.sale_items i
           JOIN controle_vendas_estoque.sales s ON s.id = i.sale_id AND s.status = 'completed'
          WHERE s.sold_at >= now() - interval '30 days'
          GROUP BY i.product_id
       ), last_sale AS (
         SELECT i.product_id, max(s.sold_at) AS at
           FROM controle_vendas_estoque.sale_items i
           JOIN controle_vendas_estoque.sales s ON s.id = i.sale_id AND s.status = 'completed'
          GROUP BY i.product_id
       )
       SELECT p.id, p.name, p.sku, u.code AS "unitCode", c.name AS "categoryName",
              p.stock_qty::text AS "stockQty", p.min_stock::text AS "minStock",
              p.cost_price::text AS "costPrice", p.sale_price::text AS "salePrice",
              round(greatest(p.stock_qty, 0) * p.cost_price, 2)::text AS "costValue",
              coalesce(sold.qty, 0)::text AS "soldQty30",
              round(coalesce(sold.qty, 0) / 30.0, 3)::text AS "avgDaily",
              CASE WHEN coalesce(sold.qty, 0) > 0 THEN round(greatest(p.stock_qty, 0) / (sold.qty / 30.0), 1)::text END AS coverage,
              ls.at AS "lastSaleAt"
         FROM controle_vendas_estoque.products p
         JOIN controle_vendas_estoque.units u ON u.id = p.unit_id
         LEFT JOIN controle_vendas_estoque.categories c ON c.id = p.category_id
         LEFT JOIN sold ON sold.product_id = p.id
         LEFT JOIN last_sale ls ON ls.product_id = p.id
        WHERE p.status = 'active' AND p.track_stock
        ORDER BY lower(p.name)`,
    );

    const result: StockRow[] = rows.map(({ coverage, ...r }) => {
      const stock = Number(r.stockQty);
      const status: StockStatus =
        stock <= 0 ? "out" : Number(r.minStock) > 0 && stock <= Number(r.minStock) ? "low" : Number(r.soldQty30) === 0 ? "idle" : "ok";
      return { ...r, coverageDays: coverage == null ? null : Number(coverage), status };
    });

    const totals = await tx.query<{ cost: string; sale: string; cogs30: string }>(
      `SELECT coalesce(sum(round(greatest(stock_qty, 0) * cost_price, 2)), 0)::text AS cost,
              coalesce(sum(round(greatest(stock_qty, 0) * sale_price, 2)), 0)::text AS sale,
              (SELECT coalesce(sum(i.quantity * i.unit_cost), 0)
                 FROM controle_vendas_estoque.sale_items i
                 JOIN controle_vendas_estoque.sales s ON s.id = i.sale_id AND s.status = 'completed'
                WHERE s.sold_at >= now() - interval '30 days')::text AS cogs30
         FROM controle_vendas_estoque.products WHERE status = 'active' AND track_stock`,
    );
    const t = totals.rows[0]!;

    const covered = result.filter((r) => r.coverageDays != null);
    return {
      kpis: {
        products: result.length,
        costValue: t.cost,
        saleValue: t.sale,
        potentialProfit: (Number(t.sale) - Number(t.cost)).toFixed(2),
        outCount: result.filter((r) => r.status === "out").length,
        lowCount: result.filter((r) => r.status === "low").length,
        idleCount: result.filter((r) => r.status === "idle").length,
        turnover30: Number(t.cost) > 0 ? (Number(t.cogs30) / Number(t.cost)).toFixed(2) : null,
        avgCoverageDays: covered.length ? Math.round(covered.reduce((a, r) => a + r.coverageDays!, 0) / covered.length) : null,
      },
      rows: result,
    } satisfies StockOverview;
  },
});
