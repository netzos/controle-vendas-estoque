import Link from "next/link";
import { can, dashboardProductsPanel } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money, quantity } from "@/lib/format";
import { Kpi, RankList, SplitBar } from "@/components/charts";
import { dayLabel, PanelHeader, parseFilters, type PanelParams } from "../filters";

export const metadata = { title: "Painel · Produtos" };

export default async function PanelProducts({ searchParams }: { searchParams: Promise<PanelParams> }) {
  const actor = await requirePermission("sales.view");
  const params = await searchParams;
  const filters = parseFilters(params);
  const d = await query(dashboardProductsPanel, filters);
  const n = (v: string) => Number(v);
  const byQty = [...d.products].sort((a, b) => n(b.quantity) - n(a.quantity)).slice(0, 8);
  const byProfit = [...d.products].filter((p) => n(p.profit) > 0).sort((a, b) => n(b.profit) - n(a.profit)).slice(0, 8);
  const top = d.products.slice(0, 8);
  const canStock = can(actor, "stock.view");

  return (
    <>
      <PanelHeader actor={actor} path="/painel/produtos" params={params} filters={filters} range={d.range} />

      <div className="kpi-grid compact four">
        <Kpi label="Produtos vendidos" value={String(d.products.length)} sub="diferentes, no período" />
        <Kpi label="Fazem 80% do faturamento" value={String(d.abc.A.products)} sub={d.products.length ? `${Math.round((d.abc.A.products / d.products.length) * 100)}% dos produtos vendidos` : undefined} />
        {canStock && <Kpi label="Dinheiro no estoque" value={money(d.stock.value)} sub={`${d.stock.products} produtos, pelo custo`} />}
        {canStock && <Kpi label="Parado no estoque" value={money(d.stock.stalledValue)} tone={n(d.stock.stalledValue) > 0 ? "warn" : undefined} sub={`${d.stalled.length} sem venda há 30 dias`} />}
      </div>

      <div className="dash-grid">
        <section className="card">
          <div className="card-head"><h2>Mais vendidos em R$</h2></div>
          <RankList
            emptyText="Nenhuma venda no período."
            rows={top.map((p) => ({ key: p.productId, label: p.name, value: money(p.revenue), sub: `${quantity(p.quantity)} ${p.unitCode} · ${String(p.share).replace(".", ",")}% do faturamento`, ratio: n(p.revenue) / n(top[0]!.revenue) }))}
          />
        </section>
        <section className="card">
          <div className="card-head"><h2>Mais vendidos em quantidade</h2></div>
          <RankList
            emptyText="Nenhuma venda no período."
            rows={byQty.map((p) => ({ key: p.productId, label: p.name, value: `${quantity(p.quantity)} ${p.unitCode}`, sub: money(p.revenue), ratio: n(p.quantity) / n(byQty[0]!.quantity) }))}
          />
        </section>
        <section className="card">
          <div className="card-head"><h2>Mais lucrativos</h2></div>
          <RankList
            emptyText="O lucro aparece quando o produto tem custo cadastrado."
            rows={byProfit.map((p) => ({ key: p.productId, label: p.name, value: money(p.profit), sub: p.margin ? `margem ${p.margin.replace(".", ",")}%` : undefined, ratio: n(p.profit) / n(byProfit[0]!.profit) }))}
          />
        </section>

        <section className="card">
          <div className="card-head"><h2>Curva ABC</h2></div>
          <SplitBar
            parts={(["A", "B", "C"] as const).map((k) => ({ label: `${k}: ${d.abc[k].products} ${d.abc[k].products === 1 ? "produto" : "produtos"}`, value: n(d.abc[k].revenue), sub: money(d.abc[k].revenue) }))}
          />
          <p className="muted small-note">A são os poucos produtos que trazem 80% do dinheiro: nunca deixe faltar. C vende pouco: bom para promoção.</p>
        </section>

        <section className="card span-2">
          <div className="card-head"><h2>Por categoria</h2></div>
          <RankList
            emptyText="Nenhuma venda no período."
            rows={d.categories.map((c) => ({ key: c.name, label: c.name, value: money(c.revenue), sub: `${String(c.share).replace(".", ",")}% · lucro ${money(c.profit)}`, ratio: n(c.revenue) / n(d.categories[0]!.revenue) }))}
          />
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Todos os produtos vendidos</h2>
          <span className="muted">{d.products.length}</span>
        </div>
        {d.products.length === 0 ? (
          <p className="chart-empty">Nenhuma venda no período.</p>
        ) : (
          <div className="table-wrap">
            <table className="cards panel-table">
              <thead>
                <tr><th>Curva</th><th>Produto</th><th>Categoria</th><th className="num">Quantidade</th><th className="num">Faturamento</th><th className="num">Lucro</th><th className="num">Margem</th></tr>
              </thead>
              <tbody>
                {d.products.map((p) => (
                  <tr key={p.productId}>
                    <td data-label="Curva"><span className={`abc ${p.abc}`}>{p.abc}</span></td>
                    <td data-label="Produto"><Link href={`/produtos?id=${p.productId}`}>{p.name}</Link></td>
                    <td data-label="Categoria" className="muted">{p.category ?? "—"}</td>
                    <td data-label="Quantidade" className="num">{quantity(p.quantity)} {p.unitCode}</td>
                    <td data-label="Faturamento" className="num">{money(p.revenue)}</td>
                    <td data-label="Lucro" className="num">{money(p.profit)}</td>
                    <td data-label="Margem" className="num">{p.margin ? `${p.margin.replace(".", ",")}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canStock && (
        <section className="card">
          <div className="card-head">
            <h2>Parados no estoque</h2>
            <span className="muted">com estoque e sem venda há 30 dias ou mais</span>
          </div>
          {d.stalled.length === 0 ? (
            <p className="chart-empty">Nenhum produto parado. Tudo girando.</p>
          ) : (
            <ul className="mini-list">
              {d.stalled.slice(0, 12).map((p) => (
                <li key={p.productId}>
                  <Link href={`/produtos?id=${p.productId}`}>
                    <strong>{p.name}</strong> <span className="muted">{quantity(p.stockQty)} {p.unitCode} · {p.lastSale ? `última venda ${dayLabel(p.lastSale)}` : "nunca vendido"}</span>
                  </Link>
                  <span>{money(p.value)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
