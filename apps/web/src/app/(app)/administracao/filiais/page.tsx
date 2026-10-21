import { can, listBranches } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { BranchForm } from "./branch-forms";

export const metadata = { title: "Filiais" };

export default async function BranchesPage() {
  const actor = await requirePermission("branches.view");
  const branches = await query(listBranches, { includeInactive: true });
  const canManage = can(actor, "branches.manage");
  return (
    <>
      <div className="page-header">
        <h1>Filiais</h1>
        <p>Unidades da empresa. Vendas, estoque e financeiro poderão ser filtrados por filial.</p>
      </div>
      {branches.map((b) =>
        canManage ? (
          <details className="card" key={b.id}>
            <summary>
              {b.name} <span className="muted">({b.code})</span>{" "}
              {b.isHeadquarters && <span className="tag">Matriz</span>}{" "}
              <span className={`tag ${b.status === "active" ? "ok" : "off"}`}>{b.status === "active" ? "Ativa" : "Inativa"}</span>
            </summary>
            <BranchForm branch={b} />
          </details>
        ) : (
          <div className="card" key={b.id}>
            <strong>{b.name}</strong> <span className="muted">({b.code})</span> {b.isHeadquarters && <span className="tag">Matriz</span>}
          </div>
        ),
      )}
      {canManage && (
        <section className="card">
          <h2>Nova filial</h2>
          <BranchForm />
        </section>
      )}
    </>
  );
}
