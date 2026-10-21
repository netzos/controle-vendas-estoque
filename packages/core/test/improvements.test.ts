import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  agentCreateImprovement,
  AppError,
  claudeCommentImprovement,
  claudeCreateImprovement,
  claudeGetImprovement,
  claudeListImprovements,
  claudeMoveImprovement,
  commentImprovement,
  createImprovement,
  decideImprovement,
  editImprovement,
  getImprovement,
  improvementViewer,
  listImprovements,
  type Actor,
  type ImprovementViewer,
} from "../src/index.ts";
import { actorFor, addUserWithRole, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

let t: TestDb;
let devOwner: Actor; // proprietário da empresa A e desenvolvedor da plataforma
let dev: ImprovementViewer;
let seller: ImprovementViewer;
let sellerActor: Actor;
let otherOrg: ImprovementViewer;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Empresa A", "dev@netzcode.com.br");
  devOwner = await actorFor(t.app, a.userId, a.organizationId);
  await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1)", [a.userId]);
  dev = await improvementViewer(t.app, devOwner);
  const s = await addUserWithRole(t.app, devOwner, "sales", "Vendedora");
  sellerActor = s.actor;
  seller = await improvementViewer(t.app, s.actor);
  const b = await seedCompany(t.app, "Empresa B");
  otherOrg = await improvementViewer(t.app, await actorFor(t.app, b.userId, b.organizationId));
});
after(() => t.close());

