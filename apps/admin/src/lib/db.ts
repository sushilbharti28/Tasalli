import { Pool, type PoolConfig } from 'pg';

/**
 * Two pools:
 *  - `readPool` opens every session with default_transaction_read_only=on, so a
 *    read query can never change data even if a bug slips in.
 *  - `writePool` is used only by src/lib/writes.ts (block, pause, notes).
 * Both read the URL from env by name; nothing is hard-coded (safety rule 8).
 */
let readPool: Pool | undefined;
let writePool: Pool | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function baseConfig(connectionString: string): PoolConfig {
  return { connectionString, max: 5, idleTimeoutMillis: 30_000, application_name: 'tasalli-admin' };
}

export function getReadPool(): Pool {
  if (!readPool) {
    readPool = new Pool({
      ...baseConfig(requireEnv('DATABASE_URL')),
      options: '-c default_transaction_read_only=on -c statement_timeout=15000',
    });
  }
  return readPool;
}

export function getWritePool(): Pool {
  if (!writePool) {
    writePool = new Pool(baseConfig(process.env.ADMIN_WRITE_DATABASE_URL || requireEnv('DATABASE_URL')));
  }
  return writePool;
}

/** Used by tests to point the console at a fresh database. */
export async function resetPools(): Promise<void> {
  await Promise.all([readPool?.end(), writePool?.end()]);
  readPool = undefined;
  writePool = undefined;
}
