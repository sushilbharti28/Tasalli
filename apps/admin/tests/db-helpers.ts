import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { SEED_SQL } from './fixtures';

export const TEST_DB_NAME = 'tasalli_admin_test';

/**
 * A connection that may create and drop databases. TEST_DATABASE_ADMIN_URL if set; otherwise the same server and user as
 * every other package's tests (TEST_DATABASE_URL, which CI provides), on the `postgres` database; otherwise the
 * docker-compose user. (The old default user `admin_test` existed nowhere, so these tests failed in CI.)
 */
export function adminUrl(): string {
  if (process.env.TEST_DATABASE_ADMIN_URL) return process.env.TEST_DATABASE_ADMIN_URL;
  if (process.env.TEST_DATABASE_URL) {
    const u = new URL(process.env.TEST_DATABASE_URL);
    u.pathname = '/postgres';
    return u.toString();
  }
  return 'postgres://tasalli:tasalli@localhost:5432/postgres';
}

export function testDbUrl(): string {
  const u = new URL(adminUrl());
  u.pathname = `/${TEST_DB_NAME}`;
  return u.toString();
}

const SCHEMA_PATH = path.resolve(__dirname, '../../../packages/contracts/schema.sql');

/** Drop and recreate the test database from packages/contracts/schema.sql. */
export async function createTestDatabase(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${TEST_DB_NAME} with (force)`);
    await admin.query(`create database ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }
  const c = new Client({ connectionString: testDbUrl() });
  await c.connect();
  try {
    await c.query(readFileSync(SCHEMA_PATH, 'utf8'));
  } finally {
    await c.end();
  }
}

/** Empty every table and load the fixture families again. */
export async function reseed(): Promise<void> {
  const c = new Client({ connectionString: testDbUrl() });
  await c.connect();
  try {
    await c.query(`truncate users, people, blocked_numbers, consent_events, medicines, schedules, doses, calls,
                   webhook_events, subscriptions, audit_log restart identity cascade`);
    await c.query(SEED_SQL);
  } finally {
    await c.end();
  }
}
