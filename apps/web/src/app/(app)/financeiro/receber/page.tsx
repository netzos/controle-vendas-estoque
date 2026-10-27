import Link from "next/link";
import { can, INSTALLMENT_STATUS_LABELS, listReceivables } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money, whatsappLink } from "@/lib/format";
import { Kpi } from "@/components/charts";
import { ReceivePaymentForm } from "../../vendas/receive-form";

export const metadata = { title: "A receber" };

const FILTERS = [
  { key: "all", label: "Tudo" },
  { key: "late", label: "Vencidas" },
  { key: "week", label: "Até 7 dias" },
] as const;

const day = (d: string) => d.split("-").reverse().join("/");

// Telefone livre do cadastro → número do WhatsApp (DDI 55 quando vier só DDD + número).
function whatsappOf(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length >= 12 ? digits : null;
}

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ filtro?: string; cliente?: string }> }) {
  const actor = await requirePermission("sales.view");
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === params.filtro)?.key ?? "all";
  const customerId = params.cliente && /^[0-9a-f-]{36}$/.test(params.cliente) ? params.cliente : null;
  const r = await query(listReceivables, { filter, customerId });
  const canReceive = can(actor, "sales.receive");
  const customerName = customerId ? r.customers[0]?.name ?? "Cliente" : null;
  const link = (patch: { filtro?: string; cliente?: string | null }) => {
    const q = new URLSearchParams();
    const f = patch.filtro ?? filter;
    const c = patch.cliente === undefined ? customerId : patch.cliente;
    if (f !== "all") q.set("filtro", f);
    if (c) q.set("cliente", c);
    return `/financeiro/receber${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <div className="page-header">
        <h1>A receber</h1>
        <p>O dinheiro na rua: o que os clientes ainda devem das vendas parceladas, a prazo ou com pagamento parcial.</p>
      </div>

      <div className="kpi-grid compact four">
        <Kpi hero label="Total na rua" value={money(r.total.amount)} sub={`${r.total.customers} ${r.total.customers === 1 ? "cliente" : "clientes"}`} />
        <Kpi label="Vencido" value={money(r.late.amount)} sub={`${r.late.count} ${r.late.count === 1 ? "parcela" : "parcelas"}`} tone={r.late.count > 0 ? "bad" : undefined} />
        <Kpi label="Vence em 7 dias" value={money(r.week.amount)} sub={`${r.week.count} ${r.week.count === 1 ? "parcela" : "parcelas"}`} tone={r.week.count > 0 ? "warn" : undefined} />
        <Kpi label="Sem data combinada" value={money(r.noDate.amount)} sub={`${r.noDate.count} ${r.noDate.count === 1 ? "venda" : "vendas"}`} />
      </div>

      {!customerId && r.customers.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Quem deve</h2></div>
          <div className="table-wrap">
            <table className="cards">
              <thead><tr><th>Cliente</th><th className="num">Deve</th><th className="num">Vencido</th><th>Próximo vencimento</th><th></th></tr></thead>
              <tbody>
                {r.customers.map((c) => {
                  const wa = whatsappOf(c.phone);
                  return (
                    <tr key={c.customerId ?? "none"}>
                      <td data-label="Cliente">
                        {c.customerId ? <Link href={link({ cliente: c.customerId })}><strong>{c.name}</strong></Link> : <span className="muted">Sem cliente informado</span>}
                        <small className="muted">{c.items} {c.items === 1 ? "parcela em aberto" : "parcelas em aberto"}</small>
                      </td>
                      <td data-label="Deve" className="num"><strong>{money(c.open)}</strong></td>
                      <td data-label="Vencido" className="num">{Number(c.late) > 0 ? <span className="warn-text">{money(c.late)}</span> : "—"}</td>
                      <td data-label="Próximo vencimento">{c.nextDue ? day(c.nextDue) : <span className="muted">sem data</span>}</td>
                      <td>
                        {wa && (
                          <a className="button secondary small" target="_blank" rel="noreferrer"
                            href={whatsappLink(wa, `Olá, ${c.name?.split(" ")[0]}! Passando para lembrar do saldo de ${money(c.open)}${Number(c.late) > 0 ? `, com ${money(c.late)} já vencido` : ""}. Qualquer dúvida, é só chamar.`)}>
                            Cobrar no WhatsApp
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <div className="list-toolbar">
          <h2>{customerName ? `Parcelas de ${customerName}` : "Parcelas em aberto"}</h2>
          <nav className="segmented" aria-label="Filtro">
            {FILTERS.map((f) => <Link key={f.key} href={link({ filtro: f.key })} className={filter === f.key ? "active" : ""}>{f.label}</Link>)}
          </nav>
          {customerId && <Link href={link({ cliente: null })}>← Todos os clientes</Link>}
        </div>
        {r.items.length === 0 ? (
          <p className="chart-empty">{filter === "late" ? "Nada vencido." : filter === "week" ? "Nada vencendo nos próximos 7 dias." : "Ninguém está devendo."}</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead><tr><th>Vencimento</th><th>Cliente</th><th>Venda</th><th className="num">Falta</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.installmentId ?? i.saleId}>
                    <td data-label="Vencimento">
                      {i.dueDate ? day(i.dueDate) : <span className="muted">sem data</span>}
                      {i.daysLate > 0 && <small className="warn-text">{i.daysLate} {i.daysLate === 1 ? "dia" : "dias"} de atraso</small>}
                    </td>
                    <td data-label="Cliente">{i.customerName ?? <span className="muted">Consumidor</span>}</td>
                    <td data-label="Venda">
                      <Link href={`/vendas?id=${i.saleId}`}>nº {i.saleNumber}</Link>
                      {i.number !== null && <small className="muted">parcela {i.number}/{i.count}</small>}
                    </td>
                    <td data-label="Falta" className="num">
                      <strong>{money(i.open)}</strong>
                      {Number(i.paidAmount) > 0 && <small className="muted">de {money(i.amount)}</small>}
                    </td>
                    <td data-label="Situação"><span className={`tag inst-tag ${i.status}`}>{INSTALLMENT_STATUS_LABELS[i.status]}</span></td>
                    <td>
                      {canReceive && (
                        <details className="row-action">
                          <summary className="button secondary small">Receber</summary>
                          <ReceivePaymentForm saleId={i.saleId} open={i.open} installmentId={i.installmentId ?? undefined} hint={i.number !== null ? "Se passar, vai para as próximas parcelas." : undefined} />
                        </details>
                      )}
                    </td>
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
