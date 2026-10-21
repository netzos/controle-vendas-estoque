import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  createCategory,
  createCustomer,
  createProduct,
  createSupplier,
  listAuditLogs,
  listCustomers,
  listProducts,
  listUnits,
  runService,
  updateCategory,
  updateCustomer,
  updateProduct,
  updateUnit,
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
let otherOwner: Actor;
let unitId: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Açaí do Norte");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const b = await seedCompany(t.app, "Outra Loja");
  otherOwner = await actorFor(t.app, b.userId, b.organizationId);
  const units = await runService(t.app, listUnits, owner, {});
  unitId = units.find((u) => u.code === "UN")!.id;
});
after(() => t.close());

describe("clientes e fornecedores", () => {
  it("empresa nova já vem com unidades de medida", async () => {
    const units = await runService(t.app, listUnits, owner, {});
    assert.deepEqual(units.map((u) => u.code).sort(), ["CX", "G", "KG", "L", "M", "ML", "PCT", "UN"]);
  });

  it("normaliza e valida CPF/CNPJ e recusa documento repetido", async () => {
    const c = await runService(t.app, createCustomer, owner, { name: "Maria Silva", document: "529.982.247-25", phone: "(91) 99999-0000" });
    assert.equal(c.document, "52998224725");
    await assert.rejects(runService(t.app, createCustomer, owner, { name: "Outra", document: "529.982.247-24" }), rejectsWith("invalid_input"));
    await assert.rejects(runService(t.app, createCustomer, owner, { name: "Maria 2", document: "52998224725" }), rejectsWith("conflict"));
    // Outra empresa pode ter o mesmo cliente.
    await runService(t.app, createCustomer, otherOwner, { name: "Maria Silva", document: "52998224725" });
    const s = await runService(t.app, createSupplier, owner, { name: "Distribuidora Pará", document: "11.222.333/0001-81" });
    assert.equal(s.document, "11222333000181");
  });

  it("busca por nome e por documento, e desativa sem apagar", async () => {
    const byName = await runService(t.app, listCustomers, owner, { search: "maria" });
    assert.equal(byName.length, 1);
    const byDoc = await runService(t.app, listCustomers, owner, { search: "982.247" });
    assert.equal(byDoc.length, 1);
    await runService(t.app, updateCustomer, owner, { ...byName[0]!, id: byName[0]!.id, status: "inactive" });
    assert.equal((await runService(t.app, listCustomers, owner, {})).length, 0);
    assert.equal((await runService(t.app, listCustomers, owner, { includeInactive: true })).length, 1);
  });

  it("isolamento: uma empresa não vê os clientes da outra", async () => {
    const mine = await runService(t.app, listCustomers, otherOwner, { includeInactive: true });
    assert.equal(mine.length, 1);
    const theirs = await runService(t.app, listCustomers, owner, { includeInactive: true });
    assert.notEqual(mine[0]!.id, theirs[0]!.id);
  });
});

describe("produtos", () => {
  let categoryId: string;

  it("cadastra produto com preço em formato brasileiro", async () => {
    categoryId = (await runService(t.app, createCategory, owner, { name: "Açaí" })).id;
    await assert.rejects(runService(t.app, createCategory, owner, { name: "açaí" }), rejectsWith("conflict"));
    const p = await runService(t.app, createProduct, owner, {
      sku: "ACAI-500", name: "Açaí 500 ml", unitId, categoryId, salePrice: "1.234,50", costPrice: "8,7550", minStock: "10",
    });
    assert.equal(p.salePrice, "1234.50");
    assert.equal(p.costPrice, "8.7550");
    assert.equal(p.categoryName, "Açaí");
    assert.equal(p.unitCode, "UN");
    await assert.rejects(
      runService(t.app, createProduct, owner, { sku: "ACAI-500", name: "Repetido", unitId, salePrice: "1", costPrice: "0", minStock: "0" }),
      rejectsWith("conflict"),
    );
    await assert.rejects(
      runService(t.app, createProduct, owner, { sku: "X1", name: "Preço ruim", unitId, salePrice: "12,345", costPrice: "0", minStock: "0" }),
      rejectsWith("invalid_input"),
    );
  });

  it("não aceita unidade ou categoria de outra empresa", async () => {
    const otherUnit = (await runService(t.app, listUnits, otherOwner, {}))[0]!.id;
    await assert.rejects(
      runService(t.app, createProduct, owner, { sku: "X2", name: "Produto", unitId: otherUnit, salePrice: "1", costPrice: "0", minStock: "0" }),
      rejectsWith("invalid_input"),
    );
  });

  it("estoquista cadastra sem preço; só quem tem permissão altera preço, e a mudança fica auditada", async () => {
    const stock = await addUserWithRole(t.app, owner, "stock", "Estoquista");
    await assert.rejects(
      runService(t.app, createProduct, stock.actor, { sku: "COPO", name: "Copo 300 ml", unitId, salePrice: "2", costPrice: "0", minStock: "0" }),
      rejectsWith("forbidden"),
    );
    const p = await runService(t.app, createProduct, stock.actor, { sku: "COPO", name: "Copo 300 ml", unitId, salePrice: "", costPrice: "", minStock: "50" });
    await assert.rejects(
      runService(t.app, updateProduct, stock.actor, { ...p, id: p.id, salePrice: "3", costPrice: "0", minStock: "50", status: "active" }),
      rejectsWith("forbidden"),
    );
    // Alterar outros campos sem mexer no preço é permitido.
    await runService(t.app, updateProduct, stock.actor, { ...p, id: p.id, name: "Copo 300ml", salePrice: "0", costPrice: "0", minStock: "60", status: "active" });
    const updated = await runService(t.app, updateProduct, owner, { ...p, id: p.id, name: "Copo 300ml", salePrice: "3,00", costPrice: "0,80", minStock: "60", status: "active" });
    assert.equal(updated.salePrice, "3.00");
    const logs = await runService(t.app, listAuditLogs, owner, { limit: 50 });
    const change = logs.items.find((l) => l.action === "product.price_change");
    assert.ok(change, "mudança de preço auditada");
    assert.match(change.summary ?? "", /0\.00 → 3\.00/);

    const seller = await addUserWithRole(t.app, owner, "sales", "Vendedor");
    await assert.rejects(
      runService(t.app, createProduct, seller.actor, { sku: "V1", name: "X", unitId, salePrice: "0", costPrice: "0", minStock: "0" }),
      rejectsWith("forbidden"),
    );
    assert.ok((await runService(t.app, listProducts, seller.actor, {})).length >= 2);
  });

  it("busca por código de barras e filtra por categoria", async () => {
    const p = await runService(t.app, createProduct, owner, {
      sku: "AGUA", barcode: "7891234567895", name: "Água mineral", unitId, salePrice: "3", costPrice: "1", minStock: "0",
    });
    const found = await runService(t.app, listProducts, owner, { search: "7891234567895" });
    assert.deepEqual(found.map((x) => x.id), [p.id]);
    const inCat = await runService(t.app, listProducts, owner, { categoryId });
    assert.deepEqual(inCat.map((x) => x.sku), ["ACAI-500"]);
  });

  it("não desativa unidade usada por produto ativo; categoria pode ser renomeada", async () => {
    const u = (await runService(t.app, listUnits, owner, {})).find((x) => x.code === "UN")!;
    await assert.rejects(runService(t.app, updateUnit, owner, { ...u, status: "inactive" }), rejectsWith("conflict"));
    const c = await runService(t.app, updateCategory, owner, { id: categoryId, name: "Açaí na tigela", status: "active" });
    assert.equal(c.name, "Açaí na tigela");
  });
});
