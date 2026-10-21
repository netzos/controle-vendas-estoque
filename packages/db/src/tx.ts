import type pg from "pg";
import type { Db } from "./pool.ts";

export type Tx = pg.PoolClient;

export interface TenantContext {
  organizationId: string | null;
  userId: string | null;
}

const RETRYABLE = new Set(["40001", "40P01"]); // serialização e deadlock

export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < retries) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

// Transação com o contexto de RLS fixado. set_config(..., true) vale só para
// esta transação, então o contexto não vaza para a próxima conexão do pool.
export async function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    await setTenant(tx, ctx);
    return fn(tx);
  });
}

export async function setTenant(tx: Tx, ctx: TenantContext): Promise<void> {
  await tx.query(
    "SELECT set_config('app.organization_id', $1, true), set_config('app.user_id', $2, true)",
    [ctx.organizationId ?? "", ctx.userId ?? ""],
  );
}
