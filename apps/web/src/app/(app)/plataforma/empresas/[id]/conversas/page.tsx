import Link from "next/link";
import { notFound } from "next/navigation";
import { isAppError, listPlatformConversations, platformConversationMessages, platformOrganizationDetail } from "@erp/core";
import { requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { sinceLabel } from "../../health";

export const metadata = { title: "Conversas com a Netz" };

const CHANNEL: Record<string, string> = { web: "Painel", telegram: "Telegram", whatsapp: "WhatsApp" };
const ACTION_LABEL: Record<string, string> = {
  pending: "Esperando a pessoa confirmar",
  running: "Executando...",
  done: "Feito",
  failed: "Deu erro",
  cancelled: "Cancelado pela pessoa",
  expired: "Ficou sem resposta",
};

export default async function OrganizationConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pessoa?: string }>;
}) {
  const actor = await requireDeveloper();
  const { id } = await params;
  const { pessoa } = await searchParams;
  let detail;
  try {
    detail = await platformOrganizationDetail(db(), actor.userId, id);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  }
  const o = detail.organization;
  const conversations = await listPlatformConversations(db(), actor.userId, id);
  const selected = conversations.find((c) => c.userId === pessoa) ?? conversations[0];
  const messages = selected ? await platformConversationMessages(db(), actor.userId, id, selected.userId) : [];
  const time = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: o.timezone });
  const day = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: o.timezone });

  let lastDay = "";
  return (
    <>
      <p className="back-link"><Link href={`/plataforma/empresas/${o.id}`}>‹ Ficha de {o.name}</Link></p>
      <div className="page-header">
        <h1>Conversas com a Netz</h1>
        <p>{o.name} · o que cada pessoa pediu à Netz pelo painel e pelo Telegram</p>
      </div>
      <p className="privacy-note">
        Só leitura, para acompanhar o uso e melhorar a Netz. As conversas são da empresa: use só para suporte e deixe claro
        para o cliente que a equipe netzsales pode vê-las.
      </p>

      {conversations.length === 0 ? (
        <section className="card"><p className="chart-empty">Ninguém desta empresa conversou com a Netz ainda.</p></section>
      ) : (
        <div className="conv-layout">
          <section className="card">
            <h2>Pessoas</h2>
            <ul className="conv-people">
              {conversations.map((c) => (
                <li key={c.userId}>
                  <Link href={`/plataforma/empresas/${o.id}/conversas?pessoa=${c.userId}`} className={c.userId === selected?.userId ? "active" : ""}>
                    <b>{c.name}</b>
                    <span className="muted">
                      {c.userMessages} {c.userMessages === 1 ? "mensagem" : "mensagens"} · {c.channels.map((ch) => CHANNEL[ch] ?? ch).join(" e ")}
                    </span>
                    <span className="muted">última {sinceLabel(c.lastAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          {selected && (
            <section className="card">
              <div className="card-head">
                <h2>{selected.name}</h2>
                <span className="muted">
                  {selected.actionsDone} {selected.actionsDone === 1 ? "ação feita" : "ações feitas"} pela Netz
                  {messages.length < selected.messages ? ` · mostrando as últimas ${messages.length} de ${selected.messages}` : ""}
                </span>
              </div>
              <div className="conv-thread">
                {messages.map((m) => {
                  const d = day.format(new Date(m.createdAt));
                  const showDay = d !== lastDay;
                  lastDay = d;
                  return (
                    <div key={m.id} style={{ display: "contents" }}>
                      {showDay && <span className="conv-day">{d}</span>}
                      <div className={`nets-msg ${m.role}`}>
                        <div className="nets-bubble-text">{m.body || (m.status === "failed" ? "(a Netz não conseguiu responder)" : "…")}</div>
                        {m.actionTitle && (
                          <div className={`nets-action ${m.actionStatus ?? ""}`}>
                            <span>{m.actionTitle}</span>
                            <small>{ACTION_LABEL[m.actionStatus ?? "expired"]}{m.actionStatus === "failed" && m.actionResult ? `: ${m.actionResult}` : ""}</small>
                          </div>
                        )}
                        <span className="conv-meta">
                          {m.role === "user" ? selected.name : "Netz"} · {time.format(new Date(m.createdAt))} · {CHANNEL[m.channel] ?? m.channel}
                          {m.context ? ` · ${m.context}` : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
