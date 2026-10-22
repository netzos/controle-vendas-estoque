"use server";

import { addProductImage, removeProductImage, setProductCover } from "@erp/core";
import { perform, str, type FormState } from "@/lib/actions";

export async function addPhotoAction(form: FormData): Promise<FormState> {
  const file = form.get("file");
  if (!(file instanceof Blob)) return { ok: false, message: "Escolha uma foto." };
  const size = (key: string) => {
    const n = Number(str(form, key));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  return perform(
    addProductImage,
    { productId: str(form, "productId"), data: new Uint8Array(await file.arrayBuffer()), width: size("width"), height: size("height") },
    { successMessage: "Foto adicionada.", revalidate: "/produtos" },
  );
}

export async function removePhotoAction(id: string): Promise<FormState> {
  return perform(removeProductImage, { id }, { successMessage: "Foto removida.", revalidate: "/produtos" });
}

export async function coverPhotoAction(id: string): Promise<FormState> {
  return perform(setProductCover, { id }, { successMessage: "Capa definida.", revalidate: "/produtos" });
}
