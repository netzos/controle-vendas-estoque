"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { proposeAction, revertAction, saveAction, versionAction } from "./actions";

export type Request = { id: string; number: string; title: string; body: string; organization: string | null; status: string; open: boolean };
type Version = { id: number; note: string | null; source: "edit" | "proposal" | "revert"; improvementNumber: string | null; by: string; at: string };
type Current = { id: number | null; body: string; by: string | null; at: string | null };

// O que vai ser salvo depois que o administrador vê o antes e depois.
type Review = { text: string; summary: string; note: string; from: "ask" | "edit" | "restore"; restore?: number; improvementId?: string };

const SOURCE: Record<Version["source"], string> = { edit: "Editado à mão", proposal: "Proposta aprovada", revert: "Versão restaurada" };

// Diferença por linha (maior subsequência comum), suficiente para textos de algumas centenas de linhas.
type Line = { kind: "same" | "add" | "del"; text: string };
function diffLines(before: string, after: string): Line[] {
  const a = before.split("\n"), b = after.split("\n"), n = a.length, m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const out: Line[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i]! }); i++; j++; }
    else if (t[i + 1]![j]! >= t[i]![j + 1]!) out.push({ kind: "del", text: a[i++]! });
    else out.push({ kind: "add", text: b[j++]! });
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

/** Mostra só o que muda, com duas linhas iguais em volta; o resto fica dobrado. */
function Diff({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after);
  const near = lines.map((_, k) => lines.slice(Math.max(0, k - 2), k + 3).some((l) => l.kind !== "same"));
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;
  if (!added && !removed) return <p className="muted">O texto proposto é igual ao atual.</p>;
  const rows: React.ReactNode[] = [];
  let hidden = 0;
  const fold = (k: string) => rows.push(<li key={k} className="fold">… {hidden} {hidden === 1 ? "linha sem mudança" : "linhas sem mudança"} …</li>);
  lines.forEach((l, k) => {
    if (l.kind === "same" && !near[k]) { hidden++; return; }
    if (hidden) { fold(`h${k}`); hidden = 0; }
    rows.push(<li key={k} className={l.kind}><span aria-hidden>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</span>{l.text || " "}</li>);
  });
  if (hidden) fold("end");
  return (
    <div className="comm-diff">
      <p><span className="add">{added} {added === 1 ? "linha entra" : "linhas entram"}</span> <span className="del">{removed} {removed === 1 ? "linha sai" : "linhas saem"}</span></p>
      <ul>{rows}</ul>
    </div>
  );
}

