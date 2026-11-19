import { testDbUrl } from './db-helpers';

process.env.DATABASE_URL = testDbUrl();
delete process.env.ADMIN_WRITE_DATABASE_URL;
