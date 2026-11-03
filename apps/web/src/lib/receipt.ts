import { PAYMENT_LABELS, type getSale } from "@erp/core";
import { money, quantity } from "./format";

// Recibo da venda em texto, para mandar pelo WhatsApp do cliente (wa.me).
// Sem telefone no cadastro, o WhatsApp abre para a pessoa escolher o contato.

type SaleDetail = Awaited<ReturnType<(typeof getSale)["handler"]>>;

const shortDay = (d: string) => d.split("-").reverse().join("/");

export function receiptText(sale: SaleDetail, orgName: string, timezone: string): string {
  const date = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(sale.soldAt));
  const lines = [`*${orgName}*`, `Recibo da venda nº ${sale.number} · ${date}`, ""];
  if (sale.customerName) lines.push(`Cliente: ${sale.customerName}`, "");
  for (const i of sale.items) lines.push(`• ${quantity(i.quantity)} ${i.unitCode} ${i.productName}: ${money(i.total)}`);
  lines.push("");
  if (Number(sale.discount) > 0) lines.push(`Desconto: −${money(sale.discount)}`);
  if (Number(sale.deliveryFee) > 0) lines.push(`Frete: ${money(sale.deliveryFee)}`);
  for (const t of sale.tradeIns) lines.push(`Recebido na troca (${t.productName}): −${money(t.value)}`);
  lines.push(`*Total: ${money(Number(sale.total) - Number(sale.tradeInTotal))}*`);
  for (const p of sale.payments) lines.push(`Pago no ${PAYMENT_LABELS[p.method]}: ${money(p.amount)}`);
  const open = Number(sale.total) - Number(sale.tradeInTotal) - Number(sale.paidTotal);
  if (open > 0.004) {
    lines.push(`Falta pagar: ${money(open)}`);
    const pending = sale.installments.filter((i) => i.status !== "paid" && i.status !== "cancelled");
    if (pending.length > 0) {
      lines.push("", "Parcelas:");
      for (const i of pending) lines.push(`${i.number}/${sale.installments.length} · vence ${shortDay(i.dueDate)} · ${money(Number(i.amount) - Number(i.paidAmount))}`);
    }
  }
  if (sale.handoverDate) lines.push("", `${sale.fulfillment === "delivery" ? "Entrega" : "Retirada"} combinada para ${shortDay(sale.handoverDate)}.`);
  lines.push("", "Obrigado pela compra!");
  return lines.join("\n");
}

/** Link do WhatsApp com o recibo; vai direto ao cliente quando o telefone é válido. */
export function receiptLink(sale: SaleDetail, orgName: string, timezone: string): string {
  const digits = (sale.customerPhone ?? "").replace(/\D/g, "");
  const phone = digits.length >= 10 ? (digits.length <= 11 ? `55${digits}` : digits) : "";
  return `https://wa.me/${phone}?text=${encodeURIComponent(receiptText(sale, orgName, timezone))}`;
}
