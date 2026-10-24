"use client";

import { useActionState } from "react";
import { addMyNoteAction, removeMyNoteAction } from "./actions";

export type MyNote = { id: number; body: string; source: "netz" | "admin" | "person"; at: string };

/** O que a Netz aprendeu sobre a pessoa: ela vê, tira o que não quiser e escreve como prefere ser atendida. */
export function MyNotes({ notes }: { notes: MyNote[] }) {
  const [added, add, adding] = useActionState(addMyNoteAction, null);
  return (
    <>
      {notes.length === 0 ? (
        <p className="muted">Nada ainda. Conforme vocês conversam, a Netz vai aprendendo o seu jeito e anota aqui.</p>
      ) : (
        <ul className="comm-list">
          {notes.map((n) => (
            <li key={n.id}>
              <div>
                {n.body}
                <div className="muted small-text">{n.source === "person" ? "Você escreveu" : n.source === "admin" ? "A equipe do netzsales anotou" : "A Netz percebeu"} · {n.at}</div>
              </div>
              <RemoveNote id={n.id} />
            </li>
          ))}
        </ul>
      )}
      <form action={add} className="comm-review comm-add" key={added?.ok ? "ok" : "form"}>
        <label className="field">
          <span>Quer dizer como prefere ser atendida(o)?</span>
          <textarea name="body" rows={2} maxLength={500} placeholder="Ex.: Prefiro respostas curtas e não gosto de ser lembrado de cobranças." />
          {added && !added.ok && <span className="error">{added.message}</span>}
        </label>
        <div className="actions"><button type="submit" disabled={adding}>{adding ? "Salvando…" : "Salvar"}</button></div>
      </form>
    </>
  );
}

function RemoveNote({ id }: { id: number }) {
  const [state, action, pending] = useActionState(removeMyNoteAction, null);
  return (
    <form action={action} className="actions">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="secondary small" disabled={pending}>{pending ? "Tirando…" : "Tirar"}</button>
      {state && !state.ok && <span className="error">{state.message}</span>}
    </form>
  );
}
