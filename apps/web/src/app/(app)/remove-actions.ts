"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { REMOVABLE_KINDS, removeRecord, runService, type RemovableKind } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { str, toFormState, type FormState } from "@/lib/actions";

export async function removeRecordAction(_: FormState, form: FormData): Promise<FormState> {
  const kind = str(form, "kind") as RemovableKind;
  if (!REMOVABLE_KINDS.includes(kind)) return { ok: false, message: "Cadastro inválido." };
  const back = str(form, "back");
  let message: string;
  try {
    ({ message } = await runService(db(), removeRecord, await currentActor(), { kind, id: str(form, "id") }));
  } catch (err) {
    return toFormState(err);
  }
  const path = back.split("?")[0] || "/";
  revalidatePath(path);
  // Voltar para a lista com o aviso do que aconteceu (apagado ou desativado).
  if (back.startsWith("/")) redirect(`${path}?aviso=${encodeURIComponent(message)}`);
  return { ok: true, message };
}
