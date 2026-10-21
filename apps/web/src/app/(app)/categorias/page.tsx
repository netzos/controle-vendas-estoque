import { can, listCategories } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { CategoryForm } from "./forms";

export const metadata = { title: "Categorias" };

export default async function CategoriesPage() {
  const actor = await requirePermission("products.view");
  const categories = await query(listCategories, { includeInactive: true });
  const canManage = can(actor, "products.manage");
  return (
    <>
      <div className="page-header">
        <h1>Categorias</h1>
        <p>Grupos para organizar os produtos, por exemplo Açaí, Bebidas ou Complementos.</p>
      </div>
      {canManage && (
        <section className="card">
          <h2>Nova categoria</h2>
          <CategoryForm />
        </section>
      )}
      {categories.length === 0 && <p className="muted">Nenhuma categoria cadastrada ainda.</p>}
      {categories.map((c) =>
        canManage ? (
          <details className="card" key={c.id}>
            <summary>
              {c.name} <span className="muted">· {c.productCount} {c.productCount === 1 ? "produto" : "produtos"}</span>{" "}
              {c.status === "inactive" && <span className="tag off">Inativa</span>}
            </summary>
            <CategoryForm category={c} />
          </details>
        ) : (
          <div className="card" key={c.id}>
            <strong>{c.name}</strong> <span className="muted">· {c.productCount} produtos</span>
          </div>
        ),
      )}
    </>
  );
}
