import type React from "react";
import { useCallback, useMemo } from "react";
import { PanResponder } from "react-native";
import { SignalClient } from "../services/signal/SignalClient";

type EndReason = "remote_left" | "disconnect" | "error" | "find_other";

type UseCallActionsArgs = {
  stopAll: (isUserExit?: boolean, resetMatchingActions?: boolean) => void;
  wsRef: React.MutableRefObject<SignalClient | null>;
  roomId: string | null;
  endCallAndRequeue: (why: EndReason) => void;
  showInterstitialIfAllowed: (after: () => void) => Promise<void>;
  adAllowedRef: React.MutableRefObject<boolean>;
  setMatchingActionsVisible: (v: boolean) => void;
  setNoMatchModal: (v: boolean) => void;
  isScreenFocusedRef: React.MutableRefObject<boolean>;
  beautyOpenRef: React.MutableRefObject<boolean>;
  phaseRef: React.MutableRefObject<string>;
  startMatchingActionsTimer: (forceReset?: boolean) => void;
  clearMatchingActionsTimer: (resetDeadline?: boolean) => void;
  setMyCamOn: (v: boolean) => void;
  beautyOpeningIntentRef: React.MutableRefObject<boolean>;
  openBeauty: () => void;
  ensureLocalPreviewStream: () => Promise<boolean>;
  setBeautyOpen: (v: boolean) => void;
  navigation: any;
  chatComposerOpen: boolean;
  lastSwipeRefreshAtRef: React.MutableRefObject<number>;
};

export default function useCallActions({
  stopAll,
  wsRef,
  roomId,
  endCallAndRequeue,
  showInterstitialIfAllowed,
  adAllowedRef,
  setMatchingActionsVisible,
  setNoMatchModal,
  isScreenFocusedRef,
  beautyOpenRef,
  phaseRef,
  startMatchingActionsTimer,
  clearMatchingActionsTimer,
  setMyCamOn,
  beautyOpeningIntentRef,
  openBeauty,
  ensureLocalPreviewStream,
  setBeautyOpen,
  navigation,
  chatComposerOpen,
  lastSwipeRefreshAtRef,
}: UseCallActionsArgs) {
  const goHome = useCallback(() => {
    const nav: any = navigation as any;

    let root: any = nav;
    try {
      while (root?.getParent?.()) root = root.getParent();
    } catch {}

    try {
      const st = root?.getState?.();
      const first = st?.routes?.[0]?.name;
      if (first) {
        root.reset({ index: 0, routes: [{ name: first }] });
        return;
      }
    } catch {}

    try {
      root?.popToTop?.();
    } catch {}
  }, [navigation]);

  const onPressBack = useCallback(() => {
    stopAll(true);
    goHome();
  }, [goHome, stopAll]);

  const onExitToHome = useCallback(() => {
    stopAll();
    goHome();
  }, [goHome, stopAll]);

  const endCall = useCallback(() => {
    const go = () => endCallAndRequeue("find_other");

    try {
      wsRef.current?.leaveRoom(roomId || "");
    } catch {}
    try {
      wsRef.current?.close();
    } catch {}

    showInterstitialIfAllowed(go);
  }, [endCallAndRequeue, roomId, showInterstitialIfAllowed, wsRef]);

  const retry = useCallback(() => {
    setMatchingActionsVisible(false);
    setNoMatchModal(false);
    endCallAndRequeue("disconnect");
  }, [endCallAndRequeue, setMatchingActionsVisible, setNoMatchModal]);

  const dismissMatchingActions = useCallback(() => {
    setMatchingActionsVisible(false);
    if (!isScreenFocusedRef.current) return;
    if (!beautyOpenRef.current && (phaseRef.current === "connecting" || phaseRef.current === "queued" || phaseRef.current === "ended")) {
      startMatchingActionsTimer(true);
    }
  }, [beautyOpenRef, isScreenFocusedRef, phaseRef, setMatchingActionsVisible, startMatchingActionsTimer]);

  const onPressMatchingBeauty = useCallback(async () => {
    clearMatchingActionsTimer();
    setMatchingActionsVisible(false);
    setMyCamOn(true);
    beautyOpeningIntentRef.current = true;
    openBeauty();
    const ok = await ensureLocalPreviewStream();
    if (!ok) {
      beautyOpeningIntentRef.current = false;
      setBeautyOpen(false);
      return;
    }
  }, [beautyOpeningIntentRef, clearMatchingActionsTimer, ensureLocalPreviewStream, openBeauty, setBeautyOpen, setMatchingActionsVisible, setMyCamOn]);

  const onPressMatchingFortune = useCallback(() => {
    setMatchingActionsVisible(false);
    navigation.navigate("Fortune");
  }, [navigation, setMatchingActionsVisible]);

  const onPressMatchingGame = useCallback(() => {
    setMatchingActionsVisible(false);
    navigation.navigate("Dino");
  }, [navigation, setMatchingActionsVisible]);

  const onPressFindOther = useCallback(() => {
    adAllowedRef.current = true;

    const go = () => {
      try {
        wsRef.current?.leaveRoom(roomId || "");
      } catch {}
      endCallAndRequeue("find_other");
    };

    showInterstitialIfAllowed(go);
  }, [adAllowedRef, endCallAndRequeue, roomId, showInterstitialIfAllowed, wsRef]);

  const swipeRefreshPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (phaseRef.current !== "calling") return false;
          if (chatComposerOpen) return false;

          const dx = Number(gestureState.dx || 0);
          const dy = Number(gestureState.dy || 0);
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);

          return dx < -18 && absDx > absDy + 10;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (phaseRef.current !== "calling") return;
          if (chatComposerOpen) return;

          const dx = Number(gestureState.dx || 0);
          const dy = Number(gestureState.dy || 0);
          const vx = Number(gestureState.vx || 0);
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          const horizontal = absDx > absDy + 14;
          const passed = dx <= -90 || (dx <= -60 && vx <= -0.42);
          if (!horizontal || !passed) return;

          const now = Date.now();
          if (now - lastSwipeRefreshAtRef.current < 1200) return;
          lastSwipeRefreshAtRef.current = now;
          onPressFindOther();
        },
      }),
    [chatComposerOpen, lastSwipeRefreshAtRef, onPressFindOther, phaseRef]
  );

  return {
    onPressBack,
    onExitToHome,
    endCall,
    retry,
    dismissMatchingActions,
    onPressMatchingBeauty,
    onPressMatchingFortune,
    onPressMatchingGame,
    onPressFindOther,
    swipeRefreshPanResponder,
  };
}
