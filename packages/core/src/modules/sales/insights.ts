import type { Tx } from "@erp/db";
import { z } from "zod";
import type { Actor } from "../../context.ts";
import { AppError } from "../../errors.ts";
import { defineService } from "../../service.ts";

// Painel (aba Painel do menu): consultas de leitura sobre as vendas que já
// existem, sem tabela nova. Cada sub-aba tem um serviço, e a Netz usa os mesmos
// (dashboard_overview, dashboard_sales_panel...) para responder no Telegram.

export const INSIGHT_PERIODS = ["today", "7d", "30d", "month", "last_month", "year", "custom"] as const;
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");

export const insightFilters = z.object({
  period: z.enum(INSIGHT_PERIODS).default("30d").describe("today, 7d, 30d, month (este mês), last_month, year (este ano) ou custom (com from e to)"),
  from: DATE.optional().describe("Primeiro dia, só com period=custom"),
  to: DATE.optional().describe("Último dia (incluído), só com period=custom"),
  branchId: z.string().uuid().optional().describe("Só as vendas desta filial"),
  sellerId: z.string().uuid().optional().describe("Só as vendas registradas por esta pessoa"),
  group: z.enum(["day", "week", "month"]).optional().describe("Agrupar a evolução por dia, semana ou mês; sem isso escolhe sozinho pelo tamanho do período"),
});
export type InsightFilters = z.infer<typeof insightFilters>;

export interface InsightRange {
  /** Dias no fuso da empresa: [from, to] incluídos. */
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  days: number;
  tz: string;
}

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const addMonths = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

/** Período pedido → dias de início e fim, e o período anterior de mesmo tamanho para comparar. */
export function resolveRange(today: string, f: Pick<InsightFilters, "period" | "from" | "to">, tz = "America/Sao_Paulo"): InsightRange {
  let from: string;
  let to = today;
  let prevFrom: string;
  let prevTo: string;
  switch (f.period) {
    case "today":
      from = today;
      break;
    case "7d":
      from = addDays(today, -6);
      break;
    case "30d":
      from = addDays(today, -29);
      break;
    case "month":
      from = `${today.slice(0, 8)}01`;
      break;
    case "last_month":
      from = addMonths(`${today.slice(0, 8)}01`, -1);
      to = addDays(`${today.slice(0, 8)}01`, -1);
      break;
    case "year":
      from = `${today.slice(0, 4)}-01-01`;
      break;
    case "custom": {
      if (!f.from || !f.to) throw new AppError("invalid_input", "Escolha o primeiro e o último dia.");
      [from, to] = f.from <= f.to ? [f.from, f.to] : [f.to, f.from];
      if (daysBetween(from, to) > 3 * 366) throw new AppError("invalid_input", "Escolha no máximo 3 anos.");
      break;
    }
  }
  // Mês e ano comparam com os mesmos dias do mês/ano anterior (1 a 15/11 x 1 a 15/10).
  if (f.period === "month" || f.period === "last_month") {
    prevFrom = addMonths(from, -1);
    prevTo = f.period === "last_month" ? addDays(from, -1) : addMonths(to, -1);
  } else if (f.period === "year") {
    prevFrom = addMonths(from, -12);
    prevTo = addMonths(to, -12);
  } else {
    const n = daysBetween(from, to);
    prevTo = addDays(from, -1);
    prevFrom = addDays(prevTo, -(n - 1));
  }
  return { from, to, prevFrom, prevTo, days: daysBetween(from, to), tz };
}

async function rangeFor(tx: Tx, f: InsightFilters): Promise<InsightRange> {
  const { rows } = await tx.query<{ today: string; tz: string }>(
    `SELECT to_char((now() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS today, timezone AS tz
       FROM controle_vendas_estoque.organizations WHERE id = controle_vendas_estoque.current_org()`,
  );
  return resolveRange(rows[0]!.today, f, rows[0]!.tz);
}

