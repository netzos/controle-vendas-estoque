"use server";

import { revalidatePath } from "next/cache";
import { setCompanyFeature } from "@erp/core";
import { perform, type FormState } from "@/lib/actions";

export async function setFeatureAction(key: string, enabled: boolean): Promise<FormState> {
  const state = await perform(setCompanyFeature, { key, enabled }, { successMessage: enabled ? "Recurso ligado." : "Recurso desligado." });
  // O menu, a venda e os cadastros mudam junto.
  revalidatePath("/", "layout");
  return state;
}
