import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  createProduct,
  createSale,
  createSupplier,
  listSupplierProducts,
  listUnits,
  removeSupplierProduct,
  runService,
  setSupplierProduct,
  updateSupplier,
  type Actor,
} from "../src/index.ts";
import { actorFor, addUserWithRole, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

let t: TestDb;
let owner: Actor;
let other: Actor;
let iphone: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Loja de Eletrônicos");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const b = await seedCompany(t.app, "Outra Loja");
  other = await actorFor(t.app, b.userId, b.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  iphone = (await runService(t.app, createProduct, owner, { sku: "IP15", name: "iPhone 15", unitId: un, salePrice: "5000", costPrice: "4200", minStock: "0", trackStock: true })).id;
});
after(() => t.close());

describe("fornecedor completo e preço combinado", () => {
  it("guarda WhatsApp com código do país, CEP e prazo", async () => {
    const s = await runService(t.app, createSupplier, owner, {
      name: "Distribuidora Norte", whatsapp: "(91) 98888-7777", zipCode: "66.010-000", street: "Av. Presidente Vargas",
      streetNumber: "100", district: "Campina", city: "Belém", state: "pa", leadTimeDays: "5",
    });
    assert.equal(s.whatsapp, "5591988887777");
    assert.equal(s.zipCode, "66010000");
    assert.equal(s.leadTimeDays, 5);
    assert.equal(s.state, "PA");
    await assert.rejects(runService(t.app, createSupplier, owner, { name: "Ruim", whatsapp: "123" }), rejectsWith("invalid_input"));
    const u = await runService(t.app, updateSupplier, owner, { ...s, leadTimeDays: "", id: s.id, status: "active" });
    assert.equal(u.leadTimeDays, null);
  });

  it("um produto com vários fornecedores, mais barato primeiro, prazo herdado", async () => {
    const a = await runService(t.app, createSupplier, owner, { name: "Fornecedor A", whatsapp: "11999990000", leadTimeDays: "7" });
    const b = await runService(t.app, createSupplier, owner, { name: "Fornecedor B" });
    await runService(t.app, setSupplierProduct, owner, { supplierId: a.id, productId: iphone, agreedPrice: "4.150,00" });
    await runService(t.app, setSupplierProduct, owner, { supplierId: b.id, productId: iphone, agreedPrice: "4100", leadTimeDays: "2", supplierCode: "APL-15" });
    const rows = await runService(t.app, listSupplierProducts, owner, { productId: iphone });
    assert.deepEqual(rows.map((r) => r.supplierName), ["Fornecedor B", "Fornecedor A"]);
    assert.equal(rows[1]!.leadTimeDays, 7);
    assert.equal(rows[1]!.supplierWhatsapp, "5511999990000");

    // Gravar de novo atualiza, não duplica.
    await runService(t.app, setSupplierProduct, owner, { supplierId: a.id, productId: iphone, agreedPrice: "4000" });
    const again = await runService(t.app, listSupplierProducts, owner, { supplierId: a.id });
    assert.equal(again.length, 1);
    assert.equal(again[0]!.agreedPrice, "4000.0000");

    await runService(t.app, removeSupplierProduct, owner, { id: again[0]!.id });
    assert.equal((await runService(t.app, listSupplierProducts, owner, { productId: iphone })).length, 1);
  });

  it("outra empresa não vê nem usa os fornecedores", async () => {
    const s = await runService(t.app, createSupplier, owner, { name: "Fornecedor C" });
    assert.equal((await runService(t.app, listSupplierProducts, other, {})).length, 0);
    await assert.rejects(
      runService(t.app, setSupplierProduct, other, { supplierId: s.id, productId: iphone, agreedPrice: "1" }),
      rejectsWith("not_found"),
    );
  });
});

describe("preço na hora da venda", () => {
  it("só muda o preço quem tem a permissão", async () => {
    const seller = await addUserWithRole(t.app, owner, "sales", "Vendedor");
    await assert.rejects(
      runService(t.app, createSale, seller.actor, { paymentMethod: "pix", items: [{ productId: iphone, quantity: "1", unitPrice: "4500" }] }),
      rejectsWith("forbidden"),
    );
    // Mesmo preço do cadastro passa.
    await runService(t.app, createSale, seller.actor, { paymentMethod: "pix", items: [{ productId: iphone, quantity: "1", unitPrice: "5000,00" }] });
    const sale = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: iphone, quantity: "1", unitPrice: "4800" }] });
    assert.equal(sale.total, "4800.00");
  });
});
