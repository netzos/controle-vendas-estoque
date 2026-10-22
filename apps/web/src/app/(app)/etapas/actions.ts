"use server";

import { createStepType, updateStepType } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

function fields(form: FormData) {
  return {
    name: str(form, "name"),
    description: optional(form, "description"),
    defaultDays: str(form, "defaultDays"),
    defaultResponsible: optional(form, "defaultResponsible"),
    defaultCost: str(form, "defaultCost"),
  };
}

export async function createStepTypeAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(createStepType, fields(form), { successMessage: "Etapa criada.", revalidate: "/etapas" });
}

export async function updateStepTypeAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateStepType,
    { ...fields(form), id: str(form, "id"), status: str(form, "status") === "inactive" ? "inactive" : "active" },
    { successMessage: "Etapa salva.", revalidate: "/etapas" },
  );
}
