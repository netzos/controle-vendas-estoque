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
    itemType: (["stock", "made_to_order", "service", "production"].find((t) => t === str(form, "itemType")) ?? "stock") as
      "stock" | "made_to_order" | "service" | "production",
    customValues: Object.fromEntries(
      [...form.keys()].filter((k) => k.startsWith("cf_")).map((k) => [k.slice(3), str(form, k)]),
    ),
  };
}

export async function createProductAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(createProduct, { ...fields(form), initialStock: str(form, "initialStock") }, { successMessage: "Produto cadastrado.", revalidate: "/produtos" });
}

export async function updateProductAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateProduct,
    { ...fields(form), id: str(form, "id"), status: str(form, "status") === "inactive" ? "inactive" : "active" },
    { successMessage: "Produto salvo.", revalidate: "/produtos" },
  );
}
