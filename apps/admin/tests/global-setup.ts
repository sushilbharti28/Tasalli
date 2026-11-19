import { createTestDatabase } from './db-helpers';

export default async function setup(): Promise<void> {
  await createTestDatabase();
}
