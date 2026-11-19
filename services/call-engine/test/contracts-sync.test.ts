import { expect, it } from 'vitest';
import * as contract from '@tasalli/contracts';
import * as local from '../src/contracts-values.js';

it('local runtime copies match packages/contracts', () => {
  expect(local.RULES).toEqual(contract.RULES);
  expect(local.REMINDER_KEYS).toEqual(contract.REMINDER_KEYS);
  expect(local.CONSENT_KEYS).toEqual(contract.CONSENT_KEYS);
});
