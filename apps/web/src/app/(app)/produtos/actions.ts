"use server";

import { revalidatePath } from "next/cache";
import { addProductImage, createProduct, runService, updateProduct } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { optional, perform, str, toFormState, type FormState } from "@/lib/actions";

function jsonList(form: FormData, name: string): string[] {
  try {
    const v: unknown = JSON.parse(str(form, name) || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

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
    backorder: str(form, "backorder") !== "no",
    afterSaleSteps: jsonList(form, "afterSaleSteps"),
    customValues: Object.fromEntries(
      [...form.keys()].filter((k) => k.startsWith("cf_")).map((k) => [k.slice(3), str(form, k)]),
    ),
  };
}

export async function createProductAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const actor = await currentActor();
    const product = await runService(db(), createProduct, actor, { ...fields(form), initialStock: str(form, "initialStock") });
    // Foto opcional escolhida já no cadastro (reduzida no navegador); as outras entram na ficha.
    const photo = form.get("photo");
    if (photo instanceof Blob && photo.size > 0) {
      await runService(db(), addProductImage, actor, { productId: product.id, data: new Uint8Array(await photo.arrayBuffer()) });
    }
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/produtos");
  return { ok: true, message: "Produto cadastrado." };
}

export async function updateProductAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateProduct,
    { ...fields(form), id: str(form, "id"), status: str(form, "status") === "inactive" ? "inactive" : "active" },
    { successMessage: "Produto salvo.", revalidate: "/produtos" },
  );
}
