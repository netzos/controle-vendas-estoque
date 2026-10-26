"use server";

import { recordCommissionPayout, setCommissionRate } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

export async function setRateAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(setCommissionRate, { userId: str(form, "userId"), rate: str(form, "rate") }, { successMessage: "Taxa salva.", revalidate: "/comissoes" });
}

export async function payoutAction(_: FormState, form: FormData): Promise<FormState> {
  const method = optional(form, "method");
  return perform(
    recordCommissionPayout,
    {
      userId: str(form, "userId"),
      month: str(form, "month"),
      amount: str(form, "amount"),
      method: method === "cash" || method === "pix" || method === "other" ? method : undefined,
      notes: optional(form, "notes"),
    },
    { successMessage: "Repasse registrado.", revalidate: "/comissoes" },
  );
}
