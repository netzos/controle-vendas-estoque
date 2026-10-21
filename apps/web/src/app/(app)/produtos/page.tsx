import Link from "next/link";
import { can, listCategories, listProducts, listSuppliers, listUnits } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money, quantity } from "@/lib/format";
import { ProductForm, type ProductFormOptions } from "./product-form";

export const metadata = { title: "Produtos" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; id?: string; novo?: string; categoria?: string; inativos?: string }>;
}) {
  const actor = await requirePermission("products.view");
  const params = await searchParams;
  const includeInactive = params.inativos === "1";
  const canManage = can(actor, "products.manage");
  const [products, categories] = await Promise.all([
    query(listProducts, { search: params.q || undefined, categoryId: params.categoria || undefined, includeInactive: true }),
    query(listCategories, {}),
  ]);
  const shown = includeInactive ? products : products.filter((p) => p.status === "active");
  const selected = params.id ? products.find((p) => p.id === params.id) : undefined;

  let options: ProductFormOptions | null = null;
  if (canManage && (params.novo === "1" || selected)) {
    const [units, suppliers] = await Promise.all([
      query(listUnits, {}),
      can(actor, "suppliers.view") ? query(listSuppliers, { limit: 500 }) : Promise.resolve([]),
    ]);
    options = { categories, units, suppliers, canEditPrice: can(actor, "products.update_price") };
  }

  return (
    <>
      <div className="page-header">
        <h1>Produtos</h1>
        <p>O que você vende: preço, custo, unidade e estoque mínimo.</p>
      </div>

      {options && params.novo === "1" && (
        <section className="card">
          <h2>Novo produto</h2>
          <ProductForm options={options} />
        </section>
      )}
      {options && selected && (
        <section className="card">
          <h2>{selected.name}</h2>
          <ProductForm key={selected.id} product={selected} options={options} />
        </section>
      )}

      <section className="card">
        <div className="list-toolbar">
          <form>
            <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Buscar por nome, código ou código de barras" aria-label="Buscar produtos" />
            <select name="categoria" defaultValue={params.categoria ?? ""} aria-label="Categoria" style={{ width: "auto" }}>
              <option value="">Todas as categorias</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="submit" className="secondary">Buscar</button>
          </form>
          {canManage && <Link className="button" href="/produtos?novo=1">Novo produto</Link>}
        </div>
        {shown.length === 0 ? (
          <p className="muted">{params.q || params.categoria ? "Nenhum produto encontrado." : "Nenhum produto cadastrado ainda."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th><th>Código</th><th>Categoria</th><th>Unid.</th>
                  <th className="num">Preço</th><th className="num">Custo</th><th className="num">Margem</th><th className="num">Estoque</th><th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const sale = Number(p.salePrice);
                  const margin = sale > 0 ? ((sale - Number(p.costPrice)) / sale) * 100 : null;
                  return (
                    <tr key={p.id} className="clickable">
                      <td><Link href={`/produtos?id=${p.id}`}>{p.name}</Link></td>
                      <td>{p.sku}</td>
                      <td>{p.categoryName}</td>
                      <td>{p.unitCode}</td>
                      <td className="num">{money(p.salePrice)}</td>
                      <td className="num">{money(p.costPrice)}</td>
                      <td className="num">{margin === null ? "—" : `${quantity(margin.toFixed(1), 1)}%`}</td>
                      <td className="num">
                        {p.trackStock ? (
                          <span className={Number(p.stockQty) <= 0 ? "qty-out" : Number(p.stockQty) <= Number(p.minStock) ? "warn-text" : ""}>{quantity(p.stockQty)}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td><span className={`tag ${p.status === "active" ? "ok" : "off"}`}>{p.status === "active" ? "Ativo" : "Inativo"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          {includeInactive ? <Link href="/produtos">Esconder inativos</Link> : <Link href="/produtos?inativos=1">Mostrar inativos</Link>}
        </p>
      </section>
    </>
  );
}
