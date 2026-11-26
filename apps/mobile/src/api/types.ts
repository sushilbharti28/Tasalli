import type { components } from './schema';

type S = components['schemas'];

export type User = S['User'];
export type Person = S['Person'];
export type PersonCreate = S['PersonCreate'];
export type PersonUpdate = S['PersonUpdate'];
export type CallLanguage = S['CallLanguage'];
export type ConsentState = S['ConsentState'];
export type MedicineKind = S['MedicineKind'];
export type Appearance = S['Appearance'];
export type ScheduleInput = S['ScheduleInput'];
export type MedicineCreate = S['MedicineCreate'];
export type Medicine = S['Medicine'];
export type MedicineSaved = S['MedicineSaved'];
export type LookAlikeConflict = S['LookAlikeConflict'];
export type Dose = S['Dose'];
export type DoseStatus = S['DoseStatus'];
export type CallAttempt = S['CallAttempt'];
export type Subscription = S['Subscription'];
export type Session = S['Session'];
export type CanReadStrip = NonNullable<Person['canReadStrip']>;
export type PlanId = 'one_parent' | 'two_parents' | 'family_yearly';

export const CALL_LANGUAGES: CallLanguage[] = ['hi', 'en', 'bn', 'mr', 'ta', 'te'];
/** Languages calls can be made in today (the API serves the same list at GET /call-languages). Hindi only for now. */
export const AVAILABLE_CALL_LANGUAGES: CallLanguage[] = ['hi'];
