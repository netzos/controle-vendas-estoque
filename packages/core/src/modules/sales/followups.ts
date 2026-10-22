import { z } from "zod";
import type { Tx } from "@erp/db";
import type { Actor } from "../../context.ts";
import { AppError, notFound } from "../../errors.ts";
import { STEP_STATUS, type StepStatus } from "../../labels.ts";
import { defineService } from "../../service.ts";
import { decimalField, optionalText } from "../catalog/fields.ts";
import { costTypeByName, insertCost, orgToday } from "../costs/costs.ts";

// Depois da venda. A venda não termina no "vendido": um guarda-roupa pago
// ainda precisa ser entregue e montado; um ar-condicionado, entregue e
// instalado. Cada produto diz quais etapas tem; a venda nasce com elas e cada
// uma é acompanhada até o fim. Quem não usa nunca vê nada disso.

export interface SaleStep {
  id: string;
  followupId: string;
  saleId: string;
  saleNumber: number;
  customerName: string | null;
  address: string | null;
  recipient: string | null;
  phone: string | null;
  name: string;
  status: StepStatus;
  scheduledFor: string | null;
  responsible: string | null;
  notes: string | null;
  doneAt: Date | null;
  cost: string;
  late: boolean;
}

export interface SaleFollowup {
  id: string;
  address: string | null;
  recipient: string | null;
  phone: string | null;
  notes: string | null;
  status: "open" | "done" | "cancelled";
  steps: SaleStep[];
}

const STEP_COLUMNS = (todayParam: number) => `st.id, st.followup_id AS "followupId", st.sale_id AS "saleId", s.number AS "saleNumber",
  c.name AS "customerName", f.address, f.recipient, f.phone, st.name, st.status, st.scheduled_for::text AS "scheduledFor",
  st.responsible, st.notes, st.done_at AS "doneAt",
  coalesce((SELECT sum(k.amount) FROM controle_vendas_estoque.costs k WHERE k.step_id = st.id AND k.status = 'active'), 0)::text AS cost,
  (st.status IN ('pending', 'in_progress') AND st.scheduled_for < $${todayParam}::date) AS late`;
const STEP_FROM = `controle_vendas_estoque.sale_steps st
  JOIN controle_vendas_estoque.sale_followups f ON f.id = st.followup_id
  JOIN controle_vendas_estoque.sales s ON s.id = st.sale_id
  LEFT JOIN controle_vendas_estoque.customers c ON c.id = s.customer_id`;

const stepName = z.string().trim().min(2, "Nome da etapa muito curto.").max(60);
const dateField = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").nullable().optional());

export const stepInput = z.object({
  name: stepName,
  scheduledFor: dateField,
  responsible: optionalText(120),
  // Quanto a etapa custou para a empresa (motoboy, instalador). Vira um custo.
  cost: decimalField(2, "Custo da etapa").optional(),
});

export const followupInput = z.object({
  address: optionalText(300),
  recipient: optionalText(120),
  phone: optionalText(30),
  notes: optionalText(500),
  // Sem etapas informadas, valem as etapas cadastradas nos produtos da venda.
  steps: z.array(stepInput).max(10).optional(),
});

