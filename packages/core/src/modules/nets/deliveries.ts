import type { Db } from "@erp/db";
import { withTenant } from "@erp/db";
import type { Actor } from "../../context.ts";

// O que a Netz respondeu e como chegou em cada canal (pedido nº 8): o painel
// mostra o texto guardado; o Telegram recebe o texto registrado em
// nets_deliveries, exatamente como foi enviado.

export interface NetsDelivered {
  at: Date;
  painel: string;
  canais: Array<{ canal: string; texto: string; situacao: "entregue" | "falhou"; erro: string | null }>;
  /** Marcações internas que o sistema tirou da resposta antes de guardar. */
  removido: string[];
}

export async function listNetsDeliveries(db: Db, actor: Pick<Actor, "organizationId" | "userId">, limit = 10): Promise<NetsDelivered[]> {
  const n = Math.min(Math.max(1, Math.trunc(limit) || 10), 30);
  return withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { rows } = await tx.query<{
      at: Date;
      body: string;
      cleaned: string[] | null;
      deliveries: Array<{ channel: string; text: string; status: string; error: string | null }> | null;
    }>(
      `SELECT m.created_at AS at, m.body, m.cleaned,
              (SELECT json_agg(json_build_object('channel', d.channel, 'text', d.text, 'status', d.status, 'error', d.error) ORDER BY d.created_at)
                 FROM controle_vendas_estoque.nets_deliveries d WHERE d.nets_message_id = m.id) AS deliveries
         FROM controle_vendas_estoque.nets_messages m
        WHERE m.organization_id = $1 AND m.user_id = $2 AND m.role = 'assistant'
        ORDER BY m.created_at DESC LIMIT $3`,
      [actor.organizationId, actor.userId, n],
    );
    return rows.map((r) => ({
      at: r.at,
      painel: r.body,
      canais: (r.deliveries ?? []).map((d) => ({
        canal: d.channel === "telegram" ? "Telegram" : d.channel,
        texto: d.text,
        situacao: d.status === "sent" ? "entregue" : "falhou",
        erro: d.error,
      })),
      removido: r.cleaned ?? [],
    }));
  });
}
