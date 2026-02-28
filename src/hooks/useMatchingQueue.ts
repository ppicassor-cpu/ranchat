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
    }
  }, []);

  const startMatchingActionsTimer = useCallback(
    (forceReset = false) => {
      if (forceReset) {
        clearMatchingActionsTimer();
        setMatchingActionsVisible(false);
      } else if (matchingActionsTimerRef.current) {
        return;
      }
      if (!matchingActionsDeadlineRef.current) {
        matchingActionsDeadlineRef.current = Date.now() + matchingActionsDelayMs;
      }
      const waitMs = Math.max(0, matchingActionsDeadlineRef.current - Date.now());
      matchingActionsTimerRef.current = setTimeout(() => {
        matchingActionsTimerRef.current = null;
        if (!isScreenFocusedRef.current) return;
        if (phaseRef.current === "calling") {
          matchingActionsDeadlineRef.current = 0;
          return;
        }
        if (phaseRef.current === "matched") {
          return;
        }
        if (beautyOpenRef.current) {
          return;
        }
        matchingActionsDeadlineRef.current = 0;
        setMatchingActionsVisible(true);
      }, waitMs);
    },
    [beautyOpenRef, clearMatchingActionsTimer, matchingActionsDelayMs, phaseRef, setMatchingActionsVisible]
  );

  useEffect(() => {
    if (!isScreenFocused) {
      clearMatchingActionsTimer(false);
      setMatchingActionsVisible(false);
      return;
    }

    if (beautyOpen) {
      clearMatchingActionsTimer();
      setMatchingActionsVisible(false);
      return;
    }

    if (phase === "connecting" || phase === "queued" || phase === "ended") {
      startMatchingActionsTimer();
      return;
    }

    if (phase === "matched") {
      clearMatchingActionsTimer(false);
      return;
    }

    if (phase === "calling") {
      clearMatchingActionsTimer(true);
      setMatchingActionsVisible(false);
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
    if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);

    noMatchTimerRef.current = setTimeout(() => {
      if (!queueRunningRef.current) return;
      if (!enqueuedRef.current) return;
      if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return;
      if (noMatchShownThisCycleRef.current) return;
      noMatchShownThisCycleRef.current = true;

      if (isPremium) {
        setFastMatchHint(true);
        setMatchingActionsVisible(false);
        setNoMatchModal(true);

        if (premiumNoMatchAutoCloseRef.current) clearTimeout(premiumNoMatchAutoCloseRef.current);
        premiumNoMatchAutoCloseRef.current = setTimeout(() => {
          setNoMatchModal(false);
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
    enqueuedRef,
    isPremium,
    manualCloseRef,
    matchTimeoutMs,
    phaseRef,
    queueRunningRef,
    setFastMatchHint,
    setMatchingActionsVisible,
    setNoMatchModal,
    wsRef,
  ]);

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
  }, [setNoMatchModal]);

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
    clearNoMatchTimer,
    dismissNoMatch,
  };
}