// Vendas do recorte (filial, vendedor e filiais que a pessoa pode ver), entre
// dois dias do fuso da empresa. $1..$6 ficam reservados para isso.
const SCOPE = `
  SELECT s.* FROM controle_vendas_estoque.sales s
   WHERE s.sold_at >= ($1::date::timestamp AT TIME ZONE $3)
     AND s.sold_at < (($2::date + 1)::timestamp AT TIME ZONE $3)
     AND ($4::uuid IS NULL OR s.branch_id = $4)
     AND ($5::uuid IS NULL OR s.created_by = $5)
     AND ($6::uuid[] IS NULL OR s.branch_id IS NULL OR s.branch_id = ANY($6))`;

const scopeParams = (from: string, to: string, r: InsightRange, f: InsightFilters, actor: Actor) =>
  [from, to, r.tz, f.branchId ?? null, f.sellerId ?? null, actor.branchIds] as unknown[];

// Mesmo recorte, mas sem data: para "desde sempre" (cliente sumido, última compra).
const SCOPE_ALL = `
  SELECT s.* FROM controle_vendas_estoque.sales s
   WHERE ($1::uuid IS NULL OR s.branch_id = $1)
     AND ($2::uuid IS NULL OR s.created_by = $2)
     AND ($3::uuid[] IS NULL OR s.branch_id IS NULL OR s.branch_id = ANY($3))`;
const allParams = (f: InsightFilters, actor: Actor) => [f.branchId ?? null, f.sellerId ?? null, actor.branchIds] as unknown[];

export interface InsightTotals {
  revenue: string;
  count: number;
  ticket: string;
  profit: string;
  margin: string | null;
  otherCosts: string;
  realProfit: string;
  items: string;
  discount: string;
  received: string;
  customers: number;
}

async function totals(tx: Tx, actor: Actor, r: InsightRange, f: InsightFilters, from: string, to: string): Promise<InsightTotals> {
  const { rows } = await tx.query<{ revenue: string; count: number; cost: string; items: string; discount: string; received: string; customers: number; other: string }>(
    `WITH f AS (${SCOPE}), ok AS (SELECT * FROM f WHERE status = 'completed')
     SELECT coalesce((SELECT sum(total) FROM ok), 0)::text AS revenue,
            (SELECT count(*) FROM ok)::int AS count,
            coalesce((SELECT sum(cost_total) FROM ok), 0)::text AS cost,
            coalesce((SELECT sum(discount) FROM ok), 0)::text AS discount,
            (SELECT count(DISTINCT customer_id) FROM ok)::int AS customers,
            coalesce((SELECT sum(i.quantity) FROM controle_vendas_estoque.sale_items i JOIN ok ON ok.id = i.sale_id), 0)::text AS items,
            -- Recebido: pagamentos lançados nesses dias, de vendas de qualquer data.
            coalesce((SELECT sum(p.amount) FROM controle_vendas_estoque.sale_payments p
                        JOIN controle_vendas_estoque.sales s ON s.id = p.sale_id AND s.status = 'completed'
                       WHERE p.paid_at >= ($1::date::timestamp AT TIME ZONE $3) AND p.paid_at < (($2::date + 1)::timestamp AT TIME ZONE $3)
                         AND ($4::uuid IS NULL OR s.branch_id = $4) AND ($5::uuid IS NULL OR s.created_by = $5)
                         AND ($6::uuid[] IS NULL OR s.branch_id IS NULL OR s.branch_id = ANY($6))), 0)::text AS received,
            -- Outros custos são da empresa toda (não têm filial nem vendedor).
            coalesce((SELECT sum(k.amount) FROM controle_vendas_estoque.costs k
                       WHERE k.status = 'active' AND k.incurred_on BETWEEN $1::date AND $2::date
                         AND $4::uuid IS NULL AND $5::uuid IS NULL), 0)::text AS other`,
    scopeParams(from, to, r, f, actor),
  );
  const x = rows[0]!;
  const revenue = Number(x.revenue);
  const profit = revenue - Number(x.cost);
  const real = profit - Number(x.other);
  return {
    revenue: revenue.toFixed(2),
    count: x.count,
    ticket: x.count ? (revenue / x.count).toFixed(2) : "0.00",
    profit: profit.toFixed(2),
    margin: revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : null,
    otherCosts: Number(x.other).toFixed(2),
    realProfit: real.toFixed(2),
    items: x.items,
    discount: Number(x.discount).toFixed(2),
    received: Number(x.received).toFixed(2),
    customers: x.customers,
  };
}

