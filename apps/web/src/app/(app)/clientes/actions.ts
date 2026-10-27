"use server";

import { revalidatePath } from "next/cache";
import { createCustomer, removeCustomerPhoto, runService, setCustomerPhoto, updateCustomer } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { optional, str, toFormState, type FormState } from "@/lib/actions";

function fields(form: FormData) {
  return {
    kind: str(form, "kind") === "company" ? ("company" as const) : ("person" as const),
    name: str(form, "name"),
    document: optional(form, "document"),
    email: optional(form, "email"),
    phone: optional(form, "phone"),
    zipCode: optional(form, "zipCode"),
    street: optional(form, "street"),
    streetNumber: optional(form, "streetNumber"),
    complement: optional(form, "complement"),
    district: optional(form, "district"),
    city: optional(form, "city"),
    state: optional(form, "state"),
    notes: optional(form, "notes"),
    code: optional(form, "code"),
    customerSince: optional(form, "customerSince"),
    // Sem o campo na tela (empresa com uma filial só), a filial fica como está.
    branchId: form.has("branchId") ? optional(form, "branchId") : undefined,
  };
}

// Foto escolhida no formulário (já reduzida no navegador) ou pedido para tirar.
async function savePhoto(form: FormData, customerId: string) {
  const actor = await currentActor();
  const file = form.get("photo");
  if (file instanceof Blob && file.size > 0) {
    await runService(db(), setCustomerPhoto, actor, { customerId, data: new Uint8Array(await file.arrayBuffer()) });
  } else if (str(form, "photoRemove") === "1") {
    await runService(db(), removeCustomerPhoto, actor, { customerId });
  }
}

export async function createCustomerAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const customer = await runService(db(), createCustomer, await currentActor(), fields(form));
    await savePhoto(form, customer.id);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/clientes");
  return { ok: true, message: "Cliente cadastrado." };
}

export async function updateCustomerAction(_: FormState, form: FormData): Promise<FormState> {
  const id = str(form, "id");
  try {
    await runService(db(), updateCustomer, await currentActor(), { ...fields(form), id, status: str(form, "status") === "inactive" ? "inactive" : "active" });
    await savePhoto(form, id);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/clientes");
  return { ok: true, message: "Cliente salvo." };
}
