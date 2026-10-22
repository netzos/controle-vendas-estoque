import Link from "next/link";
import { can, ITEM_TYPES, listCategories, ORDER_STEP, listStepTypes, listCustomFields, listProductImages, listProducts, listSupplierProducts, listSuppliers, listUnits } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { money, quantity } from "@/lib/format";
import { ProductForm, type ProductFormOptions } from "./product-form";
import { SupplierPrices } from "../fornecedores/supplier-prices";
import { ProductPhotos } from "./photos";

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

  const seesSuppliers = can(actor, "suppliers.view");
  const [suppliers, supplierPrices, images] = await Promise.all([
    seesSuppliers && (params.novo === "1" || selected) ? query(listSuppliers, { limit: 500 }) : Promise.resolve([]),
    seesSuppliers && selected ? query(listSupplierProducts, { productId: selected.id }) : Promise.resolve([]),
    selected ? query(listProductImages, { productId: selected.id }) : Promise.resolve([]),
  ]);
  let options: ProductFormOptions | null = null;
  if (canManage && (params.novo === "1" || selected)) {
    const [units, customFields, stepTypes] = await Promise.all([query(listUnits, {}), query(listCustomFields, {}), query(listStepTypes, {})]);
    options = { categories, units, suppliers, customFields, stepNames: stepTypes.map((t) => t.name).filter((n) => n !== ORDER_STEP), canEditPrice: can(actor, "products.update_price") };
  }

  return (
    <>
      <div className="page-header">
        <h1>Produtos</h1>
        <p>Tudo o que você vende: produtos em estoque, só por encomenda, serviços e produção própria.</p>
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
      {selected && (
        <section className="card">
          <ProductPhotos key={selected.id} productId={selected.id} images={images} canManage={canManage} />
        </section>
      )}
      {selected && seesSuppliers && (
        <section className="card">
          <SupplierPrices
            key={selected.id}
            side="product"
            ownerId={selected.id}
            rows={supplierPrices}
            options={suppliers.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name }))}
            canManage={can(actor, "suppliers.manage")}
          />
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
                      <td>
                        <div className="with-thumb">
                          {p.coverImageId ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="thumb" src={`/imagens/${p.coverImageId}`} alt="" loading="lazy" />
                          ) : (
                            <span className="thumb empty">{p.name[0]}</span>
                          )}
                          <div>
                            <Link href={`/produtos?id=${p.id}`}>{p.name}</Link>
                            {p.itemType !== "stock" && <small className="muted">{ITEM_TYPES[p.itemType].label}</small>}
                          </div>
                        </div>
                      </td>
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
