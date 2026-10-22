"use server";

import { revalidatePath } from "next/cache";
import { createSupplier, removeSupplierProduct, setSupplierProduct, updateSupplier } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

function fields(form: FormData) {
  return {
    name: str(form, "name"),
    tradeName: optional(form, "tradeName"),
    document: optional(form, "document"),
    email: optional(form, "email"),
    phone: optional(form, "phone"),
    contactName: optional(form, "contactName"),
    whatsapp: optional(form, "whatsapp"),
    zipCode: optional(form, "zipCode"),
    street: optional(form, "street"),
    streetNumber: optional(form, "streetNumber"),
    complement: optional(form, "complement"),
    district: optional(form, "district"),
    leadTimeDays: optional(form, "leadTimeDays"),
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

// Preço combinado aparece na ficha do fornecedor e na do produto.
export async function setSupplierPriceAction(_: FormState, form: FormData): Promise<FormState> {
  const state = await perform(
    setSupplierProduct,
    {
      supplierId: str(form, "supplierId"),
      productId: str(form, "productId"),
      agreedPrice: str(form, "agreedPrice"),
      supplierCode: optional(form, "supplierCode"),
      leadTimeDays: optional(form, "leadTimeDays"),
      notes: optional(form, "notes"),
    },
    { successMessage: "Preço combinado salvo.", revalidate: "/fornecedores" },
  );
  if (state?.ok) revalidatePath("/produtos");
  return state;
}

export async function removeSupplierPriceAction(_: FormState, form: FormData): Promise<FormState> {
  const state = await perform(removeSupplierProduct, { id: str(form, "id") }, { successMessage: "Vínculo removido.", revalidate: "/fornecedores" });
  if (state?.ok) revalidatePath("/produtos");
  return state;
}
