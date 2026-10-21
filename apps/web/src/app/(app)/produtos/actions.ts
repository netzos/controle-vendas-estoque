"use server";

import { createProduct, updateProduct } from "@erp/core";
import { optional, perform, str, type FormState } from "@/lib/actions";

function fields(form: FormData) {
  return {
    sku: str(form, "sku"),
    barcode: optional(form, "barcode"),
    name: str(form, "name"),
    description: optional(form, "description"),
    categoryId: optional(form, "categoryId"),
    unitId: str(form, "unitId"),
    supplierId: optional(form, "supplierId"),
    salePrice: str(form, "salePrice"),
    costPrice: str(form, "costPrice"),
    minStock: str(form, "minStock"),
  };
}

export async function createProductAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(createProduct, fields(form), { successMessage: "Produto cadastrado.", revalidate: "/produtos" });
}

export async function updateProductAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateProduct,
    { ...fields(form), id: str(form, "id"), status: str(form, "status") === "inactive" ? "inactive" : "active" },
    { successMessage: "Produto salvo.", revalidate: "/produtos" },
  );
}
