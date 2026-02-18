import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAppStore } from "../store/useAppStore";
import { translations } from "./translations";

type LanguageContextType = {
  currentLang: keyof typeof translations;
  t: (key: string, params?: Record<string, any>) => string;
  setLanguage: (lang: keyof typeof translations) => void;
};

const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const prefsLang = useAppStore((s) => s.prefs.language);
  const setPrefs = useAppStore((s) => s.setPrefs);

  const [currentLang, setCurrentLang] = useState<keyof typeof translations>("ko");

  useEffect(() => {
    const lang = prefsLang && translations[prefsLang as keyof typeof translations] ? (prefsLang as keyof typeof translations) : "ko";
    setCurrentLang(lang);
  }, [prefsLang]);

  const t = (key: string, params?: Record<string, any>): string => {
    const dict = translations[currentLang] || translations.ko;
    let text = (dict as any)[key] || key;

    if (params) {
      Object.keys(params).forEach((k) => {
        text = text.replace(`{${k}}`, String(params[k]));
      });
    }
    return text;
  };

  const setLanguage = (lang: keyof typeof translations) => {
    setCurrentLang(lang);
    setPrefs({ language: lang });
  };

  return <LanguageContext.Provider value={{ currentLang, t, setLanguage }}>{children}</LanguageContext.Provider>;
}

export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useTranslation must be used within LanguageProvider");
  return context;
};
