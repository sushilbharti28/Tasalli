import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { redactPhones } from './phone';

function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactPhones(value);
  if (value instanceof Error) {
    const e = new Error(redactPhones(value.message));
    e.stack = value.stack ? redactPhones(value.stack) : undefined;
    return e;
  }
  if (value && typeof value === 'object') {
    try {
      return redactPhones(JSON.stringify(value));
    } catch {
      return '[unserialisable]';
    }
  }
  return value;
}

/** Nest logger that masks phone numbers in every message (safety rule 8). */
export class RedactingLogger extends ConsoleLogger {
  protected printMessages(messages: unknown[], context?: string, logLevel?: LogLevel, writeStreamType?: 'stdout' | 'stderr'): void {
    super.printMessages(messages.map(redact), context, logLevel, writeStreamType);
  }
}
