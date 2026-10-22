import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BILLING_LABELS,
  FEATURES,
  HEALTH_LABELS,
  IMPROVEMENT_MODULES,
  improvementViewer,
  isAppError,
  listImprovements,
  platformBillingNotes,
  platformFeatures,
  platformOrganizationDetail,
  platformUsdBrl,
  type ImprovementStatus,
} from "@erp/core";
import { BarChart, Kpi } from "@/components/charts";
import { currentActor, requireDeveloper } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentLabel, money, whatsappLabel, whatsappLink } from "@/lib/format";
import { FeatureToggle } from "../../liberacoes/forms";
import { openOrganizationAction } from "../actions";
import { BillingForm, DeleteOrganization, LeaveSupport, MemberLink, NotesForm, OrganizationKind, OrganizationStatus, OwnerLink } from "../forms";
import { HEALTH_TONE, sinceLabel } from "../health";

export const metadata = { title: "Ficha da empresa" };

const IMP_STATUS: Record<ImprovementStatus, string> = {
  new: "Novo", analysis: "Em análise", approved: "Aprovado", building: "Em desenvolvimento", published: "Publicado", rejected: "Recusado",
};
const CHANNEL: Record<string, string> = { web: "Painel", telegram: "Telegram", api: "Integração", system: "Sistema", whatsapp: "WhatsApp" };

