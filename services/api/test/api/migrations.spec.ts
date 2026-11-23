import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { MIGRATIONS_DIR } from '../../src/db/migrate';
import { TEST_DB_URL } from '../api/global-setup';

const contract = readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'contracts', 'schema.sql'), 'utf8');

describe('migrations', () => {
  it('every migration in order gives exactly the schema in packages/contracts/schema.sql', async () => {
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

  it('0003 maps the five old sizes onto three and rejects the old values', async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const c = new Client({ connectionString: TEST_DB_URL.replace(/\/[^/]+$/, '/postgres') });
    await c.connect();
    try {
      await c.query('drop schema if exists m_sizes cascade; create schema m_sizes; set search_path to m_sizes, public');
      for (const f of files.filter((x) => x < '0003')) await c.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
      const u = (await c.query(`insert into users (phone_e164) values ('+919999900099') returning id`)).rows[0].id;
      const p = (await c.query(`insert into people (owner_user_id, is_self, nickname, phone_e164, language, time_zone)
        values ($1, false, 'Papa', '+919999900098', 'hi', 'Asia/Kolkata') returning id`, [u])).rows[0].id;
      for (const size of ['rai', 'dal', 'matar', 'badam', 'bigger', null]) {
        await c.query(`insert into medicines (person_id, created_by_user_id, kind, strip_name, spoken_name, size) values ($1, $4, 'tablet', $2, 'x', $3)`, [p, `S-${size}`, size, u]);
      }
      await c.query(readFileSync(join(MIGRATIONS_DIR, '0003_v1_6.sql'), 'utf8'));
      const rows = (await c.query(`select strip_name, size from medicines order by strip_name`)).rows;
      expect(Object.fromEntries(rows.map((r) => [r.strip_name, r.size]))).toEqual({
        'S-rai': 'very_small', 'S-dal': 'small', 'S-matar': 'small', 'S-badam': 'large', 'S-bigger': 'large', 'S-null': null });
      await expect(c.query(`update medicines set size = 'dal' where strip_name = 'S-dal'`)).rejects.toThrow(/medicines_size_check/);
    } finally {
      await c.query('set search_path to public; drop schema if exists m_sizes cascade').catch(() => undefined);
      await c.end();
    }
  });
});
