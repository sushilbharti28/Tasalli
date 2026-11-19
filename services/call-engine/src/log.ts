/**
 * Minimal structured logger. Safety rule 8: phone numbers are never logged in full.
 * Every string value that looks like a phone number is masked to its last 4 digits.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** "+919876543210" -> "********3210". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}

const PHONE_RE = /\+?\d[\d\s-]{7,}\d/g;

export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_RE, (m) => maskPhone(m));
}

function scrub(value: unknown): unknown {
  if (typeof value === 'string') return maskPhonesInText(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v);
    return out;
  }
  return value;
}

export function createLogger(opts: { level?: LogLevel; sink?: (line: string) => void } = {}): Logger {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const min = order.indexOf(opts.level ?? 'info');
  const sink = opts.sink ?? ((line: string) => process.stdout.write(line + '\n'));
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (order.indexOf(level) < min) return;
    sink(JSON.stringify({ t: new Date().toISOString(), level, msg: maskPhonesInText(msg), ...(scrub(fields ?? {}) as object) }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
