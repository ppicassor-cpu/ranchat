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
  callCamOn: boolean;
  callMicOn: boolean;
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
  kernelCount: number;
  updatedAtMs: number | null;
};

type Shop = {
  firstPurchaseClaimed: Record<string, boolean>;
  giftsOwned: Record<string, number>;
  giftsReceived: Record<string, number>;
};

type GiftSendEvent = {
  token: number;
  giftId: string;
};

type Store = {
  hasHydrated: boolean;
  authNonce: number;
  pendingGiftSend: GiftSendEvent | null;

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
  setCallMediaPrefs: (p: { camOn?: boolean; micOn?: boolean }) => void;
  setDinoBestScore: (v: number) => void;
  setDinoBestComment: (v: string | null) => void;
  setPopTalk: (p: Partial<PopTalk>) => void;
  setAssets: (p: Partial<Assets>) => void;
  setShop: (p: Partial<Shop>) => void;
  markFirstPurchaseClaimed: (packId: string) => void;
  purchaseGiftWithKernel: (giftId: string, costKernel: number, count?: number) => { ok: boolean; message?: string };
  consumeOwnedGift: (giftId: string, count?: number) => boolean;
  addOwnedGift: (giftId: string, count?: number) => void;
  addReceivedGift: (giftId: string, count?: number) => void;
  requestGiftSend: (giftId: string) => void;
  clearPendingGiftSend: (token?: number) => void;

  logoutAndWipe: () => void;

  showGlobalModal: (title: string, message: string) => void;
  hideGlobalModal: () => void;
};

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      authNonce: 0,
      pendingGiftSend: null,

      prefs: { language: null, country: null, gender: null },
      sub: { isPremium: false, entitlementId: null, lastCheckedAt: null },
      auth: { verified: false, token: null, userId: null, deviceKey: null },

      ui: { fontScale: 1, callMatchedSignal: 0, callCamOn: true, callMicOn: true, dinoBestScore: 0, dinoBestComment: null },
      popTalk: { balance: 0, cap: 0, plan: null, serverNowMs: null, syncedAtMs: null },
      assets: { kernelCount: 0, updatedAtMs: null },
      shop: { firstPurchaseClaimed: {}, giftsOwned: {}, giftsReceived: {} },

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

      setCallMediaPrefs: (p) => {
        const prev = get().ui;
        const nextCam = typeof p?.camOn === "boolean" ? p.camOn : prev.callCamOn;
        const nextMic = typeof p?.micOn === "boolean" ? p.micOn : prev.callMicOn;
        set({ ui: { ...prev, callCamOn: nextCam, callMicOn: nextMic } });
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
        const nextKernelRaw = p.kernelCount ?? prev.kernelCount;
        const nextKernel = Number.isFinite(Number(nextKernelRaw)) ? Math.max(0, Math.trunc(Number(nextKernelRaw))) : prev.kernelCount;
        set({
          assets: {
            ...prev,
            ...p,
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

      // Gift / wallet writes must go through server APIs.
      purchaseGiftWithKernel: () => ({ ok: false, message: "SERVER_ONLY_MUTATION" }),

      // Deprecated local mutation helpers: intentionally disabled.
      consumeOwnedGift: () => false,
      addOwnedGift: () => undefined,
      addReceivedGift: () => undefined,

      requestGiftSend: (giftId) => {
        const key = String(giftId || "").trim();
        if (!key) return;
        set({
          pendingGiftSend: {
            token: Date.now() + Math.floor(Math.random() * 1000),
            giftId: key,
          },
        });
      },

      clearPendingGiftSend: (token) => {
        const current = get().pendingGiftSend;
        if (!current) return;
        if (typeof token === "number" && current.token !== token) return;
        set({ pendingGiftSend: null });
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
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        prefs: s.prefs,
        sub: s.sub,
        auth: s.auth,
        ui: s.ui,
      }),
      migrate: (persistedState: any) => {
        if (!persistedState || typeof persistedState !== "object") return persistedState as any;
        const next = { ...persistedState } as any;
        delete next.popTalk;
        delete next.assets;
        delete next.shop;
        return next;
      },
      merge: (persistedState: any, currentState: Store): Store => {
        const persisted =
          persistedState && typeof persistedState === "object" ? (persistedState as Partial<Store>) : {};
        return {
          ...currentState,
          prefs: { ...currentState.prefs, ...(persisted.prefs || {}) },
          sub: { ...currentState.sub, ...(persisted.sub || {}) },
          auth: { ...currentState.auth, ...(persisted.auth || {}) },
          ui: { ...currentState.ui, ...(persisted.ui || {}) },
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