export type SeriesStep = "hour" | "day" | "week" | "month";
export interface SeriesPoint {
  key: string;
  label: string;
  revenue: string;
  profit: string;
  count: number;
}

/** Faturamento e lucro ao longo do período: o agrupamento escolhido ou, sem escolha, por hora (1 dia), dia (até 62), semana (até 182) ou mês. */
async function series(tx: Tx, actor: Actor, r: InsightRange, f: InsightFilters, from: string, to: string): Promise<{ step: SeriesStep; points: SeriesPoint[] }> {
  const days = daysBetween(from, to);
  const step: SeriesStep = f.group ?? (days === 1 ? "hour" : days <= 62 ? "day" : days <= 182 ? "week" : "month");
  const params = scopeParams(from, to, r, f, actor);
  const sql =
    step === "hour"
      ? `WITH f AS (${SCOPE})
         SELECT lpad(h::text, 2, '0') AS key, lpad(h::text, 2, '0') || 'h' AS label,
                coalesce(sum(f.total), 0)::text AS revenue, coalesce(sum(f.total - f.cost_total), 0)::text AS profit, count(f.id)::int AS count
           FROM generate_series(0, 23) h
           LEFT JOIN f ON f.status = 'completed' AND extract(hour FROM f.sold_at AT TIME ZONE $3)::int = h
          GROUP BY h ORDER BY h`
      : `WITH f AS (${SCOPE}),
              b AS (SELECT generate_series(date_trunc($7, $1::date::timestamp), $2::date::timestamp, ('1 ' || $7)::interval)::date AS d)
         SELECT to_char(b.d, 'YYYY-MM-DD') AS key,
                CASE $7 WHEN 'month' THEN to_char(b.d, 'MM/YY') ELSE to_char(b.d, 'DD/MM') END AS label,
                coalesce(sum(f.total), 0)::text AS revenue, coalesce(sum(f.total - f.cost_total), 0)::text AS profit, count(f.id)::int AS count
           FROM b
           LEFT JOIN f ON f.status = 'completed' AND date_trunc($7, (f.sold_at AT TIME ZONE $3))::date = b.d
          GROUP BY b.d ORDER BY b.d`;
  const { rows } = await tx.query<SeriesPoint>(sql, step === "hour" ? params : [...params, step]);
  return { step, points: rows };
}

// Visão geral ------------------------------------------------------------------

export interface DashboardOverview {
  range: InsightRange;
  current: InsightTotals;
  previous: InsightTotals;
  step: SeriesStep;
  series: SeriesPoint[];
  /** Mesmo número de pontos do período anterior, para a linha de comparação. */
  previousSeries: SeriesPoint[];
  /** Tudo o que falta receber hoje, de vendas de qualquer data. */
  receivable: { amount: string; count: number };
  /** Quem registrou vendas no período (para o filtro de vendedor). */
  sellers: { id: string; name: string }[];
}

