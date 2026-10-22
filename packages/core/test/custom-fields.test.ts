import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  createCategory,
  createCustomField,
  createProduct,
  fieldKey,
  listCustomFields,
  listUnits,
  runService,
  stockOverview,
  updateCustomField,
  updateProduct,
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
let un: string;
let celulares: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Loja de Eletrônicos");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const b = await seedCompany(t.app, "Outra Loja");
  other = await actorFor(t.app, b.userId, b.organizationId);
  un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  celulares = (await runService(t.app, createCategory, owner, { name: "Celulares" })).id;
});
after(() => t.close());

const base = () => ({ unitId: un, salePrice: "100", costPrice: "50", minStock: "0" });

describe("tipo do item", () => {
  it("serviço e encomenda não controlam estoque; produção própria controla", async () => {
    const svc = await runService(t.app, createProduct, owner, { ...base(), sku: "INST", name: "Instalação", itemType: "service", initialStock: "5" });
    assert.equal(svc.trackStock, false);
    const enc = await runService(t.app, createProduct, owner, { ...base(), sku: "IP16", name: "iPhone 16", itemType: "made_to_order" });
    assert.equal(enc.trackStock, false);
    assert.equal(enc.itemType, "made_to_order");
    const prod = await runService(t.app, createProduct, owner, { ...base(), sku: "LATA", name: "Lata de açaí", itemType: "production", initialStock: "12" });
    assert.equal(prod.trackStock, true);
    assert.equal(prod.stockQty, "12.000");
    const rows = (await runService(t.app, stockOverview, owner, {})).rows.map((r) => r.name);
    assert.ok(rows.includes("Lata de açaí") && !rows.includes("Instalação") && !rows.includes("iPhone 16"));
  });
});

describe("campos personalizados", () => {
  it("gera chave a partir do nome", () => {
    assert.equal(fieldKey("Cor do aparelho"), "cor_do_aparelho");
    assert.equal(fieldKey("Nº de série"), "n_de_serie");
    assert.equal(fieldKey("2ª via"), "campo_2_via");
  });

  it("valida, converte e respeita a categoria", async () => {
    await runService(t.app, createCustomField, owner, { label: "IMEI", fieldType: "text", required: true, categoryId: celulares });
    await runService(t.app, createCustomField, owner, { label: "Cor", fieldType: "select", options: "Preto, Branco, Preto" });
    await runService(t.app, createCustomField, owner, { label: "Garantia (meses)", fieldType: "number" });
    await runService(t.app, createCustomField, owner, { label: "Validade", fieldType: "date" });
    await runService(t.app, createCustomField, owner, { label: "Lacrado", fieldType: "boolean" });
    const fields = await runService(t.app, listCustomFields, owner, {});
    assert.deepEqual(fields.find((f) => f.key === "cor")!.options, ["Preto", "Branco"]);
    assert.equal((await runService(t.app, listCustomFields, other, {})).length, 0);

    // IMEI obrigatório só vale para Celulares.
    await assert.rejects(
      runService(t.app, createProduct, owner, { ...base(), sku: "IP15", name: "iPhone 15", categoryId: celulares, customValues: { cor: "Preto" } }),
      rejectsWith("invalid_input"),
    );
    const capa = await runService(t.app, createProduct, owner, { ...base(), sku: "CAPA", name: "Capa", customValues: { cor: "Branco", inexistente: "x" } });
    assert.deepEqual(capa.customValues, { cor: "Branco" });

    const ip = await runService(t.app, createProduct, owner, {
      ...base(), sku: "IP15", name: "iPhone 15", categoryId: celulares,
      customValues: { imei: " 356938035643809 ", cor: "Preto", garantia_meses: "12", validade: "31/12/2027", lacrado: "on" },
    });
    assert.deepEqual(ip.customValues, { imei: "356938035643809", cor: "Preto", garantia_meses: 12, validade: "2027-12-31", lacrado: true });
    await assert.rejects(
      runService(t.app, updateProduct, owner, { ...base(), ...ip, id: ip.id, status: "active", customValues: { imei: "1", cor: "Roxo" } }),
      rejectsWith("invalid_input"),
    );

    // Campo desativado: o valor antigo fica guardado.
    const cor = fields.find((f) => f.key === "cor")!;
    await runService(t.app, updateCustomField, owner, { ...cor, options: cor.options.join(","), id: cor.id, status: "inactive" });
    const upd = await runService(t.app, updateProduct, owner, { ...base(), ...ip, id: ip.id, status: "active", customValues: { imei: "999" } });
    assert.equal(upd.customValues.cor, "Preto");
    assert.equal(upd.customValues.imei, "999");
  });

  it("só quem tem a permissão cria campos", async () => {
    const seller = await addUserWithRole(t.app, owner, "sales", "Vendedor");
    await assert.rejects(runService(t.app, createCustomField, seller.actor, { label: "Chassi", fieldType: "text" }), rejectsWith("forbidden"));
    await assert.rejects(runService(t.app, createCustomField, owner, { label: "Tamanho", fieldType: "select" }), rejectsWith("invalid_input"));
  });
});
