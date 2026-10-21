import Link from "next/link";
import {
  getImprovement,
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
import { CorrectForm, DecideForm, NewImprovementForm, ReplyForm } from "./forms";

export const metadata = { title: "Melhorias" };

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

type Search = { aba?: string; modulo?: string; id?: string; novo?: string; criado?: string };

export default async function ImprovementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const actor = await currentActor();
  const [viewer, org] = await Promise.all([improvementViewer(db(), actor), query(getOrganization, {})]);
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: org.timezone });
  const tab = TABS.find((t) => t.key === sp.aba) ?? TABS[0];
  const moduleFilter = IMPROVEMENT_MODULES.some((m) => m.key === sp.modulo) ? (sp.modulo as ImprovementModule) : undefined;

  const all = await listImprovements(db(), viewer, { module: moduleFilter });
  const shown = all.filter((i) => (tab.has as readonly string[]).includes(i.status));
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
    const merged = { aba: tab.key, modulo: moduleFilter, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/melhorias?${q}`;
  };
  const d = detail?.item;
  const canCorrect = d && (viewer.isDeveloper || d.createdBy === viewer.userId) && (d.status === "new" || d.status === "analysis");

  return (
    <>
      <div className="page-header">
        <h1>Melhorias</h1>
        <p>
          Pedidos de mudança no sistema e a conversa sobre cada um. Qualquer pessoa da empresa pode pedir. O Claude, que
          desenvolve o sistema, responde os pedidos novos com uma análise. Só o desenvolvedor aprova ou recusa, e o que for aprovado
          o Claude desenvolve, publica e registra aqui.
        </p>
      </div>
      <ol className="imp-steps card">
        <li><b>Pedido</b><span>painel ou IA</span></li>
        <li><b>Análise</b><span>Claude responde</span></li>
        <li><b>Decisão</b><span>desenvolvedor aprova</span></li>
        <li><b>Publicação</b><span>Claude desenvolve e avisa</span></li>
      </ol>
      {viewer.isDeveloper && <p className="muted">Você é desenvolvedor da plataforma: vê os pedidos de todas as empresas e pode aprovar ou recusar.</p>}

      <div className="imp-layout">
        <section className="card imp-list">
          <div className="imp-toolbar">
            <nav className="imp-tabs" aria-label="Situação">
              {TABS.map((t) => (
                <Link key={t.key} href={href({ aba: t.key, id: undefined })} className={t.key === tab.key ? "active" : ""}>
                  {t.label} <span>{all.filter((i) => (t.has as readonly string[]).includes(i.status)).length}</span>
                </Link>
              ))}
            </nav>
            <Link className="button" href={href({ novo: "1", id: undefined })}>Novo pedido</Link>
          </div>
          <form method="get" className="imp-filter">
            <input type="hidden" name="aba" value={tab.key} />
            <label htmlFor="modulo">Módulo</label>
            <select id="modulo" name="modulo" defaultValue={moduleFilter ?? ""}>
              <option value="">Todos os módulos</option>
              {IMPROVEMENT_MODULES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
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
                    <strong>#{i.number} {i.title}</strong>
                    <small>
                      {origin(i)}
                      {viewer.isDeveloper && i.organizationName ? ` · ${i.organizationName}` : ""}
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
                  {viewer.isDeveloper ? (
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
                {viewer.isDeveloper && d.organizationName ? ` · ${d.organizationName}` : ""}
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
              {viewer.isDeveloper && (d.status === "new" || d.status === "analysis") && <DecideForm id={d.id} />}
              <ReplyForm id={d.id} />
            </>
          )}
        </section>
      </div>
    </>
  );
}