export const dashboardOverview = defineService({
  name: "dashboard.overview",
  description:
    "Painel › Visão geral: faturamento, lucro bruto e real, vendas, ticket médio, recebido, falta receber e a evolução no período, comparando com o período anterior. Aceita período (hoje, 7d, 30d, este mês, mês passado, este ano ou datas), filial e vendedor.",
  permission: "sales.view",
  risk: 1,
  input: insightFilters,
  async handler({ tx, actor }, input): Promise<DashboardOverview> {
    const r = await rangeFor(tx, input);
    const [current, previous, now, before] = [
      await totals(tx, actor, r, input, r.from, r.to),
      await totals(tx, actor, r, input, r.prevFrom, r.prevTo),
      await series(tx, actor, r, input, r.from, r.to),
      await series(tx, actor, r, input, r.prevFrom, r.prevTo),
    ];
    const open = await tx.query<{ amount: string; count: number }>(
      `WITH f AS (${SCOPE_ALL})
       SELECT coalesce(sum(total - trade_in_total - paid_total), 0)::text AS amount, count(*)::int AS count
         FROM f WHERE status = 'completed' AND payment_status <> 'paid'`,
      allParams(input, actor),
    );
    const sellers = await tx.query<{ id: string; name: string }>(
      `WITH f AS (${SCOPE})
       SELECT DISTINCT u.id, u.name FROM f JOIN controle_vendas_estoque.users u ON u.id = f.created_by ORDER BY u.name`,
      scopeParams(r.prevFrom, r.to, r, { ...input, sellerId: undefined }, actor),
    );
    return {
      range: r,
      current,
      previous,
      step: now.step,
      series: now.points,
      previousSeries: before.points.slice(0, now.points.length),
      receivable: open.rows[0]!,
      sellers: sellers.rows,
    };
  },
});

// Vendas -------------------------------------------------------------------------

export interface DashboardSales {
  range: InsightRange;
  step: SeriesStep;
  series: SeriesPoint[];
  /** Dia da semana (0 = domingo) × hora, no fuso da empresa. */
  heatmap: { weekday: number; hour: number; revenue: string; count: number }[];
  weekdays: { weekday: number; revenue: string; count: number; days: number; average: string }[];
  bestDays: { day: string; revenue: string; count: number }[];
  branches: { id: string | null; name: string; revenue: string; count: number }[];
  sellers: { id: string; name: string; revenue: string; count: number; ticket: string }[];
  fulfillment: { pickup: { count: number; revenue: string }; delivery: { count: number; revenue: string } };
  discounts: { amount: string; count: number; share: string | null };
  cancellations: { count: number; amount: string; reasons: { reason: string; count: number }[] };
}

