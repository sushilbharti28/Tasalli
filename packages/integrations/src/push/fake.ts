import type { PushMessage, PushResult, PushSender } from './types';

/** Records pushes. Tokens can be marked dead or flaky. For tests and local work. */
export class FakePushSender implements PushSender {
  readonly name = 'fake';
  readonly sent: Array<PushMessage & { messageId: string }> = [];
  private readonly dead = new Set<string>();
  private readonly flaky = new Map<string, number>();

  markInvalid(token: string): void { this.dead.add(token); }
  /** The next `times` sends to this token fail with a retryable error. */
  failNext(token: string, times = 1): void { this.flaky.set(token, (this.flaky.get(token) ?? 0) + times); }

  async send(msg: PushMessage): Promise<PushResult> {
    if (this.dead.has(msg.token)) return { ok: false, reason: 'invalid_token', detail: 'UNREGISTERED' };
    const left = this.flaky.get(msg.token) ?? 0;
    if (left > 0) {
      this.flaky.set(msg.token, left - 1);
      return { ok: false, reason: 'retryable', detail: 'UNAVAILABLE' };
    }
    const messageId = `projects/fake/messages/${this.sent.length + 1}`;
    this.sent.push({ ...msg, messageId });
    return { ok: true, messageId };
  }
}
