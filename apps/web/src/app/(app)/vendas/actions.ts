"use server";

import { revalidatePath } from "next/cache";
import { cancelSale, createSale, runService } from "@erp/core";
import { money } from "@/lib/format";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { optional, perform, str, toFormState, type FormState } from "@/lib/actions";

export async function createSaleAction(_: FormState, form: FormData): Promise<FormState> {
  let items: { productId: string; quantity: string; unitPrice?: string }[] = [];
  let tradeIns: { productId?: string | null; name?: string | null; value: string }[] = [];
  try {
    items = JSON.parse(str(form, "items") || "[]");
    tradeIns = JSON.parse(str(form, "tradeIns") || "[]");
  } catch {
    return { ok: false, message: "Itens inválidos." };
  }
  try {
    const sale = await runService(db(), createSale, await currentActor(), {
      customerId: optional(form, "customerId"),
      paymentMethod: str(form, "paymentMethod") as "pix",
      discount: str(form, "discount"),
      notes: optional(form, "notes"),
      items,
      tradeIns,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Venda nº ${sale.number} registrada: ${money(sale.total)}` };
  } catch (err) {
    return toFormState(err);
  }
}

export async function cancelSaleAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(cancelSale, { id: str(form, "id"), reason: str(form, "reason") }, { successMessage: "Venda cancelada e itens devolvidos ao estoque.", revalidate: "/vendas" });
}
