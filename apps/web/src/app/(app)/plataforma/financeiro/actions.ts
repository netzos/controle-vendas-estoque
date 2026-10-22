"use server";

import { revalidatePath } from "next/cache";
import { savePlatformFixedCost, setPlatformUsdBrl } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { str, toFormState, type FormState } from "@/lib/actions";

const decimal = (v: string) => v.replace(/\./g, "").replace(",", ".");

export async function fixedCostAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await savePlatformFixedCost(db(), (await currentActor()).userId, {
      id: str(form, "id") || undefined,
      name: str(form, "name"),
      monthlyBrl: decimal(str(form, "monthlyBrl")),
      status: str(form, "status") === "inactive" ? "inactive" : "active",
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/plataforma", "layout");
  return { ok: true, message: "Custo salvo." };
}

export async function usdBrlAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await setPlatformUsdBrl(db(), (await currentActor()).userId, { rate: decimal(str(form, "rate")) });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/plataforma", "layout");
  return { ok: true, message: "Cotação salva." };
}
