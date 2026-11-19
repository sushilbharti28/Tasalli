/** Time source. Production uses the system clock; tests drive a FakeClock. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  private ms: number;
  constructor(start: Date | string) {
    this.ms = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.ms);
  }
  set(to: Date | string): void {
    this.ms = new Date(to).getTime();
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

export const MINUTE = 60_000;
