"use server";

import { revalidatePath } from "next/cache";
import { createSaleFollowup, updateSaleFollowup, updateSaleStep } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

// Etapas aparecem em Entregas e no detalhe da venda.
function refresh(state: FormState): FormState {
  if (state?.ok) {
    revalidatePath("/entregas");
    revalidatePath("/vendas");
  }
  return state;
}

const STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;

export async function updateStepAction(_: FormState, form: FormData): Promise<FormState> {
  const status = STATUSES.find((s) => s === str(form, "status"));
  // Botão rápido manda só a situação; o formulário completo manda o resto.
  const full = form.has("responsible");
  return refresh(await perform(
    updateSaleStep,
    {
      id: str(form, "id"),
      status,
      ...(full
        ? { scheduledFor: optional(form, "scheduledFor"), responsible: optional(form, "responsible"), notes: optional(form, "notes"), cost: str(form, "cost") }
        : {}),
    },
    { successMessage: "Etapa atualizada." },
  ));
}

export async function createFollowupAction(_: FormState, form: FormData): Promise<FormState> {
  const steps = form.getAll("step").map(String).filter((s) => s.trim());
  const other = optional(form, "otherStep");
  if (other) steps.push(other);
  return refresh(await perform(
    createSaleFollowup,
    {
      saleId: str(form, "saleId"),
      address: optional(form, "address"),
      recipient: optional(form, "recipient"),
      phone: optional(form, "phone"),
      steps: steps.length ? steps.map((name) => ({ name, scheduledFor: optional(form, "scheduledFor") })) : undefined,
    },
    { successMessage: "Etapas abertas." },
  ));
}

export async function updateFollowupAction(_: FormState, form: FormData): Promise<FormState> {
  return refresh(await perform(
    updateSaleFollowup,
    { id: str(form, "id"), address: optional(form, "address"), recipient: optional(form, "recipient"), phone: optional(form, "phone"), notes: optional(form, "notes") },
    { successMessage: "Endereço salvo." },
  ));
}
