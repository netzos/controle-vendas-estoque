"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { cancelSale, createSale, receiveSalePayment, runService } from "@erp/core";
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
    const sale = await runService(db(), createSale, await currentActor(), {
      customerId: optional(form, "customerId"),
      paymentMethod: payments ? undefined : (str(form, "paymentMethod") as "pix"),
      payments,
      installments,
      fulfillment: str(form, "fulfillment") === "delivery" ? "delivery" : "pickup",
      discount: str(form, "discount"),
      notes: optional(form, "notes"),
      items,
      tradeIns,
      followup,
    });
    revalidatePath("/", "layout");
    const open = Number(sale.toPay) - Number(sale.paidTotal);
    return {
      ok: true,
      message: `Venda nº ${sale.number} registrada: ${money(sale.total)}${
        sale.installments.length > 0
          ? `. ${sale.installments.length === 1 ? `A receber ${money(open)}` : `${sale.installments.length} parcelas, total ${money(open)}`}, 1º vencimento ${sale.installments[0]!.dueDate.split("-").reverse().join("/")}.`
          : sale.paymentStatus !== "paid" ? `. Falta receber ${money(open)}.` : ""
      }`,
    };
  } catch (err) {
    return toFormState(err);
  }
}

export async function cancelSaleAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(cancelSale, { id: str(form, "id"), reason: str(form, "reason") }, { successMessage: "Venda cancelada e itens devolvidos ao estoque.", revalidate: "/vendas" });
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
