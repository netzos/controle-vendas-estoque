"use server";

import { revalidatePath } from "next/cache";
import { importCustomers, runService, type CustomerImportResult } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { optional, str, toFormState, type FormState } from "@/lib/actions";

export type ImportState = (FormState & { result?: CustomerImportResult; confirmed?: boolean }) | null;

export async function importCustomersAction(_: ImportState, form: FormData): Promise<ImportState> {
  const confirm = str(form, "confirm") === "1";
  try {
    const result = await runService(db(), importCustomers, await currentActor(), {
      text: str(form, "text"),
      branchId: optional(form, "branchId"),
      confirm,
    });
    if (confirm) revalidatePath("/clientes");
    return {
      ok: true,
      result,
      confirmed: confirm,
      message: confirm ? `${result.created} ${result.created === 1 ? "cliente cadastrado" : "clientes cadastrados"}.` : undefined,
    };
  } catch (err) {
    return toFormState(err);
  }
}