// Grava o custo da etapa como lançamento em Custos, no tipo de mesmo nome.
async function setStepCost(tx: Tx, actor: Actor, step: { id: string; name: string; saleId: string }, cost: string | undefined) {
  if (cost === undefined) return;
  const current = await tx.query<{ id: string; amount: string }>(
    "SELECT id, amount::text AS amount FROM controle_vendas_estoque.costs WHERE step_id = $1 AND status = 'active' FOR UPDATE",
    [step.id],
  );
  const old = current.rows[0];
  if (old && Number(old.amount) === Number(cost)) return;
  if (old) await tx.query("UPDATE controle_vendas_estoque.costs SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [old.id]);
  if (Number(cost) > 0) {
    await insertCost(tx, actor, {
      costTypeId: await costTypeByName(tx, actor.organizationId, step.name),
      amount: cost,
      incurredOn: await orgToday(tx),
      description: `${step.name} da venda`,
      saleId: step.saleId,
      stepId: step.id,
    });
  }
}

// Etapas cadastradas nos produtos da venda, sem repetir, na ordem em que aparecem.
export async function productSteps(tx: Tx, productIds: string[]): Promise<string[]> {
  const { rows } = await tx.query<{ steps: string[] }>(
    "SELECT after_sale_steps AS steps FROM controle_vendas_estoque.products WHERE id = ANY($1::uuid[])",
    [productIds],
  );
  const seen = new Map<string, string>();
  for (const r of rows) for (const s of r.steps) if (!seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
  return [...seen.values()];
}

async function addSteps(tx: Tx, actor: Actor, followupId: string, saleId: string, steps: z.output<typeof stepInput>[], startAt = 0) {
  for (const [i, st] of steps.entries()) {
    const dup = await tx.query("SELECT 1 FROM controle_vendas_estoque.sale_steps WHERE followup_id = $1 AND lower(name) = lower($2)", [followupId, st.name]);
    if (dup.rowCount) throw new AppError("conflict", `A etapa ${st.name} já existe nesta venda.`);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.sale_steps (organization_id, followup_id, sale_id, name, position, scheduled_for, responsible)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [actor.organizationId, followupId, saleId, st.name, startAt + i, st.scheduledFor ?? null, st.responsible ?? null],
    );
    await setStepCost(tx, actor, { id: rows[0]!.id, name: st.name, saleId }, st.cost);
  }
}

/** Cria o acompanhamento de uma venda com as etapas dadas ou as dos produtos. */
export async function insertFollowup(
  tx: Tx,
  actor: Actor,
  saleId: string,
  productIds: string[],
  input: z.output<typeof followupInput>,
): Promise<string | null> {
  const steps = input.steps ?? (await productSteps(tx, productIds)).map((name) => ({ name }));
  if (steps.length === 0) return null;
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO controle_vendas_estoque.sale_followups (organization_id, sale_id, address, recipient, phone, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [actor.organizationId, saleId, input.address ?? null, input.recipient ?? null, input.phone ?? null, input.notes ?? null, actor.userId],
  );
  await addSteps(tx, actor, rows[0]!.id, saleId, steps);
  return rows[0]!.id;
}

// Acompanhamento fica concluído quando todas as etapas ativas terminam.
async function refreshFollowup(tx: Tx, followupId: string) {
  await tx.query(
    `UPDATE controle_vendas_estoque.sale_followups f
        SET status = CASE WHEN x.open = 0 AND x.done > 0 THEN 'done' WHEN x.open = 0 THEN 'cancelled' ELSE 'open' END,
            done_at = CASE WHEN x.open = 0 AND x.done > 0 THEN coalesce(f.done_at, now()) ELSE NULL END
       FROM (SELECT count(*) FILTER (WHERE status IN ('pending', 'in_progress')) AS open, count(*) FILTER (WHERE status = 'done') AS done
               FROM controle_vendas_estoque.sale_steps WHERE followup_id = $1) x
      WHERE f.id = $1`,
    [followupId],
  );
}

export const listSaleSteps = defineService({
  name: "followups.steps.list",
  description: "Lista as etapas depois da venda (entregas, instalações...): atrasadas, de hoje, abertas ou feitas",
  permission: "deliveries.view",
  risk: 1,
  input: z.object({
    filter: z.enum(["open", "late", "today", "done", "all"]).default("open"),
    saleId: z.string().uuid().optional(),
    name: z.string().trim().max(60).optional(),
    limit: z.number().int().min(1).max(500).default(300),
  }),
  async handler({ tx }, input) {
    const today = await orgToday(tx);
    const where: Record<typeof input.filter, string> = {
      open: "st.status IN ('pending', 'in_progress')",
      late: "st.status IN ('pending', 'in_progress') AND st.scheduled_for < $1::date",
      today: "st.status IN ('pending', 'in_progress') AND st.scheduled_for = $1::date",
      done: "st.status = 'done'",
      all: "true",
    };
    const params: unknown[] = [today, input.limit];
    let cond = input.saleId ? "st.sale_id = $3" : where[input.filter];
    if (input.saleId) params.push(input.saleId);
    if (input.name) {
      params.push(input.name);
      cond += ` AND lower(st.name) = lower($${params.length})`;
    }
    const { rows } = await tx.query<SaleStep>(
      `SELECT ${STEP_COLUMNS(1)} FROM ${STEP_FROM} WHERE ${cond}
        ORDER BY (st.status IN ('pending', 'in_progress')) DESC, st.scheduled_for NULLS LAST, s.number, st.position LIMIT $2`,
      params,
    );
    return rows;
  },
});

export const getSaleFollowup = defineService({
  name: "followups.get",
  description: "Mostra o acompanhamento de uma venda: endereço e etapas",
  permission: "deliveries.view",
  risk: 1,
  input: z.object({ saleId: z.string().uuid() }),
  async handler({ tx }, input): Promise<SaleFollowup | null> {
    const f = await tx.query<Omit<SaleFollowup, "steps">>(
      "SELECT id, address, recipient, phone, notes, status FROM controle_vendas_estoque.sale_followups WHERE sale_id = $1",
      [input.saleId],
    );
    if (!f.rows[0]) return null;
    const today = await orgToday(tx);
    const steps = await tx.query<SaleStep>(`SELECT ${STEP_COLUMNS(1)} FROM ${STEP_FROM} WHERE st.followup_id = $2 ORDER BY st.position`, [today, f.rows[0].id]);
    return { ...f.rows[0], steps: steps.rows };
  },
});

export const stepCounts = defineService({
  name: "followups.counts",
  description: "Quantas etapas depois da venda estão atrasadas, para hoje, a fazer e em andamento",
  permission: "deliveries.view",
  risk: 1,
  input: z.object({}),
  async handler({ tx }) {
    const today = await orgToday(tx);
    const { rows } = await tx.query<{ late: number; today: number; pending: number; inProgress: number; doneWeek: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('pending', 'in_progress') AND scheduled_for < $1::date)::int AS late,
              count(*) FILTER (WHERE status IN ('pending', 'in_progress') AND scheduled_for = $1::date)::int AS today,
              count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
              count(*) FILTER (WHERE status = 'done' AND done_at > now() - interval '7 days')::int AS "doneWeek"
         FROM controle_vendas_estoque.sale_steps`,
      [today],
    );
    return rows[0]!;
  },
});

export const createSaleFollowup = defineService({
  name: "followups.create",
  description: "Abre o acompanhamento de uma venda já feita, com endereço e etapas (entrega, instalação...)",
  permission: "deliveries.manage",
  risk: 2,
  input: followupInput.extend({ saleId: z.string().uuid() }),
  async handler({ tx, actor, audit }, input) {
    const sale = await tx.query<{ number: number; status: string }>("SELECT number, status FROM controle_vendas_estoque.sales WHERE id = $1 FOR UPDATE", [input.saleId]);
    if (!sale.rows[0]) throw notFound("Venda");
    if (sale.rows[0].status !== "completed") throw new AppError("invalid_input", "Venda cancelada não tem etapas depois da venda.");
    const existing = await tx.query<{ id: string; position: number }>(
      `SELECT f.id, coalesce(max(st.position) + 1, 0)::int AS position FROM controle_vendas_estoque.sale_followups f
         LEFT JOIN controle_vendas_estoque.sale_steps st ON st.followup_id = f.id WHERE f.sale_id = $1 GROUP BY f.id`,
      [input.saleId],
    );
    let id = existing.rows[0]?.id ?? null;
    if (id) {
      // Já existe: só acrescenta as etapas novas.
      if (!input.steps?.length) throw new AppError("conflict", `A venda nº ${sale.rows[0].number} já tem acompanhamento.`);
      await addSteps(tx, actor, id, input.saleId, input.steps, existing.rows[0]!.position);
      await refreshFollowup(tx, id);
    } else {
      const items = await tx.query<{ id: string }>("SELECT product_id AS id FROM controle_vendas_estoque.sale_items WHERE sale_id = $1", [input.saleId]);
      id = await insertFollowup(tx, actor, input.saleId, items.rows.map((r) => r.id), input);
      if (!id) throw new AppError("invalid_input", "Diga quais etapas vêm depois desta venda (ex.: Entrega).");
    }
    await audit({ action: "followup.create", entityType: "sale", entityId: input.saleId, summary: `Etapas depois da venda nº ${sale.rows[0].number} abertas` });
    return { id };
  },
});

export const updateSaleFollowup = defineService({
  name: "followups.update",
  description: "Muda endereço, destinatário ou telefone do acompanhamento de uma venda",
  permission: "deliveries.manage",
  risk: 2,
  input: followupInput.omit({ steps: true }).extend({ id: z.string().uuid() }),
  async handler({ tx, audit }, input) {
    const { rows } = await tx.query<{ saleId: string }>(
      `UPDATE controle_vendas_estoque.sale_followups SET address = $2, recipient = $3, phone = $4, notes = $5
        WHERE id = $1 RETURNING sale_id AS "saleId"`,
      [input.id, input.address ?? null, input.recipient ?? null, input.phone ?? null, input.notes ?? null],
    );
    if (!rows[0]) throw notFound("Acompanhamento");
    await audit({ action: "followup.update", entityType: "sale", entityId: rows[0].saleId, summary: "Endereço/contato do acompanhamento alterado" });
    return { id: input.id };
  },
});

export const updateSaleStep = defineService({
  name: "followups.steps.update",
  description: "Muda a situação de uma etapa (a fazer, em andamento, feito, cancelado), o prazo, o responsável ou o custo",
  permission: "deliveries.manage",
  risk: 2,
  input: z.object({
    id: z.string().uuid(),
    status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
    scheduledFor: dateField,
    responsible: optionalText(120),
    notes: optionalText(500),
    cost: decimalField(2, "Custo da etapa").optional(),
  }),
  async handler({ tx, actor, audit }, input) {
    const cur = await tx.query<{ followupId: string; saleId: string; name: string; status: StepStatus; number: number; scheduledFor: string | null; responsible: string | null; notes: string | null }>(
      `SELECT st.followup_id AS "followupId", st.sale_id AS "saleId", st.name, st.status, s.number,
              st.scheduled_for::text AS "scheduledFor", st.responsible, st.notes
         FROM controle_vendas_estoque.sale_steps st JOIN controle_vendas_estoque.sales s ON s.id = st.sale_id
        WHERE st.id = $1 FOR UPDATE OF st`,
      [input.id],
    );
    const st = cur.rows[0];
    if (!st) throw notFound("Etapa");
    const status = input.status ?? st.status;
    await tx.query(
      `UPDATE controle_vendas_estoque.sale_steps
          SET status = $2, scheduled_for = $3, responsible = $4, notes = $5,
              done_at = CASE WHEN $2 = 'done' THEN coalesce(done_at, now()) ELSE NULL END
        WHERE id = $1`,
      [input.id, status, input.scheduledFor === undefined ? st.scheduledFor : input.scheduledFor,
        input.responsible === undefined ? st.responsible : input.responsible, input.notes === undefined ? st.notes : input.notes],
    );
    await setStepCost(tx, actor, { id: input.id, name: st.name, saleId: st.saleId }, status === "cancelled" ? "0" : input.cost);
    await refreshFollowup(tx, st.followupId);
    await audit({
      action: status !== st.status ? "followup.step_status" : "followup.step_update",
      entityType: "sale",
      entityId: st.saleId,
      summary: status !== st.status
        ? `${st.name} da venda nº ${st.number}: ${STEP_STATUS[st.status]} → ${STEP_STATUS[status]}`
        : `${st.name} da venda nº ${st.number} alterada`,
    });
    return { id: input.id, status };
  },
});

// Venda cancelada: etapas que ainda não terminaram são canceladas. Custos já
// pagos continuam lançados.
export async function cancelFollowup(tx: Tx, saleId: string) {
  await tx.query("UPDATE controle_vendas_estoque.sale_steps SET status = 'cancelled' WHERE sale_id = $1 AND status IN ('pending', 'in_progress')", [saleId]);
  await tx.query("UPDATE controle_vendas_estoque.sale_followups SET status = 'cancelled' WHERE sale_id = $1 AND status = 'open'", [saleId]);
}
