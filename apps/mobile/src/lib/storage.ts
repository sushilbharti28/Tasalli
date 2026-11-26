import * as SecureStore from 'expo-secure-store';

/** Small wrapper over SecureStore (encrypted on device). Never throws. */
export async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
export async function setItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // ignore: the app still works for this session
  }
}
export async function removeItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export const KEYS = {
  token: 'tasalli.token',
  locale: 'tasalli.locale',
  /** Full numbers the child typed, kept only on this phone so "Call yourself" can dial. */
  personPhones: 'tasalli.personPhones',
  /** Optional medicine photos: local file URIs, never uploaded. */
  medicinePhotos: 'tasalli.medicinePhotos',
  /** Set once the first-run story has been watched or skipped. */
  storySeen: 'tasalli.storySeen',
  /** Answers to the setup questions while the person is not saved yet. */
  setupDraft: 'tasalli.setupDraft',
  /** Meal times picked during setup, per person id, offered when adding a medicine. */
  mealTimes: 'tasalli.mealTimes',
} as const;

export async function getJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
export async function setJson(key: string, value: unknown) {
  await setItem(key, JSON.stringify(value));
}

/** Keep the full number on this phone only (for "call yourself"); the API returns it masked. */
export async function rememberPhone(personId: string, e164: string) {
  const map = await getJson<Record<string, string>>(KEYS.personPhones, {});
  map[personId] = e164;
  await setJson(KEYS.personPhones, map);
}

export async function phoneFor(personId: string): Promise<string | null> {
  const map = await getJson<Record<string, string>>(KEYS.personPhones, {});
  return map[personId] ?? null;
}

export async function forgetPerson(personId: string) {
  const map = await getJson<Record<string, string>>(KEYS.personPhones, {});
  delete map[personId];
  await setJson(KEYS.personPhones, map);
}
