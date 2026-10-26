import { z } from "zod";
import { AppError } from "../../errors.ts";
import { defineService } from "../../service.ts";
import { decimalField, optionalText } from "../catalog/fields.ts";

// Comissões, primeira versão: taxa por vendedor sobre o valor das vendas que
// ele registrou (total da venda, já com desconto e frete). Venda cancelada não
// conta. O repasse é anotado por mês de referência.

export interface CommissionRow {
  userId: string;
  name: string;
  /** % do vendedor; null = sem taxa definida (não ganha comissão). */
  rate: string | null;
  sales: number;
  revenue: string;
  commission: string;
  paid: string;
  /** commission − paid (nunca negativo). */
  toPay: string;
}

export interface CommissionPanel {
  /** Mês de referência, AAAA-MM. */
  month: string;
  rows: CommissionRow[];
  totals: { revenue: string; commission: string; paid: string; toPay: string };
  payouts: { id: string; userName: string; amount: string; method: string | null; notes: string | null; createdAt: Date; byName: string }[];
}

const monthField = z.string().regex(/^\d{4}-\d{2}$/, "Mês no formato AAAA-MM.");

export const commissionPanel = defineService({
  name: "commissions.panel",
  description: "Comissões do mês: ranking de vendedores, quanto cada um vendeu, ganhou, já recebeu e ainda tem a receber",
  permission: "commissions.view",
  risk: 1,
  input: z.object({ month: monthField.optional() }),
  async handler({ tx, actor }, input) {
    const { rows: [range] } = await tx.query<{ month: string; start: Date; end: Date; period: string }>(
      `WITH tz AS (SELECT timezone AS tz FROM controle_vendas_estoque.organizations WHERE id = controle_vendas_estoque.current_org()),
            m AS (SELECT coalesce(to_date($1, 'YYYY-MM'), date_trunc('month', now() AT TIME ZONE tz)::date) AS d, tz FROM tz)
       SELECT to_char(d, 'YYYY-MM') AS month, d::timestamp AT TIME ZONE tz AS start,
              (d + interval '1 month')::timestamp AT TIME ZONE tz AS "end", d::text AS period FROM m`,
      [input.month ?? null],
    );
    const { rows } = await tx.query<CommissionRow>(
      `WITH people AS (
         SELECT u.id, u.name FROM controle_vendas_estoque.memberships m
           JOIN controle_vendas_estoque.users u ON u.id = m.user_id
          WHERE m.organization_id = $1 AND m.status = 'active'
       ), sold AS (
         SELECT created_by AS id, count(*)::int AS n, sum(total) AS revenue FROM controle_vendas_estoque.sales
          WHERE status = 'completed' AND sold_at >= $2 AND sold_at < $3 GROUP BY created_by
       ), paid AS (
         SELECT user_id AS id, sum(amount) AS amount FROM controle_vendas_estoque.commission_payouts WHERE period = $4::date GROUP BY user_id
       ), who AS (SELECT id FROM people UNION SELECT id FROM sold UNION SELECT id FROM paid)
       SELECT w.id AS "userId", u.name, r.rate::text AS rate, coalesce(s.n, 0) AS sales, coalesce(s.revenue, 0)::text AS revenue,
              round(coalesce(s.revenue, 0) * coalesce(r.rate, 0) / 100, 2)::text AS commission, coalesce(p.amount, 0)::text AS paid,
              greatest(round(coalesce(s.revenue, 0) * coalesce(r.rate, 0) / 100, 2) - coalesce(p.amount, 0), 0)::text AS "toPay"
         FROM who w
         JOIN controle_vendas_estoque.users u ON u.id = w.id
         LEFT JOIN sold s ON s.id = w.id
         LEFT JOIN paid p ON p.id = w.id
         LEFT JOIN controle_vendas_estoque.commission_rates r ON r.user_id = w.id
        ORDER BY coalesce(s.revenue, 0) DESC, u.name`,
      [actor.organizationId, range!.start, range!.end, range!.period],
    );
    const payouts = await tx.query<CommissionPanel["payouts"][number]>(
      `SELECT p.id, u.name AS "userName", p.amount::text AS amount, p.method, p.notes, p.created_at AS "createdAt", b.name AS "byName"
         FROM controle_vendas_estoque.commission_payouts p
         JOIN controle_vendas_estoque.users u ON u.id = p.user_id
         JOIN controle_vendas_estoque.users b ON b.id = p.created_by
        WHERE p.period = $1::date ORDER BY p.created_at DESC`,
      [range!.period],
    );
    const sum = (k: "revenue" | "commission" | "paid" | "toPay") => rows.reduce((a, r) => a + Number(r[k]), 0).toFixed(2);
    return {
      month: range!.month,
      rows,
      totals: { revenue: sum("revenue"), commission: sum("commission"), paid: sum("paid"), toPay: sum("toPay") },
      payouts: payouts.rows,
    } satisfies CommissionPanel;
  },
});

export const setCommissionRate = defineService({
  name: "commissions.set_rate",
  description: "Define a taxa de comissão (%) de um vendedor sobre o valor das vendas dele",
  permission: "commissions.manage",
  risk: 3,
  input: z.object({ userId: z.string().uuid(), rate: decimalField(2, "Taxa") }),
  async handler({ tx, actor, audit }, input) {
    const rate = Number(input.rate);
    if (rate < 0 || rate > 100) throw new AppError("invalid_input", "A taxa vai de 0 a 100%.");
    const member = await tx.query<{ name: string }>(
      `SELECT u.name FROM controle_vendas_estoque.memberships m JOIN controle_vendas_estoque.users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND m.user_id = $2`,
      [actor.organizationId, input.userId],
    );
    if (!member.rows[0]) throw new AppError("invalid_input", "Pessoa não faz parte da equipe.");
    await tx.query(
      `INSERT INTO controle_vendas_estoque.commission_rates (organization_id, user_id, rate, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET rate = EXCLUDED.rate, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [actor.organizationId, input.userId, input.rate, actor.userId],
    );
    await audit({ action: "commission.rate", entityType: "user", entityId: input.userId, summary: `Comissão de ${member.rows[0].name}: ${input.rate}%` });
    return { userId: input.userId, rate: input.rate };
  },
});

export const recordCommissionPayout = defineService({
  name: "commissions.payout",
  description: "Registra um repasse de comissão feito a um vendedor, no mês de referência",
  permission: "commissions.manage",
  risk: 3,
  input: z.object({
    userId: z.string().uuid(),
    month: monthField,
    amount: decimalField(2, "Valor do repasse"),
    method: z.enum(["cash", "pix", "other"]).optional(),
    notes: optionalText(300),
  }),
  async handler({ tx, actor, audit }, input) {
    if (Number(input.amount) <= 0) throw new AppError("invalid_input", "Informe o valor do repasse.");
    const member = await tx.query<{ name: string }>("SELECT name FROM controle_vendas_estoque.users WHERE id = $1", [input.userId]);
    if (!member.rows[0]) throw new AppError("invalid_input", "Pessoa não encontrada.");
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.commission_payouts (organization_id, user_id, period, amount, method, notes, created_by)
       VALUES ($1, $2, to_date($3, 'YYYY-MM'), $4, $5, $6, $7) RETURNING id`,
      [actor.organizationId, input.userId, input.month, input.amount, input.method ?? null, input.notes ?? null, actor.userId],
    );
    await audit({ action: "commission.payout", entityType: "user", entityId: input.userId, summary: `Repasse de R$ ${input.amount} para ${member.rows[0].name} (${input.month})` });
    return { id: rows[0]!.id };
  },
});
