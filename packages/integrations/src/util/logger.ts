import { maskPhonesInText } from './mask';

/** Minimal logger interface so callers can plug in pino/nest. Everything is phone-masked. */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function scrubValue(v: unknown): unknown {
  if (typeof v === 'string') return maskPhonesInText(v);
  if (Array.isArray(v)) return v.map(scrubValue);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, scrubValue(x)]));
  }
  return v;
}

function scrub(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  return meta ? (scrubValue(meta) as Record<string, unknown>) : meta;
}

export const consoleLogger: Logger = {
  info: (m, meta) => console.log(maskPhonesInText(m), scrub(meta) ?? ''),
  warn: (m, meta) => console.warn(maskPhonesInText(m), scrub(meta) ?? ''),
  error: (m, meta) => console.error(maskPhonesInText(m), scrub(meta) ?? ''),
};

/** Captures log lines in memory; used by tests to assert nothing leaks. */
export class MemoryLogger implements Logger {
  readonly lines: string[] = [];
  private push(level: string, m: string, meta?: Record<string, unknown>) {
    this.lines.push(`${level} ${maskPhonesInText(m)} ${meta ? JSON.stringify(scrub(meta)) : ''}`.trim());
  }
  info(m: string, meta?: Record<string, unknown>) { this.push('info', m, meta); }
  warn(m: string, meta?: Record<string, unknown>) { this.push('warn', m, meta); }
  error(m: string, meta?: Record<string, unknown>) { this.push('error', m, meta); }
}
