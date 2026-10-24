import Link from "next/link";
import { improvementViewer, netsGuidanceOverview, platformNetsPeople, platformPersonNotes } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { History, ManualEditor, type Request, type Version } from "./editor";
import { PersonNotes } from "./people";

// A IA pode levar alguns segundos para preparar a proposta.
export const maxDuration = 120;

export const metadata = { title: "Comunicação da Netz" };

type Search = { aba?: string; versao?: string; pedido?: string; pessoa?: string };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const when = (d: Date | string | null) => (d ? fmt.format(new Date(d)) : null);
const OPEN = new Set(["new", "analysis", "approved", "building"]);
const STATUS: Record<string, string> = { new: "Novo", analysis: "Em análise", approved: "Aprovado", building: "Em desenvolvimento", published: "Aplicado", rejected: "Recusado" };
const TABS = [
  { key: "manual", label: "Manual" },
  { key: "jeito", label: "Jeito de cada pessoa" },
  { key: "pedidos", label: "Pedidos de ajuste" },
  { key: "historico", label: "Histórico" },
  { key: "regras", label: "Regras fixas e ferramentas" },
] as const;

export default async function CommunicationPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireDeveloper();
  const sp = await searchParams;
  const viewer = await improvementViewer(db(), actor);
  const [o, people] = await Promise.all([netsGuidanceOverview(db(), viewer), platformNetsPeople(db(), viewer)]);
  const tab = TABS.find((t) => t.key === sp.aba)?.key ?? (sp.versao ? "historico" : "manual");

  const requests: Request[] = o.requests
    .filter((r) => !r.mergedInto)
    .map((r) => ({ id: r.id, number: String(r.number), title: r.title, body: r.body, organization: r.organizationName, status: r.status, open: OPEN.has(r.status) }));
  const open = requests.filter((r) => r.open);
  const closed = requests.filter((r) => !r.open);

  const readsOf = (id: number) => {
    const r = o.reads[id];
    return { web: r?.web ?? 0, telegram: r?.telegram ?? 0, last: when(r?.lastAt ?? null) };
  };
  const versions: Version[] = [
    ...o.versions.map((v) => ({ id: v.id, note: v.note, source: v.source, improvementNumber: v.improvementNumber, by: v.by, at: when(v.at)!, reads: readsOf(v.id) })),
    { id: 0, note: "O texto que veio com o sistema.", source: "seed" as const, improvementNumber: null, by: "", at: "", reads: readsOf(0) },
  ];
  const current = o.current.id ?? 0;
  const now = readsOf(current);
  const totalReads = Object.values(o.reads).reduce((n, r) => n + r.total, 0);
  const telegramReads = Object.values(o.reads).reduce((n, r) => n + r.telegram, 0);
  const noted = people.filter((p) => p.notes > 0).length;

  const [orgId, userId] = (sp.pessoa ?? "").split(":");
  const person = people.find((p) => p.organizationId === orgId && p.userId === userId);
  const notes = person ? await platformPersonNotes(db(), viewer, person.organizationId, person.userId) : [];
  const href = (q: Record<string, string>) => `/plataforma/comunicacao?${new URLSearchParams(q)}`;

  return (
    <>
      <div className="page-header">
        <h1>Comunicação da Netz</h1>
        <p>
          Como a Netz conversa com as pessoas de todas as empresas: o manual que ela lê antes de cada resposta, o que ela
          aprende do jeito de cada pessoa e os pedidos de ajuste. Separado das melhorias do sistema, igual às instruções da IA
          do IONPA e ao manual (AGENTS.md) do Netz no NetzOS.
        </p>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span className="kpi-label">Manual em uso</span>
          <span className="kpi-value">Versão {current}</span>
          <span className="kpi-foot">{o.current.id ? `${o.current.by ?? ""}, ${when(o.current.at)}` : "texto inicial do sistema"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Respostas que leram o manual</span>
          <span className="kpi-value">{totalReads.toLocaleString("pt-BR")}</span>
          <span className="kpi-foot">{telegramReads.toLocaleString("pt-BR")} no Telegram · versão atual: {now.web + now.telegram}{now.last ? `, última ${now.last}` : ""}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Pessoas com jeito anotado</span>
          <span className="kpi-value">{noted}</span>
          <span className="kpi-foot">de {people.length} que já conversaram</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Pedidos de ajuste</span>
          <span className="kpi-value">{open.length}</span>
          <span className="kpi-foot">em aberto · {closed.length} encerrados</span>
        </div>
      </div>

      <section className="card comm-how">
        <b>Antes de cada resposta, no painel e no Telegram, a Netz lê nesta ordem:</b>
        <ol>
          <li><Link href={href({ aba: "regras" })}>Regras fixas</Link>: segurança, confirmação e permissões (só mudam pelo código).</li>
          <li><Link href={href({ aba: "manual" })}>Manual de comunicação</Link>: o jeito padrão de conversar (você muda aqui).</li>
          <li><Link href={href({ aba: "jeito" })}>O jeito da pessoa</Link>: o que ela aprendeu daquela pessoa, que vale acima do padrão.</li>
        </ol>
        <p className="muted small-text">Cada resposta grava a versão do manual que leu. É o número &quot;Respostas que leram o manual&quot; acima e o &quot;Lida em&quot; do Histórico.</p>
      </section>

      <nav className="imp-tabs comm-tabs" aria-label="Partes da comunicação">
        {TABS.map((t) => (
          <Link key={t.key} href={href({ aba: t.key })} className={t.key === tab ? "active" : ""}>
            {t.label}
            {t.key === "pedidos" && open.length > 0 ? ` (${open.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "manual" && (
        <ManualEditor
          key={`${o.current.id ?? 0}-${sp.pedido ?? ""}`}
          current={{ id: o.current.id, body: o.current.body, by: o.current.by, at: when(o.current.at) }}
          request={open.find((r) => r.id === sp.pedido) ?? null}
        />
      )}

      {tab === "historico" && <History versions={versions} currentId={o.current.id} highlight={sp.versao ? Number(sp.versao) : null} />}

      {tab === "jeito" && (
        <section className="card">
          <div className="imp-row-head">
            <h2>Jeito de cada pessoa</h2>
            <span className="muted">{people.length} {people.length === 1 ? "pessoa" : "pessoas"}</span>
          </div>
          <p className="muted">
            Cada pessoa tem o seu jeito: umas são organizadas e passam tudo, outras falam pouco; umas gostam de ser lembradas e
            cobradas, outras não. A Netz vai sentindo nas conversas e anota aqui. Você pode corrigir, tirar ou anotar. A própria
            pessoa também vê e tira o que quiser em Ajustes › Meu Telegram.
          </p>
          <div className="comm-people">
            <ul className="comm-list">
              {people.length === 0 && <li className="muted">Ninguém conversou com a Netz ainda.</li>}
              {people.map((p) => {
                const key = `${p.organizationId}:${p.userId}`;
                return (
                  <li key={key} className={sp.pessoa === key ? "highlight" : ""}>
                    <div>
                      <Link href={href({ aba: "jeito", pessoa: key })}><b>{p.userName}</b></Link>
                      <span className="muted"> · {p.organizationName}</span>
                      <div className="muted small-text">
                        {p.messages} {p.messages === 1 ? "mensagem" : "mensagens"}{p.lastAt ? ` · última ${when(p.lastAt)}` : ""}{p.telegram ? " · usa o Telegram" : ""}
                      </div>
                    </div>
                    <span className={`tag ${p.notes ? "ok" : ""}`}>{p.notes ? `${p.notes} ${p.notes === 1 ? "nota" : "notas"}` : "sem notas"}</span>
                  </li>
                );
              })}
            </ul>
            {person ? (
              <div className="comm-person">
                <h3>{person.userName} <span className="muted">· {person.organizationName}</span></h3>
                <PersonNotes
                  key={sp.pessoa}
                  organizationId={person.organizationId}
                  userId={person.userId}
                  notes={notes.map((n) => ({ id: n.id, body: n.body, source: n.source, active: n.active, at: when(n.createdAt)!, ended: when(n.endedAt), endedReason: n.endedReason, replaces: n.replaces }))}
                />
              </div>
            ) : (
              people.length > 0 && <p className="muted comm-person">Escolha uma pessoa para ver o que a Netz aprendeu dela.</p>
            )}
          </div>
        </section>
      )}

      {tab === "pedidos" && (
        <section className="card">
          <div className="imp-row-head">
            <h2>Pedidos de ajuste na comunicação</h2>
            <span className="muted">{open.length} em aberto</span>
          </div>
          <p className="muted">
            Pedidos do módulo Comunicação da Netz, de todas as empresas. Chegam pela tela Melhorias ou pela própria Netz, quando
            alguém reclama do jeito dela falar. &quot;Preparar mudança&quot; leva o pedido para a IA reescrever o manual; você confere o
            antes e depois e aprova.
          </p>
          {open.length === 0 ? (
            <p className="muted">Nenhum pedido em aberto.</p>
          ) : (
            <ul className="comm-list">
              {open.map((r) => (
                <li key={r.id}>
                  <div>
                    <Link href={`/plataforma/melhorias?id=${r.id}`}><b>#{r.number} {r.title}</b></Link>
                    {r.organization && <span className="muted"> · {r.organization}</span>}
                    <div className="muted comm-clip">{r.body}</div>
                  </div>
                  <div className="actions">
                    <Link className="button small" href={href({ aba: "manual", pedido: r.id })}>Preparar mudança</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {closed.length > 0 && (
            <details className="comm-history">
              <summary>Encerrados ({closed.length})</summary>
              <ul className="comm-list">
                {closed.map((r) => (
                  <li key={r.id}>
                    <div>
                      <span className={`tag ${r.status === "published" ? "ok" : "off"}`}>{STATUS[r.status] ?? r.status}</span>{" "}
                      <Link href={`/plataforma/melhorias?id=${r.id}&aba=${r.status === "published" ? "publicados" : "recusados"}`}>#{r.number} {r.title}</Link>
                      {r.organization && <span className="muted"> · {r.organization}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {tab === "regras" && (
        <section className="card">
          <h2>Regras fixas</h2>
          <p className="muted">
            O que o próprio sistema garante, mesmo se o manual mudar: quem a Netz é, a confirmação antes de mudar dados, as
            permissões de cada pessoa, como ela aprende o jeito de cada um, o registro de melhorias e os limites de segurança. Isso
            muda só pelo código, pedindo ao Claude.
          </p>
          <pre className="comm-text">{o.rules}</pre>
          <h3>As {o.tools.length} ferramentas que a Netz pode usar</h3>
          <p className="muted">Cada pessoa só recebe as que o perfil dela permite.</p>
          <ul className="comm-tools">
            {o.tools.map((t) => <li key={t.name}><code>{t.name}</code><span>{t.description}</span></li>)}
          </ul>
        </section>
      )}
    </>
  );
}
