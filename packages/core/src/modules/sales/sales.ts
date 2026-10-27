import type { Tx } from "@erp/db";
import { z } from "zod";
import { can } from "../../context.ts";
import { AppError, forbidden, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";
import { decimalField, optionalText, uuidOrNull } from "../catalog/fields.ts";
import { applyMovement, averageCost } from "../stock/movements.ts";
import { DELIVERY_STEP, ORDER_STEP, type Fulfillment } from "../../labels.ts";
import { cancelFollowup, followupInput, insertFollowup } from "./followups.ts";
import { featureEnabled } from "../../features.ts";

export type PaymentMethod = "cash" | "pix" | "credit" | "debit" | "other";

export const PAYMENT_LABELS: Record<PaymentMethod | "trade_in", string> = {
  pix: "Pix",
  cash: "Dinheiro",
  credit: "Cartão de crédito",
  debit: "Cartão de débito",
  other: "Outro",
  trade_in: "Item na troca",
};

export interface SaleTradeIn {
  id: string;
  productId: string;
  productName: string;
  unitCode: string;
  quantity: string;
  value: string;
  notes: string | null;
}

export type PaymentStatus = "paid" | "partial" | "pending";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: "Pago",
  partial: "Pagamento parcial",
  pending: "A receber",
};

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  amount: string;
  paidAt: Date;
  notes: string | null;
  userName: string;
}

export interface SaleItem {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  unitCode: string;
  quantity: string;
  unitPrice: string;
  total: string;
  /** Quanto foi vendido sem ter em estoque (por encomenda). */
  backorderQty: string;
}

