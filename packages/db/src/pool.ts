import pg from "pg";

export type Db = pg.Pool;

// Valores numeric e bigint chegam como string; quem lê decide a conversão
// (valores monetários nunca passam por float).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

export function createPool(connectionString = process.env.DATABASE_URL, max = 10): Db {
  if (!connectionString) throw new Error("DATABASE_URL não configurada");
  const pool = new pg.Pool({ connectionString, max, application_name: "controle-vendas-estoque" });
  pool.on("error", (err) => {
    console.error("[db] erro em conexão ociosa", err);
  });
  return pool;
}
