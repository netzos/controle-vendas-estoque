"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { changeSaleDateAction } from "./actions";

/**
 * Melhoria 27: trocar o dia de uma venda já registrada. Fica fechado por
 * padrão e pede três conferências: o novo dia, repetir o número da venda e o
 * motivo. Quem trocou fica no histórico de alterações.
 */
export function SaleDateForm({ saleId, number, soldOn, today }: { saleId: string; number: number; soldOn: string; today: string }) {
  const [state, action] = useActionState(changeSaleDateAction, null);
  return (
    <details className="sale-date-form">
      <summary>Trocar o dia da venda</summary>
      <form action={action} className="stack">
        <FormMessage state={state} />
        <input type="hidden" name="id" value={saleId} />
        <p className="muted">
          Use quando a venda foi lançada com o dia errado. O número, os pagamentos e o estoque não mudam.
          Fica registrado quem trocou, quando e por quê.
        </p>
        <label htmlFor="soldOn">1. Dia em que a venda aconteceu</label>
        <input id="soldOn" name="soldOn" type="date" max={today} defaultValue={soldOn} key={soldOn} required />
        <label htmlFor="confirmNumber">2. Para confirmar, digite o número da venda ({number})</label>
        <input id="confirmNumber" name="confirmNumber" inputMode="numeric" autoComplete="off" required />
        <label htmlFor="dateReason">3. Motivo</label>
        <input id="dateReason" name="reason" placeholder="Ex.: lancei hoje, mas a venda foi no dia 22" minLength={5} maxLength={300} required />
        <SubmitButton className="secondary small" pendingText="Trocando...">Trocar o dia</SubmitButton>
      </form>
    </details>
  );
}
