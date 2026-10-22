"use server";

import { revalidatePath } from "next/cache";
import { createPlatformOrganization, joinOrganizationForSupport, platformOwnerPasswordLink, setOrganizationStatus, switchOrganization } from "@erp/core";
import { redirect } from "next/navigation";
import { currentActor, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { str, toFormState, type FormState } from "@/lib/actions";

export type CreateOrgState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  url?: string;
  ownerName?: string;
  organizationName?: string;
} | null;

export async function createOrganizationAction(_: CreateOrgState, form: FormData): Promise<CreateOrgState> {
  try {
    const actor = await currentActor();
    const organizationName = str(form, "organizationName");
    const r = await createPlatformOrganization(db(), actor, {
      organizationName,
      ownerName: str(form, "ownerName"),
      ownerEmail: str(form, "ownerEmail"),
      joinAsOwner: str(form, "joinAsOwner") === "1",
    });
    revalidatePath("/plataforma", "layout");
    return {
      ok: true,
      organizationName,
      ownerName: r.ownerName,
      url: r.link?.url,
      message: r.link
        ? `Empresa ${organizationName} criada. Mande o link abaixo para ${r.ownerName} criar a senha. Ele vale por ${r.link.validFor} e só pode ser usado uma vez.`
        : `Empresa ${organizationName} criada. ${r.ownerName} já tinha conta: entra com a mesma senha de sempre e escolhe a empresa no topo da tela.`,
    };
  } catch (err) {
    const s = toFormState(err);
    return { ok: false, message: s?.message, fieldErrors: s?.fieldErrors };
  }
}

export type LinkState = { ok: boolean; message?: string; url?: string; name?: string; firstAccess?: boolean } | null;

export async function ownerLinkAction(_: LinkState, form: FormData): Promise<LinkState> {
  try {
    const actor = await currentActor();
    const r = await platformOwnerPasswordLink(db(), actor.userId, str(form, "organizationId"));
    return {
      ok: true,
      url: r.url,
      name: r.name,
      firstAccess: r.firstAccess,
      message: `Link para ${r.name} ${r.firstAccess ? "criar a senha" : "trocar a senha"}. Vale por ${r.validFor} e só pode ser usado uma vez.`,
    };
  } catch (err) {
    return { ok: false, message: toFormState(err)?.message };
  }
}

export async function organizationStatusAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const actor = await currentActor();
    const status = str(form, "status") === "suspended" ? "suspended" : "active";
    await setOrganizationStatus(db(), actor, str(form, "organizationId"), status);
    revalidatePath("/plataforma", "layout");
    return { ok: true, message: status === "suspended" ? "Empresa suspensa. Ninguém entra nela até você reativar." : "Empresa reativada." };
  } catch (err) {
    return toFormState(err);
  }
}

/** Abre a empresa (entrando para dar suporte se ainda não participa) e vai para a tela inicial dela. */
export async function openOrganizationAction(form: FormData): Promise<void> {
  const actor = await currentActor();
  const id = str(form, "organizationId");
  if (str(form, "join") === "1") await joinOrganizationForSupport(db(), actor, id);
  await switchOrganization(db(), await requireSession(), id);
  revalidatePath("/", "layout");
  redirect("/");
}
