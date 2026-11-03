"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createWhatsAppLink, getWhatsAppStatus, setWhatsAppOrganization, unlinkWhatsApp, whatsappChatUrl } from "@erp/core";
import { toFormState, type FormState } from "@/lib/actions";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

/** Botão WhatsApp (topo e Meu WhatsApp): já ligado abre a conversa; senão abre com o código de ligação escrito. */
export async function connectWhatsAppAction(_: FormState, form?: FormData): Promise<FormState> {
  const actor = await requirePermission("nets.use");
  let url: string;
  try {
    const status = await getWhatsAppStatus(db(), actor);
    if (form?.get("mode") === "open" && status.link) {
      // Abrir pelo painel leva a Netz para a empresa que está aberta aqui.
      if (status.link.organizationId !== actor.organizationId) await setWhatsAppOrganization(db(), actor, actor.organizationId);
      url = await whatsappChatUrl();
    } else {
      url = (await createWhatsAppLink(db(), actor)).url;
    }
  } catch (err) {
    return toFormState(err);
  }
  redirect(url);
}

export async function disconnectWhatsAppAction(_: FormState): Promise<FormState> {
  const actor = await requirePermission("nets.use");
  await unlinkWhatsApp(db(), actor);
  revalidatePath("/", "layout");
  return { ok: true, message: "WhatsApp desligado." };
}

export async function whatsappOrganizationAction(_: FormState, form: FormData): Promise<FormState> {
  const actor = await requirePermission("nets.use");
  try {
    const r = await setWhatsAppOrganization(db(), actor, String(form.get("organizationId") ?? ""));
    revalidatePath("/assistente/whatsapp");
    return { ok: true, message: `Pronto: no WhatsApp a Netz agora trabalha na empresa ${r.name}. Ela te avisou por lá.` };
  } catch (err) {
    return toFormState(err);
  }
}