describe("melhorias", () => {
  it("desenvolvedor vem da tabela da plataforma, não do perfil", () => {
    assert.equal(dev.isDeveloper, true);
    assert.equal(seller.isDeveloper, false);
    assert.equal(otherOrg.isDeveloper, false);
  });

  it("fluxo completo: pedido, análise do Claude, aprovação, desenvolvimento e publicação", async () => {
    const item = await createImprovement(t.app, seller, {
      title: "Filtrar vendas por vendedor",
      body: "Quero ver só as minhas vendas na lista.",
      module: "comercial",
    });
    assert.equal(item.status, "new");
    assert.equal(item.source, "site");
    assert.equal(item.createdByName, "Vendedora");

    // O Claude vê pedidos de todas as empresas e responde com a análise.
    const fresh = await claudeListImprovements(t.app, { status: ["new"] });
    assert.ok(fresh.some((i) => i.id === item.id));
    await claudeMoveImprovement(t.app, item.id, "analysis", { body: "Análise: adicionar filtro por vendedor na lista; risco baixo." });

    // O Claude não aprova.
    await assert.rejects(claudeMoveImprovement(t.app, item.id, "approved"), rejectsWith("invalid_input"));
    await assert.rejects(claudeMoveImprovement(t.app, item.id, "building"), rejectsWith("conflict"));

    // Quem pediu não aprova; só o desenvolvedor.
    await assert.rejects(decideImprovement(t.app, seller, item.id, "approve"), rejectsWith("forbidden"));
    const approved = await decideImprovement(t.app, dev, item.id, "approve", "Pode fazer.");
    assert.equal(approved.status, "approved");
    assert.equal(approved.decidedByName, "Dono");
    await assert.rejects(decideImprovement(t.app, dev, item.id, "reject"), rejectsWith("conflict"));

    await claudeMoveImprovement(t.app, item.id, "building", { body: "Começando." });
    await assert.rejects(claudeMoveImprovement(t.app, item.id, "published", { link: "http://inseguro" }), rejectsWith("invalid_input"));
    const published = await claudeMoveImprovement(t.app, item.id, "published", {
      link: "https://github.com/netzos/netz-erp/pull/1",
      body: "Publicado: filtro por vendedor na lista de vendas.",
    });
    assert.equal(published.status, "published");
    assert.equal(published.decidedByName, "Dono", "a decisão continua registrada após mover o status");

    const detail = await getImprovement(t.app, seller, item.id);
    assert.deepEqual(
      detail.messages.map((m) => [m.kind, m.body.split(":")[0]]),
      [
        ["claude", "Análise"],
        ["person", "Aprovado. Pode fazer."],
        ["claude", "Começando."],
        ["claude", "Publicado"],
      ],
    );
  });

  it("empresas não veem pedidos umas das outras; o desenvolvedor vê todos", async () => {
    const mine = await createImprovement(t.app, otherOrg, { title: "Pedido da Empresa B", body: "Detalhes internos" });
    const fromA = await listImprovements(t.app, seller);
    assert.ok(fromA.every((i) => i.id !== mine.id));
    await assert.rejects(getImprovement(t.app, seller, mine.id), rejectsWith("not_found"));
    await assert.rejects(commentImprovement(t.app, seller, mine.id, "oi"), rejectsWith("not_found"));
    const all = await listImprovements(t.app, dev);
    const seen = all.find((i) => i.id === mine.id);
    assert.equal(seen?.organizationName, "Empresa B");
  });

  it("correção antes da decisão registra o que mudou; depois da decisão, só a conversa", async () => {
    const item = await createImprovement(t.app, seller, { title: "Relatório de comissões", body: "Texto inicial" });
    await assert.rejects(editImprovement(t.app, otherOrg, item.id, { title: "Outro" }), rejectsWith("not_found"));
    const vendor2 = await addUserWithRole(t.app, devOwner, "sales", "Outro Vendedor");
    const v2 = await improvementViewer(t.app, vendor2.actor);
    await assert.rejects(editImprovement(t.app, v2, item.id, { title: "Outro título" }), rejectsWith("forbidden"));

    const edited = await editImprovement(t.app, seller, item.id, {
      problem: "Calculo comissões à mão toda semana.",
      proposal: "Relatório de comissões por vendedor e período.",
      criteria: ["Filtra por período", "Mostra total por vendedor"],
      comment: "Detalhei melhor.",
    });
    assert.ok(edited.body.startsWith("Problema (por quê)"));
    assert.deepEqual(edited.details?.criterios, ["Filtra por período", "Mostra total por vendedor"]);
    const d = await getImprovement(t.app, seller, item.id);
    assert.match(d.messages.at(-1)!.body, /^Pedido corrigido: problema, proposta, critérios\. Detalhei melhor\.$/);

    await decideImprovement(t.app, dev, item.id, "reject", "Fora do escopo agora.");
    await assert.rejects(editImprovement(t.app, seller, item.id, { title: "Novo título" }), rejectsWith("conflict"));
    // O módulo ainda pode mudar.
    const moved = await editImprovement(t.app, dev, item.id, { module: "inteligencia" });
    assert.equal(moved.module, "inteligencia");
  });

  it("IA do ERP: pedido com partes, sem duplicar título aberto, com limite diário", async () => {
    const first = await agentCreateImprovement(t.app, sellerActor, {
      title: "Desconto por quantidade",
      kind: "suggestion",
      original: "queria que desse desconto automático acima de 10 unidades",
      problem: "Dou desconto manual em pedidos grandes.",
      proposal: "Regra de desconto por faixa de quantidade.",
      criteria: ["Aplica sozinho na venda"],
    });
    assert.equal(first.existing, false);
    assert.equal(first.item.source, "telegram");
    assert.match(first.item.body, /Fala original/);
    const again = await agentCreateImprovement(t.app, sellerActor, {
      title: "DESCONTO POR QUANTIDADE",
      kind: "noticed",
      problem: "Outra pessoa pediu o mesmo.",
      proposal: "Mesma regra.",
    });
    assert.equal(again.existing, true);
    assert.equal(again.item.id, first.item.id);
    const noticed = await agentCreateImprovement(t.app, sellerActor, {
      title: "Busca de cliente pelo telefone",
      kind: "noticed",
      problem: "A pessoa tentou buscar cliente pelo telefone.",
      proposal: "Permitir busca por telefone.",
    });
    assert.equal(noticed.item.source, "erp_ai");
    assert.equal(noticed.item.createdByName, "IA do ERP");
  });

  it("pedido criado pelo Claude é visível ao desenvolvedor e não às empresas", async () => {
    const c = await claudeCreateImprovement(t.app, { title: "Índice para busca de vendas", body: "Consulta lenta com muitos registros.", module: "geral" });
    assert.equal(c.source, "claude");
    assert.equal(c.organizationId, null);
    assert.ok((await listImprovements(t.app, dev)).some((i) => i.id === c.id));
    assert.ok((await listImprovements(t.app, seller)).every((i) => i.id !== c.id));
    await claudeCommentImprovement(t.app, c.id, "Medido: 1,2 s com 50 mil vendas.");
    const d = await claudeGetImprovement(t.app, c.id);
    assert.equal(d.messages.length, 1);
  });

  it("valida entrada", async () => {
    await assert.rejects(createImprovement(t.app, seller, { title: "ab", body: "x" }), rejectsWith("invalid_input"));
    await assert.rejects(createImprovement(t.app, seller, { title: "Título ok", body: "x", module: "inexistente" as "geral" }), rejectsWith("invalid_input"));
    await assert.rejects(getImprovement(t.app, seller, "nao-e-uuid"), rejectsWith("not_found"));
  });
});
