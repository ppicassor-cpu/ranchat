//C:\ranchat\src\store\useAppStore.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Gender, Language } from "../config/app";

type Prefs = {
  language: Language | null;
  country: string | null;
  gender: Gender | null;
};

type Sub = {
  isPremium: boolean;
  entitlementId: string | null;
  lastCheckedAt: number | null;
};

type Auth = {
  verified: boolean;
  token: string | null;
  userId: string | null;
  deviceKey: string | null;
};

type GlobalModal = {
  visible: boolean;
  title: string;
  message: string;
};

type Ui = {
  fontScale: number; // 0.85~1.25 권장
};

type Store = {
  hasHydrated: boolean;
  authNonce: number;

  prefs: Prefs;
  sub: Sub;
  auth: Auth;

  ui: Ui;

  globalModal: GlobalModal;

  setHasHydrated: (v: boolean) => void;
  bumpAuthNonce: () => void;

  setPrefs: (p: Partial<Prefs>) => void;

  setPremium: (v: boolean) => void;
  setSub: (p: Partial<Sub>) => void;

  setDeviceKey: (k: string) => void;
  setAuth: (a: Partial<Auth>) => void;

  setFontScale: (v: number) => void;

  logoutAndWipe: () => void;

  showGlobalModal: (title: string, message: string) => void;
  hideGlobalModal: () => void;
};

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      authNonce: 0,

      prefs: { language: null, country: null, gender: null },
      sub: { isPremium: false, entitlementId: null, lastCheckedAt: null },
      auth: { verified: false, token: null, userId: null, deviceKey: null },

      ui: { fontScale: 1 },

      globalModal: { visible: false, title: "", message: "" },

      setHasHydrated: (v) => set({ hasHydrated: v }),
      bumpAuthNonce: () => set({ authNonce: get().authNonce + 1 }),

      setPrefs: (p) => set({ prefs: { ...get().prefs, ...p } }),

      setPremium: (v) => set({ sub: { ...get().sub, isPremium: v } }),
      setSub: (p) => set({ sub: { ...get().sub, ...p } }),

      setDeviceKey: (k) => set({ auth: { ...get().auth, deviceKey: k } }),
      setAuth: (a) => set({ auth: { ...get().auth, ...a } }),

      setFontScale: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return;
        const clamped = Math.min(1.25, Math.max(0.85, n));
        set({ ui: { ...get().ui, fontScale: Number(clamped.toFixed(2)) } });
      },

      logoutAndWipe: () => {
        set({
          auth: {
            ...get().auth,
            verified: false,
            token: null,
            userId: null,
          },
        });
        get().bumpAuthNonce();
      },

      showGlobalModal: (title, message) => set({ globalModal: { visible: true, title, message } }),
      hideGlobalModal: () => set({ globalModal: { visible: false, title: "", message: "" } }),
    }),
    {
      name: "ranchat_store_v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ prefs: s.prefs, sub: s.sub, auth: s.auth, ui: s.ui }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
