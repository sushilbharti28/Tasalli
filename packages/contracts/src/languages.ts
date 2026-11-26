/**
 * Call languages and whether each can be picked yet. Served by GET /call-languages; the app draws its picker from it.
 * To launch a language: its call script is written and reviewed in packages/scripts, then its status changes here
 * and the API is deployed. No app release is needed.
 */
export type CallLanguageCode = 'hi' | 'en' | 'bn' | 'mr' | 'ta' | 'te';

export interface CallLanguageInfo {
  code: CallLanguageCode;
  nativeName: string;
  englishName: string;
  status: 'available' | 'coming_soon';
}

export const CALL_LANGUAGES: readonly CallLanguageInfo[] = [
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', status: 'available' },
  { code: 'en', nativeName: 'English', englishName: 'English', status: 'coming_soon' },
  { code: 'mr', nativeName: 'मराठी', englishName: 'Marathi', status: 'coming_soon' },
  { code: 'bn', nativeName: 'বাংলা', englishName: 'Bengali', status: 'coming_soon' },
  { code: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil', status: 'coming_soon' },
  { code: 'te', nativeName: 'తెలుగు', englishName: 'Telugu', status: 'coming_soon' },
];

export function isCallLanguageAvailable(code: string): boolean {
  return CALL_LANGUAGES.some((l) => l.code === code && l.status === 'available');
}
