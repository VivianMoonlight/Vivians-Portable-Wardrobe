/**
 * i18n setup (React / i18next).
 *
 * Replaces the previous vue-i18n module. Reuses the same `locales/*.json`
 * resource files. Locale strings use single-brace placeholders (`{name}`,
 * vue-i18n style), so i18next interpolation is configured to match.
 *
 * A vue-i18n-compatible default export (`{ global: { t } }`) is kept so the
 * framework-agnostic helper in `src/config/filterGroupConfig.js` — which probes
 * for an i18n instance shaped like `i18n.global.t` — keeps working unchanged.
 */
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import zh from '../locales/zh.json'

export const SUPPORTED_LOCALES = ['en', 'zh'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_STORAGE_KEY = 'locale'

function isSupported(value: string | null | undefined): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

function detectInitialLocale(): SupportedLocale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isSupported(saved)) return saved
  } catch {
    /* ignore restricted storage */
  }

  const navLang =
    typeof navigator !== 'undefined' && navigator.language
      ? navigator.language.split('-')[0]
      : 'en'

  return isSupported(navLang) ? navLang : 'en'
}

i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectInitialLocale(),
  fallbackLng: 'en',
  returnNull: false,
  interpolation: {
    escapeValue: false,
    // Match the existing vue-i18n single-brace placeholder syntax: {name}
    prefix: '{',
    suffix: '}',
  },
})

export function setLocale(locale: SupportedLocale): void {
  i18next.changeLanguage(locale)
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
}

export const i18n = i18next

// vue-i18n-shaped compatibility surface for legacy consumers (filterGroupConfig).
const compat = {
  global: {
    t: (key: string, params?: Record<string, unknown>) =>
      params ? i18next.t(key, params) : i18next.t(key),
    locale: i18next.language,
  },
}

export default compat
