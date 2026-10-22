"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { SaleStep } from "@erp/core";
import { STEP_STATUS, STEP_SUGGESTIONS, type StepStatus } from "@erp/core/labels";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { money } from "@/lib/format";
import { createFollowupAction, updateStepAction } from "./actions";

const dateLabel = (d: string) => d.split("-").reverse().join("/");
const tone: Record<StepStatus, string> = { pending: "", in_progress: "run", done: "ok", cancelled: "off" };

// Próximo passo de cada situação, em um toque.
const NEXT: Record<StepStatus, { status: StepStatus; label: string }[]> = {
  pending: [{ status: "in_progress", label: "Começar" }, { status: "done", label: "Concluir" }],
  in_progress: [{ status: "done", label: "Concluir" }],
  done: [{ status: "in_progress", label: "Reabrir" }],
  cancelled: [{ status: "pending", label: "Reabrir" }],
};

function QuickStatus({ id, status, label }: { id: string; status: StepStatus; label: string }) {
  const [state, action] = useActionState(updateStepAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      {state && !state.ok ? (
        <span className="warn-text">{state.message}</span>
      ) : (
        <SubmitButton className={status === "done" ? "small" : "secondary small"} pendingText="...">{label}</SubmitButton>
      )}
    </form>
  );
}

function StepEdit({ step, today }: { step: SaleStep; today: string }) {
  const [state, action] = useActionState(updateStepAction, null);
  const p = `st-${step.id}-`;
  return (
    <form action={action} className="step-edit">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={step.id} />
      <div className="grid-3">
        <Field label="Situação" name="status" state={state}>
          <select id={`${p}status`} name="status" defaultValue={step.status}>
            {(Object.keys(STEP_STATUS) as StepStatus[]).map((s) => <option key={s} value={s}>{STEP_STATUS[s]}</option>)}
          </select>
        </Field>
        <Field label="Prazo" name="scheduledFor" state={state}>
          <input id={`${p}date`} name="scheduledFor" type="date" defaultValue={step.scheduledFor ?? ""} min={step.scheduledFor && step.scheduledFor < today ? undefined : today} />
        </Field>
        <Field label="Responsável" name="responsible" state={state}>
          <input id={`${p}resp`} name="responsible" defaultValue={step.responsible ?? ""} maxLength={120} placeholder="Quem faz" />
        </Field>
        <Field label="Custo (R$)" name="cost" state={state} hint="Entra em Custos.">
          <input id={`${p}cost`} name="cost" inputMode="decimal" defaultValue={Number(step.cost) ? step.cost.replace(".", ",") : ""} placeholder="0,00" />
        </Field>
        <Field label="Observação" name="notes" state={state}>
          <input id={`${p}notes`} name="notes" defaultValue={step.notes ?? ""} maxLength={500} />
        </Field>
      </div>
      <div className="actions"><SubmitButton className="small">Salvar</SubmitButton></div>
    </form>
  );
}

export function StepRow({ step, today, canManage, showSale = true }: { step: SaleStep; today: string; canManage: boolean; showSale?: boolean }) {
  const [editing, setEditing] = useState(false);
  const when = step.scheduledFor
    ? step.scheduledFor === today ? "hoje" : dateLabel(step.scheduledFor)
    : "sem prazo";
  return (
    <li className={`step-row${step.late ? " late" : ""}`}>
      <div className="step-main">
        <div className="step-title">
          <strong>{step.name}</strong>
          {showSale && (
            <Link href={`/vendas?id=${step.saleId}`} className="muted">
              Venda nº {step.saleNumber}{step.customerName ? ` · ${step.customerName}` : ""}
            </Link>
          )}
        </div>
        <div className="step-meta muted">
          <span className={step.late ? "warn-text" : ""}>{step.late ? `atrasada · era ${when}` : when}</span>
          {step.responsible && <span>· {step.responsible}</span>}
          {Number(step.cost) > 0 && <span>· custo {money(step.cost)}</span>}
          {showSale && step.address && <span>· {step.address}</span>}
          {showSale && step.phone && <span>· {step.phone}</span>}
        </div>
        {step.notes && <small className="muted">{step.notes}</small>}
      </div>
      <span className={`tag ${tone[step.status]}`}>{STEP_STATUS[step.status]}</span>
      {canManage && (
        <div className="row-actions">
          {NEXT[step.status].map((n) => <QuickStatus key={n.status} id={step.id} status={n.status} label={n.label} />)}
          <button type="button" className="secondary small" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            {editing ? "Fechar" : "Editar"}
          </button>
        </div>
      )}
      {editing && <StepEdit step={step} today={today} />}
    </li>
  );
}

export function AddStepsForm({ saleId, hasFollowup, today }: { saleId: string; hasFollowup: boolean; today: string }) {
  const [state, action] = useActionState(createFollowupAction, null);
  return (
    <details className="imp-correct">
      <summary>{hasFollowup ? "Acrescentar etapa" : "Abrir etapas depois da venda (entrega, instalação...)"}</summary>
      <form action={action}>
        <FormMessage state={state} />
        <input type="hidden" name="saleId" value={saleId} />
        <div className="check-row">
          {STEP_SUGGESTIONS.map((s) => (
            <label className="check" key={s}><input type="checkbox" name="step" value={s} /> {s}</label>
          ))}
        </div>
        <div className="grid-3">
          <Field label="Outra etapa" name="otherStep" state={state}>
            <input id={`os-${saleId}`} name="otherStep" maxLength={60} placeholder="Ex.: Pintura" />
          </Field>
          <Field label="Prazo" name="scheduledFor" state={state}>
            <input id={`sf-${saleId}`} name="scheduledFor" type="date" min={today} />
          </Field>
          {!hasFollowup && (
            <Field label="Endereço" name="address" state={state}>
              <input id={`ad-${saleId}`} name="address" maxLength={300} />
            </Field>
          )}
        </div>
        <SubmitButton className="small">Abrir etapas</SubmitButton>
      </form>
    </details>
  );
}
