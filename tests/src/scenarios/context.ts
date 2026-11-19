import { afterEach, beforeEach } from 'vitest';
import type { EngineFactory } from '../harness/engine';
import { World } from '../harness/world';

/** Fresh World per test. Returns a getter so suites can use it inside `it` blocks. */
export function useWorld(factory: EngineFactory, startIso?: string): () => World {
  let world: World | undefined;
  beforeEach(async () => {
    world = await World.create(factory, startIso);
  });
  afterEach(async () => {
    await world?.close();
    world = undefined;
  });
  return () => {
    if (!world) throw new Error('World not initialised');
    return world;
  };
}

/** 09:00 IST on Monday 18 Jan 2027, in UTC. */
export const MON_0900_IST = '2027-01-18T03:30:00.000Z';

export function plusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}
