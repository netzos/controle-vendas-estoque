"use server";

import { after } from "next/server";
import { addSaleAttachment, recheckSaleAttachment, removeSaleAttachment, runAttachmentChecks } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { optional, perform, str, type FormState } from "@/lib/actions";

/** Confere os comprovantes que esperam conferência, depois de responder à tela. */
async function checkLater() {
  const actor = await currentActor();
  after(() => runAttachmentChecks(db(), { organizationId: actor.organizationId, userId: actor.userId }));
}

export async function addAttachmentAction(form: FormData): Promise<FormState> {
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, message: "Escolha uma foto ou um PDF." };
  const r = await perform(
    addSaleAttachment,
    {
      saleId: str(form, "saleId"),
      installmentId: optional(form, "installmentId"),
      data: new Uint8Array(await file.arrayBuffer()),
      fileName: optional(form, "name"),
    },
    { successMessage: "Comprovante guardado na venda.", revalidate: "/vendas" },
  );
  if (r?.ok) await checkLater();
  return r;
}

export async function removeAttachmentAction(id: string): Promise<FormState> {
  return perform(removeSaleAttachment, { id }, { successMessage: "Comprovante removido.", revalidate: "/vendas" });
}

export async function recheckAttachmentAction(id: string): Promise<FormState> {
  const r = await perform(recheckSaleAttachment, { id }, { successMessage: "Conferindo de novo...", revalidate: "/vendas" });
  if (r?.ok) await checkLater();
  return r;
}
