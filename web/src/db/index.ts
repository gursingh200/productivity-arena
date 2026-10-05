import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgresql://arena:arena@localhost:5433/arena";

// One pool per process. In development, hot reloads re-run this module, so the
// pool is kept on globalThis; otherwise every reload opens a new pool and the
// old connections pile up until Postgres refuses new ones. Idle connections
// close after 30 s either way.
const globalForDb = globalThis as unknown as { arenaQueryClient?: postgres.Sql; arenaMigrationClient?: postgres.Sql };

// For migrations / one-off scripts: max 1 connection
const migrationClient = globalForDb.arenaMigrationClient ?? postgres(connectionString, { max: 1, idle_timeout: 30 });

// For queries. Behind a transaction-mode pooler (Neon's "-pooler" URL, Supabase's
// port 6543), set DATABASE_POOLER=1: such poolers don't support prepared statements.
const pooled = process.env.DATABASE_POOLER === "1";
const queryClient = globalForDb.arenaQueryClient ?? postgres(connectionString, { idle_timeout: 30, prepare: !pooled, max: pooled ? 5 : 10 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.arenaQueryClient = queryClient;
  globalForDb.arenaMigrationClient = migrationClient;
}

export const db = drizzle(queryClient, { schema });
export const migrationDb = drizzle(migrationClient, { schema });

export * from "./schema";
