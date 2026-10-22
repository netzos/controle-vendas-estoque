import { can, listCostTypes } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { CostTypeForm } from "../forms";

export const metadata = { title: "Tipos de custo" };

export default async function CostTypesPage() {
  const actor = await requirePermission("costs.view");
  const types = await query(listCostTypes, { includeInactive: true });
  const canManage = can(actor, "costs.manage");
  return (
    <>
      <div className="page-header">
        <h1>Tipos de custo</h1>
        <p>Como o seu negócio separa os gastos: entrega, mão de obra, combustível, embalagem. As etapas depois da venda usam o tipo com o mesmo nome.</p>
      </div>
      {canManage && (
        <section className="card">
          <h2>Novo tipo</h2>
          <CostTypeForm />
        </section>
      )}
      {types.map((t) => {
        const info = (
          <>
            {t.name}{" "}
            <span className="muted">· {t.usage === 0 ? "sem lançamentos" : `${t.usage} ${t.usage === 1 ? "lançamento" : "lançamentos"}`}</span>{" "}
            {t.status === "inactive" && <span className="tag off">Inativo</span>}
          </>
        );
        return canManage ? (
          <details className="card" key={t.id}>
            <summary>{info}</summary>
            <CostTypeForm type={t} />
          </details>
        ) : (
          <div className="card" key={t.id}>{info}</div>
        );
      })}
    </>
  );
}
