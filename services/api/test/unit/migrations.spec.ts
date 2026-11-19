import { readFileSync } from 'fs';
import { join } from 'path';
import { MIGRATIONS_DIR } from '../../src/db/migrate';

describe('migrations', () => {
  it('0001_initial.sql is exactly packages/contracts/schema.sql', () => {
    const contract = readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'contracts', 'schema.sql'), 'utf8');
    const migration = readFileSync(join(MIGRATIONS_DIR, '0001_initial.sql'), 'utf8');
    expect(migration).toBe(contract);
  });
});
