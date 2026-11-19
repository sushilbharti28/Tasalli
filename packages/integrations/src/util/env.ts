/**
 * Safety rule 8: configuration comes from environment variables, read by name.
 * Nothing in this package has a default secret.
 */
export type Env = Record<string, string | undefined>;

export function requireEnv(env: Env, name: string): string {
  const v = env[name];
  if (v === undefined || v.trim() === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

export function optionalEnv(env: Env, name: string): string | undefined {
  const v = env[name];
  return v === undefined || v.trim() === '' ? undefined : v;
}

export function isProduction(env: Env): boolean {
  return env['NODE_ENV'] === 'production' || env['APP_ENV'] === 'production';
}
