"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  commentImprovement,
  createImprovement,
  decideImprovement,
  editImprovement,
  improvementViewer,
  type ImprovementModule,
} from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { str, toFormState, type FormState } from "@/lib/actions";

async function viewer() {
  return improvementViewer(db(), await currentActor());
}

export async function createImprovementAction(_: FormState, form: FormData): Promise<FormState> {
  let id: string;
  try {
    const item = await createImprovement(db(), await viewer(), {
      title: str(form, "title"),
      body: str(form, "body"),
      module: (str(form, "module") || "geral") as ImprovementModule,
    });
    id = item.id;
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/melhorias");
  redirect(`/melhorias?id=${id}&criado=1`);
}

export async function commentImprovementAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await commentImprovement(db(), await viewer(), str(form, "id"), str(form, "body"));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/melhorias");
  return { ok: true, message: "Mensagem enviada." };
}

export async function decideImprovementAction(_: FormState, form: FormData): Promise<FormState> {
  const decision = str(form, "decision") === "reject" ? "reject" : "approve";
  try {
    await decideImprovement(db(), await viewer(), str(form, "id"), decision, str(form, "note"));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/melhorias");
  return {
    ok: true,
    message: decision === "approve" ? "Pedido aprovado. O Claude vai desenvolver e avisar aqui quando estiver publicado." : "Pedido recusado.",
  };
}

export async function editImprovementAction(_: FormState, form: FormData): Promise<FormState> {
  const lines = (key: string) => str(form, key).split("\n").map((l) => l.trim()).filter(Boolean);
  const hasParts = form.has("problem");
  try {
    await editImprovement(db(), await viewer(), str(form, "id"), {
      title: str(form, "title") || undefined,
      ...(hasParts
        ? { problem: str(form, "problem"), proposal: str(form, "proposal"), criteria: lines("criteria") }
        : { body: str(form, "body") || undefined }),
      comment: str(form, "comment") || undefined,
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/melhorias");
  return { ok: true, message: "Pedido corrigido. A correção ficou registrada na conversa." };
}

export async function moveImprovementAction(form: FormData): Promise<void> {
  await editImprovement(db(), await viewer(), str(form, "id"), { module: str(form, "module") as ImprovementModule });
  revalidatePath("/melhorias");
}
