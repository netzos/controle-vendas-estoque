"use server";

import { createSupplier, updateSupplier } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

function fields(form: FormData) {
  return {
    name: str(form, "name"),
    tradeName: optional(form, "tradeName"),
    document: optional(form, "document"),
    email: optional(form, "email"),
    phone: optional(form, "phone"),
    contactName: optional(form, "contactName"),
    city: optional(form, "city"),
    state: optional(form, "state"),
    notes: optional(form, "notes"),
  };
}

export async function createSupplierAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(createSupplier, fields(form), { successMessage: "Fornecedor cadastrado.", revalidate: "/fornecedores" });
}

export async function updateSupplierAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateSupplier,
    { ...fields(form), id: str(form, "id"), status: str(form, "status") === "inactive" ? "inactive" : "active" },
    { successMessage: "Fornecedor salvo.", revalidate: "/fornecedores" },
  );
}
