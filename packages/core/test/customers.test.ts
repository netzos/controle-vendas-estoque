import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addressLine, createCustomer, getCustomerPhoto, listCustomers, removeCustomerPhoto, runService, setCustomerPhoto, updateCustomer, AppError, type Actor } from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
let owner: Actor;
// Menor PNG válido (1x1).
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Loja");
  owner = await actorFor(t.app, a.userId, a.organizationId);
});
after(() => t.close());

describe("cliente com endereço completo e foto", () => {
  it("guarda o endereço começando pelo CEP e monta a linha de entrega", async () => {
    const c = await runService(t.app, createCustomer, owner, {
      name: "Maria Souza", zipCode: "66.010-000", street: "Av. Presidente Vargas", streetNumber: "100", complement: "apto 12", district: "Campina", city: "Belém", state: "pa",
    });
    assert.equal(c.zipCode, "66010000");
    assert.equal(c.state, "PA");
    assert.equal(addressLine(c), "Av. Presidente Vargas, 100 - apto 12 - Campina, Belém/PA - CEP 66010-000");
    const updated = await runService(t.app, updateCustomer, owner, { ...c, id: c.id, status: "active", streetNumber: "200" });
    assert.equal(updated.streetNumber, "200");
    await assert.rejects(runService(t.app, createCustomer, owner, { name: "CEP errado", zipCode: "123" }), AppError);
  });

  it("coloca, troca e tira a foto; cada foto nova tem outro endereço", async () => {
    const c = (await runService(t.app, listCustomers, owner, { search: "Maria" }))[0]!;
    assert.equal(c.photoId, null);
    const first = await runService(t.app, setCustomerPhoto, owner, { customerId: c.id, data: PNG });
    const photo = await runService(t.app, getCustomerPhoto, owner, { photoId: first.photoId });
    assert.equal(photo.contentType, "image/png");
    const second = await runService(t.app, setCustomerPhoto, owner, { customerId: c.id, data: PNG });
    assert.notEqual(first.photoId, second.photoId);
    await assert.rejects(runService(t.app, setCustomerPhoto, owner, { customerId: c.id, data: Uint8Array.from([1, 2, 3]) }), AppError);
    await runService(t.app, removeCustomerPhoto, owner, { customerId: c.id });
    assert.equal((await runService(t.app, listCustomers, owner, { search: "Maria" }))[0]!.photoId, null);
  });
});
