import { describe } from 'vitest';
import type { EngineFactory } from '../harness/engine';
import { capScenarios } from './caps';
import { consentScenarios } from './consent';
import { groupingScenarios } from './grouping';
import { idempotencyScenarios } from './idempotency';
import { optOutScenarios } from './optout';
import { privacyScenarios } from './privacy';
import { retryScenarios } from './retries';
import { snoozeScenarios } from './snooze';
import { speechScenarios } from './speech';
import { timeZoneScenarios } from './timezones';

export {
  capScenarios, consentScenarios, groupingScenarios, idempotencyScenarios, optOutScenarios,
  privacyScenarios, retryScenarios, snoozeScenarios, speechScenarios, timeZoneScenarios,
};

/**
 * Every call-flow scenario, pointed at one engine. From services/call-engine:
 *
 *   import { describeCallEngineScenarios } from '@tasalli/tests/scenarios';
 *   describeCallEngineScenarios('call-engine', (deps) => createEngineForTests(deps));
 */
export function describeCallEngineScenarios(name: string, factory: EngineFactory): void {
  describe(`call-flow scenarios: ${name}`, () => {
    consentScenarios(factory);
    idempotencyScenarios(factory);
    retryScenarios(factory);
    snoozeScenarios(factory);
    capScenarios(factory);
    optOutScenarios(factory);
    groupingScenarios(factory);
    timeZoneScenarios(factory);
    speechScenarios(factory);
    privacyScenarios(factory);
  });
}
