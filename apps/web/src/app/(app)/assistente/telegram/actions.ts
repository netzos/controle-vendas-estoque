"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createTelegramLink, getTelegramStatus, setTelegramOrganization, unlinkTelegram } from "@erp/core";
import { toFormState, type FormState } from "@/lib/actions";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

/** Botão Telegram (topo, Início e Meu Telegram): já ligado abre a conversa; senão liga a conta com um código. */
export async function connectTelegramAction(_: FormState, form?: FormData): Promise<FormState> {
  const actor = await requirePermission("nets.use");
  let url: string;
  try {
    const status = await getTelegramStatus(db(), actor);
    // Abrir pelo painel leva a Netz para a empresa que está aberta aqui.
    if (form?.get("mode") === "open" && status.link && status.botUrl) {
      if (status.link.organizationId !== actor.organizationId) await setTelegramOrganization(db(), actor, actor.organizationId);
      url = status.botUrl;
    } else {
      url = (await createTelegramLink(db(), actor)).url;
    }
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

/** Meu Telegram: escolhe em qual empresa a Netz do Telegram trabalha. */
export async function telegramOrganizationAction(_: FormState, form: FormData): Promise<FormState> {
  const actor = await requirePermission("nets.use");
  try {
    const r = await setTelegramOrganization(db(), actor, String(form.get("organizationId") ?? ""));
    revalidatePath("/assistente/telegram");
    return { ok: true, message: `Pronto: no Telegram a Netz agora trabalha na empresa ${r.name}. Ela te avisou por lá.` };
  } catch (err) {
    return toFormState(err);
  }
}
