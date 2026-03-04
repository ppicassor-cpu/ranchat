type TranslateFn = (key: string, params?: Record<string, any>) => string;

export const LANGUAGE_CODES = ["ko", "en", "ja", "zh", "es", "de", "fr", "it", "ru"] as const;
export const COUNTRY_CODES = [
  "KR",
  "JP",
  "CN",
  "TW",
  "HK",
  "SG",
  "TH",
  "VN",
  "PH",
  "ID",
  "MY",
  "IN",
  "US",
  "CA",
  "GB",
  "AU",
  "DE",
  "FR",
  "RU",
  "ES",
  "IT",
  "BR",
  "MX",
] as const;

const LANGUAGE_AUTONYMS: Record<string, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  zh: "中文",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  ru: "Русский",
};

export function normalizeLanguageCode(v: string) {
  const lower = String(v || "").trim().toLowerCase();
  if (!lower) return "";
  if (lower === "kr" || lower === "kor" || lower === "korean") return "ko";
  if (lower === "en" || lower === "eng" || lower === "english") return "en";
  if (lower === "ja" || lower === "jpn" || lower === "japanese") return "ja";
  if (lower === "zh" || lower === "chi" || lower === "chinese") return "zh";
  return lower;
}

export function getLanguageName(t: TranslateFn, raw: string) {
  const code = normalizeLanguageCode(raw);
  if (!code) return "";
  const key = `lang.name.${code}`;
  const text = String(t(key) || "");
  return text && text !== key ? text : code;
}

export function getLanguageAutonym(raw: string) {
  const code = normalizeLanguageCode(raw);
  if (!code) return "";
  return LANGUAGE_AUTONYMS[code] || code;
}

export function getCountryName(t: TranslateFn, raw: string) {
  const code = String(raw || "").trim().toLowerCase();
  if (!code) return "";
  const key = `country.name.${code}`;
  const text = String(t(key) || "");
  return text && text !== key ? text : code.toUpperCase();
}
