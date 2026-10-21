"use client";

import { useActionState } from "react";
import type { Improvement } from "@erp/core";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { commentImprovementAction, createImprovementAction, decideImprovementAction, editImprovementAction } from "./actions";

type Module = { key: string; label: string };

export function NewImprovementForm({ modules }: { modules: readonly Module[] }) {
  const [state, action] = useActionState(createImprovementAction, null);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <Field label="Módulo" name="module" state={state}>
        <select id="module" name="module" defaultValue="geral">
          {modules.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </Field>
      <Field label="Título" name="title" state={state}>
        <input id="title" name="title" required minLength={3} maxLength={200} placeholder="Ex.: Filtrar vendas por vendedor" />
      </Field>
      <Field label="O que você precisa e por quê" name="body" state={state} hint="Descreva a situação, o que o sistema deveria fazer e um exemplo. Não coloque CPF, telefone ou dados de clientes.">
        <textarea id="body" name="body" required rows={6} maxLength={5000} />
      </Field>
      <div className="actions"><SubmitButton pendingText="Registrando...">Registrar pedido</SubmitButton></div>
    </form>
  );
}

export function ReplyForm({ id }: { id: string }) {
  const [state, action] = useActionState(commentImprovementAction, null);
  return (
    <form action={action} className="imp-reply">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <textarea name="body" rows={3} maxLength={5000} required placeholder="Escreva na conversa deste pedido..." aria-label="Mensagem" />
      <div className="actions"><SubmitButton pendingText="Enviando...">Enviar</SubmitButton></div>
    </form>
  );
}

export function DecideForm({ id }: { id: string }) {
  const [state, action] = useActionState(decideImprovementAction, null);
  return (
    <form action={action} className="imp-decide">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <Field label="Comentário da decisão (opcional)" name="note" state={state}>
        <input id="note" name="note" maxLength={1000} placeholder="Ex.: pode fazer, mas só para administradores" />
      </Field>
      <div className="actions">
        <button type="submit" name="decision" value="approve">Aprovar para desenvolver</button>
        <button type="submit" name="decision" value="reject" className="secondary">Recusar</button>
      </div>
    </form>
  );
}

export function CorrectForm({ item }: { item: Improvement }) {
  const [state, action] = useActionState(editImprovementAction, null);
  const d = item.details;
  return (
    <details className="imp-correct">
      <summary>Corrigir pedido</summary>
      <form action={action}>
        <FormMessage state={state} />
        <input type="hidden" name="id" value={item.id} />
        <Field label="Título" name="title" state={state}>
          <input id="c-title" name="title" defaultValue={item.title} minLength={3} maxLength={200} />
        </Field>
        {d ? (
          <>
            <Field label="Problema (por quê)" name="problem" state={state}>
              <textarea id="c-problem" name="problem" rows={3} defaultValue={d.problema} maxLength={1500} />
            </Field>
            <Field label="Proposta" name="proposal" state={state}>
              <textarea id="c-proposal" name="proposal" rows={3} defaultValue={d.proposta} maxLength={2000} />
            </Field>
            <Field label="Como saber que ficou pronto" name="criteria" state={state} hint="Um critério por linha, até 6.">
              <textarea id="c-criteria" name="criteria" rows={3} defaultValue={(d.criterios ?? []).join("\n")} />
            </Field>
          </>
        ) : (
          <Field label="Descrição" name="body" state={state}>
            <textarea id="c-body" name="body" rows={5} defaultValue={item.body} maxLength={5000} />
          </Field>
        )}
        <Field label="Comentário sobre a correção (opcional)" name="comment" state={state}>
          <input id="c-comment" name="comment" maxLength={2000} />
        </Field>
        <div className="actions"><SubmitButton>Salvar correção</SubmitButton></div>
      </form>
    </details>
  );
}
