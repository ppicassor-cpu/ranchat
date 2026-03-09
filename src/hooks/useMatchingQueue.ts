import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";

type UseMatchingQueueArgs = {
  isScreenFocused: boolean;
  isScreenFocusedRef: React.MutableRefObject<boolean>;
  phase: string;
  phaseRef: React.MutableRefObject<string>;
  beautyOpen: boolean;
  beautyOpenRef: React.MutableRefObject<boolean>;
  isPremium: boolean;
  wsRef: React.MutableRefObject<any>;
  queueRunningRef: React.MutableRefObject<boolean>;
  enqueuedRef: React.MutableRefObject<boolean>;
  manualCloseRef: React.MutableRefObject<boolean>;
  setMatchingActionsVisible: (visible: boolean) => void;
  setNoMatchModal: (visible: boolean) => void;
  setFastMatchHint: (visible: boolean) => void;
  matchTimeoutMs: number;
  matchingActionsDelayMs: number;
};

export default function useMatchingQueue({
  isScreenFocused,
  isScreenFocusedRef,
  phase,
  phaseRef,
  beautyOpen,
  beautyOpenRef,
  isPremium,
  wsRef,
  queueRunningRef,
  enqueuedRef,
  manualCloseRef,
  setMatchingActionsVisible,
  setNoMatchModal,
  setFastMatchHint,
  matchTimeoutMs,
  matchingActionsDelayMs,
}: UseMatchingQueueArgs) {
  const noMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchingActionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchingActionsDeadlineRef = useRef(0);
  const matchingActionsStartedAtRef = useRef(0);
  const matchingActionsPinnedRef = useRef(false);
  const premiumNoMatchAutoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noMatchShownThisCycleRef = useRef(false);

  useEffect(() => {
    isScreenFocusedRef.current = isScreenFocused;
  }, [isScreenFocused]);

  const clearMatchingActionsTimer = useCallback((resetDeadline = true) => {
    if (matchingActionsTimerRef.current) clearTimeout(matchingActionsTimerRef.current);
    matchingActionsTimerRef.current = null;
    if (resetDeadline) {
      matchingActionsDeadlineRef.current = 0;
      matchingActionsStartedAtRef.current = 0;
      matchingActionsPinnedRef.current = false;
    }
  }, []);

  const startMatchingActionsTimer = useCallback(
    (forceReset = false, delayOverrideMs?: number) => {
      if (forceReset) {
        clearMatchingActionsTimer(true);
        setMatchingActionsVisible(false);
      } else if (matchingActionsPinnedRef.current) {
        setMatchingActionsVisible(true);
        return;
      } else if (matchingActionsTimerRef.current) {
        return;
      }
      if (!isScreenFocusedRef.current) {
        setMatchingActionsVisible(false);
        return;
      }
      if (phaseRef.current === "calling") {
        // Keep the waiting deadline/state across transient calling -> reconnect loops.
        clearMatchingActionsTimer(false);
        return;
      }
      if (phaseRef.current === "matched") {
        // Preserve waiting deadline across transient matched -> reconnect loops.
        clearMatchingActionsTimer(false);
        return;
      }
      if (beautyOpenRef.current) {
        setMatchingActionsVisible(false);
        return;
      }

      if (!matchingActionsStartedAtRef.current) {
        matchingActionsStartedAtRef.current = Date.now();
      }
      const delayMsRaw =
        delayOverrideMs == null || !Number.isFinite(Number(delayOverrideMs))
          ? matchingActionsDelayMs
          : Number(delayOverrideMs);
      const delayMs = Math.max(0, Math.trunc(Number(delayMsRaw) || 0));
      const deadlineMs = matchingActionsStartedAtRef.current + delayMs;
      matchingActionsDeadlineRef.current = deadlineMs;
      const waitMs = Math.max(0, deadlineMs - Date.now());
      if (waitMs <= 0) {
        matchingActionsDeadlineRef.current = 0;
        matchingActionsPinnedRef.current = true;
        setMatchingActionsVisible(true);
        return;
      }
      matchingActionsTimerRef.current = setTimeout(() => {
        matchingActionsTimerRef.current = null;
        if (!isScreenFocusedRef.current) return;
        if (phaseRef.current === "calling" || phaseRef.current === "matched") return;
        if (beautyOpenRef.current) return;
        matchingActionsDeadlineRef.current = 0;
        matchingActionsPinnedRef.current = true;
        setMatchingActionsVisible(true);
      }, waitMs);
    },
    [beautyOpenRef, clearMatchingActionsTimer, isScreenFocusedRef, matchingActionsDelayMs, phaseRef, setMatchingActionsVisible]
  );

  useEffect(() => {
    if (!isScreenFocused) {
      clearMatchingActionsTimer(false);
      setMatchingActionsVisible(false);
      return;
    }

    if (beautyOpen) {
      clearMatchingActionsTimer(false);
      setMatchingActionsVisible(false);
      return;
    }

    if (phase === "connecting" || phase === "queued" || phase === "ended") {
      startMatchingActionsTimer();
      return;
    }

    if (phase === "matched") {
      // Preserve waiting deadline across transient matched -> reconnect loops.
      clearMatchingActionsTimer(false);
      return;
    }

    if (phase === "calling") {
      // Keep the waiting deadline/state across transient calling -> reconnect loops.
      clearMatchingActionsTimer(false);
      return;
    }

    clearMatchingActionsTimer(true);
  }, [beautyOpen, clearMatchingActionsTimer, isScreenFocused, phase, setMatchingActionsVisible, startMatchingActionsTimer]);

  useFocusEffect(
    useCallback(() => {
      if (!isScreenFocusedRef.current) return;
      if (beautyOpenRef.current) return;
      if (phaseRef.current === "calling" || phaseRef.current === "matched") return;
      startMatchingActionsTimer();
    }, [beautyOpenRef, phaseRef, startMatchingActionsTimer])
  );

  const startNoMatchTimer = useCallback(() => {
    if (!queueRunningRef.current) return;
    if (noMatchShownThisCycleRef.current) return;
    if (noMatchTimerRef.current) return;

    noMatchTimerRef.current = setTimeout(() => {
      noMatchTimerRef.current = null;
      if (!queueRunningRef.current) return;
      if (!isScreenFocusedRef.current || beautyOpenRef.current) return;
      if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return;
      if (noMatchShownThisCycleRef.current) return;
      noMatchShownThisCycleRef.current = true;

      if (isPremium) {
        setFastMatchHint(true);
        setNoMatchModal(true);

        if (premiumNoMatchAutoCloseRef.current) clearTimeout(premiumNoMatchAutoCloseRef.current);
        premiumNoMatchAutoCloseRef.current = setTimeout(() => {
          setNoMatchModal(false);
          if (!queueRunningRef.current) return;
          if (!isScreenFocusedRef.current) return;
          if (beautyOpenRef.current) return;
          if (phaseRef.current !== "connecting" && phaseRef.current !== "queued" && phaseRef.current !== "ended") return;
          startMatchingActionsTimer(false);
        }, 3000);

        return;
      }

      queueRunningRef.current = false;
      enqueuedRef.current = false;

      try {
        wsRef.current?.leaveQueue();
      } catch {}
      try {
        manualCloseRef.current = true;
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;

      setMatchingActionsVisible(false);
      setNoMatchModal(true);
    }, matchTimeoutMs);
  }, [
    beautyOpenRef,
    enqueuedRef,
    isScreenFocusedRef,
    isPremium,
    manualCloseRef,
    matchTimeoutMs,
    phaseRef,
    queueRunningRef,
    setFastMatchHint,
    setMatchingActionsVisible,
    setNoMatchModal,
    startMatchingActionsTimer,
    wsRef,
  ]);

  const resetNoMatchTimer = useCallback(() => {
    noMatchShownThisCycleRef.current = false;
    if (noMatchTimerRef.current) {
      clearTimeout(noMatchTimerRef.current);
      noMatchTimerRef.current = null;
    }
    if (!queueRunningRef.current) return;
    if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return;
    startNoMatchTimer();
  }, [phaseRef, queueRunningRef, startNoMatchTimer]);

  const clearNoMatchTimer = useCallback(() => {
    if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);
    noMatchTimerRef.current = null;

    if (premiumNoMatchAutoCloseRef.current) clearTimeout(premiumNoMatchAutoCloseRef.current);
    premiumNoMatchAutoCloseRef.current = null;
  }, []);

  const dismissNoMatch = useCallback(() => {
    if (premiumNoMatchAutoCloseRef.current) clearTimeout(premiumNoMatchAutoCloseRef.current);
    premiumNoMatchAutoCloseRef.current = null;
    setNoMatchModal(false);
    if (!isScreenFocusedRef.current) return;
    if (beautyOpenRef.current) return;
    if (phaseRef.current === "calling" || phaseRef.current === "matched") return;
    setMatchingActionsVisible(true);
    if (queueRunningRef.current) {
      startMatchingActionsTimer(false);
    }
  }, [beautyOpenRef, isScreenFocusedRef, phaseRef, queueRunningRef, setMatchingActionsVisible, setNoMatchModal, startMatchingActionsTimer]);

  return {
    isScreenFocusedRef,
    noMatchTimerRef,
    matchingActionsTimerRef,
    matchingActionsDeadlineRef,
    premiumNoMatchAutoCloseRef,
    noMatchShownThisCycleRef,
    clearMatchingActionsTimer,
    startMatchingActionsTimer,
    startNoMatchTimer,
    resetNoMatchTimer,
    clearNoMatchTimer,
    dismissNoMatch,
  };
}