export const dashboardSalesPanel = defineService({
  name: "dashboard.sales.panel",
  description:
    "Painel › Vendas: melhores dias da semana e horários (dia × hora), melhores dias do período, vendas por filial e por vendedor, retirada x entrega, descontos dados e cancelamentos com o motivo.",
  permission: "sales.view",
  risk: 1,
  input: insightFilters,
  async handler({ tx, actor }, input): Promise<DashboardSales> {
    const r = await rangeFor(tx, input);
    const p = scopeParams(r.from, r.to, r, input, actor);
    const s = await series(tx, actor, r, input, r.from, r.to);
    const heat = await tx.query<DashboardSales["heatmap"][number]>(
      `WITH f AS (${SCOPE})
       SELECT extract(dow FROM sold_at AT TIME ZONE $3)::int AS weekday, extract(hour FROM sold_at AT TIME ZONE $3)::int AS hour,
              sum(total)::text AS revenue, count(*)::int AS count
         FROM f WHERE status = 'completed' GROUP BY 1, 2 ORDER BY 1, 2`,
      p,
    );
    // Média por dia da semana: divide pelo número de vezes que aquele dia apareceu no período.
    const weekdays = await tx.query<DashboardSales["weekdays"][number]>(
      `WITH f AS (${SCOPE}),
            d AS (SELECT extract(dow FROM g)::int AS weekday, count(*)::int AS days
                    FROM generate_series($1::date, $2::date, interval '1 day') g GROUP BY 1)
       SELECT d.weekday, coalesce(sum(f.total), 0)::text AS revenue, count(f.id)::int AS count, d.days,
              round(coalesce(sum(f.total), 0) / d.days, 2)::text AS average
         FROM d LEFT JOIN f ON f.status = 'completed' AND extract(dow FROM f.sold_at AT TIME ZONE $3)::int = d.weekday
        GROUP BY d.weekday, d.days ORDER BY d.weekday`,
      p,
    );
    const best = await tx.query<DashboardSales["bestDays"][number]>(
      `WITH f AS (${SCOPE})
       SELECT to_char((sold_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day, sum(total)::text AS revenue, count(*)::int AS count
         FROM f WHERE status = 'completed' GROUP BY 1 ORDER BY sum(total) DESC LIMIT 7`,
      p,
    );
    const branches = await tx.query<DashboardSales["branches"][number]>(
      `WITH f AS (${SCOPE})
       SELECT b.id, coalesce(b.name, 'Sem filial') AS name, sum(f.total)::text AS revenue, count(*)::int AS count
         FROM f LEFT JOIN controle_vendas_estoque.branches b ON b.id = f.branch_id
        WHERE f.status = 'completed' GROUP BY b.id, b.name ORDER BY sum(f.total) DESC`,
      p,
    );
    const sellers = await tx.query<DashboardSales["sellers"][number]>(
      `WITH f AS (${SCOPE})
       SELECT u.id, u.name, sum(f.total)::text AS revenue, count(*)::int AS count, round(sum(f.total) / count(*), 2)::text AS ticket
         FROM f JOIN controle_vendas_estoque.users u ON u.id = f.created_by
        WHERE f.status = 'completed' GROUP BY u.id, u.name ORDER BY sum(f.total) DESC`,
      p,
    );
    const ways = await tx.query<{ fulfillment: "pickup" | "delivery"; count: number; revenue: string }>(
      `WITH f AS (${SCOPE})
       SELECT fulfillment, count(*)::int AS count, sum(total)::text AS revenue FROM f WHERE status = 'completed' GROUP BY 1`,
      p,
    );
    const way = (k: "pickup" | "delivery") => {
      const w = ways.rows.find((x) => x.fulfillment === k);
      return { count: w?.count ?? 0, revenue: w?.revenue ?? "0" };
    };
    const disc = await tx.query<{ amount: string; count: number; gross: string }>(
      `WITH f AS (${SCOPE})
       SELECT coalesce(sum(discount), 0)::text AS amount, count(*) FILTER (WHERE discount > 0)::int AS count,
              coalesce(sum(subtotal), 0)::text AS gross
         FROM f WHERE status = 'completed'`,
      p,
    );
    const cancel = await tx.query<{ count: number; amount: string }>(
      `WITH f AS (${SCOPE}) SELECT count(*)::int AS count, coalesce(sum(total), 0)::text AS amount FROM f WHERE status = 'cancelled'`,
      p,
    );
    const reasons = await tx.query<{ reason: string; count: number }>(
      `WITH f AS (${SCOPE})
       SELECT coalesce(nullif(btrim(cancel_reason), ''), 'Sem motivo') AS reason, count(*)::int AS count
         FROM f WHERE status = 'cancelled' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`,
      p,
    );
    const d = disc.rows[0]!;
    return {
      range: r,
      step: s.step,
      series: s.points,
      heatmap: heat.rows,
      weekdays: weekdays.rows,
      bestDays: best.rows,
      branches: branches.rows,
      sellers: sellers.rows,
      fulfillment: { pickup: way("pickup"), delivery: way("delivery") },
      discounts: { amount: d.amount, count: d.count, share: Number(d.gross) > 0 ? ((Number(d.amount) / Number(d.gross)) * 100).toFixed(1) : null },
      cancellations: { ...cancel.rows[0]!, reasons: reasons.rows },
    };
  },
});

// Produtos -----------------------------------------------------------------------

export interface ProductInsight {
  productId: string;
  name: string;
  unitCode: string;
  category: string | null;
  quantity: string;
  revenue: string;
  profit: string;
  margin: string | null;
  share: number;
  /** Curva ABC: A = os que somam os primeiros 80% do faturamento, B = até 95%, C = o resto. */
  abc: "A" | "B" | "C";
}

