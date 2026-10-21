import Link from "next/link";
import { can, getOrganization, listMovements, listProducts, MOVEMENT_LABELS } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { quantity } from "@/lib/format";
import { MovementForm } from "./movement-form";

export const metadata = { title: "Movimentações" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ produto?: string; novo?: string }> }) {
  const actor = await requirePermission("stock.view");
  const params = await searchParams;
  const canManage = can(actor, "stock.manage");
  const [org, products, movements] = await Promise.all([
    query(getOrganization, {}),
    query(listProducts, { limit: 500 }),
    query(listMovements, { productId: params.produto || undefined }),
  ]);
  const tracked = products.filter((p) => p.trackStock);
  const product = params.produto ? products.find((p) => p.id === params.produto) : undefined;
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });
  const kind = params.novo === "out" || params.novo === "adjust" ? params.novo : "in";

  return (
    <>
      <div className="page-header">
        <h1>{product ? product.name : "Movimentações"}</h1>
        <p>
          {product
            ? `Saldo atual: ${quantity(product.stockQty)} ${product.unitCode}. Cada entrada, saída, ajuste e venda deste produto.`
            : "Entradas, saídas, ajustes e vendas. Tudo que muda o estoque fica registrado aqui."}
        </p>
      </div>

      {canManage && (
        <section className="card">
          <MovementForm
            key={`${kind}-${product?.id ?? ""}`}
            defaultKind={kind}
            defaultProductId={product?.id}
            products={tracked.map((p) => ({ id: p.id, name: p.name, unitCode: p.unitCode, stock: p.stockQty, cost: p.costPrice }))}
          />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Histórico</h2>
          {product && <Link href="/estoque/movimentacoes" className="muted">Ver todos os produtos</Link>}
        </div>
        {movements.length === 0 ? (
          <p className="chart-empty">Nenhuma movimentação ainda.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Data</th>{!product && <th>Produto</th>}<th>Tipo</th><th className="num">Quantidade</th><th className="num">Saldo depois</th><th>Por</th><th>Obs.</th></tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const q = Number(m.quantity);
                  return (
                    <tr key={m.id}>
                      <td>{fmt.format(m.createdAt)}</td>
                      {!product && <td><Link href={`/estoque/movimentacoes?produto=${m.productId}`}>{m.productName}</Link></td>}
                      <td>
                        {m.saleId ? <Link href={`/vendas?id=${m.saleId}`}>{MOVEMENT_LABELS[m.kind]} nº {m.saleNumber}</Link> : MOVEMENT_LABELS[m.kind]}
                      </td>
                      <td className={`num ${q > 0 ? "qty-in" : "qty-out"}`}>{q > 0 ? "+" : "−"}{quantity(Math.abs(q))} {m.unitCode}</td>
                      <td className="num">{quantity(m.balanceAfter)}</td>
                      <td>{m.userName}</td>
                      <td className="muted">{m.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
