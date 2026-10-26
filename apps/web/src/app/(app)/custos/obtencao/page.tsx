import Link from "next/link";
import { can, listCostTypes, listObtainingCosts, orgDate } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money } from "@/lib/format";
import { CostPartForm } from "../forms";

export const metadata = { title: "Custo de cada produto" };

const dateLabel = (d: string) => d.split("-").reverse().join("/");

export default async function ObtainingCostsPage({ searchParams }: { searchParams: Promise<{ produto?: string }> }) {
  const actor = await requirePermission("costs.view");
  const { produto } = await searchParams;
  const [items, types, today] = await Promise.all([query(listObtainingCosts, {}), query(listCostTypes, {}), query(orgDate, {})]);
  const canManage = can(actor, "costs.manage");
  const withParts = items.filter((i) => i.parts.length > 0);
  const without = items.filter((i) => i.parts.length === 0);
  return (
    <>
      <div className="page-header">
        <h1>Custo de cada produto</h1>
        <p>
          Quanto custa para ter cada produto, separado em partes (ex.: camiseta = tecido + costura + estampa).
          A soma vira o custo do produto. Quando um valor muda, o anterior fica guardado e as vendas antigas não mudam.
        </p>
      </div>
      {canManage && (
        <section className="card">
          <h2>Definir uma parte do custo</h2>
          <CostPartForm
            today={today}
            productId={produto}
            products={items.map((i) => ({ id: i.productId, name: i.productName }))}
            types={types.map((t) => ({ id: t.id, name: t.name }))}
          />
        </section>
      )}
      {withParts.length === 0 && <p className="muted">Nenhum produto com custo separado em partes ainda.</p>}
      {withParts.map((i) => {
        const margin = Number(i.salePrice) > 0 ? ((Number(i.salePrice) - Number(i.total)) / Number(i.salePrice)) * 100 : null;
        const current = i.parts.filter((p) => p.current);
        const history = i.parts.filter((p) => !p.current);
        return (
          <section className="card" key={i.productId}>
            <div className="card-head">
              <h2>{i.productName}</h2>
              <span className="muted">
                custa {money(i.total)} por {i.unitCode} · vende a {money(i.salePrice)}
                {margin !== null ? ` · margem ${margin.toFixed(1).replace(".", ",")}%` : ""}
              </span>
            </div>
            <ul className="mini-list">
              {current.map((p) => (
                <li key={p.id}>
                  <span>{p.costTypeName} <span className="muted">desde {dateLabel(p.validFrom)}{p.notes ? ` · ${p.notes}` : ""}</span></span>
                  <strong>{money(p.amount)}</strong>
                </li>
              ))}
            </ul>
            {history.length > 0 && (
              <details>
                <summary className="muted">Valores anteriores ({history.length})</summary>
                <ul className="mini-list">
                  {history.map((p) => (
                    <li key={p.id}>
                      <span>{p.costTypeName} <span className="muted">a partir de {dateLabel(p.validFrom)} · {p.userName}{p.notes ? ` · ${p.notes}` : ""}</span></span>
                      <span>{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {canManage && <p><Link href={`/custos/obtencao?produto=${i.productId}`}>Mudar uma parte</Link></p>}
          </section>
        );
      })}
      {without.length > 0 && (
        <section className="card">
          <h2>Produtos com custo de um valor só</h2>
          <ul className="mini-list">
            {without.map((i) => (
              <li key={i.productId}>
                <span>{i.productName}</span>
                <strong>{money(i.costPrice)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