export function ManualEditor({ current, versions, requests, highlight }: { current: Current; versions: Version[]; requests: Request[]; highlight: number | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "ask" | "edit">("view");
  const [ask, setAsk] = useState("");
  const [askFor, setAskFor] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [viewing, setViewing] = useState<{ id: number; body: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [, startTransition] = useTransition();

  function close() {
    setMode("view"); setReview(null); setAsk(""); setAskFor(undefined); setDraft("");
  }

  async function propose(request: string, improvementId?: string) {
    setBusy("propose"); setError(""); setMessage("");
    const r = await proposeAction(request);
    setBusy("");
    if (!r.ok) { setError(r.message); return; }
    if (r.data.base !== current.id) { setError("O manual mudou enquanto a proposta era preparada. Recarregue a página e gere de novo."); return; }
    setReview({ text: r.data.proposed, summary: r.data.summary, note: (r.data.summary || request).slice(0, 300), from: "ask", improvementId });
  }

  async function apply() {
    if (!review) return;
    setBusy("apply"); setError("");
    const r = review.restore
      ? await revertAction(review.restore, current.id)
      : await saveAction({ body: review.text, note: review.note, base: current.id, source: review.from === "ask" ? "proposal" : "edit", improvementId: review.improvementId });
    setBusy("");
    if (!r.ok) { setError(r.message); return; }
    setMessage(review.restore ? "Versão restaurada. A Netz já usa este texto na próxima mensagem." : "Mudança aplicada. A Netz já usa o novo texto na próxima mensagem.");
    close(); setViewing(null);
    startTransition(() => router.refresh());
  }

  async function load(id: number) {
    setBusy(`v${id}`); setError("");
    const r = await versionAction(id);
    setBusy("");
    if (!r.ok) { setError(r.message); return null; }
    return r.data;
  }

  async function view(id: number) {
    if (viewing?.id === id) { setViewing(null); return; }
    const v = await load(id);
    if (v) setViewing({ id: v.id, body: v.body });
  }

  async function restore(v: Version) {
    const d = await load(v.id);
    if (!d) return;
    setMode("view");
    setReview({ text: d.body, summary: `Voltar ao texto de ${v.at}.`, note: "", from: "restore", restore: v.id });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fromRequest(r: Request) {
    const text = `Pedido de ajuste #${r.number}${r.organization ? ` (${r.organization})` : ""}: ${r.title}\n\n${r.body}`;
    setMode("ask"); setAsk(text); setAskFor(r.id); setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    void propose(text, r.id);
  }

  const older = versions.slice(current.id ? 1 : 0);
  const linked = askFor ? requests.find((r) => r.id === askFor) : undefined;

  return (
    <>
      {message && <p className="alert success" role="status">{message}</p>}
      {error && <p className="alert error" role="alert">{error}</p>}
      <section className="card">
        <div className="imp-row-head">
          <h2>Manual de comunicação</h2>
          <span className="muted">
            {current.id ? `Versão ${current.id}${current.by ? ` de ${current.by}` : ""}${current.at ? `, ${current.at}` : ""}` : "Texto inicial do sistema"}
          </span>
        </div>
        <p className="muted">A Netz lê este texto antes de cada resposta, no painel e no Telegram. Nada é apagado: cada mudança vira uma versão nova.</p>

        {review ? (
          <div className="comm-review">
            <h3>{review.from === "restore" ? "Restaurar uma versão anterior" : "Confira a mudança antes de aprovar"}</h3>
            {linked && <p className="muted">Atende o pedido #{linked.number}: {linked.title}. Ao aprovar, ele fica como aplicado e a empresa vê na tela Melhorias.</p>}
            {review.summary && <p>{review.summary}</p>}
            <Diff before={current.body} after={review.text} />
            <details><summary>Ver o texto completo como vai ficar</summary><pre className="comm-text">{review.text}</pre></details>
            {!review.restore && (
              <label className="field">
                <span>O que mudou (fica no histórico)</span>
                <input value={review.note} maxLength={300} onChange={(e) => setReview({ ...review, note: e.target.value })} />
              </label>
            )}
            <p className="muted">Nada é salvo até você aprovar.</p>
            <div className="actions">
              <button type="button" disabled={!!busy || review.text.trim() === current.body.trim()} onClick={() => void apply()}>{busy === "apply" ? "Aplicando…" : "Aprovar e aplicar"}</button>
              {review.from !== "restore" && (
                <button type="button" className="secondary" disabled={!!busy} onClick={() => { if (review.from === "edit") setDraft(review.text); setReview(null); }}>
                  {review.from === "ask" ? "Ajustar o pedido" : "Voltar a editar"}
                </button>
              )}
              <button type="button" className="secondary" disabled={!!busy} onClick={close}>Cancelar</button>
            </div>
          </div>
        ) : mode === "ask" ? (
          <div className="comm-review">
            <label className="field">
              <span>O que a Netz deve fazer diferente?</span>
              <textarea value={ask} rows={5} maxLength={3000} autoFocus placeholder='Ex.: Quando a pessoa disser "vendi um iPhone", perguntar qual modelo e oferecer cadastrar no catálogo, sem fazer várias perguntas de uma vez.' onChange={(e) => setAsk(e.target.value)} />
              <span className="hint">Escreva só a mudança. A IA reescreve o manual mexendo só no necessário, e você vê o antes e depois.</span>
            </label>
            <div className="actions">
              <button type="button" disabled={!!busy || ask.trim().length < 3} onClick={() => void propose(ask, askFor)}>{busy === "propose" ? "Preparando a proposta…" : "Gerar proposta"}</button>
              <button type="button" className="secondary" disabled={!!busy} onClick={close}>Cancelar</button>
            </div>
          </div>
        ) : mode === "edit" ? (
          <div className="comm-review">
            <textarea className="comm-edit" value={draft} rows={22} maxLength={20000} onChange={(e) => setDraft(e.target.value)} />
            <span className="muted">{draft.length.toLocaleString("pt-BR")} de 20.000 caracteres</span>
            <div className="actions">
              <button type="button" disabled={!draft.trim() || draft.trim() === current.body.trim()} onClick={() => setReview({ text: draft.trim(), summary: "", note: "", from: "edit" })}>Revisar mudanças</button>
              <button type="button" className="secondary" onClick={close}>Cancelar</button>
            </div>
          </div>
        ) : (
          <>
            <pre className="comm-text">{current.body}</pre>
            <div className="actions">
              <button type="button" disabled={!!busy} onClick={() => { setMode("ask"); setMessage(""); }}>Pedir uma mudança</button>
              <button type="button" className="secondary" disabled={!!busy} onClick={() => { setDraft(current.body); setMode("edit"); setMessage(""); }}>Editar o texto à mão</button>
            </div>
          </>
        )}

        {older.length > 0 && (
          <details className="comm-history" open={!!highlight}>
            <summary>Versões anteriores ({older.length})</summary>
            <ul className="comm-list">
              {older.map((v) => (
                <li key={v.id} className={highlight === v.id ? "highlight" : ""}>
                  <div>
                    <b>Versão {v.id} · {SOURCE[v.source]} por {v.by}</b>
                    <span className="muted"> · {v.at}</span>
                    {v.improvementNumber && <span className="muted"> · pedido #{v.improvementNumber}</span>}
                    {v.note && <div className="muted">{v.note}</div>}
                  </div>
                  <div className="actions">
                    <button type="button" className="secondary small" disabled={!!busy} onClick={() => void view(v.id)}>{viewing?.id === v.id ? "Fechar" : "Ver"}</button>
                    <button type="button" className="secondary small" disabled={!!busy} onClick={() => void restore(v)}>Restaurar</button>
                  </div>
                  {viewing?.id === v.id && <pre className="comm-text">{viewing.body}</pre>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <div className="imp-row-head">
          <h2>Pedidos de ajuste na comunicação</h2>
          <span className="muted">{requests.length} em aberto</span>
        </div>
        <p className="muted">
          Pedidos do módulo Comunicação da Netz, de todas as empresas. Chegam pela tela Melhorias ou pela própria Netz, quando
          alguém reclama do jeito dela falar. &quot;Preparar mudança&quot; leva o pedido para a IA reescrever o manual; você confere e aprova.
        </p>
        {requests.length === 0 ? (
          <p className="muted">Nenhum pedido em aberto.</p>
        ) : (
          <ul className="comm-list">
            {requests.map((r) => (
              <li key={r.id}>
                <div>
                  <Link href={`/plataforma/melhorias?id=${r.id}`}><b>#{r.number} {r.title}</b></Link>
                  {r.organization && <span className="muted"> · {r.organization}</span>}
                  <div className="muted comm-clip">{r.body}</div>
                </div>
                <div className="actions">
                  <button type="button" className="small" disabled={!!busy || !!review} onClick={() => fromRequest(r)}>{busy === "propose" && askFor === r.id ? "Preparando…" : "Preparar mudança"}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
