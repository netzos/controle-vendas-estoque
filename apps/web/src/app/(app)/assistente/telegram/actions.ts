"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createTelegramLink, getTelegramStatus, unlinkTelegram } from "@erp/core";
import { toFormState, type FormState } from "@/lib/actions";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

/** Botão Telegram (topo, Início e Meu Telegram): já ligado abre a conversa; senão liga a conta com um código. */
export async function connectTelegramAction(_: FormState, form?: FormData): Promise<FormState> {
  const actor = await requirePermission("nets.use");
  let url: string;
  try {
    const status = await getTelegramStatus(db(), actor);
    const open = form?.get("mode") === "open" && status.link?.organizationId === actor.organizationId && status.botUrl;
    url = open || (await createTelegramLink(db(), actor)).url;
  } catch (err) {
    return toFormState(err);
  }
  redirect(url);
}

export async function disconnectTelegramAction(_: FormState): Promise<FormState> {
  const actor = await requirePermission("nets.use");
  await unlinkTelegram(db(), actor);
  revalidatePath("/", "layout");
  return { ok: true, message: "Telegram desligado." };
}
