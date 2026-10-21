"use server";

import { changePassword } from "@erp/core";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { str, toFormState, type FormState } from "@/lib/actions";

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  if (str(form, "newPassword") !== str(form, "confirm")) {
    return { ok: false, message: "As senhas não conferem.", fieldErrors: { confirm: "As senhas não conferem." } };
  }
  try {
    await changePassword(db(), session, { currentPassword: str(form, "currentPassword"), newPassword: str(form, "newPassword") });
    return { ok: true, message: "Senha alterada. As outras sessões abertas foram encerradas." };
  } catch (err) {
    return toFormState(err);
  }
}
