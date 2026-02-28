import { useCallback } from "react";
import { AdEventType, RewardedAdEventType } from "react-native-google-mobile-ads";
import { createRewarded, initAds } from "../services/ads/AdManager";
import { consumePopTalk, fetchPopTalkSnapshot, PopTalkMutationResult, PopTalkSnapshot, rewardPopTalk } from "../services/poptalk/PopTalkService";
import { useAppStore } from "../store/useAppStore";

type RewardFlowResult = {
  ok: boolean;
  errorCode: string;
};

function safeSnapshot(snap: PopTalkSnapshot) {
  return {
    balance: Math.max(0, Math.trunc(Number(snap.balance || 0))),
    cap: Math.max(1, Math.trunc(Number(snap.cap || 0))),
    plan: snap.plan || null,
    serverNowMs: Number.isFinite(Number(snap.serverNowMs || 0)) ? Math.trunc(Number(snap.serverNowMs || 0)) : null,
    syncedAtMs: Date.now(),
  };
}

export default function usePopTalk() {
  const auth = useAppStore((s: any) => s.auth);
  const sub = useAppStore((s: any) => s.sub);
  const popTalk = useAppStore((s: any) => s.popTalk);
  const setPopTalk = useAppStore((s: any) => s.setPopTalk);

  const applySnapshot = useCallback(
    (snap: PopTalkSnapshot | null) => {
      if (!snap) return;
      setPopTalk(safeSnapshot(snap));
    },
    [setPopTalk]
  );

  const refreshPopTalk = useCallback(async () => {
    const token = String(auth?.token || "").trim();
    if (!token) return null;

    const snap = await fetchPopTalkSnapshot({
      token,
      userId: auth?.userId,
      deviceKey: auth?.deviceKey,
      planId: sub?.planId,
      storeProductId: sub?.storeProductId,
      isPremium: sub?.isPremium,
    });
    if (snap) {
      const incoming = safeSnapshot(snap);
      const currentPopTalk = (useAppStore.getState() as any)?.popTalk ?? {};
      const currentBalance = Math.max(0, Math.trunc(Number(currentPopTalk?.balance ?? 0)));
      const currentCap = Math.max(currentBalance, Math.max(0, Math.trunc(Number(currentPopTalk?.cap ?? 0))));
      setPopTalk({
        ...incoming,
        balance: Math.max(currentBalance, incoming.balance),
        cap: Math.max(currentCap, incoming.cap, incoming.balance, currentBalance),
      });
    }
    return snap;
  }, [auth?.deviceKey, auth?.token, auth?.userId, setPopTalk, sub?.isPremium, sub?.planId, sub?.storeProductId]);

  const consume = useCallback(
    async (amount: number, reason: string, idempotencyKey?: string | null): Promise<PopTalkMutationResult> => {
      const token = String(auth?.token || "").trim();
      const res = await consumePopTalk({
        token,
        userId: auth?.userId,
        deviceKey: auth?.deviceKey,
        planId: sub?.planId,
        storeProductId: sub?.storeProductId,
        isPremium: sub?.isPremium,
        amount,
        reason,
        idempotencyKey,
      });
      if (res.snapshot) {
        applySnapshot(res.snapshot);
      }
      return res;
    },
    [applySnapshot, auth?.deviceKey, auth?.token, auth?.userId, sub?.isPremium, sub?.planId, sub?.storeProductId]
  );

  const reward = useCallback(
    async (amount: number, reason: string, idempotencyKey?: string | null): Promise<PopTalkMutationResult> => {
      const token = String(auth?.token || "").trim();
      const res = await rewardPopTalk({
        token,
        userId: auth?.userId,
        deviceKey: auth?.deviceKey,
        planId: sub?.planId,
        storeProductId: sub?.storeProductId,
        isPremium: sub?.isPremium,
        amount,
        reason,
        idempotencyKey,
      });
      if (res.snapshot) {
        applySnapshot(res.snapshot);
      }
      return res;
    },
    [applySnapshot, auth?.deviceKey, auth?.token, auth?.userId, sub?.isPremium, sub?.planId, sub?.storeProductId]
  );

  const watchRewardedAdAndReward = useCallback(
    async (amount: number, reason = "rewarded_ad"): Promise<RewardFlowResult> => {
      try {
        await initAds();
      } catch {}

      let ad: any;
      try {
        ad = createRewarded();
      } catch {
        return { ok: false, errorCode: "AD_CREATE_FAILED" };
      }

      if (!ad) return { ok: false, errorCode: "AD_CREATE_FAILED" };

      const earned = { value: false };

      const adOutcome = await new Promise<"earned" | "closed" | "error" | "timeout">((resolve) => {
        let done = false;
        let tm: ReturnType<typeof setTimeout> | null = null;
        let unsubLoaded: any = null;
        let unsubEarned: any = null;
        let unsubClosed: any = null;
        let unsubError: any = null;

        const finish = (v: "earned" | "closed" | "error" | "timeout") => {
          if (done) return;
          done = true;
          try {
            unsubLoaded?.();
          } catch {}
          try {
            unsubEarned?.();
          } catch {}
          try {
            unsubClosed?.();
          } catch {}
          try {
            unsubError?.();
          } catch {}
          if (tm) clearTimeout(tm);
          tm = null;
          resolve(v);
        };

        unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
          try {
            ad.show();
          } catch {
            finish("error");
          }
        });
        unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
          earned.value = true;
        });
        unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
          finish(earned.value ? "earned" : "closed");
        });
        unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
          finish("error");
        });

        try {
          ad.load();
        } catch {
          finish("error");
          return;
        }

        tm = setTimeout(() => finish("timeout"), 12000);
      });

      if (adOutcome !== "earned") {
        return {
          ok: false,
          errorCode:
            adOutcome === "timeout"
              ? "AD_TIMEOUT"
              : adOutcome === "closed"
                ? "AD_NOT_REWARDED"
                : "AD_FAILED",
        };
      }

      const rewardRes = await reward(amount, reason, `${Date.now()}_${Math.random().toString(16).slice(2)}`);
      if (!rewardRes.ok) {
        return {
          ok: false,
          errorCode: rewardRes.errorCode || "REWARD_GRANT_FAILED",
        };
      }
      return { ok: true, errorCode: "" };
    },
    [reward]
  );

  return {
    popTalk,
    refreshPopTalk,
    consumePopTalk: consume,
    rewardPopTalk: reward,
    watchRewardedAdAndReward,
  };
}
