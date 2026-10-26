import Link from "next/link";
import { can, commissionPanel } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money } from "@/lib/format";
import { Kpi } from "@/components/charts";
import { PayoutForm, RateForm } from "./forms";

export const metadata = { title: "Comissões" };

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const METHODS: Record<string, string> = { cash: "Dinheiro", pix: "Pix", other: "Outro" };

function shift(month: string, by: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const label = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} de ${month.slice(0, 4)}`;

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const actor = await requirePermission("commissions.view");
  const { mes } = await searchParams;
  const p = await query(commissionPanel, { month: /^\d{4}-\d{2}$/.test(mes ?? "") ? mes : undefined });
  const canManage = can(actor, "commissions.manage");
  const top = Math.max(...p.rows.map((r) => Number(r.revenue)), 0);
  const noRate = p.rows.filter((r) => r.rate === null && r.sales > 0).length;

  return (
    <>
      <div className="page-header dash-header">
        <div>
          <h1>Comissões</h1>
          <p>Quanto cada vendedor vendeu no mês, quanto ganha de comissão e quanto ainda falta repassar. A comissão é a taxa de cada um sobre o total das vendas que ele registrou; venda cancelada não conta.</p>
        </div>
        <div className="dash-actions">
          <nav className="segmented" aria-label="Mês">
            <Link href={`/comissoes?mes=${shift(p.month, -1)}`}>‹ Anterior</Link>
            <span className="active">{label(p.month).replace(/^./, (c) => c.toUpperCase())}</span>
            <Link href={`/comissoes?mes=${shift(p.month, 1)}`}>Próximo ›</Link>
          </nav>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi hero label="Comissão do mês" value={money(p.totals.commission)} sub={`sobre ${money(p.totals.revenue)} vendidos`} />
        <Kpi label="Já repassado" value={money(p.totals.paid)} />
        <Kpi label="Falta repassar" value={money(p.totals.toPay)} tone={Number(p.totals.toPay) > 0 ? "warn" : undefined} />
      </div>

      <section className="card">
        <div className="card-head"><h2>Ranking de vendedores</h2>{noRate > 0 && <span className="warn-text">{noRate} {noRate === 1 ? "vendedor sem taxa" : "vendedores sem taxa"}</span>}</div>
        {p.rows.length === 0 ? (
          <p className="chart-empty">Ninguém na equipe ainda.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Vendedor</th><th className="num">Vendas</th><th className="num">Vendido</th><th>Taxa</th><th className="num">Comissão</th><th className="num">Repassado</th><th className="num">Falta</th></tr></thead>
              <tbody>
                {p.rows.map((r, i) => (
                  <tr key={r.userId}>
                    <td className="muted">{r.sales > 0 ? `${i + 1}º` : "—"}</td>
                    <td>
                      <strong>{r.name}</strong>
                      {top > 0 && <div className="bar-track"><span style={{ width: `${(Number(r.revenue) / top) * 100}%` }} /></div>}
                    </td>
                    <td className="num">{r.sales}</td>
                    <td className="num">{money(r.revenue)}</td>
                    <td>{canManage ? <RateForm userId={r.userId} rate={r.rate} /> : r.rate === null ? <span className="muted">sem taxa</span> : `${r.rate.replace(".", ",")}%`}</td>
                    <td className="num"><strong>{money(r.commission)}</strong></td>
                    <td className="num">{money(r.paid)}</td>
                    <td className="num">{Number(r.toPay) > 0 ? <strong>{money(r.toPay)}</strong> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && (
        <section className="card">
          <h2>Registrar repasse de {label(p.month)}</h2>
          <PayoutForm month={p.month} people={p.rows.map((r) => ({ id: r.userId, name: r.name, toPay: r.toPay }))} />
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Repasses de {label(p.month)}</h2><span className="muted">{p.payouts.length}</span></div>
        {p.payouts.length === 0 ? (
          <p className="chart-empty">Nenhum repasse registrado neste mês.</p>
        ) : (
          <ul className="mini-list">
            {p.payouts.map((o) => (
              <li key={o.id}>
                <span>{o.userName}<span className="muted"> · {o.method ? METHODS[o.method] : "—"} · {o.createdAt.toLocaleDateString("pt-BR")} por {o.byName}{o.notes ? ` · ${o.notes}` : ""}</span></span>
                <strong>{money(o.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
