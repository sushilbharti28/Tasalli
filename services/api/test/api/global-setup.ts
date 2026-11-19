import { Client } from 'pg';
import { migrate } from '../../src/db/migrate';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tasalli_api_test';

/** Recreates the test database from migrations so every run starts clean. */
export default async function setup() {
  const u = new URL(TEST_DB_URL);
  const name = u.pathname.slice(1);
  u.pathname = '/postgres';
  const admin = new Client({ connectionString: u.toString() });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate(TEST_DB_URL);
}
