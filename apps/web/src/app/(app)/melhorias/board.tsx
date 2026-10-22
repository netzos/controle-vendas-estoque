import Link from "next/link";
import {
  getImprovement,
  latestImprovementAnalysis,
  listPlatformOrganizations,
  getOrganization,
  improvementViewer,
  IMPROVEMENT_MODULES,
  isAppError,
  listImprovements,
  type AuthorKind,
  type Improvement,
  type ImprovementModule,
  type ImprovementSource,
  type ImprovementStatus,
} from "@erp/core";
import { currentActor } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { moveImprovementAction } from "./actions";
import { AnalyzeButton, CorrectForm, ExecuteAnalysisButton, DecideForm, MergeForm, MergeGroupButton, NewImprovementForm, ReplyForm } from "./forms";

const STATUS_LABEL: Record<ImprovementStatus, string> = {
  new: "Novo",
  analysis: "Em análise",
  approved: "Aprovado",
  building: "Em desenvolvimento",
  published: "Publicado",
  rejected: "Recusado",
};
const STATUS_TONE: Record<ImprovementStatus, string> = {
  new: "", analysis: "", approved: "ok", building: "ok", published: "ok", rejected: "off",
};
const SOURCE_LABEL: Record<ImprovementSource, string> = {
  site: "Pelo painel",
  telegram: "Pelo Telegram",
  erp_ai: "Percebido pela IA do sistema",
  claude: "Sugerido pelo Claude",
};
const TABS = [
  { key: "abertos", label: "Em aberto", has: ["new", "analysis", "approved", "building"] },
  { key: "publicados", label: "Publicados", has: ["published"] },
  { key: "recusados", label: "Recusados", has: ["rejected"] },
] as const;

const moduleLabel = (key: string) => IMPROVEMENT_MODULES.find((m) => m.key === key)?.label ?? key;
const origin = (i: Improvement) =>
  i.source === "site" || i.source === "telegram" ? `${SOURCE_LABEL[i.source]} · ${i.createdByName}` : SOURCE_LABEL[i.source];
const authorLabel = (kind: AuthorKind, name: string) =>
  kind === "claude" ? "Claude · desenvolvimento" : kind === "erp_ai" ? "IA do sistema" : name;

export type Search = { aba?: string; modulo?: string; empresa?: string; id?: string; novo?: string; criado?: string };

/**
 * Quadro de melhorias. "company": a tela Melhorias de cada empresa, só com os
 * pedidos dela (vale também para o desenvolvedor). "platform": Plataforma ›
 * Melhorias, com os pedidos de todas as empresas, decisão, junção e análise da IA.
 */
