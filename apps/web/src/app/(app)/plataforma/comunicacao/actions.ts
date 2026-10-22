"use server";

import { revalidatePath } from "next/cache";
import { getNetsGuidanceVersion, improvementViewer, proposeNetsGuidance, revertNetsGuidance, saveNetsGuidance } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { toFormState } from "@/lib/actions";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, message: toFormState(err)?.message ?? "Não foi possível concluir." };
  }
}

async function viewer() {
  return improvementViewer(db(), await currentActor());
}

function revalidate() {
  revalidatePath("/plataforma/comunicacao");
  revalidatePath("/melhorias");
  revalidatePath("/plataforma/melhorias");
}

export async function proposeAction(request: string) {
  return run(async () => proposeNetsGuidance(db(), await viewer(), { request }));
}

export async function saveAction(input: { body: string; note?: string; base: number | null; source: "edit" | "proposal"; improvementId?: string }) {
  const r = await run(async () => saveNetsGuidance(db(), await viewer(), input));
  if (r.ok) revalidate();
  return r;
}

export async function versionAction(id: number) {
  return run(async () => getNetsGuidanceVersion(db(), await viewer(), id));
}

export async function revertAction(id: number, base: number | null) {
  const r = await run(async () => revertNetsGuidance(db(), await viewer(), id, base));
  if (r.ok) revalidate();
  return r;
}
