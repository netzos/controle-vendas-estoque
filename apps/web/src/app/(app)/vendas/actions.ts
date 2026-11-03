"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { cancelSale, completeSaleFollowup, createCustomer, createSale, deleteSale, getOrganization, getSale, receiveSalePayment, runService, setHandoverDate, updateSale } from "@erp/core";
import { receiptLink } from "@/lib/receipt";
import { money } from "@/lib/format";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { optional, perform, str, toFormState, type FormState } from "@/lib/actions";

export async function createSaleAction(_: FormState, form: FormData): Promise<FormState> {
  let items: { productId: string; quantity: string; unitPrice?: string }[] = [];
  let tradeIns: { productId?: string | null; name?: string | null; value: string }[] = [];
  let payments: { method: "pix"; amount: string }[] | undefined;
  let followup: z.input<typeof createSale.input>["followup"];
  let installments: z.input<typeof createSale.input>["installments"];
  try {
    items = JSON.parse(str(form, "items") || "[]");
    tradeIns = JSON.parse(str(form, "tradeIns") || "[]");
    if (str(form, "payments")) payments = JSON.parse(str(form, "payments"));
    const f = str(form, "followup");
    if (f) followup = JSON.parse(f);
    if (str(form, "installments")) installments = JSON.parse(str(form, "installments"));
  } catch {
    return { ok: false, message: "Itens inválidos." };
  }
  try {
    const actor = await currentActor();
    // Cliente novo digitado na própria venda: cadastra antes (nome e telefone).
    let customerId = optional(form, "customerId");
    const newName = str(form, "newCustomerName").trim();
    if (!customerId && newName) {
      const created = await runService(db(), createCustomer, actor, { name: newName, phone: optional(form, "newCustomerPhone") });
      customerId = created.id;
    }
    const sale = await runService(db(), createSale, actor, {
      customerId,
      paymentLater: str(form, "paymentLater") === "1",
      paymentMethod: payments || str(form, "paymentLater") === "1" ? undefined : (str(form, "paymentMethod") as "pix"),
      payments,
      installments,
      handoverDate: str(form, "handoverDate") || null,
      fulfillment: str(form, "fulfillment") === "delivery" ? "delivery" : "pickup",
      discount: str(form, "discount"),
      notes: optional(form, "notes"),
      items,
      tradeIns,
      followup,
    });
    revalidatePath("/", "layout");
    const open = Number(sale.toPay) - Number(sale.paidTotal);
    // Recibo pronto para o WhatsApp do cliente.
    const [detail, org] = await Promise.all([runService(db(), getSale, actor, { id: sale.id }), runService(db(), getOrganization, actor, {})]);
    const link = receiptLink(detail, org.name, org.timezone);
    return {
      ok: true,
      message: `Venda nº ${sale.number} registrada: ${money(sale.total)}${
        sale.installments.length > 0
          ? `. ${sale.installments.length === 1 ? `A receber ${money(open)}` : `${sale.installments.length} parcelas, total ${money(open)}`}, 1º vencimento ${sale.installments[0]!.dueDate.split("-").reverse().join("/")}.`
          : sale.paymentStatus !== "paid" ? `. Falta receber ${money(open)}.` : ""
      }`,
      link,
    };
  } catch (err) {
    return toFormState(err);
  }
}

export async function cancelSaleAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(cancelSale, { id: str(form, "id"), reason: str(form, "reason") }, { successMessage: "Venda cancelada e itens devolvidos ao estoque.", revalidate: "/vendas" });
}

export async function deleteSaleAction(_: FormState, form: FormData): Promise<FormState> {
  let number: number;
  try {
    ({ number } = await runService(db(), deleteSale, await currentActor(), { id: str(form, "id") }));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  redirect(`/vendas?aviso=${encodeURIComponent(`Venda nº ${number} excluída por completo.`)}`);
}

export async function receivePaymentAction(_: FormState, form: FormData): Promise<FormState> {
  // Recebe pela venda, por A receber ou pela ficha do cliente: atualiza todas.
  const state = await perform(
    receiveSalePayment,
    { saleId: str(form, "saleId"), method: str(form, "method") as "pix", amount: str(form, "amount"), installmentId: optional(form, "installmentId"), notes: optional(form, "notes") },
    { successMessage: "Pagamento registrado." },
  );
  if (state?.ok) revalidatePath("/", "layout");
  return state;
}

export async function setHandoverDateAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    setHandoverDate,
    { id: str(form, "id"), handoverDate: str(form, "handoverDate") || null },
    { successMessage: str(form, "handoverDate") ? "Data salva." : "Data tirada.", revalidate: "/vendas" },
  );
}

export async function updateSaleAction(_: FormState, form: FormData): Promise<FormState> {
  let items: { productId: string; quantity: string; unitPrice?: string }[];
  try {
    items = JSON.parse(str(form, "items") || "[]");
  } catch {
    return { ok: false, message: "Itens inválidos." };
  }
  try {
    const r = await runService(db(), updateSale, await currentActor(), { id: str(form, "id"), items, reason: optional(form, "reason") });
    revalidatePath("/", "layout");
    return { ok: true, message: `Venda nº ${r.number} corrigida: ${money(r.total)}${Number(r.stillOpen) > 0 ? `. Falta receber ${money(r.stillOpen)}.` : ""}` };
  } catch (err) {
    return toFormState(err);
  }
}

export async function completeFollowupAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    completeSaleFollowup,
    { saleId: str(form, "saleId") },
    { successMessage: str(form, "word") === "delivery" ? "Venda marcada como entregue." : "Venda marcada como retirada.", revalidate: "/vendas" },
  );
}