export interface Sale {
  id: string;
  number: number;
  customerId: string | null;
  customerName: string | null;
  /** Filial da venda; null = da empresa toda. */
  branchId: string | null;
  branchName: string | null;
  status: "completed" | "cancelled";
  paymentMethod: PaymentMethod;
  subtotal: string;
  discount: string;
  total: string;
  tradeInTotal: string;
  /** Quanto já foi recebido em dinheiro, Pix, cartão... (sem a troca). */
  paidTotal: string;
  paymentStatus: PaymentStatus;
  deliveryFee: string;
  fulfillment: Fulfillment;
  followupStatus: "open" | "done" | "cancelled" | null;
  costTotal: string;
  notes: string | null;
  soldAt: Date;
  userName: string;
  itemCount: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

const SALE_COLUMNS = `s.id, s.number, s.customer_id AS "customerId", c.name AS "customerName",
  s.branch_id AS "branchId", (SELECT b.name FROM controle_vendas_estoque.branches b WHERE b.id = s.branch_id) AS "branchName", s.status,
  s.payment_method AS "paymentMethod", s.subtotal::text AS subtotal, s.discount::text AS discount, s.total::text AS total,
  s.trade_in_total::text AS "tradeInTotal", s.paid_total::text AS "paidTotal", s.payment_status AS "paymentStatus",
  s.delivery_fee::text AS "deliveryFee", s.fulfillment,
  (SELECT f.status FROM controle_vendas_estoque.sale_followups f WHERE f.sale_id = s.id) AS "followupStatus", s.cost_total::text AS "costTotal", s.notes, s.sold_at AS "soldAt", u.name AS "userName",
  (SELECT count(*) FROM controle_vendas_estoque.sale_items i WHERE i.sale_id = s.id)::int AS "itemCount",
  s.cancelled_at AS "cancelledAt", s.cancel_reason AS "cancelReason"`;
const SALE_FROM = `controle_vendas_estoque.sales s
  JOIN controle_vendas_estoque.users u ON u.id = s.created_by
  LEFT JOIN controle_vendas_estoque.customers c ON c.id = s.customer_id`;

async function defaultFulfillment(tx: Tx): Promise<Fulfillment> {
  const { rows } = await tx.query<{ value: unknown }>(
    "SELECT value FROM controle_vendas_estoque.organization_settings WHERE key = 'sales.default_fulfillment'",
  );
  return rows[0]?.value === "delivery" ? "delivery" : "pickup";
}

export const createSale = defineService({
  name: "sales.create",
  description: "Registra uma venda com um ou mais itens; baixa o estoque dos produtos na mesma operação",
  permission: "sales.create",
  risk: 3,
  input: z.object({
    customerId: uuidOrNull,
    // Sem filial: a do cliente, ou a única filial de quem vende.
    branchId: uuidOrNull,
    // Pago de uma forma só, tudo na hora. Para dividir ou deixar parte para
    // depois, use payments (o que não for pago fica a receber).
    paymentMethod: z.enum(["cash", "pix", "credit", "debit", "other"]).optional(),
    payments: z
      .array(z.object({ method: z.enum(["cash", "pix", "credit", "debit", "other"]), amount: decimalField(2, "Valor pago") }))
      .max(10)
      .optional(),
    discount: decimalField(2, "Desconto").default("0"),
    notes: optionalText(1000),
    items: z
      .array(
        z.object({
          productId: z.string().uuid("Escolha o produto."),
          quantity: decimalField(3, "Quantidade"),
          // Sem preço informado, vale o preço de venda do cadastro.
          unitPrice: decimalField(2, "Preço").optional(),
        }),
      )
      .min(1, "Adicione pelo menos um item."),
    // Itens que o cliente entrega como parte do pagamento. Um item já
    // cadastrado (productId) ou um novo (name), que é criado na hora.
    tradeIns: z
      .array(
        z.object({
          productId: uuidOrNull,
          name: optionalText(160),
          quantity: decimalField(3, "Quantidade da troca").default("1"),
          value: decimalField(2, "Valor da troca"),
          salePrice: decimalField(2, "Preço de revenda").optional(),
          notes: optionalText(500),
        }),
      )
      .max(10)
      .default([]),
    // Retirada no local ou entrega. Se omitido, vale o padrão da empresa
    // (ou entrega, quando vier endereço ou taxa).
    fulfillment: z.enum(["pickup", "delivery"]).optional(),
    // Depois da venda: endereço e etapas (entrega, instalação...). Se omitido,
    // a venda ganha as etapas cadastradas nos produtos, sem endereço.
    followup: followupInput
      .extend({
        fee: decimalField(2, "Taxa de entrega").default("0"),
        // Quanto o transporte custou (motoboy, combustível). Vira o custo da etapa Entrega.
        deliveryCost: decimalField(2, "Custo do transporte").optional(),
      })
      .optional(),
  }),
  async handler({ tx, actor, audit, emit }, input) {
    let branchId = input.branchId ?? null;
    if (input.customerId) {
      const c = await tx.query<{ branchId: string | null }>("SELECT branch_id AS \"branchId\" FROM controle_vendas_estoque.customers WHERE id = $1", [input.customerId]);
      if (!c.rowCount) throw new AppError("invalid_input", "Cliente não encontrado.");
      branchId ??= c.rows[0]!.branchId;
    }
    if (!branchId && actor.branchIds?.length === 1) branchId = actor.branchIds[0]!;
    if (branchId) {
      if (actor.branchIds && !actor.branchIds.includes(branchId)) throw forbidden("Você não vende por esta filial.");
      const b = await tx.query("SELECT 1 FROM controle_vendas_estoque.branches WHERE id = $1", [branchId]);
      if (!b.rowCount) throw new AppError("invalid_input", "Filial inválida.");
    }

    const ids = [...new Set(input.items.map((i) => i.productId))];
    const products = await tx.query<{
      id: string; name: string; price: string; cost: string; track: boolean; status: string; stock: string; backorder: boolean; type: string;
    }>(
      `SELECT id, name, sale_price::text AS price, cost_price::text AS cost, track_stock AS track, status,
              stock_qty::text AS stock, backorder, item_type AS type
         FROM controle_vendas_estoque.products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [ids],
    );
    const byId = new Map(products.rows.map((p) => [p.id, p]));
    const lines = input.items.map((item) => {
      const p = byId.get(item.productId);
      if (!p) throw new AppError("invalid_input", "Produto não encontrado.");
      if (p.status !== "active") throw new AppError("invalid_input", `${p.name} está inativo.`);
      if (Number(item.quantity) <= 0) throw new AppError("invalid_input", `Quantidade de ${p.name} deve ser maior que zero.`);
      // Preço diferente do cadastro só com a permissão que o dono concede.
      if (item.unitPrice !== undefined && Number(item.unitPrice) !== Number(p.price) && !can(actor, "sales.change_price")) {
        throw new AppError("forbidden", `Você não tem permissão para mudar o preço de ${p.name}.`);
      }
      return { ...item, product: p, unitPrice: item.unitPrice ?? p.price, backorder: 0 };
    });

    // O que passa do estoque vira encomenda (o saldo fica negativo) ou é
    // barrado, conforme o produto. "Só por encomenda" é sempre encomenda.
    // Quantidades em milésimos para não somar com erro de ponto flutuante.
    const used = new Map<string, number>();
    for (const l of lines) {
      const qty = Math.round(Number(l.quantity) * 1000);
      if (l.product.type === "made_to_order") {
        l.backorder = qty;
        continue;
      }
      if (!l.product.track) continue;
      const free = Math.max(Math.round(Number(l.product.stock) * 1000) - (used.get(l.productId) ?? 0), 0);
      used.set(l.productId, (used.get(l.productId) ?? 0) + qty);
      if (qty <= free) continue;
      if (!l.product.backorder) {
        throw new AppError("invalid_input", `${l.product.name}: só tem ${fmtQty(free)} em estoque e este produto não vende por encomenda.`);
      }
      l.backorder = qty - free;
    }

    // Totais calculados no banco, em numeric.
    const totals = await tx.query<{ subtotal: string; cost: string }>(
      `SELECT coalesce(sum(round(q * p, 2)), 0)::text AS subtotal, coalesce(sum(q * c), 0)::text AS cost
         FROM unnest($1::numeric[], $2::numeric[], $3::numeric[]) AS t(q, p, c)`,
      [lines.map((l) => l.quantity), lines.map((l) => l.unitPrice), lines.map((l) => l.product.cost)],
    );
    const { subtotal, cost } = totals.rows[0]!;
    if (Number(input.discount) > Number(subtotal)) throw new AppError("invalid_input", "O desconto é maior que o valor da venda.");

    // Recursos opcionais que a empresa liga em Ajustes › Recursos.
    if (input.tradeIns.length > 0 && !(await featureEnabled(tx, actor.organizationId, "trade_in"))) {
      throw new AppError("invalid_input", "Receber item na troca está desligado. Ligue em Ajustes › Recursos.");
    }
    const deliveriesOn = await featureEnabled(tx, actor.organizationId, "deliveries");
    if (!deliveriesOn && (input.fulfillment === "delivery" || input.followup)) {
      throw new AppError("invalid_input", "Entregas e serviços depois da venda estão desligados. Ligue em Ajustes › Recursos.");
    }
    if (input.tradeIns.length > 0 && !can(actor, "sales.trade_in")) {
      throw new AppError("forbidden", "Você não tem permissão para aceitar item na troca.");
    }
    const tradeTotal = input.tradeIns.reduce((a, t) => a + Math.round(Number(t.value) * 100), 0) / 100;
    for (const t of input.tradeIns) {
      if (!t.productId && !t.name) throw new AppError("invalid_input", "Diga qual item foi recebido na troca.");
      if (Number(t.quantity) <= 0) throw new AppError("invalid_input", "Quantidade da troca deve ser maior que zero.");
    }
    const fee = input.followup?.fee ?? "0";
    if (input.followup && !can(actor, "deliveries.manage")) {
      throw new AppError("forbidden", "Você não tem permissão para registrar entregas e etapas depois da venda.");
    }
    const fulfillment: Fulfillment = !deliveriesOn
      ? "pickup"
      : input.fulfillment ??
        (input.followup?.address || Number(fee) > 0 || input.followup?.deliveryCost ? "delivery" : await defaultFulfillment(tx));
    if (fulfillment === "pickup" && Number(fee) > 0) {
      throw new AppError("invalid_input", "Venda com retirada no local não tem taxa de entrega. Escolha Entrega para cobrar o frete.");
    }
    if (fulfillment === "delivery" && !input.followup?.address) {
      throw new AppError("invalid_input", "Informe o endereço da entrega.");
    }
    if (tradeTotal > Number(subtotal) - Number(input.discount) + Number(fee)) {
      throw new AppError("invalid_input", "O valor da troca passa do valor da venda. Registre a diferença como compra.");
    }

    // Recebimentos: o que não for pago agora fica a receber (pagamento parcial).
    const toPayCents = Math.round((Number(subtotal) - Number(input.discount) + Number(fee) - tradeTotal) * 100);
    if (!input.payments && !input.paymentMethod) throw new AppError("invalid_input", "Escolha a forma de pagamento.");
    const payments = (input.payments ?? (toPayCents > 0 ? [{ method: input.paymentMethod!, amount: (toPayCents / 100).toFixed(2) }] : []))
      .filter((p) => Number(p.amount) > 0);
    const paidCents = payments.reduce((a, p) => a + Math.round(Number(p.amount) * 100), 0);
    if (paidCents > toPayCents) throw new AppError("invalid_input", "O valor pago passa do total da venda.");
    const paymentStatus: PaymentStatus = paidCents >= toPayCents ? "paid" : paidCents > 0 ? "partial" : "pending";
    // Forma principal: a de maior valor (a venda antiga só tinha uma).
    const mainMethod = [...payments].sort((a, b) => Number(b.amount) - Number(a.amount))[0]?.method ?? input.paymentMethod ?? "other";

    // Número sequencial por empresa, sem buracos por concorrência.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('sales:' || $1))", [actor.organizationId]);
    const { rows } = await tx.query<{ id: string; number: number; total: string }>(
      `INSERT INTO controle_vendas_estoque.sales
         (organization_id, number, customer_id, payment_method, subtotal, discount, total, cost_total, notes, created_by, trade_in_total, delivery_fee, fulfillment,
          paid_total, payment_status, branch_id)
       VALUES ($1, (SELECT coalesce(max(number), 0) + 1 FROM controle_vendas_estoque.sales WHERE organization_id = $1),
               $2, $3, $4, $5, $4::numeric - $5::numeric + $10::numeric, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, number, total::text AS total`,
      [actor.organizationId, input.customerId ?? null, mainMethod, subtotal, input.discount, cost, input.notes ?? null, actor.userId,
        tradeTotal.toFixed(2), fee, fulfillment, (paidCents / 100).toFixed(2), paymentStatus, branchId],
    );
    const sale = { ...rows[0]!, paymentStatus, paidTotal: (paidCents / 100).toFixed(2), toPay: (toPayCents / 100).toFixed(2) };
    for (const p of payments) {
      await tx.query(
        `INSERT INTO controle_vendas_estoque.sale_payments (organization_id, sale_id, method, amount, created_by) VALUES ($1, $2, $3, $4, $5)`,
        [actor.organizationId, sale.id, p.method, p.amount, actor.userId],
      );
    }

    for (const l of lines) {
      await tx.query(
        `INSERT INTO controle_vendas_estoque.sale_items (organization_id, sale_id, product_id, quantity, unit_price, unit_cost, total, backorder_qty)
         VALUES ($1, $2, $3, $4, $5, $6, round($4::numeric * $5::numeric, 2), $7)`,
        [actor.organizationId, sale.id, l.productId, l.quantity, l.unitPrice, l.product.cost, (l.backorder / 1000).toFixed(3)],
      );
      if (l.product.track) {
        await applyMovement(tx, actor, { productId: l.productId, kind: "sale", quantity: `-${l.quantity}`, unitCost: l.product.cost, saleId: sale.id });
      }
    }

    // Item recebido entra no estoque com o valor da troca como custo.
    for (const [i, t] of input.tradeIns.entries()) {
      let productId = t.productId ?? null;
      if (productId) {
        const p = await tx.query<{ track: boolean; name: string }>(
          "SELECT track_stock AS track, name FROM controle_vendas_estoque.products WHERE id = $1 FOR UPDATE",
          [productId],
        );
        if (!p.rows[0]) throw new AppError("invalid_input", "Item da troca não encontrado.");
        if (!p.rows[0].track) throw new AppError("invalid_input", `${p.rows[0].name} não tem estoque; não pode ser recebido na troca.`);
      } else {
        const unit = await tx.query<{ id: string }>(
          "SELECT id FROM controle_vendas_estoque.units WHERE status = 'active' ORDER BY (code = 'UN') DESC, code LIMIT 1",
        );
        if (!unit.rows[0]) throw new AppError("invalid_input", "Cadastre uma unidade de medida antes.");
        const created = await tx.query<{ id: string }>(
          `INSERT INTO controle_vendas_estoque.products
             (organization_id, sku, name, unit_id, sale_price, cost_price, item_type, track_stock, description)
           VALUES ($1, $2, $3, $4, $5, round($6::numeric / $7::numeric, 4), 'stock', true, $8) RETURNING id`,
          [actor.organizationId, `TROCA-${sale.number}-${i + 1}`, t.name, unit.rows[0].id, t.salePrice ?? "0", t.value, t.quantity,
            `Recebido na troca da venda nº ${sale.number}.`],
        );
        productId = created.rows[0]!.id;
      }
      const unitCost = (await tx.query<{ c: string }>("SELECT round($1::numeric / $2::numeric, 4)::text AS c", [t.value, t.quantity])).rows[0]!.c;
      if (t.productId) await averageCost(tx, productId, t.quantity, unitCost);
      await tx.query(
        `INSERT INTO controle_vendas_estoque.sale_trade_ins (organization_id, sale_id, product_id, quantity, value, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [actor.organizationId, sale.id, productId, t.quantity, t.value, t.notes ?? null],
      );
      await applyMovement(tx, actor, { productId, kind: "trade_in", quantity: t.quantity, unitCost, saleId: sale.id, notes: t.notes ?? null });
    }

    // Produtos com etapas depois da venda (entrega, instalação...) abrem o
    // acompanhamento mesmo que o caixa não tenha informado nada.
    // O que foi vendido sem estoque entra como a etapa Encomenda, com o que pedir.
    const owed = lines.filter((l) => l.backorder > 0).map((l) => `${fmtQty(l.backorder)} × ${l.product.name}`);
    const extra: { name: string; notes?: string; cost?: string }[] = owed.length > 0 ? [{ name: ORDER_STEP, notes: `Pedir: ${owed.join("; ")}` }] : [];
    if (fulfillment === "delivery") extra.push({ name: DELIVERY_STEP, cost: input.followup?.deliveryCost });
    // Sem o recurso de entregas, a venda não abre etapas (o que faltou fica em backorder_qty).
    if (deliveriesOn) await insertFollowup(tx, actor, sale.id, ids, input.followup ?? {}, extra, fulfillment === "pickup" ? [DELIVERY_STEP] : []);

    await audit({
      action: "sale.create",
      entityType: "sale",
      entityId: sale.id,
      summary: `Venda nº ${sale.number} de R$ ${sale.total}${tradeTotal > 0 ? ` (R$ ${tradeTotal.toFixed(2)} em troca)` : ""}${paymentStatus !== "paid" ? ` · falta receber R$ ${((toPayCents - paidCents) / 100).toFixed(2)}` : ""}`,
      after: { ...sale, items: lines.length, tradeIns: input.tradeIns.length },
    });
    await emit("sale.created", { saleId: sale.id, number: sale.number, total: sale.total }, { type: "sale", id: sale.id });
    return sale;
  },
});

export const cancelSale = defineService({
  name: "sales.cancel",
  description: "Cancela uma venda e devolve os itens ao estoque",
  permission: "sales.cancel",
  risk: 4,
  input: z.object({ id: z.string().uuid(), reason: z.string().trim().min(3, "Informe o motivo do cancelamento.").max(500) }),
  async handler({ tx, actor, audit, emit }, input) {
    const { rows } = await tx.query<{ number: number; status: string }>(
      "SELECT number, status FROM controle_vendas_estoque.sales WHERE id = $1 FOR UPDATE",
      [input.id],
    );
    const sale = rows[0];
    if (!sale) throw notFound("Venda");
    if (sale.status === "cancelled") throw new AppError("conflict", `A venda nº ${sale.number} já está cancelada.`);
    await tx.query(
      "UPDATE controle_vendas_estoque.sales SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1",
      [input.id, actor.userId, input.reason],
    );
    const moved = await tx.query<{ productId: string; quantity: string; unitCost: string | null }>(
      `SELECT product_id AS "productId", (-quantity)::text AS quantity, unit_cost::text AS "unitCost"
         FROM controle_vendas_estoque.stock_movements WHERE sale_id = $1 AND kind IN ('sale', 'trade_in')`,
      [input.id],
    );
    for (const m of moved.rows) {
      await applyMovement(tx, actor, { ...m, kind: "sale_cancel", saleId: input.id, notes: input.reason });
    }
    await cancelFollowup(tx, input.id);
    await audit({ action: "sale.cancel", entityType: "sale", entityId: input.id, summary: `Venda nº ${sale.number} cancelada: ${input.reason}` });
    await emit("sale.cancelled", { saleId: input.id, number: sale.number }, { type: "sale", id: input.id });
    return { id: input.id, number: sale.number };
  },
});

export const receiveSalePayment = defineService({
  name: "sales.receive",
  description: "Registra o recebimento de uma parte ou do restante de uma venda com pagamento parcial ou a receber",
  permission: "sales.receive",
  risk: 3,
  input: z.object({
    saleId: z.string().uuid(),
    method: z.enum(["cash", "pix", "credit", "debit", "other"]),
    amount: decimalField(2, "Valor recebido"),
    notes: optionalText(300),
  }),
  async handler({ tx, actor, audit, emit }, input) {
    const { rows } = await tx.query<{ number: number; status: string; open: string }>(
      `SELECT number, status, (total - trade_in_total - paid_total)::text AS open
         FROM controle_vendas_estoque.sales WHERE id = $1 FOR UPDATE`,
      [input.saleId],
    );
    const sale = rows[0];
    if (!sale) throw notFound("Venda");
    if (sale.status === "cancelled") throw new AppError("conflict", `A venda nº ${sale.number} está cancelada.`);
    const open = Math.round(Number(sale.open) * 100);
    const amount = Math.round(Number(input.amount) * 100);
    if (open <= 0) throw new AppError("conflict", `A venda nº ${sale.number} já está paga.`);
    if (amount <= 0) throw new AppError("invalid_input", "Informe o valor recebido.");
    if (amount > open) throw new AppError("invalid_input", `Falta receber só R$ ${(open / 100).toFixed(2).replace(".", ",")} desta venda.`);
    await tx.query(
      `INSERT INTO controle_vendas_estoque.sale_payments (organization_id, sale_id, method, amount, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor.organizationId, input.saleId, input.method, (amount / 100).toFixed(2), input.notes ?? null, actor.userId],
    );
    const status: PaymentStatus = amount === open ? "paid" : "partial";
    await tx.query(
      "UPDATE controle_vendas_estoque.sales SET paid_total = paid_total + $2::numeric, payment_status = $3 WHERE id = $1",
      [input.saleId, (amount / 100).toFixed(2), status],
    );
    await audit({
      action: "sale.receive",
      entityType: "sale",
      entityId: input.saleId,
      summary: `Recebido R$ ${(amount / 100).toFixed(2)} (${PAYMENT_LABELS[input.method]}) da venda nº ${sale.number}${status === "paid" ? ", quitada" : ""}`,
    });
    await emit("sale.payment_received", { saleId: input.saleId, amount: (amount / 100).toFixed(2), status }, { type: "sale", id: input.saleId });
    return { saleId: input.saleId, number: sale.number, paymentStatus: status, stillOpen: ((open - amount) / 100).toFixed(2) };
  },
});

export const listSales = defineService({
  name: "sales.list",
  description: "Lista as vendas mais recentes, com busca pelo número ou pelo cliente",
  permission: "sales.view",
  risk: 1,
  input: z.object({
    search: z.string().trim().max(100).optional(),
    // Só as que ainda têm algo a receber (pagamento parcial ou a receber).
    openPayment: z.boolean().default(false),
    // Só as vendas desta filial.
    branchId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  async handler({ tx, actor }, input) {
    const term = input.search?.replace(/^n[ºo°]?\s*/i, "") ?? "";
    const { rows } = await tx.query<Sale>(
      `SELECT ${SALE_COLUMNS} FROM ${SALE_FROM}
        WHERE ($1 = '' OR s.number::text = $1 OR lower(c.name) LIKE '%' || lower($1) || '%')
          AND (NOT $3 OR (s.payment_status <> 'paid' AND s.status = 'completed'))
          AND ($4::uuid IS NULL OR s.branch_id = $4)
          AND ($5::uuid[] IS NULL OR s.branch_id IS NULL OR s.branch_id = ANY($5))
        ORDER BY s.sold_at DESC LIMIT $2`,
      [term, input.limit, input.openPayment, input.branchId ?? null, actor.branchIds],
    );
    return rows;
  },
});

export const getSale = defineService({
  name: "sales.get",
  description: "Mostra uma venda com seus itens",
  permission: "sales.view",
  risk: 1,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<Sale>(`SELECT ${SALE_COLUMNS} FROM ${SALE_FROM} WHERE s.id = $1`, [input.id]);
    if (!rows[0]) throw notFound("Venda");
    const items = await tx.query<SaleItem>(
      `SELECT i.id, i.product_id AS "productId", p.name AS "productName", p.sku AS "productSku", u.code AS "unitCode",
              i.quantity::text AS quantity, i.unit_price::text AS "unitPrice", i.total::text AS total,
              i.backorder_qty::text AS "backorderQty"
         FROM controle_vendas_estoque.sale_items i
         JOIN controle_vendas_estoque.products p ON p.id = i.product_id
         JOIN controle_vendas_estoque.units u ON u.id = p.unit_id
        WHERE i.sale_id = $1 ORDER BY p.name`,
      [input.id],
    );
    const tradeIns = await tx.query<SaleTradeIn>(
      `SELECT t.id, t.product_id AS "productId", p.name AS "productName", u.code AS "unitCode",
              t.quantity::text AS quantity, t.value::text AS value, t.notes
         FROM controle_vendas_estoque.sale_trade_ins t
         JOIN controle_vendas_estoque.products p ON p.id = t.product_id
         JOIN controle_vendas_estoque.units u ON u.id = p.unit_id
        WHERE t.sale_id = $1 ORDER BY t.created_at`,
      [input.id],
    );
    const payments = await tx.query<SalePayment>(
      `SELECT p.id, p.method, p.amount::text AS amount, p.paid_at AS "paidAt", p.notes, u.name AS "userName"
         FROM controle_vendas_estoque.sale_payments p
         JOIN controle_vendas_estoque.users u ON u.id = p.created_by
        WHERE p.sale_id = $1 ORDER BY p.paid_at, p.created_at`,
      [input.id],
    );
    return { ...rows[0], items: items.rows, tradeIns: tradeIns.rows, payments: payments.rows };
  },
});

// Painel de vendas ---------------------------------------------------------------

export type SalesPeriod = "today" | "7d" | "30d" | "month";

export interface SalesDashboard {
  period: SalesPeriod;
  // Vendas retiradas no local x entregues; transport = custo da etapa Entrega.
  fulfillment: Record<Fulfillment, { count: number; revenue: string; fees: string; transport: string }>;
  // otherCosts: custos lançados no período; realProfit = profit − otherCosts.
  current: { revenue: string; count: number; ticket: string; profit: string; margin: string | null; items: string; otherCosts: string; realProfit: string; realMargin: string | null };
  previous: { revenue: string; count: number; ticket: string; profit: string; otherCosts: string; realProfit: string };
  series: { label: string; revenue: string; count: number }[];
  topProducts: { productId: string; name: string; unitCode: string; quantity: string; revenue: string; share: number }[];
  payments: { method: PaymentMethod | "trade_in"; revenue: string; count: number }[];
  /** Vendas com pagamento parcial ou a receber (qualquer data). */
  receivable: { amount: string; count: number };
  hours: { hour: number; revenue: string; count: number }[];
  recent: Sale[];
}

export const salesDashboard = defineService({
  name: "sales.dashboard",
  description: "Painel de vendas: faturamento, número de vendas, ticket médio, lucro, comparação com o período anterior e mais vendidos",
  permission: "sales.view",
  risk: 1,
  input: z.object({
    period: z.enum(["today", "7d", "30d", "month"]).default("today"),
    // Só as vendas desta filial (os outros custos continuam da empresa toda).
    branchId: z.string().uuid().optional(),
  }),
  async handler({ tx }, input) {
    // Com filial, cada consulta lê só as vendas dela. O id já foi validado como UUID.
    const SALES = input.branchId
      ? `(SELECT * FROM controle_vendas_estoque.sales WHERE branch_id = '${input.branchId}')`
      : "controle_vendas_estoque.sales";
    // Intervalo [start, end) no fuso da empresa, e o intervalo anterior de mesmo tamanho.
    const range = await tx.query<{ start: Date; end: Date; prevStart: Date; tz: string }>(
      `WITH tz AS (SELECT timezone AS tz FROM controle_vendas_estoque.organizations WHERE id = controle_vendas_estoque.current_org()),
            today AS (SELECT (now() AT TIME ZONE tz)::date AS d, tz FROM tz),
            r AS (
              SELECT tz,
                     CASE $1 WHEN 'today' THEN d WHEN '7d' THEN d - 6 WHEN '30d' THEN d - 29 ELSE date_trunc('month', d)::date END AS s,
                     d + 1 AS e
                FROM today)
       SELECT (s::timestamp AT TIME ZONE tz) AS start, (e::timestamp AT TIME ZONE tz) AS "end",
              (CASE WHEN $1 = 'month' THEN (s - interval '1 month')::date ELSE s - (e - s) END)::timestamp AT TIME ZONE tz AS "prevStart",
              tz
         FROM r`,
      [input.period],
    );
    const { start, end, prevStart, tz } = range.rows[0]!;

    const kpi = async (from: Date, to: Date) => {
      const { rows } = await tx.query<{ revenue: string; count: number; cost: string; items: string; other: string }>(
        `SELECT coalesce(sum(total), 0)::text AS revenue, count(*)::int AS count, coalesce(sum(cost_total), 0)::text AS cost,
                (SELECT coalesce(sum(k.amount), 0) FROM controle_vendas_estoque.costs k
                  WHERE k.status = 'active' AND k.incurred_on >= ($1::timestamptz AT TIME ZONE $3)::date
                    AND k.incurred_on < ($2::timestamptz AT TIME ZONE $3)::date)::text AS other,
                coalesce((SELECT sum(i.quantity) FROM controle_vendas_estoque.sale_items i
                           JOIN ${SALES} s2 ON s2.id = i.sale_id
                          WHERE s2.status = 'completed' AND s2.sold_at >= $1 AND s2.sold_at < $2), 0)::text AS items
           FROM ${SALES} sf WHERE status = 'completed' AND sold_at >= $1 AND sold_at < $2`,
        [from, to, tz],
      );
      const r = rows[0]!;
      const revenue = Number(r.revenue);
      const profit = revenue - Number(r.cost);
      const real = profit - Number(r.other);
      return {
        revenue: r.revenue,
        count: r.count,
        ticket: r.count ? (revenue / r.count).toFixed(2) : "0",
        profit: profit.toFixed(2),
        margin: revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : null,
        otherCosts: Number(r.other).toFixed(2),
        realProfit: real.toFixed(2),
        realMargin: revenue > 0 ? ((real / revenue) * 100).toFixed(1) : null,
        items: r.items,
      };
    };
    const current = await kpi(start, end);
    const { margin: _m, items: _i, ...previous } = await kpi(prevStart, start);

    // Hoje: por hora. Demais períodos: por dia.
    const series = await tx.query<{ label: string; revenue: string; count: number }>(
      input.period === "today"
        ? `SELECT lpad(h::text, 2, '0') || 'h' AS label,
                  coalesce(sum(s.total), 0)::text AS revenue, count(s.id)::int AS count
             FROM generate_series(0, 23) h
             LEFT JOIN ${SALES} s
               ON s.status = 'completed' AND s.sold_at >= $1 AND s.sold_at < $2
              AND extract(hour FROM s.sold_at AT TIME ZONE $3)::int = h
            GROUP BY h ORDER BY h`
        : `SELECT to_char(d, 'DD/MM') AS label, coalesce(sum(s.total), 0)::text AS revenue, count(s.id)::int AS count
             FROM generate_series(($1::timestamptz AT TIME ZONE $3)::date, ($2::timestamptz AT TIME ZONE $3)::date - 1, interval '1 day') d
             LEFT JOIN ${SALES} s
               ON s.status = 'completed' AND (s.sold_at AT TIME ZONE $3)::date = d::date
            GROUP BY d ORDER BY d`,
      [start, end, tz],
    );

    const top = await tx.query<{ productId: string; name: string; unitCode: string; quantity: string; revenue: string }>(
      `SELECT p.id AS "productId", p.name, u.code AS "unitCode", sum(i.quantity)::text AS quantity, sum(i.total)::text AS revenue
         FROM controle_vendas_estoque.sale_items i
         JOIN ${SALES} s ON s.id = i.sale_id AND s.status = 'completed'
         JOIN controle_vendas_estoque.products p ON p.id = i.product_id
         JOIN controle_vendas_estoque.units u ON u.id = p.unit_id
        WHERE s.sold_at >= $1 AND s.sold_at < $2
        GROUP BY p.id, p.name, u.code ORDER BY sum(i.total) DESC LIMIT 6`,
      [start, end],
    );

    // Recebido por forma de pagamento (vendas do período, inclusive pagamento
    // dividido). A parte paga com item na troca aparece separada.
    const payments = await tx.query<{ method: PaymentMethod | "trade_in"; revenue: string; count: number }>(
      `SELECT method, sum(amount)::text AS revenue, count(DISTINCT sale_id)::int AS count FROM (
         SELECT p.method, p.amount, p.sale_id FROM controle_vendas_estoque.sale_payments p
           JOIN ${SALES} s ON s.id = p.sale_id
          WHERE s.status = 'completed' AND s.sold_at >= $1 AND s.sold_at < $2
         UNION ALL
         SELECT 'trade_in', trade_in_total, id FROM ${SALES} sf
          WHERE status = 'completed' AND sold_at >= $1 AND sold_at < $2 AND trade_in_total > 0
       ) x GROUP BY method ORDER BY sum(amount) DESC`,
      [start, end],
    );

    // Tudo o que ainda falta receber, de qualquer data.
    const open = await tx.query<{ amount: string; count: number }>(
      `SELECT coalesce(sum(total - trade_in_total - paid_total), 0)::text AS amount, count(*)::int AS count
         FROM ${SALES} sf WHERE status = 'completed' AND payment_status <> 'paid'`,
    );

    const hours = await tx.query<{ hour: number; revenue: string; count: number }>(
      `SELECT extract(hour FROM sold_at AT TIME ZONE $3)::int AS hour, sum(total)::text AS revenue, count(*)::int AS count
         FROM ${SALES} sf WHERE status = 'completed' AND sold_at >= $1 AND sold_at < $2
        GROUP BY 1 ORDER BY 1`,
      [start, end, tz],
    );

    const recent = await tx.query<Sale>(`SELECT ${SALE_COLUMNS} FROM ${SALE_FROM.replace("controle_vendas_estoque.sales s", `${SALES} s`)} ORDER BY s.sold_at DESC LIMIT 6`);

    // Retiradas no local x entregas, com o que o transporte custou.
    const ways = await tx.query<{ fulfillment: Fulfillment; count: number; revenue: string; fees: string; transport: string }>(
      `SELECT s.fulfillment, count(*)::int AS count, sum(s.total)::text AS revenue, sum(s.delivery_fee)::text AS fees,
              coalesce(sum((SELECT sum(k.amount) FROM controle_vendas_estoque.costs k
                             JOIN controle_vendas_estoque.sale_steps t ON t.id = k.step_id
                            WHERE k.sale_id = s.id AND k.status = 'active' AND lower(t.name) = lower($3))), 0)::text AS transport
         FROM ${SALES} s WHERE s.status = 'completed' AND s.sold_at >= $1 AND s.sold_at < $2
        GROUP BY s.fulfillment`,
      [start, end, DELIVERY_STEP],
    );
    const way = (f: Fulfillment) => ways.rows.find((r) => r.fulfillment === f) ?? { fulfillment: f, count: 0, revenue: "0", fees: "0", transport: "0" };

    const base = Number(current.revenue);
    return {
      period: input.period,
      fulfillment: { pickup: way("pickup"), delivery: way("delivery") },
      current,
      previous,
      series: series.rows,
      topProducts: top.rows.map((r) => ({ ...r, share: base > 0 ? Math.round((Number(r.revenue) / base) * 100) : 0 })),
      payments: payments.rows,
      receivable: open.rows[0]!,
      hours: hours.rows,
      recent: recent.rows,
    } satisfies SalesDashboard;
  },
});

// Milésimos → "2" ou "1,5".
function fmtQty(thousandths: number) {
  return String(thousandths / 1000).replace(".", ",");
}
