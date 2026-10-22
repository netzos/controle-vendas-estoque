import { can, listUnits } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { Notice, RemoveRecord } from "@/components/remove-record";
import { query } from "@/lib/actions";
import { UnitForm } from "../categorias/forms";

export const metadata = { title: "Unidades de medida" };

export default async function UnitsPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const actor = await requirePermission("products.view");
  const units = await query(listUnits, { includeInactive: true });
  const canManage = can(actor, "products.manage");
  return (
    <>
      <div className="page-header">
        <h1>Unidades de medida</h1>
        <p>Como cada produto é vendido e contado no estoque: unidade, quilo, litro, caixa.</p>
      </div>
      <Notice text={(await searchParams).aviso} />
      {units.map((u) =>
        canManage ? (
          <details className="card" key={u.id}>
            <summary>
              {u.code} <span className="muted">· {u.name}</span> {u.status === "inactive" && <span className="tag off">Inativa</span>}
             <span className="edit-hint">Editar ›</span></summary>
            <UnitForm unit={u} />
            <RemoveRecord kind="unit" id={u.id} name={u.name} back="/unidades" />
          </details>
        ) : (
          <div className="card" key={u.id}><strong>{u.code}</strong> <span className="muted">· {u.name}</span></div>
        ),
      )}
      {canManage && (
        <section className="card">
          <h2>Nova unidade</h2>
          <UnitForm />
        </section>
      )}
    </>
  );
}
