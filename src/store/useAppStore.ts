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
  storeProductId?: string | null;
  planId?: string | null;
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
  callMatchedSignal: number;
  dinoBestScore: number;
  dinoBestComment: string | null;
};

type PopTalk = {
  balance: number;
  cap: number;
  plan: string | null;
  serverNowMs: number | null;
  syncedAtMs: number | null;
};

type Assets = {
  popcornCount: number;
  kernelCount: number;
  updatedAtMs: number | null;
};

type Shop = {
  firstPurchaseClaimed: Record<string, boolean>;
};

type Store = {
  hasHydrated: boolean;
  authNonce: number;

  prefs: Prefs;
  sub: Sub;
  auth: Auth;

  ui: Ui;
  popTalk: PopTalk;
  assets: Assets;
  shop: Shop;

  globalModal: GlobalModal;

  setHasHydrated: (v: boolean) => void;
  bumpAuthNonce: () => void;

  setPrefs: (p: Partial<Prefs>) => void;

  setPremium: (v: boolean) => void;
  setSub: (p: Partial<Sub>) => void;

  setDeviceKey: (k: string) => void;
  setAuth: (a: Partial<Auth>) => void;

  setFontScale: (v: number) => void;
  setCallMatchedSignal: (v: number) => void;
  setDinoBestScore: (v: number) => void;
  setDinoBestComment: (v: string | null) => void;
  setPopTalk: (p: Partial<PopTalk>) => void;
  setAssets: (p: Partial<Assets>) => void;
  setShop: (p: Partial<Shop>) => void;
  markFirstPurchaseClaimed: (packId: string) => void;

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

      ui: { fontScale: 1, callMatchedSignal: 0, dinoBestScore: 0, dinoBestComment: null },
      popTalk: { balance: 0, cap: 1000, plan: null, serverNowMs: null, syncedAtMs: null },
      assets: { popcornCount: 0, kernelCount: 0, updatedAtMs: null },
      shop: { firstPurchaseClaimed: {} },

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

      setCallMatchedSignal: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return;
        set({ ui: { ...get().ui, callMatchedSignal: n } });
      },

      setDinoBestScore: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return;
        const safe = Math.max(0, Math.trunc(n));
        if (safe <= Number(get().ui.dinoBestScore || 0)) return;
        set({ ui: { ...get().ui, dinoBestScore: safe } });
      },

      setDinoBestComment: (v) => {
        const next = String(v ?? "").trim().slice(0, 60);
        set({ ui: { ...get().ui, dinoBestComment: next || null } });
      },

      setPopTalk: (p) => {
        const prev = get().popTalk;
        const nextBalanceRaw = p.balance ?? prev.balance;
        const nextCapRaw = p.cap ?? prev.cap;
        const nextBalance = Number.isFinite(Number(nextBalanceRaw)) ? Math.max(0, Math.trunc(Number(nextBalanceRaw))) : prev.balance;
        const nextCap = Number.isFinite(Number(nextCapRaw)) ? Math.max(0, Math.trunc(Number(nextCapRaw))) : prev.cap;
        const safeBalance = Math.min(nextBalance, nextCap || nextBalance);
        set({
          popTalk: {
            ...prev,
            ...p,
            balance: safeBalance,
            cap: nextCap,
          },
        });
      },

      setAssets: (p) => {
        const prev = get().assets;
        const nextPopRaw = p.popcornCount ?? prev.popcornCount;
        const nextKernelRaw = p.kernelCount ?? prev.kernelCount;
        const nextPop = Number.isFinite(Number(nextPopRaw)) ? Math.max(0, Math.trunc(Number(nextPopRaw))) : prev.popcornCount;
        const nextKernel = Number.isFinite(Number(nextKernelRaw)) ? Math.max(0, Math.trunc(Number(nextKernelRaw))) : prev.kernelCount;
        set({
          assets: {
            ...prev,
            ...p,
            popcornCount: nextPop,
            kernelCount: nextKernel,
          },
        });
      },

      setShop: (p) => set({ shop: { ...get().shop, ...p } }),

      markFirstPurchaseClaimed: (packId) => {
        const key = String(packId || "").trim();
        if (!key) return;
        const prev = get().shop;
        const next = { ...(prev.firstPurchaseClaimed || {}), [key]: true };
        set({ shop: { ...prev, firstPurchaseClaimed: next } });
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
      partialize: (s) => ({ prefs: s.prefs, sub: s.sub, auth: s.auth, ui: s.ui, popTalk: s.popTalk, assets: s.assets, shop: s.shop }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
