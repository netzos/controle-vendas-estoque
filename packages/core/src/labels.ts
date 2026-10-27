// Rótulos e constantes sem dependências de servidor, para uso também em
// componentes de cliente via "@erp/core/labels".

export type ItemType = "stock" | "made_to_order" | "service" | "production";

// Como o item é vendido. Define se o estoque é controlado.
export const ITEM_TYPES: Record<ItemType, { label: string; hint: string; tracksStock: boolean }> = {
  stock: { label: "Produto em estoque", hint: "Você compra, guarda e vende. Quando acabar, pode seguir vendendo por encomenda.", tracksStock: true },
  made_to_order: { label: "Só por encomenda", hint: "Não guarda em estoque. Cada venda abre a etapa Encomenda.", tracksStock: false },
  service: { label: "Serviço", hint: "Mão de obra, taxa, entrega. Não tem estoque.", tracksStock: false },
  production: { label: "Produção própria", hint: "Você mesmo produz, colhe ou fabrica. Tem estoque e pode vender por encomenda.", tracksStock: true },
};

export type CustomFieldType = "text" | "number" | "date" | "select" | "boolean";

export const CUSTOM_FIELD_TYPES: Record<CustomFieldType, string> = {
  text: "Texto",
  number: "Número",
  date: "Data",
  select: "Lista de opções",
  boolean: "Sim ou não",
};

// Etapas depois da venda (entrega, instalação, montagem...).
export type StepStatus = "pending" | "in_progress" | "done" | "cancelled";

export const STEP_STATUS: Record<StepStatus, string> = {
  pending: "A fazer",
  in_progress: "Em andamento",
  done: "Feito",
  cancelled: "Cancelado",
};

// Etapa que a venda ganha quando algo foi vendido sem ter em estoque.
export const ORDER_STEP = "Encomenda";

// Etapa que a venda ganha quando vai entregue; o custo dela é o transporte.
export const DELIVERY_STEP = "Entrega";

export type Fulfillment = "pickup" | "delivery";

export const FULFILLMENTS: Record<Fulfillment, string> = {
  pickup: "Retirada no local",
  delivery: "Entrega",
};

// Venda parcelada ------------------------------------------------------------

export type InstallmentInterval = "monthly" | "biweekly" | "weekly" | "single";

export const INTERVAL_LABELS: Record<InstallmentInterval, string> = {
  monthly: "Por mês",
  biweekly: "A cada 15 dias",
  weekly: "Por semana",
  single: "Data única",
};

/** open = em dia; late = vencida; partial = pagou uma parte e ainda não venceu. */
export type InstallmentStatus = "paid" | "open" | "late" | "partial" | "cancelled";

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  paid: "Paga",
  open: "Em aberto",
  late: "Vencida",
  partial: "Paga em parte",
  cancelled: "Cancelada",
};

/** Datas de vencimento: a primeira e as seguintes pelo intervalo (mês a mês segue o dia da primeira). */
export function dueDates(first: string, count: number, interval: InstallmentInterval): string[] {
  const [y, m, d] = first.split("-").map(Number) as [number, number, number];
  return Array.from({ length: interval === "single" ? 1 : count }, (_, i) => {
    if (interval === "monthly") {
      const last = new Date(Date.UTC(y, m + i, 0)).getUTCDate();
      return new Date(Date.UTC(y, m - 1 + i, Math.min(d, last))).toISOString().slice(0, 10);
    }
    const step = interval === "biweekly" ? 14 : 7;
    return new Date(Date.UTC(y, m - 1, d + i * step)).toISOString().slice(0, 10);
  });
}

/** Divide em centavos; o que sobra da divisão vai na primeira parcela. */
export function splitCents(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? totalCents - base * count : 0));
}
