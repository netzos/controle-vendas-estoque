"use server";

import { addMember, createMemberTelegramLink, memberPasswordLink, runService, updateMember } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { optional, perform, str, toFormState, type FormState } from "@/lib/actions";

function branchIds(form: FormData): string[] | null {
  if (str(form, "allBranches") === "1") return null;
  return form.getAll("branchIds").filter((v): v is string => typeof v === "string");
}

export async function addMemberAction(_: FormState, form: FormData): Promise<FormState> {
  const password = str(form, "temporaryPassword");
  return perform(
    addMember,
    {
      email: str(form, "email"),
      name: str(form, "name"),
      roleId: str(form, "roleId"),
      branchIds: branchIds(form),
      temporaryPassword: password || undefined,
    },
    {
      successMessage: password
        ? "Usuário adicionado. No primeiro acesso ele precisará trocar a senha provisória."
        : "Usuário adicionado. Quem ainda não tinha conta recebe um convite por e-mail para criar a senha.",
      revalidate: "/administracao/usuarios",
    },
  );
}

export async function updateMemberAction(_: FormState, form: FormData): Promise<FormState> {
  return perform(
    updateMember,
    {
      membershipId: str(form, "membershipId"),
      roleId: str(form, "roleId"),
      branchIds: branchIds(form),
      status: str(form, "status") === "disabled" ? "disabled" : "active",
      name: optional(form, "name") ?? undefined,
      email: optional(form, "email") ?? undefined,
    },
    { successMessage: "Cadastro atualizado.", revalidate: "/administracao/usuarios" },
  );
}

export type LinkState = { ok: boolean; message?: string; url?: string } | null;

export async function passwordLinkAction(_: LinkState, form: FormData): Promise<LinkState> {
  try {
    const r = await runService(db(), memberPasswordLink, await currentActor(), { membershipId: str(form, "membershipId") });
    return {
      ok: true,
      url: r.url,
      message: `Link para ${r.name} ${r.firstAccess ? "criar a senha" : "trocar a senha"}. Vale por ${r.validFor} e só pode ser usado uma vez.`,
    };
  } catch (err) {
    return { ok: false, message: toFormState(err)?.message };
  }
}

export async function telegramLinkAction(_: LinkState, form: FormData): Promise<LinkState> {
  try {
    const r = await createMemberTelegramLink(db(), await currentActor(), str(form, "membershipId"));
    return { ok: true, url: r.url, message: `Link do Telegram para ${r.name}. Vale por ${r.days} dias e só pode ser usado uma vez.` };
  } catch (err) {
    return { ok: false, message: toFormState(err)?.message };
  }
}
