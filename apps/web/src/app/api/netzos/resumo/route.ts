import { listImprovements, listPlatformOrganizationRows, platformDashboard } from "@erp/core";
import { db } from "@/lib/db";
import { bridgeAuthorized, bridgeError, bridgeViewer, unauthorized } from "@/lib/netzos-bridge";

export const dynamic = "force-dynamic";

/**
 * Ponte NetzOS: o retrato do netzsales numa chamada (o mesmo que o Painel da
 * plataforma mostra). Só empresas de clientes entram nos números.
 */
export async function GET(req: Request) {
  if (!bridgeAuthorized(req)) return unauthorized();
  try {
    const viewer = await bridgeViewer();
    const [d, orgs, open] = await Promise.all([
      platformDashboard(db(), viewer.userId),
      listPlatformOrganizationRows(db(), viewer.userId),
      listImprovements(db(), viewer, { status: ["new", "analysis", "approved", "building"] }),
    ]);
    const customers = orgs.filter((o) => o.kind === "customer");
    return Response.json({
      ok: true,
      sistema: "netzsales",
      endereco: "https://netzsales.vercel.app",
      geradoEm: new Date().toISOString(),
      empresas: d.companies,
      pessoas: d.users,
      cadastros: d.signups,
      uso: d.usage,
      dinheiro: d.money,
      porMes: d.monthly,
      empresasClientes: customers.map((o) => ({
        id: o.id,
        nome: o.name,
        situacao: o.status,
        saude: o.health,
        dono: o.ownerName,
        vendas30d: Number(o.sales30d),
        valor30d: Number(o.revenue30d),
        ultimoUso: o.lastActivityAt,
        melhoriasAbertas: Number(o.improvementsOpen),
        mensalidade: Number(o.monthlyPrice),
        cobranca: o.billingStatus,
        link: `https://netzsales.vercel.app/plataforma/empresas/${o.id}`,
      })),
      melhorias: open.map((i) => ({
        id: i.id,
        numero: i.number,
        titulo: i.title,
        situacao: i.status,
        empresa: i.organizationName,
        pedidoPor: i.createdByName,
        pedidos: i.requests,
        atualizadoEm: i.updatedAt,
        podeDecidir: i.status === "new" || i.status === "analysis",
      })),
    });
  } catch (err) {
    return bridgeError(err);
  }
}
