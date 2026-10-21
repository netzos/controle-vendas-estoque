import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./pool.ts";
import { withTransaction } from "./tx.ts";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

const LOCK_KEY = 727_001; // advisory lock: impede duas execuções simultâneas

async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(path.join(dir, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

async function ensureTable(db: Db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);
}

// Aplica cada migration pendente em sua própria transação. Uma migration já
// aplicada cujo arquivo mudou interrompe o processo: migrations são imutáveis.
export async function migrate(db: Db, dir: string): Promise<MigrationResult> {
  await ensureTable(db);
  const files = await readMigrations(dir);
  const lock = await db.connect();
  try {
    await lock.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    const { rows } = await db.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM public.schema_migrations",
    );
    const done = new Map(rows.map((r) => [r.name, r.checksum]));
    const result: MigrationResult = { applied: [], skipped: [] };
    for (const file of files) {
      const previous = done.get(file.name);
      if (previous) {
        if (previous !== file.checksum) {
          throw new Error(`Migration ${file.name} foi alterada depois de aplicada; crie uma nova migration.`);
        }
        result.skipped.push(file.name);
        continue;
      }
      await withTransaction(db, async (tx) => {
        await tx.query(file.sql);
        await tx.query("INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)", [
          file.name,
          file.checksum,
        ]);
      }, 1);
      result.applied.push(file.name);
    }
    return result;
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    lock.release();
  }
}

export async function migrationStatus(db: Db, dir: string) {
  await ensureTable(db);
  const files = await readMigrations(dir);
  const { rows } = await db.query<{ name: string; applied_at: Date }>(
    "SELECT name, applied_at FROM public.schema_migrations",
  );
  const applied = new Map(rows.map((r) => [r.name, r.applied_at]));
  return files.map((f) => ({ name: f.name, appliedAt: applied.get(f.name) ?? null }));
}
