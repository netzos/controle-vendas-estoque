import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  createBranch,
  createCustomer,
  createProduct,
  createSale,
  importCustomers,
  listCustomers,
  listSales,
  listUnits,
  parseSheet,
  runService,
  salesDashboard,
  updateCustomer,
  updateMember,
  type Actor,
} from "../src/index.ts";
import { actorFor, addUserWithRole, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
let owner: Actor;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Fazenda");
  owner = await actorFor(t.app, a.userId, a.organizationId);
});
after(() => t.close());

const SHEET = [
  "codigo;nome;telefone;email;cpf_cnpj;cidade;endereco;data_cadastro;observacoes",
  "C01;Ana Lima;91 99999-0001;ana@x.com;529.982.247-25;Belém;Rua A, 10;25/03/2021;cliente antiga",
  "C02;Bruno Reis;91 99999-0002;;;Ananindeua;;2022-01-10;",
  'C03;"Carla; Joias";;carla@;;;;;',
  "C04;Ana Lima;;;;;;;repetida",
  "",
].join("\n");

describe("importar clientes da planilha", () => {
  it("lê ; , e tab, com aspas", () => {
    assert.deepEqual(parseSheet('a;b\n"x;1";2\n'), [["a", "b"], ["x;1", "2"]]);
    assert.deepEqual(parseSheet("a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(parseSheet("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  });

  it("mostra a prévia sem gravar, aponta erros e repetidos, e importa com uma confirmação", async () => {
    await runService(t.app, createCustomer, owner, { name: "Bruno Reis" });
    const preview = await runService(t.app, importCustomers, owner, { text: SHEET });
    assert.equal(preview.created, 0);
    assert.deepEqual(preview.rows.map((r) => r.status), ["new", "duplicate", "error", "duplicate"]);
    assert.match(preview.rows[2]!.message!, /E-mail inválido/);
    assert.equal(preview.columns.find((c) => c.header === "data_cadastro")!.field, "customerSince");
    assert.equal((await runService(t.app, listCustomers, owner, { search: "Ana" })).length, 0);

    const done = await runService(t.app, importCustomers, owner, { text: SHEET, confirm: true });
    assert.equal(done.created, 1);
    const ana = (await runService(t.app, listCustomers, owner, { search: "Ana" }))[0]!;
    assert.equal(ana.code, "C01");
    assert.equal(ana.customerSince, "2021-03-25");
    assert.equal(ana.document, "52998224725");
    // O código antigo também acha o cliente.
    assert.equal((await runService(t.app, listCustomers, owner, { search: "c01" }))[0]!.id, ana.id);
    // Importar de novo não duplica.
    assert.equal((await runService(t.app, importCustomers, owner, { text: SHEET, confirm: true })).created, 0);
  });

  it("sem coluna de nome, explica o que falta", async () => {
    await assert.rejects(runService(t.app, importCustomers, owner, { text: "telefone\n123" }), AppError);
  });
});

describe("filial no cliente e na venda", () => {
  it("cliente da filial, venda herda a filial e o painel filtra", async () => {
    const pepe = await runService(t.app, createBranch, owner, { name: "Pepe Joalheiro", code: "PEPE" });
    const imported = await runService(t.app, importCustomers, owner, { text: "nome\nCliente Joia", branchId: pepe.id, confirm: true });
    assert.equal(imported.created, 1);
    const joia = (await runService(t.app, listCustomers, owner, { search: "Joia" }))[0]!;
    assert.equal(joia.branchName, "Pepe Joalheiro");
    const geral = await runService(t.app, createCustomer, owner, { name: "Cliente Geral" });
    assert.equal(geral.branchId, null);
    // Filtro: os da filial e os da empresa toda.
    const filtered = await runService(t.app, listCustomers, owner, { branchId: pepe.id });
    assert.ok(filtered.some((c) => c.id === joia.id) && filtered.some((c) => c.id === geral.id));
    // Alterar sem mandar a filial mantém a que estava.
    const kept = await runService(t.app, updateCustomer, owner, { id: joia.id, name: "Cliente Joia", status: "active" });
    assert.equal(kept.branchId, pepe.id);

    const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
    const relogio = await runService(t.app, createProduct, owner, { sku: "REL", name: "Relógio", unitId: un, salePrice: "100", costPrice: "50", minStock: "0", itemType: "service" });
    await runService(t.app, createSale, owner, { customerId: joia.id, paymentMethod: "pix", items: [{ productId: relogio.id, quantity: "1" }] });
    await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: relogio.id, quantity: "2" }] });
    const sales = await runService(t.app, listSales, owner, { branchId: pepe.id });
    assert.equal(sales.length, 1);
    assert.equal(sales[0]!.branchName, "Pepe Joalheiro");
    const all = await runService(t.app, salesDashboard, owner, { period: "today" });
    const branch = await runService(t.app, salesDashboard, owner, { period: "today", branchId: pepe.id });
    assert.equal(branch.current.count, 1);
    assert.equal(branch.current.revenue, "100.00");
    assert.ok(all.current.count >= 2);
    assert.equal(branch.recent.length, 1);

    // Quem só trabalha na matriz não vê os clientes da Pepe.
    const seller = await addUserWithRole(t.app, owner, "sales", "Vendedor");
    const hq = await t.owner.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.branches WHERE organization_id = $1 AND is_headquarters", [owner.organizationId]);
    const roleId = (await t.owner.query<{ role_id: string }>("SELECT role_id FROM controle_vendas_estoque.memberships WHERE id = $1", [seller.membershipId])).rows[0]!.role_id;
    await runService(t.app, updateMember, owner, { membershipId: seller.membershipId, roleId, branchIds: [hq.rows[0]!.id], status: "active" });
    const restricted = await actorFor(t.app, seller.userId, owner.organizationId);
    const seen = await runService(t.app, listCustomers, restricted, {});
    assert.ok(!seen.some((c) => c.id === joia.id));
    assert.ok(seen.some((c) => c.id === geral.id));
    await assert.rejects(runService(t.app, createCustomer, restricted, { name: "Outro", branchId: pepe.id }), AppError);
  });
});
