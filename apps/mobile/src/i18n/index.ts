import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './en';
import hi from './hi';

export type AppLocale = 'en' | 'hi';

function deviceLocale(): AppLocale {
  try {
    const code = getLocales()[0]?.languageCode;
    return code === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, hi: { translation: hi } },
    lng: deviceLocale(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export function setAppLocale(locale: AppLocale) {
  return i18n.changeLanguage(locale);
}

export default i18n;
