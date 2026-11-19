/** A controllable clock. Engines under test must read time only from this. */
export class TestClock {
  private t: number;

  constructor(startIso: string) {
    this.t = Date.parse(startIso);
    if (Number.isNaN(this.t)) throw new Error(`Bad start time: ${startIso}`);
  }

  now(): Date {
    return new Date(this.t);
  }

  nowIso(): string {
    return new Date(this.t).toISOString();
  }

  set(iso: string): void {
    const next = Date.parse(iso);
    if (next < this.t) throw new Error(`Clock cannot go backwards (${this.nowIso()} -> ${iso})`);
    this.t = next;
  }

  advanceMinutes(minutes: number): void {
    this.t += minutes * 60_000;
  }
}
