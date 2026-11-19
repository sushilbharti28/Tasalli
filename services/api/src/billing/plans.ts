/** Plans from docs/scope-v1.md. Prices in paise. */
export const TRIAL_DAYS = 7;

export type PaidPlan = 'one_parent' | 'two_parents' | 'family_yearly';
export type Plan = 'trial' | PaidPlan;

export const PLANS: Record<Plan, { pricePaise: number; period: 'none' | 'month' | 'year'; maxPeople: number; maxCallsPerDay: number | null }> = {
  trial: { pricePaise: 0, period: 'none', maxPeople: 1, maxCallsPerDay: 3 },
  one_parent: { pricePaise: 29900, period: 'month', maxPeople: 1, maxCallsPerDay: null },
  two_parents: { pricePaise: 49900, period: 'month', maxPeople: 2, maxCallsPerDay: null },
  family_yearly: { pricePaise: 499900, period: 'year', maxPeople: 4, maxCallsPerDay: null },
};