export interface DashboardProducts {
  range: InsightRange;
  products: ProductInsight[];
  categories: { name: string; revenue: string; profit: string; quantity: string; share: number }[];
  abc: Record<"A" | "B" | "C", { products: number; revenue: string; share: number }>;
  /** Com estoque e sem venda há 30 dias ou mais (ou nunca vendidos). */
  stalled: { productId: string; name: string; unitCode: string; stockQty: string; value: string; lastSale: string | null }[];
  stock: { value: string; products: number; stalledValue: string };
}

export const dashboardProductsPanel = defineService({
  name: "dashboard.products.panel",
  description:
    "Painel › Produtos: mais vendidos em dinheiro e em quantidade, mais lucrativos, vendas por categoria, curva ABC, produtos parados (com estoque e sem venda há 30 dias) e dinheiro parado no estoque.",
  permission: "sales.view",
  risk: 1,
  input: insightFilters,
  async handler({ tx, actor }, input): Promise<DashboardProducts> {
    const r = await rangeFor(tx, input);
    const p = scopeParams(r.from, r.to, r, input, actor);
    const { rows } = await tx.query<Omit<ProductInsight, "share" | "abc" | "margin">>(
      `WITH f AS (${SCOPE})
       SELECT pr.id AS "productId", pr.name, u.code AS "unitCode", c.name AS category,
              sum(i.quantity)::text AS quantity, sum(i.total)::text AS revenue,
              round(sum(i.total - i.quantity * i.unit_cost), 2)::text AS profit
         FROM controle_vendas_estoque.sale_items i
         JOIN f ON f.id = i.sale_id AND f.status = 'completed'
         JOIN controle_vendas_estoque.products pr ON pr.id = i.product_id
         JOIN controle_vendas_estoque.units u ON u.id = pr.unit_id
         LEFT JOIN controle_vendas_estoque.categories c ON c.id = pr.category_id
        GROUP BY pr.id, pr.name, u.code, c.name
        ORDER BY sum(i.total) DESC, pr.name`,
      p,
    );
    const total = rows.reduce((s, x) => s + Number(x.revenue), 0);
    let running = 0;
    const products: ProductInsight[] = rows.map((x) => {
      const rev = Number(x.revenue);
      // A classe vem de onde o produto começa na soma: o primeiro sempre é A.
      const before = total > 0 ? running / total : 0;
      running += rev;
      return {
        ...x,
        margin: rev > 0 ? ((Number(x.profit) / rev) * 100).toFixed(1) : null,
        share: total > 0 ? Math.round((rev / total) * 1000) / 10 : 0,
        abc: before < 0.8 ? "A" : before < 0.95 ? "B" : "C",
      };
    });
    const abc = { A: { products: 0, revenue: 0 }, B: { products: 0, revenue: 0 }, C: { products: 0, revenue: 0 } };
    for (const x of products) {
      abc[x.abc].products++;
      abc[x.abc].revenue += Number(x.revenue);
    }
    const cats = new Map<string, { revenue: number; profit: number; quantity: number }>();
    for (const x of products) {
      const k = x.category ?? "Sem categoria";
      const c = cats.get(k) ?? { revenue: 0, profit: 0, quantity: 0 };
      c.revenue += Number(x.revenue);
      c.profit += Number(x.profit);
      c.quantity += Number(x.quantity);
      cats.set(k, c);
    }
    const stalled = await tx.query<DashboardProducts["stalled"][number]>(
      `WITH f AS (${SCOPE_ALL}),
            last AS (SELECT i.product_id, max(f.sold_at) AS at FROM controle_vendas_estoque.sale_items i
                       JOIN f ON f.id = i.sale_id AND f.status = 'completed' GROUP BY 1)
       SELECT pr.id AS "productId", pr.name, u.code AS "unitCode", pr.stock_qty::text AS "stockQty",
              round(pr.stock_qty * pr.cost_price, 2)::text AS value,
              to_char((last.at AT TIME ZONE o.timezone)::date, 'YYYY-MM-DD') AS "lastSale"
         FROM controle_vendas_estoque.products pr
         JOIN controle_vendas_estoque.units u ON u.id = pr.unit_id
         JOIN controle_vendas_estoque.organizations o ON o.id = pr.organization_id
         LEFT JOIN last ON last.product_id = pr.id
        WHERE pr.status = 'active' AND pr.track_stock AND pr.stock_qty > 0
          AND (last.at IS NULL OR last.at < now() - interval '30 days')
        ORDER BY pr.stock_qty * pr.cost_price DESC, pr.name LIMIT 50`,
      allParams(input, actor),
    );
    const stock = await tx.query<{ value: string; products: number }>(
      `SELECT coalesce(round(sum(stock_qty * cost_price), 2), 0)::text AS value, count(*)::int AS products
         FROM controle_vendas_estoque.products WHERE status = 'active' AND track_stock AND stock_qty > 0`,
    );
    const pct = (v: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);
    return {
      range: r,
      products,
      categories: [...cats.entries()]
        .map(([name, c]) => ({ name, revenue: c.revenue.toFixed(2), profit: c.profit.toFixed(2), quantity: String(c.quantity), share: pct(c.revenue) }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue)),
      abc: {
        A: { products: abc.A.products, revenue: abc.A.revenue.toFixed(2), share: pct(abc.A.revenue) },
        B: { products: abc.B.products, revenue: abc.B.revenue.toFixed(2), share: pct(abc.B.revenue) },
        C: { products: abc.C.products, revenue: abc.C.revenue.toFixed(2), share: pct(abc.C.revenue) },
      },
      stalled: stalled.rows,
      stock: {
        value: stock.rows[0]!.value,
        products: stock.rows[0]!.products,
        stalledValue: stalled.rows.reduce((s, x) => s + Number(x.value), 0).toFixed(2),
      },
    };
  },
});

