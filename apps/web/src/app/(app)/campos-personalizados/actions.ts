"use server";

import { createCustomField, updateCustomField } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

function fields(form: FormData) {
  return {
    label: str(form, "label"),
    options: str(form, "options"),
    categoryId: optional(form, "categoryId"),
    required: form.get("required") === "on",
    position: Number(str(form, "position") || "0") || 0,
  };
}

export async function createCustomFieldAction(_: FormState, form: FormData): Promise<FormState> {
  const fieldType = str(form, "fieldType") as "text" | "number" | "date" | "select" | "boolean";
  return perform(createCustomField, { ...fields(form), fieldType }, { successMessage: "Campo criado. Ele já aparece no cadastro dos itens.", revalidate: "/campos-personalizados" });
}

export async function updateCustomFieldAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateCustomField,
    { ...fields(form), id: str(form, "id"), status: str(form, "status") === "inactive" ? "inactive" : "active" },
    { successMessage: "Campo salvo.", revalidate: "/campos-personalizados" },
  );
}
