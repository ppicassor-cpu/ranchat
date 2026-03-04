import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAppStore } from "../store/useAppStore";
import { translations } from "./translations";
import { getOrCreateDeviceKey } from "../services/device/DeviceKey";
import { translateUiTextOnServer } from "../services/translate/UiAutoTranslateService";

type LanguageContextType = {
  currentLang: keyof typeof translations;
  t: (key: string, params?: Record<string, any>) => string;
  setLanguage: (lang: keyof typeof translations) => void;
};

const LanguageContext = createContext<LanguageContextType | null>(null);

type RuntimeTranslationMap = Record<string, Record<string, string>>;

const RUNTIME_TRANSLATIONS_KEY = "ranchat_i18n_runtime_translations_v1";
const AUTO_TRANSLATE_TARGET_LANGS = new Set(["ja", "zh", "es", "de", "fr", "it", "ru"]);

function shouldAutoTranslateText(s: string): boolean {
  const text = String(s || "").trim();
  if (!text) return false;
  // Skip obvious non-lexical tokens like '-', 'OK', or pure placeholders.
  if (!/[A-Za-z]/.test(text)) return false;
  return true;
}

function maskTemplateVars(text: string): { masked: string; vars: string[] } {
  const vars: string[] = [];
  const masked = String(text || "").replace(/\{[A-Za-z0-9_]+\}/g, (m) => {
    const idx = vars.length;
    vars.push(m);
    return `__RC_VAR_${idx}__`;
  });
  return { masked, vars };
}

function restoreTemplateVars(text: string, vars: string[]): string {
  let out = String(text || "");
  vars.forEach((v, idx) => {
    out = out.replace(new RegExp(`__RC_VAR_${idx}__`, "g"), v);
  });
  return out;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const prefsLang = useAppStore((s) => s.prefs.language);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const auth = useAppStore((s) => s.auth);

  const [currentLang, setCurrentLang] = useState<keyof typeof translations>("ko");
  const [runtimeTranslations, setRuntimeTranslations] = useState<RuntimeTranslationMap>({});

  const mountedRef = useRef(true);
  const runtimeRef = useRef<RuntimeTranslationMap>({});
  const pendingRef = useRef<Set<string>>(new Set());
  const failAtRef = useRef<Map<string, number>>(new Map());
  const queueRef = useRef<Array<{ lang: keyof typeof translations; key: string; text: string }>>([]);
  const workerRunningRef = useRef(false);
  const deviceKeyRef = useRef<string>("");

  useEffect(() => {
    runtimeRef.current = runtimeTranslations;
  }, [runtimeTranslations]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(RUNTIME_TRANSLATIONS_KEY);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setRuntimeTranslations(parsed as RuntimeTranslationMap);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      AsyncStorage.setItem(RUNTIME_TRANSLATIONS_KEY, JSON.stringify(runtimeTranslations)).catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [runtimeTranslations]);

  const consumeQueue = useCallback(() => {
    if (workerRunningRef.current) return;
    workerRunningRef.current = true;

    (async () => {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift();
        if (!item) continue;

        const uniq = `${item.lang}::${item.key}`;
        try {
          if (!deviceKeyRef.current) {
            deviceKeyRef.current = String(auth?.deviceKey || "").trim() || (await getOrCreateDeviceKey());
          }

          const token = String(useAppStore.getState().auth?.token || "").trim();
          const userId = String(useAppStore.getState().auth?.userId || "").trim();
          const deviceKey = String(deviceKeyRef.current || "").trim();
          const { masked, vars } = maskTemplateVars(item.text);

          const out = await translateUiTextOnServer({
            text: masked,
            sourceLang: "en",
            targetLang: String(item.lang),
            token: token || undefined,
            userId: userId || undefined,
            deviceKey: deviceKey || undefined,
          });

          if (out.ok && out.translatedText) {
            const restored = restoreTemplateVars(out.translatedText, vars).trim();
            if (restored) {
              setRuntimeTranslations((prev) => {
                const langMap = prev[item.lang] || {};
                if (langMap[item.key] === restored) return prev;
                return {
                  ...prev,
                  [item.lang]: {
                    ...langMap,
                    [item.key]: restored,
                  },
                };
              });
            } else {
              failAtRef.current.set(uniq, Date.now());
            }
          } else {
            failAtRef.current.set(uniq, Date.now());
          }
        } catch {
          failAtRef.current.set(uniq, Date.now());
        } finally {
          pendingRef.current.delete(uniq);
        }

        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      workerRunningRef.current = false;
    })().catch(() => {
      workerRunningRef.current = false;
    });
  }, [auth?.deviceKey]);

  const enqueueAutoTranslate = useCallback(
    (lang: keyof typeof translations, key: string, sourceText: string) => {
      if (!AUTO_TRANSLATE_TARGET_LANGS.has(String(lang))) return;
      if (!shouldAutoTranslateText(sourceText)) return;

      const already = runtimeRef.current?.[lang]?.[key];
      if (already) return;

      const uniq = `${lang}::${key}`;
      if (pendingRef.current.has(uniq)) return;

      const lastFailAt = Number(failAtRef.current.get(uniq) || 0);
      if (lastFailAt > 0 && Date.now() - lastFailAt < 60_000) return;

      pendingRef.current.add(uniq);
      queueRef.current.push({ lang, key, text: sourceText });
      consumeQueue();
    },
    [consumeQueue]
  );

  useEffect(() => {
    const lang = prefsLang && translations[prefsLang as keyof typeof translations] ? (prefsLang as keyof typeof translations) : "ko";
    setCurrentLang(lang);
  }, [prefsLang]);

  useEffect(() => {
    if (!AUTO_TRANSLATE_TARGET_LANGS.has(String(currentLang))) return;
    const baseEn = translations.en || {};
    const dict = translations[currentLang] || {};
    Object.keys(baseEn).forEach((key) => {
      const enText = String((baseEn as any)[key] || "");
      const currentText = String((dict as any)[key] || "");
      if (!enText) return;
      if (currentText !== enText) return;
      enqueueAutoTranslate(currentLang, key, enText);
    });
  }, [currentLang, enqueueAutoTranslate]);

  const t = (key: string, params?: Record<string, any>): string => {
    const dict = translations[currentLang] || translations.ko;
    const enDict = translations.en || {};
    const koDict = translations.ko || {};
    const override = runtimeTranslations?.[currentLang]?.[key];

    let text = override || (dict as any)[key] || (enDict as any)[key] || (koDict as any)[key] || key;

    if (!override && AUTO_TRANSLATE_TARGET_LANGS.has(String(currentLang))) {
      const enText = String((enDict as any)[key] || "");
      const rawCurrent = String((dict as any)[key] || "");
      if (enText && rawCurrent === enText) {
        enqueueAutoTranslate(currentLang, key, enText);
      }
    }

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
