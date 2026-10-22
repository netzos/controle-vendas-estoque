"use server";

import { revalidatePath } from "next/cache";
import { setFeature } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { str, toFormState, type FormState } from "@/lib/actions";

export async function setFeatureAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const org = str(form, "organizationId");
    await setFeature(db(), await currentActor(), org || null, str(form, "feature"), str(form, "enabled") === "1");
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
