import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { completeSaleFollowup, createProduct, createSale, getSale, listUnits, runService, type Actor } from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

// Pedido nº 24: a venda recém-criada diz se a retirada ficou em aberto,
// para a tela e a Netz oferecerem marcar retirada e recebimento na hora.
let t: TestDb;
let owner: Actor;
let lata: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Fazenda");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  lata = (await runService(t.app, createProduct, owner, {
    sku: "LATA", name: "Lata de açaí", unitId: un, salePrice: "50", costPrice: "20", minStock: "0", initialStock: "50",
  })).id;
});
after(() => t.close());

describe("depois da venda", () => {
  it("devolve o estado da retirada igual ao da ficha da venda", async () => {
    const v = await runService(t.app, createSale, owner, { paymentLater: true, items: [{ productId: lata, quantity: "1" }] });
    const s = await runService(t.app, getSale, owner, { id: v.id });
    assert.equal(v.followupStatus, s.followupStatus);
    assert.notEqual(v.paymentStatus, "paid");
    if (v.followupStatus === "open") {
      await runService(t.app, completeSaleFollowup, owner, { saleId: v.id });
      assert.equal((await runService(t.app, getSale, owner, { id: v.id })).followupStatus, "done");
    }
  });
});
