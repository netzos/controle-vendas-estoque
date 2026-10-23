"use server";

import { revalidatePath } from "next/cache";
import { approveSignup, rejectSignup } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { optional, str, toFormState } from "@/lib/actions";

export type DecisionState = {
  ok: boolean;
  message?: string;
  approved?: { name: string; organizationName: string; whatsapp: string | null; email: string; loginUrl: string; telegramUrl: string | null };
} | null;

export async function approveAction(_: DecisionState, form: FormData): Promise<DecisionState> {
  try {
    const r = await approveSignup(db(), await currentActor(), str(form, "requestId"));
    revalidatePath("/plataforma", "layout");
    return { ok: true, message: `Aprovado. A ${r.organizationName} já está liberada.`, approved: r };
  } catch (err) {
    return { ok: false, message: toFormState(err)?.message };
  }
}

export async function rejectAction(_: DecisionState, form: FormData): Promise<DecisionState> {
  try {
    await rejectSignup(db(), await currentActor(), str(form, "requestId"), optional(form, "reason"));
    revalidatePath("/plataforma", "layout");
    return { ok: true, message: "Pedido recusado." };
  } catch (err) {
    return { ok: false, message: toFormState(err)?.message };
  }
}
