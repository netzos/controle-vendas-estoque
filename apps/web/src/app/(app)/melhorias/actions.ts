"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  analyzeImprovementsWithAI,
  commentImprovement,
  improvementIdByNumber,
  mergeImprovement,
  createImprovement,
  decideImprovement,
  editImprovement,
  improvementViewer,
  type ImprovementModule,
} from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { str, toFormState, type FormState } from "@/lib/actions";

function revalidate() {
  revalidatePath("/melhorias");
  revalidatePath("/plataforma/melhorias");
}

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
  revalidate();
  redirect(`/melhorias?id=${id}&criado=1`);
}

export async function commentImprovementAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await commentImprovement(db(), await viewer(), str(form, "id"), str(form, "body"));
  } catch (err) {
    return toFormState(err);
  }
  revalidate();
  return { ok: true, message: "Mensagem enviada." };
}

export async function decideImprovementAction(_: FormState, form: FormData): Promise<FormState> {
  const decision = str(form, "decision") === "reject" ? "reject" : "approve";
  try {
    await decideImprovement(db(), await viewer(), str(form, "id"), decision, str(form, "note"));
  } catch (err) {
    return toFormState(err);
  }
  revalidate();
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
  revalidate();
  return { ok: true, message: "Pedido corrigido. A correção ficou registrada na conversa." };
}

export async function moveImprovementAction(form: FormData): Promise<void> {
  await editImprovement(db(), await viewer(), str(form, "id"), { module: str(form, "module") as ImprovementModule });
  revalidate();
}

export async function mergeImprovementAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await mergeImprovement(db(), await viewer(), str(form, "id"), str(form, "into"));
  } catch (err) {
    return toFormState(err);
  }
  revalidate();
  return { ok: true, message: "Pedidos juntados. A conversa do principal registrou o pedido parecido." };
}

/** Junta os pedidos de um grupo sugerido pela IA no primeiro número. */
export async function mergeGroupAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const v = await viewer();
    const numbers = str(form, "numbers").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const ids = await Promise.all(numbers.map((n) => improvementIdByNumber(db(), v, n)));
    const [into, ...rest] = ids;
    if (!into || rest.some((x) => !x)) return { ok: false, message: "Algum pedido do grupo não foi encontrado." };
    for (const id of rest) await mergeImprovement(db(), v, id!, into);
  } catch (err) {
    return toFormState(err);
  }
  revalidate();
  return { ok: true, message: "Grupo juntado." };
}

export async function analyzeImprovementsAction(_: FormState): Promise<FormState> {
  try {
    await analyzeImprovementsWithAI(db(), await viewer());
  } catch (err) {
    return toFormState(err);
  }
  revalidate();
  return { ok: true, message: "Análise pronta." };
}