export async function ImprovementsBoard({ mode, searchParams }: { mode: "company" | "platform"; searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const actor = await currentActor();
  const [viewer, org] = await Promise.all([improvementViewer(db(), actor), query(getOrganization, {})]);
  const platform = mode === "platform" && viewer.isDeveloper;
  const base = platform ? "/plataforma/melhorias" : "/melhorias";
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: org.timezone });
  const tab = TABS.find((t) => t.key === sp.aba) ?? TABS[0];
  const moduleFilter = IMPROVEMENT_MODULES.some((m) => m.key === sp.modulo) ? (sp.modulo as ImprovementModule) : undefined;
  const companies = platform ? await listPlatformOrganizations(db(), actor.userId) : [];
  const companyFilter = platform ? companies.find((c) => c.id === sp.empresa)?.id : undefined;

  const all = await listImprovements(db(), viewer, platform
    ? { organizationId: companyFilter }
    : { organizationId: viewer.organizationId, includeMerged: true });
  const analysis = platform ? await latestImprovementAnalysis(db(), viewer) : null;
  const byNumber = new Map(all.map((i) => [Number(i.number), i]));
  const moduleCount = (key: string) => all.filter((i) => i.module === key && (tab.has as readonly string[]).includes(i.status)).length;
  const inTab = all.filter((i) => (tab.has as readonly string[]).includes(i.status));
  const filtered = moduleFilter ? inTab.filter((i) => i.module === moduleFilter) : inTab;
  const shown = platform ? [...filtered].sort((x, y) => y.requests - x.requests) : filtered;
  let detail: Awaited<ReturnType<typeof getImprovement>> | null = null;
  if (sp.id) {
    try {
      detail = await getImprovement(db(), viewer, sp.id);
    } catch (err) {
      if (!isAppError(err)) throw err;
    }
  }
  const href = (p: Partial<Search>) => {
    const q = new URLSearchParams();
    const merged = { aba: tab.key, modulo: moduleFilter, empresa: companyFilter, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `${base}?${q}`;
  };
  const d = detail?.item;
  const canCorrect = d && !d.mergedInto && (platform || d.createdBy === viewer.userId) && (d.status === "new" || d.status === "analysis" || d.status === "approved");
  const mergeTargets = platform && d && !d.mergedInto ? all.filter((i) => i.id !== d.id && (i.status === "new" || i.status === "analysis" || i.status === "approved" || i.status === "building")) : [];

  return (
    <>
      <div className="page-header">
        <h1>Melhorias</h1>
        {platform ? (
          <p>
            Pedidos de todas as empresas, do mais pedido para o menos pedido. Junte os parecidos, aprove ou recuse. O que você
            decide aqui aparece para a empresa que pediu.
          </p>
        ) : (
          <p>
            Pedidos de mudança no sistema e a conversa sobre cada um. Qualquer pessoa da empresa pode pedir. O Claude, que
            desenvolve o sistema, responde os pedidos novos com uma análise. A equipe do netzsales aprova ou recusa, e o que for
            aprovado o Claude desenvolve, publica e registra aqui.
          </p>
        )}
      </div>
      <ol className="imp-steps card">
        <li><b>Pedido</b><span>painel ou IA</span></li>
        <li><b>Análise</b><span>Claude responde</span></li>
        <li><b>Decisão</b><span>desenvolvedor aprova</span></li>
        <li><b>Publicação</b><span>Claude desenvolve e avisa</span></li>
      </ol>
      {!platform && viewer.isDeveloper && (
        <p className="muted">Aqui aparecem só os pedidos desta empresa. Para ver os de todas e decidir, use <Link href="/plataforma/melhorias">Plataforma › Melhorias</Link>.</p>
      )}
      {platform && (
        <section className="card imp-analysis">
          <div className="imp-row-head">
            <h2>Análise da IA</h2>
            <AnalyzeButton />
          </div>
          {!analysis ? (
            <p className="muted">A IA lê todos os pedidos em aberto, sugere quais juntar e resume o que cada empresa precisa.</p>
          ) : (
            <>
              <p className="muted">Feita em {fmt.format(new Date(analysis.createdAt))}, com {analysis.items} pedidos em aberto.</p>
              {analysis.result.resumo && <p>{analysis.result.resumo}</p>}
              {analysis.result.prioridades.length > 0 && (
                <>
                  <h3>Prioridades</h3>
                  <ol>
                    {analysis.result.prioridades.map((p) => (
                      <li key={p.numero}>
                        <Link href={href({ id: byNumber.get(p.numero)?.id, aba: "abertos" })}>#{p.numero} {byNumber.get(p.numero)?.title ?? ""}</Link>: {p.motivo}
                      </li>
                    ))}
                  </ol>
                  {analysis.executedAt ? (
                    <p className="imp-execute ok">Mandado executar em {fmt.format(new Date(analysis.executedAt))}. Acompanhe cada pedido abaixo.</p>
                  ) : (
                    (() => {
                      const open = analysis.result.prioridades.map((p) => p.numero).filter((n) => { const i = byNumber.get(n); return !!i && !i.mergedInto && ["new", "analysis", "approved", "building"].includes(i.status); });
                      return open.length > 0 ? <ExecuteAnalysisButton analysisId={analysis.id} numbers={open} /> : null;
                    })()
                  )}
                </>
              )}
              {analysis.result.grupos.length > 0 && (
                <>
                  <h3>Pedidos que parecem a mesma coisa</h3>
                  <ul className="imp-groups">
                    {analysis.result.grupos.map((g) => {
                      const open = g.numeros.filter((n) => byNumber.has(n));
                      return (
                        <li key={g.numeros.join("-")}>
                          <b>{g.titulo}</b>: {g.numeros.map((n) => `#${n}`).join(", ")}. <span className="muted">{g.motivo}</span>
                          {open.length >= 2 && <MergeGroupButton numbers={open} />}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {analysis.result.necessidades.length > 0 && (
                <>
                  <h3>O que cada empresa precisa</h3>
                  <ul>
                    {analysis.result.necessidades.map((n) => <li key={n.empresa}><b>{n.empresa}</b>: {n.resumo}</li>)}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      )}

      <div className="imp-layout">
        <section className="card imp-list">
          <div className="imp-toolbar">
            <nav className="imp-tabs" aria-label="Situação">
              {TABS.map((t) => (
                <Link key={t.key} href={href({ aba: t.key, id: undefined })} className={t.key === tab.key ? "active" : ""}>
                  {t.label} <span>{all.filter((i) => (t.has as readonly string[]).includes(i.status) && (!moduleFilter || i.module === moduleFilter)).length}</span>
                </Link>
              ))}
            </nav>
            {!platform && <Link className="button" href={href({ novo: "1", id: undefined })}>Novo pedido</Link>}
          </div>
          <form method="get" className="imp-filter">
            <input type="hidden" name="aba" value={tab.key} />
            <label htmlFor="modulo">Categoria</label>
            <select id="modulo" name="modulo" defaultValue={moduleFilter ?? ""}>
              <option value="">Todas as categorias</option>
              {IMPROVEMENT_MODULES.map((m) => <option key={m.key} value={m.key}>{m.label}{platform ? ` (${moduleCount(m.key)})` : ""}</option>)}
            </select>
            {platform && (
              <select name="empresa" defaultValue={companyFilter ?? ""} aria-label="Empresa">
                <option value="">Todas as empresas</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button type="submit" className="secondary">Filtrar</button>
          </form>
          {shown.length === 0 ? (
            <p className="muted">{tab.key === "abertos" ? "Nenhum pedido em aberto." : "Nada por aqui ainda."}</p>
          ) : (
            <ul className="imp-items">
              {shown.map((i) => (
                <li key={i.id}>
                  <Link href={href({ id: i.id })} className={i.id === sp.id ? "active" : ""}>
                    <span className="imp-row-head">
                      <span>
                        <span className={`tag ${STATUS_TONE[i.status]}`}>{STATUS_LABEL[i.status]}</span>{" "}
                        <span className="tag">{moduleLabel(i.module)}</span>
                      </span>
                      <time>{fmt.format(new Date(i.updatedAt))}</time>
                    </span>
                    <strong>#{i.number} {i.title}{platform && i.requests > 1 ? ` · pedido ${i.requests} vezes` : ""}</strong>
                    <small>
                      {origin(i)}
                      {platform && i.organizations.length ? ` · ${i.organizations.join(", ")}` : ""}
                      {i.mergedInto ? ` · juntado ao #${i.mergedIntoNumber}` : ""}
                      {i.messages ? ` · ${i.messages} ${i.messages === 1 ? "mensagem" : "mensagens"}` : ""}
                      {i.last ? ` · última de ${authorLabel(i.last.kind, i.last.name)}` : ""}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card imp-detail">
          {sp.novo === "1" ? (
            <>
              <h2>Novo pedido</h2>
              <NewImprovementForm modules={IMPROVEMENT_MODULES} />
            </>
          ) : !d ? (
            <p className="muted">{sp.id ? "Pedido não encontrado." : "Escolha um pedido para ver a conversa ou registre um novo."}</p>
          ) : (
            <>
              {sp.criado === "1" && <div className="alert success">Pedido registrado. O Claude responde com uma análise na próxima conferência.</div>}
              <div className="imp-row-head">
                <span>
                  <span className={`tag ${STATUS_TONE[d.status]}`}>{STATUS_LABEL[d.status]}</span>{" "}
                  {platform ? (
                    <form action={moveImprovementAction} className="imp-inline">
                      <input type="hidden" name="id" value={d.id} />
                      <select name="module" defaultValue={d.module} aria-label="Módulo do pedido">
                        {IMPROVEMENT_MODULES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                      <button type="submit" className="secondary">Mover</button>
                    </form>
                  ) : (
                    <span className="tag">{moduleLabel(d.module)}</span>
                  )}
                </span>
                <time>{fmt.format(new Date(d.createdAt))}</time>
              </div>
              <h2>#{d.number} {d.title}</h2>
              <p className="muted">
                {origin(d)}
                {platform && d.organizations.length ? ` · ${d.organizations.join(", ")}` : ""}
                {platform && d.requests > 1 ? ` · pedido ${d.requests} vezes` : ""}
                {d.mergedInto ? ` · juntado ao pedido #${d.mergedIntoNumber}, que trata da mesma necessidade` : ""}
                {d.decidedByName && d.decidedAt ? ` · ${d.status === "rejected" ? "recusado" : "aprovado"} por ${d.decidedByName} em ${fmt.format(new Date(d.decidedAt))}` : ""}
              </p>
              <p className="imp-body">{d.body}</p>
              {d.link && (
                <p><a href={d.link} target="_blank" rel="noreferrer">Ver a mudança publicada</a></p>
              )}
              {canCorrect && <CorrectForm item={d} />}
              <ol className="imp-thread">
                {detail!.messages.map((m) => (
                  <li key={m.id} className={`from-${m.kind}`}>
                    <div><b>{authorLabel(m.kind, m.name)}</b> <time>{fmt.format(new Date(m.at))}</time></div>
                    <p>{m.body}</p>
                  </li>
                ))}
              </ol>
              {detail!.messages.length === 0 && <p className="muted">Ainda sem conversa. O Claude responde na próxima conferência.</p>}
              {platform && !d.mergedInto && (d.status === "new" || d.status === "analysis") && <DecideForm id={d.id} />}
              {mergeTargets.length > 0 && (d.status === "new" || d.status === "analysis") && (
                <MergeForm id={d.id} targets={mergeTargets.map((i) => ({ id: i.id, label: `#${i.number} ${i.title}${i.organizationName ? ` (${i.organizationName})` : ""}` }))} />
              )}
              <ReplyForm id={d.id} />
            </>
          )}
        </section>
      </div>
    </>
  );
}
