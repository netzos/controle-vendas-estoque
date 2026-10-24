"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addNoteAction, removeNoteAction } from "./actions";

export type Note = { id: number; body: string; source: "netz" | "admin" | "person"; active: boolean; at: string; ended: string | null; endedReason: "replaced" | "removed" | null; replaces: number | null };

const SOURCE: Record<Note["source"], string> = { netz: "Anotado pela Netz", admin: "Anotado por você", person: "Escrito pela própria pessoa" };

/** Notas de uma pessoa: as ativas (que a Netz lê) e o histórico das que saíram. */
export function PersonNotes({ organizationId, userId, notes }: { organizationId: string; userId: string; notes: Note[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [, startTransition] = useTransition();
  const active = notes.filter((n) => n.active);
  const ended = notes.filter((n) => !n.active);

  async function save() {
    setBusy("add"); setError("");
    const r = await addNoteAction(organizationId, userId, text, editing ?? undefined);
    setBusy("");
    if (!r.ok) { setError(r.message); return; }
    setText(""); setEditing(null);
    startTransition(() => router.refresh());
  }

  async function remove(id: number) {
    setBusy(`x${id}`); setError("");
    const r = await removeNoteAction(id);
    setBusy("");
    if (!r.ok) { setError(r.message); return; }
    startTransition(() => router.refresh());
  }

  return (
    <>
      {error && <p className="alert error" role="alert">{error}</p>}
      {active.length === 0 ? (
        <p className="muted">Nada anotado ainda. A Netz anota quando o jeito da pessoa fica claro nas conversas.</p>
      ) : (
        <ul className="comm-list">
          {active.map((n) => (
            <li key={n.id}>
              <div>
                <b>#{n.id}</b> {n.body}
                <div className="muted small-text">{SOURCE[n.source]} · {n.at}{n.replaces ? ` · atualiza a #${n.replaces}` : ""}</div>
              </div>
              <div className="actions">
                <button type="button" className="secondary small" disabled={!!busy} onClick={() => { setEditing(n.id); setText(n.body); }}>Corrigir</button>
                <button type="button" className="secondary small" disabled={!!busy} onClick={() => void remove(n.id)}>{busy === `x${n.id}` ? "Tirando…" : "Tirar"}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="comm-review comm-add">
        <label className="field">
          <span>{editing ? `Corrigir a nota #${editing} (a antiga fica no histórico)` : "Anotar algo sobre o jeito desta pessoa"}</span>
          <textarea rows={2} maxLength={500} value={text} placeholder="Ex.: Gosta de tudo organizado; pode lembrar das contas a receber toda segunda." onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" disabled={!!busy || text.trim().length < 3} onClick={() => void save()}>{busy === "add" ? "Salvando…" : editing ? "Salvar correção" : "Anotar"}</button>
          {editing && <button type="button" className="secondary" disabled={!!busy} onClick={() => { setEditing(null); setText(""); }}>Cancelar</button>}
        </div>
      </div>
      {ended.length > 0 && (
        <details className="comm-history">
          <summary>Notas que saíram ({ended.length})</summary>
          <ul className="comm-list">
            {ended.map((n) => (
              <li key={n.id}>
                <div>
                  <span className="strike">#{n.id} {n.body}</span>
                  <div className="muted small-text">{SOURCE[n.source]} · {n.at} · {n.endedReason === "replaced" ? "substituída" : "tirada"}{n.ended ? ` em ${n.ended}` : ""}</div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