export default async function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireDeveloper();
  const { id } = await params;
  let detail;
  try {
    detail = await platformOrganizationDetail(db(), actor.userId, id);
  } catch (err) {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  }
  const [features, viewer, rate, billingNotes] = await Promise.all([
    platformFeatures(db(), actor.userId),
    improvementViewer(db(), await currentActor()),
    platformUsdBrl(db()),
    platformBillingNotes(db(), actor.userId, id),
  ]);
  const improvements = await listImprovements(db(), viewer, { organizationId: id, includeMerged: true });
  const { organization: o, members, dailySales, activity, notes, signup } = detail;
  const tz = o.timezone;
  const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz });
  const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: tz });
  const dayLabel = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const me = members.find((m) => m.userId === actor.userId && m.status === "active");
  const team = members.filter((m) => !m.isDeveloper);
  const enabled = features.get(o.id);
  const openImprovements = improvements.filter((i) => ["new", "analysis", "approved", "building"].includes(i.status));
  const moduleLabel = (key: string) => IMPROVEMENT_MODULES.find((m) => m.key === key)?.label ?? key;
  const cost30 = Number(o.usageCost30dUsd) * rate;
  const costMonth = Number(o.usageCostMonthUsd) * rate;
  const margin = Number(o.monthlyPrice) - cost30;

  return (
    <>
      <p className="back-link"><Link href="/plataforma/empresas">‹ Todas as empresas</Link></p>
      <div className="page-header org-header">
        <div>
          <h1>{o.name}</h1>
          <p>
            {o.kind === "internal" ? <span className="tag">Interna da equipe</span> : <span className={`tag ${HEALTH_TONE[o.health]}`}>{HEALTH_LABELS[o.health]}</span>}{" "}
            {o.ownerName ? `Dono: ${o.ownerName} · ${o.ownerEmail}` : "Sem dono"} · cliente desde {date.format(new Date(o.createdAt))}
          </p>
        </div>
        {o.status === "active" && (
          <form action={openOrganizationAction} className="org-open">
            <input type="hidden" name="organizationId" value={o.id} />
            {me ? (
              <button type="submit">Abrir esta empresa</button>
            ) : (
              <>
                <input type="hidden" name="join" value="1" />
                <button type="submit">Entrar para dar suporte</button>
                <span className="muted">Você entra como Administrador; a empresa vê isso em Ajustes › Usuários.</span>
              </>
            )}
          </form>
        )}
      </div>

      <div className="kpi-grid">
        <Kpi hero label="Valor vendido (30 dias)" value={money(o.revenue30d)} current={Number(o.revenue30d)} previous={Number(o.revenuePrev30d)} sub="vs. 30 dias anteriores" />
        <Kpi label="Vendas (30 dias)" value={String(o.sales30d)} current={o.sales30d} previous={o.salesPrev30d} sub={`${o.salesTotal} desde o início`} />
        <Kpi label="Pessoas usando na semana" value={`${o.usersActive7d} de ${o.usersTotal}`} sub={o.usersTotal - o.usersActive7d > 0 ? `${o.usersTotal - o.usersActive7d} sem usar` : "todas usando"} tone={o.usersActive7d === 0 ? "warn" : undefined} />
        <Kpi label="Último uso" value={sinceLabel(o.lastActivityAt)} sub={o.lastActivityAt ? dateTime.format(new Date(o.lastActivityAt)) : "ninguém da empresa entrou ainda"} tone={o.health === "idle" || o.health === "never" ? "warn" : undefined} />
      </div>
      <div className="kpi-grid compact four">
        <Kpi label="Produtos ativos" value={String(o.products)} />
        <Kpi label="Clientes" value={String(o.customers)} />
        <Kpi label="Mensagens para a Netz (30 dias)" value={String(o.netzMessages30d)} />
        <Kpi label="Telegram ligado" value={String(o.telegramLinks)} sub={o.telegramLinks === 1 ? "pessoa" : "pessoas"} />
      </div>

      <div className="dash-grid spaced">
        <section className="card span-2">
          <div className="card-head">
            <h2>Vendas por dia</h2>
            <span className="muted">últimos 30 dias</span>
          </div>
          <BarChart
            data={dailySales.map((d) => ({ label: dayLabel.format(new Date(`${d.day}T00:00:00Z`)), value: Number(d.revenue), detail: `${d.sales} ${d.sales === 1 ? "venda" : "vendas"}` }))}
            format={money}
            emptyText="Nenhuma venda nos últimos 30 dias."
          />
        </section>
        <section className="card">
          <h2>Dados da empresa</h2>
          <dl className="org-facts">
            <dt>Razão social</dt><dd>{o.legalName || <span className="muted">não informada</span>}</dd>
            <dt>CNPJ/CPF</dt><dd>{o.document ? documentLabel(o.document) : <span className="muted">não informado</span>}</dd>
            <dt>Fuso horário</dt><dd>{tz}</dd>
            <dt>Origem</dt><dd>{signup ? `Pedido de cadastro em ${date.format(new Date(signup.createdAt))}` : "Criada pela equipe"}</dd>
            {signup?.whatsapp && (
              <>
                <dt>WhatsApp</dt>
                <dd><a href={whatsappLink(signup.whatsapp)} target="_blank" rel="noreferrer">{whatsappLabel(signup.whatsapp)}</a></dd>
              </>
            )}
            {signup?.business && (<><dt>Ramo</dt><dd>{signup.business}</dd></>)}
          </dl>
        </section>
      </div>

      <div className="dash-grid two">
        <section className="card">
          <div className="card-head">
            <h2>Mensalidade</h2>
            <span className={`tag ${o.billingStatus === "paying" ? "ok" : o.billingStatus === "overdue" ? "warn" : ""}`}>{BILLING_LABELS[o.billingStatus]}</span>
          </div>
          <BillingForm organizationId={o.id} planName={o.planName} monthlyPrice={o.monthlyPrice} status={o.billingStatus} notes={billingNotes} />
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Custo e lucro</h2>
            <Link href="/plataforma/financeiro" className="muted">Receita e custos ›</Link>
          </div>
          <dl className="org-facts">
            <dt>Paga por mês</dt><dd>{money(o.monthlyPrice)}</dd>
            <dt>Custo de uso (30 dias)</dt><dd>{money(cost30)} <span className="muted">IA da Netz e áudios</span></dd>
            <dt>Custo neste mês</dt><dd>{money(costMonth)}</dd>
            <dt>Sobra</dt><dd className={margin < 0 ? "negative" : ""}>{money(margin)}{Number(o.monthlyPrice) > 0 ? ` (${Math.round((margin / Number(o.monthlyPrice)) * 100)}%)` : ""}</dd>
          </dl>
          <p className="muted small-text">O custo em reais usa a cotação de {money(rate)} por dólar (muda em Receita e custos). Custos fixos da plataforma não entram aqui.</p>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Pessoas</h2>
          <span className="muted">{team.length} {team.length === 1 ? "pessoa" : "pessoas"} da empresa</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pessoa</th><th>Perfil</th><th>Último uso nesta empresa</th><th>Vendas (30 dias)</th><th>Netz</th><th>Acesso</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.membershipId}>
                  <td>
                    {m.name} <span className="muted">{m.email}</span>
                    {m.isDeveloper && <span className="tag">Equipe netzsales</span>}
                    {m.status !== "active" && <span className="tag off">Desativado</span>}
                  </td>
                  <td>{m.roleName}{m.isOwner ? " · dono" : ""}</td>
                  <td>{m.lastSeenAt ? `${sinceLabel(m.lastSeenAt)} · ${dateTime.format(new Date(m.lastSeenAt))}` : <span className="tag off">Nunca entrou</span>}</td>
                  <td>{m.sales30d}</td>
                  <td>{m.netzMessages30d}</td>
                  <td>
                    {m.status === "active" && !m.isDeveloper && (
                      <MemberLink organizationId={o.id} membershipId={m.membershipId} name={m.name} firstAccess={!m.lastLoginAt} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="dash-grid two">
        <section className="card">
          <div className="card-head">
            <h2>Liberações</h2>
            <Link href="/plataforma/liberacoes" className="muted">Todas as liberações ›</Link>
          </div>
          <ul className="feature-list">
            {FEATURES.map((f) => (
              <li key={f.key}>
                <div><b>{f.label}</b><div className="muted">{f.description}</div></div>
                <FeatureToggle organizationId={o.id} feature={f.key} enabled={enabled?.has(f.key) ?? f.defaultOn} label={`${f.label} para ${o.name}`} />
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Pedidos de melhoria</h2>
            <Link href={`/plataforma/melhorias?empresa=${o.id}`} className="muted">Abrir em Melhorias ›</Link>
          </div>
          {improvements.length === 0 ? (
            <p className="chart-empty">Esta empresa ainda não pediu nada.</p>
          ) : (
            <ul className="org-improvements">
              {[...openImprovements, ...improvements.filter((i) => !openImprovements.includes(i))].slice(0, 12).map((i) => (
                <li key={i.id}>
                  <Link href={`/plataforma/melhorias?empresa=${o.id}&id=${i.mergedInto ?? i.id}`}>#{i.number} {i.title}</Link>
                  <span className="muted">{moduleLabel(i.module)} · {date.format(new Date(i.createdAt))}{i.mergedIntoNumber ? ` · junto ao #${i.mergedIntoNumber}` : ""}</span>
                  <span className={`tag ${i.status === "rejected" ? "off" : ["approved", "building", "published"].includes(i.status) ? "ok" : ""}`}>{IMP_STATUS[i.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="dash-grid two">
        <section className="card">
          <h2>Anotações da equipe</h2>
          <NotesForm organizationId={o.id} notes={notes.notes} contact={notes.contact} />
          {notes.updatedAt && (
            <p className="muted small-text">Última alteração: {notes.updatedByName ?? "equipe"} em {dateTime.format(new Date(notes.updatedAt))}</p>
          )}
        </section>
        <section className="card">
          <h2>Administração</h2>
          {o.ownerMembershipId && (
            <div className="admin-block">
              <h3>Senha do dono</h3>
              <OwnerLink organizationId={o.id} firstAccess={!o.ownerLastLoginAt} />
            </div>
          )}
          {me && !me.isOwner && (
            <div className="admin-block">
              <h3>Suporte</h3>
              <p className="muted">Você está dentro desta empresa como {me.roleName}. Quando terminar, saia para não aparecer como usuário dela.</p>
              <LeaveSupport organizationId={o.id} name={o.name} />
            </div>
          )}
          <div className="admin-block">
            <h3>Tipo de empresa</h3>
            <p className="muted">
              {o.kind === "customer"
                ? "Cliente: aparece nas listas e nos números da Plataforma. Marque como interna se for da equipe ou de teste."
                : "Interna da equipe: fica fora das listas, dos números e dos usuários."}
            </p>
            <OrganizationKind organizationId={o.id} kind={o.kind} />
          </div>
          <div className="admin-block">
            <h3>Acesso da empresa</h3>
            <p className="muted">
              {o.status === "active"
                ? "Suspensa, ninguém da empresa consegue entrar. Os dados ficam guardados e voltam ao reativar."
                : "A empresa está suspensa: ninguém dela consegue entrar."}
            </p>
            <OrganizationStatus organizationId={o.id} name={o.name} status={o.status} />
          </div>
          <div className="admin-block">
            <h3>Excluir de vez</h3>
            {o.kind === "internal" || o.status === "suspended" ? (
              <>
                <p className="muted">Apaga a empresa com todas as vendas, produtos, clientes e pessoas dela. Não dá para desfazer.</p>
                <DeleteOrganization organizationId={o.id} name={o.name} />
              </>
            ) : (
              <p className="muted">Para excluir uma empresa cliente, suspenda primeiro. Assim nenhum cliente ativo é apagado por engano.</p>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Atividade recente</h2>
          <span className="muted">últimas {activity.length} ações registradas</span>
        </div>
        {activity.length === 0 ? (
          <p className="chart-empty">Nada registrado ainda.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Quando</th><th>Quem</th><th>Por onde</th><th>O que aconteceu</th></tr></thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{dateTime.format(new Date(a.createdAt))}</td>
                    <td>{a.actorName ?? <span className="muted">sistema</span>}</td>
                    <td>{CHANNEL[a.channel] ?? a.channel}</td>
                    <td>{a.summary ?? a.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
