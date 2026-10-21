import "server-only";
import { createPool, type Db } from "@erp/db";

// Um pool por processo, reaproveitado entre recarregamentos do modo dev.
const globalForDb = globalThis as unknown as { erpDb?: Db };

export function db(): Db {
  globalForDb.erpDb ??= createPool(process.env.DATABASE_URL, Number(process.env.WEB_DB_POOL ?? 10));
  return globalForDb.erpDb;
}
