"use server";

import { cancelCost, createCost, createCostType, setCostPart, updateCostType } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

export async function createCostAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    createCost,
    {
      costTypeId: str(form, "costTypeId"),
      amount: str(form, "amount"),
      incurredOn: optional(form, "incurredOn") ?? undefined,
      description: optional(form, "description"),
      productId: optional(form, "productId"),
      supplierId: optional(form, "supplierId"),
    },
    { successMessage: "Custo lançado.", revalidate: "/custos" },
  );
}

export async function cancelCostAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(cancelCost, { id: str(form, "id") }, { successMessage: "Custo cancelado.", revalidate: "/custos" });
}

export async function createCostTypeAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(createCostType, { name: str(form, "name") }, { successMessage: "Tipo criado.", revalidate: "/custos/tipos" });
}

export async function updateCostTypeAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateCostType,
    { id: str(form, "id"), name: str(form, "name"), status: str(form, "status") === "inactive" ? "inactive" : "active" },
    { successMessage: "Tipo salvo.", revalidate: "/custos/tipos" },
  );
}

export async function setCostPartAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    setCostPart,
    {
      productId: str(form, "productId"),
      costTypeId: str(form, "costTypeId"),
      amount: str(form, "amount"),
      validFrom: optional(form, "validFrom") ?? undefined,
      notes: optional(form, "notes"),
    },
    { successMessage: "Custo de obtenção atualizado. O custo do produto já mudou.", revalidate: "/custos/obtencao" },
  );
}
