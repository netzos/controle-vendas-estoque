"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createTelegramLink, unlinkTelegram } from "@erp/core";
import { toFormState, type FormState } from "@/lib/actions";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export async function connectTelegramAction(_: FormState): Promise<FormState> {
  const actor = await requirePermission("nets.use");
  let url: string;
  try {
    url = (await createTelegramLink(db(), actor)).url;
  } catch (err) {
    return toFormState(err);
  }
  redirect(url);
}

export async function disconnectTelegramAction(_: FormState): Promise<FormState> {
  const actor = await requirePermission("nets.use");
  await unlinkTelegram(db(), actor);
  revalidatePath("/assistente/telegram");
  return { ok: true, message: "Telegram desligado." };
}
