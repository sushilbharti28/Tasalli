import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { SEED_SQL } from './fixtures';

export const TEST_DB_NAME = 'tasalli_admin_test';

export function adminUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://admin_test:admin_test@localhost:5432/postgres';
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
