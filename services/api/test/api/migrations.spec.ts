import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { MIGRATIONS_DIR } from '../../src/db/migrate';
import { TEST_DB_URL } from '../api/global-setup';

const contract = readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'contracts', 'schema.sql'), 'utf8');

describe('migrations', () => {
  it('0001 + 0002 give exactly the schema in packages/contracts/schema.sql', async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const c = new Client({ connectionString: TEST_DB_URL.replace(/\/[^/]+$/, '/postgres') });
    await c.connect();
    try {
      for (const [schema, sqls] of [['m_migrated', files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))], ['m_contract', [contract]]] as const) {
        await c.query(`drop schema if exists ${schema} cascade; create schema ${schema}`);
        await c.query(`set search_path to ${schema}, public`);
        for (const sql of sqls) await c.query(sql);
      }
      await c.query('set search_path to public');
      const cols = (schema: string) => c.query(
        `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = $1 order by table_name, column_name`, [schema]).then((r) => r.rows.map((x) => ({ ...x, column_default: x.column_default?.replaceAll(schema, 'S') })));
      const [a, b] = [await cols('m_migrated'), await cols('m_contract')];
      expect(a.length).toBeGreaterThan(50);
      expect(a).toEqual(b);
    } finally {
      await c.query('drop schema if exists m_migrated cascade; drop schema if exists m_contract cascade').catch(() => undefined);
      await c.end();
    }
  });
});
