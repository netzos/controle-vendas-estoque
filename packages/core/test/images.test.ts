import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  addProductImage,
  AppError,
  createProduct,
  getProductImage,
  listProductImages,
  listProducts,
  listUnits,
  removeProductImage,
  runService,
  setProductCover,
  type Actor,
} from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

// Cabeçalhos mínimos de cada formato; o conteúdo não importa para o serviço.
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = () => new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);

let t: TestDb;
let owner: Actor;
let other: Actor;
let product: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Relógios");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const b = await seedCompany(t.app, "Outra");
  other = await actorFor(t.app, b.userId, b.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  product = (await runService(t.app, createProduct, owner, { sku: "R1", name: "Relógio", unitId: un, salePrice: "0", costPrice: "0", minStock: "0" })).id;
});
after(() => t.close());

describe("fotos dos itens", () => {
  it("aceita JPG, PNG e WebP pelos bytes e recusa o resto", async () => {
    const a = await runService(t.app, addProductImage, owner, { productId: product, data: jpeg(), width: 800, height: 600 });
    await runService(t.app, addProductImage, owner, { productId: product, data: png() });
    const c = await runService(t.app, addProductImage, owner, { productId: product, data: webp() });
    await assert.rejects(
      runService(t.app, addProductImage, owner, { productId: product, data: new Uint8Array(Buffer.from("<svg onload=x>")) }),
      rejectsWith("invalid_input"),
    );
    const file = await runService(t.app, getProductImage, owner, { id: a.id });
    assert.equal(file.contentType, "image/jpeg");
    assert.deepEqual(new Uint8Array(file.data), jpeg());

    // A primeira é a capa até que outra seja escolhida.
    let list = await runService(t.app, listProducts, owner, {});
    assert.equal(list[0]!.coverImageId, a.id);
    await runService(t.app, setProductCover, owner, { id: c.id });
    assert.equal((await runService(t.app, listProductImages, owner, { productId: product }))[0]!.id, c.id);
    list = await runService(t.app, listProducts, owner, {});
    assert.equal(list[0]!.coverImageId, c.id);

    await runService(t.app, removeProductImage, owner, { id: c.id });
    assert.equal((await runService(t.app, listProductImages, owner, { productId: product })).length, 2);
  });

  it("outra empresa não vê a foto nem adiciona ao item", async () => {
    const img = (await runService(t.app, listProductImages, owner, { productId: product }))[0]!;
    await assert.rejects(runService(t.app, getProductImage, other, { id: img.id }), rejectsWith("not_found"));
    await assert.rejects(runService(t.app, addProductImage, other, { productId: product, data: jpeg() }), rejectsWith("not_found"));
  });

  it("limita tamanho e quantidade", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(jpeg());
    await assert.rejects(runService(t.app, addProductImage, owner, { productId: product, data: big }), rejectsWith("invalid_input"));
    for (let i = 0; i < 6; i++) await runService(t.app, addProductImage, owner, { productId: product, data: jpeg() });
    await assert.rejects(runService(t.app, addProductImage, owner, { productId: product, data: jpeg() }), rejectsWith("invalid_input"));
  });
});
