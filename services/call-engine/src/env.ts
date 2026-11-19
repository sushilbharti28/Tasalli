import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repo-root .env (if there is one) so `pnpm dev` and `pnpm test-call` work after filling .env.
 * Variables already set in the real environment win; the file never overrides them.
 */
export function loadRootEnv(): void {
  const path = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
