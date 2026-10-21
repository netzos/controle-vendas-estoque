"use server";

import { createCustomer, updateCustomer } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

function fields(form: FormData) {
  return {
    kind: str(form, "kind") === "company" ? ("company" as const) : ("person" as const),
    name: str(form, "name"),
    document: optional(form, "document"),
    email: optional(form, "email"),
    phone: optional(form, "phone"),
    city: optional(form, "city"),
    state: optional(form, "state"),
    notes: optional(form, "notes"),
  };
}

export async function createCustomerAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(createCustomer, fields(form), { successMessage: "Cliente cadastrado.", revalidate: "/clientes" });
}

export async function updateCustomerAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateCustomer,
    { ...fields(form), id: str(form, "id"), status: str(form, "status") === "inactive" ? "inactive" : "active" },
    { successMessage: "Cliente salvo.", revalidate: "/clientes" },
  );
}
