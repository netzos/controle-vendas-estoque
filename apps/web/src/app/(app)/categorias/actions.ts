"use server";

import { createCategory, createUnit, updateCategory, updateUnit } from "@erp/core";
import { perform, str, type FormState } from "@/lib/actions";

const status = (form: FormData) => (str(form, "status") === "inactive" ? ("inactive" as const) : ("active" as const));

export async function createCategoryAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(createCategory, { name: str(form, "name") }, { successMessage: "Categoria criada.", revalidate: "/categorias" });
}

export async function updateCategoryAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateCategory,
    { id: str(form, "id"), name: str(form, "name"), status: status(form) },
    { successMessage: "Categoria salva.", revalidate: "/categorias" },
  );
}

export async function createUnitAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    createUnit,
    { code: str(form, "code"), name: str(form, "name"), decimals: Number(str(form, "decimals") || 0) },
    { successMessage: "Unidade criada.", revalidate: "/unidades" },
  );
}

export async function updateUnitAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateUnit,
    { id: str(form, "id"), code: str(form, "code"), name: str(form, "name"), decimals: Number(str(form, "decimals") || 0), status: status(form) },
    { successMessage: "Unidade salva.", revalidate: "/unidades" },
  );
}
