"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { switchOrganization } from "@erp/core";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export async function switchOrganizationAction(form: FormData): Promise<void> {
  const session = await requireSession();
  const id = form.get("organizationId");
  if (typeof id !== "string") return;
  await switchOrganization(db(), session, id);
  revalidatePath("/", "layout");
  redirect("/");
}
