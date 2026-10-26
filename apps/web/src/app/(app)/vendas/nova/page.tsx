import { can, enabledFeatures, getSettings, listCustomers, listProducts, listStepTypes, orgDate } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { db } from "@/lib/db";
import { SaleForm } from "./sale-form";

export const metadata = { title: "Nova venda" };

export default async function NewSalePage() {
  const actor = await requirePermission("sales.create");
  const [products, customers, today, stepTypes, settings, features] = await Promise.all([
    query(listProducts, { limit: 500 }),
    can(actor, "customers.view") ? query(listCustomers, { limit: 500 }) : [],
    query(orgDate, {}),
    query(listStepTypes, {}),
    query(getSettings, {}),
    enabledFeatures(db(), actor.organizationId),
  ]);
  return (
    <>
      <div className="page-header">
        <h1>Nova venda</h1>
        <p>Toque nos produtos, escolha a forma de pagamento e finalize. O estoque baixa sozinho.</p>
      </div>
      <SaleForm
        canChangePrice={can(actor, "sales.change_price")}
        canTradeIn={features.has("trade_in") && can(actor, "sales.trade_in")}
        canManageSteps={features.has("deliveries") && can(actor, "deliveries.manage")}
        today={today}
        defaultFulfillment={settings["sales.default_fulfillment"]}
        stepDefaults={stepTypes.map((t) => ({ name: t.name, days: t.defaultDays, responsible: t.defaultResponsible, cost: t.defaultCost }))}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.salePrice,
          stock: p.stockQty,
          unitCode: p.unitCode,
          trackStock: p.trackStock,
          backorder: p.backorder,
          itemType: p.itemType,
          imageId: p.coverImageId,
          steps: p.afterSaleSteps,
        }))}
      />
    </>
  );
}
