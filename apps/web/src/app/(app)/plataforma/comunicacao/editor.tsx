"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { proposeAction, revertAction, saveAction, versionAction } from "./actions";

export type Request = { id: string; number: string; title: string; body: string; organization: string | null; status: string; open: boolean };
export type Version = { id: number; note: string | null; source: "edit" | "proposal" | "revert" | "seed"; improvementNumber: string | null; by: string; at: string; reads: { web: number; telegram: number; last: string | null } };
type Current = { id: number | null; body: string; by: string | null; at: string | null };

// O que vai ser salvo depois que o administrador vê o antes e depois.
type Review = { text: string; summary: string; note: string; from: "ask" | "edit" | "restore"; restore?: number; improvementId?: string };

const SOURCE: Record<Version["source"], string> = { edit: "Editado à mão", proposal: "Proposta aprovada", revert: "Versão restaurada", seed: "Texto inicial do sistema" };

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
export function Diff({ before, after }: { before: string; after: string }) {
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

export function ManualEditor({ current, request }: { current: Current; request: Request | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "ask" | "edit">("view");
  const [ask, setAsk] = useState("");
  const [askFor, setAskFor] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [, startTransition] = useTransition();
  const started = useRef(false);

  function close() {
    setMode("view"); setReview(null); setAsk(""); setAskFor(undefined); setDraft("");
  }

  async function propose(text: string, improvementId?: string) {
    setBusy("propose"); setError(""); setMessage("");
    const r = await proposeAction(text);
    setBusy("");
    if (!r.ok) { setError(r.message); return; }
    if (r.data.base !== current.id) { setError("O manual mudou enquanto a proposta era preparada. Recarregue a página e gere de novo."); return; }
    setReview({ text: r.data.proposed, summary: r.data.summary, note: (r.data.summary || text).slice(0, 300), from: "ask", improvementId });
  }

  // Veio de "Preparar mudança" num pedido de ajuste: já pede a proposta à IA.
  useEffect(() => {
    if (!request || started.current) return;
    started.current = true;
    const text = `Pedido de ajuste #${request.number}${request.organization ? ` (${request.organization})` : ""}: ${request.title}\n\n${request.body}`;
    setMode("ask"); setAsk(text); setAskFor(request.id);
    void propose(text, request.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  async function apply() {
    if (!review) return;
    setBusy("apply"); setError("");
    const r = await saveAction({ body: review.text, note: review.note, base: current.id, source: review.from === "ask" ? "proposal" : "edit", improvementId: review.improvementId });
    setBusy("");
    if (!r.ok) { setError(r.message); return; }
    setMessage(`Mudança aplicada (versão ${r.data.id}). A Netz já usa o novo texto na próxima mensagem, no painel e no Telegram.`);
    close();
    startTransition(() => router.replace("/plataforma/comunicacao"));
  }

  const linked = askFor && request?.id === askFor ? request : undefined;

  return (
    <>
      {message && <p className="alert success" role="status">{message}</p>}
      {error && <p className="alert error" role="alert">{error}</p>}
      <section className="card">
        <div className="imp-row-head">
          <h2>Manual de comunicação</h2>
          <span className="muted">
            {current.id ? `Versão ${current.id}${current.by ? ` de ${current.by}` : ""}${current.at ? `, ${current.at}` : ""}` : "Versão 0 · texto inicial do sistema"}
          </span>
        </div>
        <p className="muted">A Netz lê este texto antes de cada resposta, no painel e no Telegram, junto com as regras fixas e o jeito anotado da pessoa. Nada é apagado: cada mudança vira uma versão nova na aba Histórico.</p>

        {review ? (
          <div className="comm-review">
            <h3>Confira a mudança antes de aprovar</h3>
            {linked && <p className="muted">Atende o pedido #{linked.number}: {linked.title}. Ao aprovar, ele fica como aplicado e a empresa vê na tela Melhorias.</p>}
            {review.summary && <p>{review.summary}</p>}
            <Diff before={current.body} after={review.text} />
            <details><summary>Ver o texto completo como vai ficar</summary><pre className="comm-text">{review.text}</pre></details>
            <label className="field">
              <span>O que mudou (fica no histórico)</span>
              <input value={review.note} maxLength={300} onChange={(e) => setReview({ ...review, note: e.target.value })} />
            </label>
            <p className="muted">Nada é salvo até você aprovar.</p>
            <div className="actions">
              <button type="button" disabled={!!busy || review.text.trim() === current.body.trim()} onClick={() => void apply()}>{busy === "apply" ? "Aplicando…" : "Aprovar e aplicar"}</button>
              <button type="button" className="secondary" disabled={!!busy} onClick={() => { if (review.from === "edit") setDraft(review.text); setReview(null); }}>
                {review.from === "ask" ? "Ajustar o pedido" : "Voltar a editar"}
              </button>
              <button type="button" className="secondary" disabled={!!busy} onClick={close}>Cancelar</button>
            </div>
          </div>
        ) : mode === "ask" ? (
          <div className="comm-review">
            <label className="field">
              <span>O que a Netz deve fazer diferente?</span>
              <textarea value={ask} rows={5} maxLength={3000} autoFocus placeholder='Ex.: Com quem não gosta de ser cobrado, só lembrar das contas a receber quando a pessoa perguntar ou quando vencer.' onChange={(e) => setAsk(e.target.value)} />
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
              <button type="button" disabled={!!busy} onClick={() => { setMode("ask"); setMessage(""); }}>Pedir uma mudança à IA</button>
              <button type="button" className="secondary" disabled={!!busy} onClick={() => { setDraft(current.body); setMode("edit"); setMessage(""); }}>Editar o texto à mão</button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/** Linha do tempo do manual: cada versão com quem, quando, por quê, quantas respostas leram, o que mudou e restaurar. */
export function History({ versions, currentId, highlight }: { versions: Version[]; currentId: number | null; highlight: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ id: number; kind: "diff" | "text"; body: string; previous: string | null } | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [, startTransition] = useTransition();
  const current = currentId ?? 0;

  async function show(id: number, kind: "diff" | "text") {
    if (open?.id === id && open.kind === kind) { setOpen(null); return; }
    setBusy(`${kind}${id}`); setError("");
    const r = await versionAction(id);
    setBusy("");
    if (!r.ok) { setError(r.message); return; }
    setOpen({ id, kind, body: r.data.body, previous: r.data.previous });
  }

  async function restore(id: number) {
    setBusy(`r${id}`); setError("");
    const r = await revertAction(id, currentId);
    setBusy(""); setConfirm(null);
    if (!r.ok) { setError(r.message); return; }
    setMessage(`Versão ${id} restaurada como versão ${r.data.id}. A Netz já usa este texto na próxima mensagem.`);
    startTransition(() => router.refresh());
  }

  return (
    <section className="card">
      <div className="imp-row-head">
        <h2>Histórico do manual</h2>
        <span className="muted">{versions.length} {versions.length === 1 ? "versão" : "versões"}</span>
      </div>
      <p className="muted">Toda versão fica guardada, do texto inicial até a de agora. &quot;Lida em&quot; conta as respostas da Netz que usaram aquela versão, no painel e no Telegram.</p>
      {message && <p className="alert success" role="status">{message}</p>}
      {error && <p className="alert error" role="alert">{error}</p>}
      <ol className="comm-timeline">
        {versions.map((v) => (
          <li key={v.id} className={`${v.id === current ? "current" : ""} ${highlight === v.id ? "highlight" : ""}`}>
            <div className="comm-timeline-head">
              <b>Versão {v.id}</b>
              {v.id === current && <span className="tag ok">Em uso</span>}
              <span className="muted">{SOURCE[v.source]}{v.by ? ` · ${v.by}` : ""}{v.at ? ` · ${v.at}` : ""}</span>
            </div>
            {v.note && <p>{v.note}</p>}
            <p className="muted small-text">
              {v.improvementNumber && <>Pedido de ajuste #{v.improvementNumber} · </>}
              Lida em {v.reads.web + v.reads.telegram} {v.reads.web + v.reads.telegram === 1 ? "resposta" : "respostas"} ({v.reads.web} no painel, {v.reads.telegram} no Telegram){v.reads.last ? ` · última em ${v.reads.last}` : ""}
            </p>
            <div className="actions">
              {v.id > 0 && <button type="button" className="secondary small" disabled={!!busy} onClick={() => void show(v.id, "diff")}>{open?.id === v.id && open.kind === "diff" ? "Fechar" : "O que mudou"}</button>}
              <button type="button" className="secondary small" disabled={!!busy} onClick={() => void show(v.id, "text")}>{open?.id === v.id && open.kind === "text" ? "Fechar" : "Ver o texto"}</button>
              {v.id !== current && (confirm === v.id ? (
                <>
                  <button type="button" className="small" disabled={!!busy} onClick={() => void restore(v.id)}>{busy === `r${v.id}` ? "Restaurando…" : "Sim, voltar para esta"}</button>
                  <button type="button" className="secondary small" disabled={!!busy} onClick={() => setConfirm(null)}>Não</button>
                </>
              ) : (
                <button type="button" className="secondary small" disabled={!!busy} onClick={() => setConfirm(v.id)}>Restaurar</button>
              ))}
            </div>
            {open?.id === v.id && (open.kind === "diff" ? <Diff before={open.previous ?? ""} after={open.body} /> : <pre className="comm-text">{open.body}</pre>)}
          </li>
        ))}
      </ol>
    </section>
  );
}
