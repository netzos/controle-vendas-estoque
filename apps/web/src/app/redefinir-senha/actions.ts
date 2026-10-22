"use server";

import { redirect } from "next/navigation";
import { resetPassword } from "@erp/core";
import { db } from "@/lib/db";
import { str, toFormState, type FormState } from "@/lib/actions";

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  if (str(form, "newPassword") !== str(form, "confirm")) {
    return { ok: false, message: "As senhas não conferem.", fieldErrors: { confirm: "Digite a mesma senha." } };
  }
  try {
    await resetPassword(db(), { token: str(form, "token"), newPassword: str(form, "newPassword") });
  } catch (err) {
    return toFormState(err);
  }
  redirect("/login?senha=nova");
}
