import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Applies migrations/NNNN_name.sql in order, each once, inside a transaction.
 * 0001_initial.sql is a verbatim copy of packages/contracts/schema.sql (a unit test checks this).
 */
export async function migrate(databaseUrl: string, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    // Serialise concurrent runners.
    await client.query('select pg_advisory_lock(727272)');
    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.query('select pg_advisory_unlock(727272)').catch(() => undefined);
    await client.end();
  }
  return applied;
}
