import { can, listCustomers, listProducts } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { SaleForm } from "./sale-form";

export const metadata = { title: "Nova venda" };

export default async function NewSalePage() {
  const actor = await requirePermission("sales.create");
  const [products, customers] = await Promise.all([
    query(listProducts, { limit: 500 }),
    can(actor, "customers.view") ? query(listCustomers, { limit: 500 }) : [],
  ]);
  return (
    <>
      <div className="page-header">
        <h1>Nova venda</h1>
        <p>Toque nos produtos, escolha a forma de pagamento e finalize. O estoque baixa sozinho.</p>
      </div>
      <SaleForm
        canChangePrice={can(actor, "sales.change_price")}
        canTradeIn={can(actor, "sales.trade_in")}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.salePrice,
          stock: p.stockQty,
          unitCode: p.unitCode,
          trackStock: p.trackStock,
          itemType: p.itemType,
          imageId: p.coverImageId,
        }))}
      />
    </>
  );
}
