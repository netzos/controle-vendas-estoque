import "server-only";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { isAppError, runService, type RunOptions, type ServiceDefinition } from "@erp/core";
import { currentActor } from "./auth";
import { db } from "./db";

export type FormState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

// Converte erros de domínio em mensagem para o formulário. Erros inesperados
// são registrados no servidor e não expõem detalhes ao usuário.
export function toFormState(err: unknown): FormState {
  if (isAppError(err)) {
    const issues = (err.details?.issues ?? []) as Array<{ path: string; message: string }>;
    const fieldErrors = Object.fromEntries(issues.filter((i) => i.path).map((i) => [i.path, i.message]));
    return { ok: false, message: err.message, fieldErrors };
  }
  console.error("[web] erro inesperado", err);
  return { ok: false, message: "Não foi possível concluir a operação. Tente novamente." };
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

export function optional(form: FormData, key: string): string | null {
  const v = str(form, key).trim();
  return v === "" ? null : v;
}


// Executa um serviço do núcleo com o ator da sessão. É o mesmo caminho que o
// Telegram e a API usarão: permissão, validação, transação, auditoria.
export async function perform<S extends z.ZodType, O>(
  service: ServiceDefinition<S, O>,
  input: z.input<S>,
  opts: { successMessage: string; revalidate?: string; run?: RunOptions },
): Promise<FormState> {
  try {
    const actor = await currentActor();
    await runService(db(), service, actor, input, opts.run);
  } catch (err) {
    return toFormState(err);
  }
  if (opts.revalidate) revalidatePath(opts.revalidate);
  return { ok: true, message: opts.successMessage };
}

// Para leituras em páginas de servidor.
export async function query<S extends z.ZodType, O>(service: ServiceDefinition<S, O>, input: z.input<S>): Promise<O> {
  return runService(db(), service, await currentActor(), input);
}