// Clientes -----------------------------------------------------------------------

export interface DashboardCustomers {
  range: InsightRange;
  /** Clientes que compraram no período: primeira compra nele (novos) ou já tinham comprado antes. */
  buyers: { total: number; new: number; returning: number; newRevenue: string; returningRevenue: string };
  /** Vendas sem cliente (consumidor). */
  anonymous: { count: number; revenue: string };
  top: { customerId: string; name: string; phone: string | null; revenue: string; count: number; lastPurchase: string }[];
  /** Compravam com frequência e pararam: 2+ compras e a última há mais de 45 dias (até 1 ano). */
  gone: { customerId: string; name: string; phone: string | null; revenue: string; count: number; lastPurchase: string; daysAway: number }[];
  /** Média de dias entre uma compra e a próxima, de quem comprou 2+ vezes. */
  returnDays: string | null;
  cities: { city: string; revenue: string; customers: number }[];
}

export const dashboardCustomersPanel = defineService({
  name: "dashboard.customers.panel",
  description:
    "Painel › Clientes: clientes novos x que voltaram, melhores clientes do período, clientes sumidos (compravam e pararam há mais de 45 dias, com telefone), de quanto em quanto tempo o cliente volta e vendas por cidade.",
  permission: "sales.view",
  risk: 1,
  input: insightFilters,
  async handler({ tx, actor }, input): Promise<DashboardCustomers> {
    const r = await rangeFor(tx, input);
    const p = scopeParams(r.from, r.to, r, input, actor);
    const buyers = await tx.query<{ total: number; new: number; returning: number; newRevenue: string; returningRevenue: string }>(
      `WITH f AS (${SCOPE}),
            c AS (SELECT customer_id, sum(total) AS revenue FROM f WHERE status = 'completed' AND customer_id IS NOT NULL GROUP BY 1),
            first AS (SELECT s.customer_id, min(s.sold_at) AS at FROM controle_vendas_estoque.sales s
                       WHERE s.status = 'completed' AND s.customer_id IN (SELECT customer_id FROM c) GROUP BY 1),
            k AS (SELECT c.revenue, first.at >= ($1::date::timestamp AT TIME ZONE $3) AS is_new FROM c JOIN first USING (customer_id))
       SELECT count(*)::int AS total, count(*) FILTER (WHERE is_new)::int AS new, count(*) FILTER (WHERE NOT is_new)::int AS returning,
              coalesce(sum(revenue) FILTER (WHERE is_new), 0)::text AS "newRevenue",
              coalesce(sum(revenue) FILTER (WHERE NOT is_new), 0)::text AS "returningRevenue"
         FROM k`,
      p,
    );
    const anonymous = await tx.query<{ count: number; revenue: string }>(
      `WITH f AS (${SCOPE}) SELECT count(*)::int AS count, coalesce(sum(total), 0)::text AS revenue
         FROM f WHERE status = 'completed' AND customer_id IS NULL`,
      p,
    );
    const top = await tx.query<DashboardCustomers["top"][number]>(
      `WITH f AS (${SCOPE})
       SELECT c.id AS "customerId", c.name, c.phone, sum(f.total)::text AS revenue, count(*)::int AS count,
              to_char((max(f.sold_at) AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS "lastPurchase"
         FROM f JOIN controle_vendas_estoque.customers c ON c.id = f.customer_id
        WHERE f.status = 'completed' GROUP BY c.id, c.name, c.phone ORDER BY sum(f.total) DESC, c.name LIMIT 10`,
      p,
    );
    const all = allParams(input, actor);
    const gone = await tx.query<DashboardCustomers["gone"][number]>(
      `WITH f AS (${SCOPE_ALL}),
            c AS (SELECT customer_id, sum(total) AS revenue, count(*) AS n, max(sold_at) AS last
                    FROM f WHERE status = 'completed' AND customer_id IS NOT NULL GROUP BY 1)
       SELECT cu.id AS "customerId", cu.name, cu.phone, c.revenue::text AS revenue, c.n::int AS count,
              to_char(c.last::date, 'YYYY-MM-DD') AS "lastPurchase", (now()::date - c.last::date)::int AS "daysAway"
         FROM c JOIN controle_vendas_estoque.customers cu ON cu.id = c.customer_id AND cu.status = 'active'
        WHERE c.n >= 2 AND c.last < now() - interval '45 days' AND c.last > now() - interval '365 days'
        ORDER BY c.revenue DESC LIMIT 10`,
      all,
    );
    const ret = await tx.query<{ days: string | null }>(
      `WITH f AS (${SCOPE_ALL}),
            g AS (SELECT customer_id, sold_at - lag(sold_at) OVER (PARTITION BY customer_id ORDER BY sold_at) AS gap
                    FROM f WHERE status = 'completed' AND customer_id IS NOT NULL)
       SELECT round(avg(extract(epoch FROM gap) / 86400))::text AS days FROM g WHERE gap IS NOT NULL`,
      all,
    );
    const cities = await tx.query<DashboardCustomers["cities"][number]>(
      `WITH f AS (${SCOPE})
       SELECT coalesce(nullif(btrim(c.city), ''), 'Sem cidade') AS city, sum(f.total)::text AS revenue, count(DISTINCT c.id)::int AS customers
         FROM f JOIN controle_vendas_estoque.customers c ON c.id = f.customer_id
        WHERE f.status = 'completed' GROUP BY 1 ORDER BY sum(f.total) DESC LIMIT 8`,
      p,
    );
    return {
      range: r,
      buyers: buyers.rows[0]!,
      anonymous: anonymous.rows[0]!,
      top: top.rows,
      gone: gone.rows,
      returnDays: ret.rows[0]?.days ?? null,
      cities: cities.rows,
    };
  },
});
