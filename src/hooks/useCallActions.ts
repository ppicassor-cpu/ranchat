import type React from "react";
import { useCallback, useMemo, useRef } from "react";
import { Animated, Dimensions, Easing, PanResponder } from "react-native";
import { SignalClient } from "../services/signal/SignalClient";

type EndReason = "remote_left" | "disconnect" | "error" | "find_other";
const SWIPE_REFRESH_MAX_DISTANCE = Math.max(220, Math.round(Dimensions.get("window").width * 0.68));
const SWIPE_REFRESH_TRIGGER_RATIO = 0.76;
const SWIPE_REFRESH_VISUAL_DAMPING = 0.86;
const SWIPE_REFRESH_FOLLOW_SMOOTHING = 0.42;
const SWIPE_REFRESH_COMMIT_DISTANCE = Math.round(Dimensions.get("window").width * 1.08);
const SWIPE_REFRESH_COMMIT_DELAY_MS = 140;
const SWIPE_REFRESH_UNLOCK_DELAY_MS = 1250;
const SWIPE_REFRESH_UNLOCK_POLL_MS = 110;
const SWIPE_REFRESH_MAX_LOCK_MS = 8000;

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
  onSwipeRefreshCommitted?: () => void;
  onOpenMatchingMiniScreen?: () => void;
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
  onSwipeRefreshCommitted,
  onOpenMatchingMiniScreen,
}: UseCallActionsArgs) {
  const swipeDragTranslateX = useRef(new Animated.Value(0)).current;
  const swipeRefreshLockedRef = useRef(false);
  const swipeUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeVisualXRef = useRef(0);
  const swipeHoldDistanceRef = useRef(0);
  const swipeLockStartedAtRef = useRef(0);

  const resetSwipePreview = useCallback(
    (immediate?: boolean) => {
      if (swipeUnlockTimerRef.current) {
        clearTimeout(swipeUnlockTimerRef.current);
        swipeUnlockTimerRef.current = null;
      }
      if (swipeCommitTimerRef.current) {
        clearTimeout(swipeCommitTimerRef.current);
        swipeCommitTimerRef.current = null;
      }
      swipeHoldDistanceRef.current = 0;
      if (immediate) {
        swipeRefreshLockedRef.current = false;
        swipeVisualXRef.current = 0;
        swipeDragTranslateX.stopAnimation();
        swipeDragTranslateX.setValue(0);
        return;
      }
      Animated.timing(swipeDragTranslateX, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        swipeVisualXRef.current = 0;
      });
    },
    [swipeDragTranslateX]
  );

  const unlockSwipeWhenSafe = useCallback(() => {
    const startedAt = Number(swipeLockStartedAtRef.current || Date.now());
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const stillCalling = phaseRef.current === "calling";
      if (stillCalling && elapsed < SWIPE_REFRESH_MAX_LOCK_MS) {
        swipeUnlockTimerRef.current = setTimeout(tick, SWIPE_REFRESH_UNLOCK_POLL_MS);
        return;
      }
      swipeRefreshLockedRef.current = false;
      resetSwipePreview(true);
    };
    swipeUnlockTimerRef.current = setTimeout(tick, SWIPE_REFRESH_UNLOCK_DELAY_MS);
  }, [phaseRef, resetSwipePreview]);

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
    try {
      wsRef.current?.leaveRoom(roomId || "");
    } catch {}
    try {
      wsRef.current?.close();
    } catch {}
    endCallAndRequeue("find_other");
  }, [endCallAndRequeue, roomId, wsRef]);

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
    onOpenMatchingMiniScreen?.();
    setMatchingActionsVisible(false);
    navigation.navigate("Fortune");
  }, [navigation, onOpenMatchingMiniScreen, setMatchingActionsVisible]);

  const onPressMatchingGame = useCallback(() => {
    onOpenMatchingMiniScreen?.();
    setMatchingActionsVisible(false);
    navigation.navigate("Dino");
  }, [navigation, onOpenMatchingMiniScreen, setMatchingActionsVisible]);

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
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          if (phaseRef.current !== "calling") {
            resetSwipePreview(true);
            return;
          }
          if (swipeRefreshLockedRef.current) return;
          swipeDragTranslateX.stopAnimation((value) => {
            const v = Number(value);
            swipeVisualXRef.current = Number.isFinite(v) ? v : 0;
          });
          swipeHoldDistanceRef.current = 0;
        },
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (phaseRef.current !== "calling") {
            resetSwipePreview(true);
            return false;
          }
          if (chatComposerOpen) return false;
          if (swipeRefreshLockedRef.current) return false;

          const dx = Number(gestureState.dx || 0);
          const dy = Number(gestureState.dy || 0);
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);

          return dx < -24 && absDx > absDy + 15;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (phaseRef.current !== "calling") return;
          if (chatComposerOpen) return;
          if (swipeRefreshLockedRef.current) return;

          const dx = Number(gestureState.dx || 0);
          const dy = Number(gestureState.dy || 0);
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          const horizontal = dx < -34 && absDx > absDy + 14;
          const rawDistance = Math.min(SWIPE_REFRESH_MAX_DISTANCE, Math.max(0, -dx));
          const swipeDistance = Math.max(swipeHoldDistanceRef.current, rawDistance);
          const progress = swipeDistance / SWIPE_REFRESH_MAX_DISTANCE;
          const passed = progress >= SWIPE_REFRESH_TRIGGER_RATIO;
          if (!horizontal || !passed) {
            resetSwipePreview();
            return;
          }

          const now = Date.now();
          if (now - lastSwipeRefreshAtRef.current < 700) {
            resetSwipePreview();
            return;
          }
          lastSwipeRefreshAtRef.current = now;
          swipeRefreshLockedRef.current = true;
          swipeLockStartedAtRef.current = now;
          swipeHoldDistanceRef.current = swipeDistance;
          swipeDragTranslateX.stopAnimation((value) => {
            const v = Number(value);
            swipeVisualXRef.current = Number.isFinite(v) ? v : 0;
          });
          Animated.timing(swipeDragTranslateX, {
            toValue: -Math.max(SWIPE_REFRESH_COMMIT_DISTANCE, Math.round(SWIPE_REFRESH_MAX_DISTANCE * 1.12)),
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(() => {
            swipeCommitTimerRef.current = setTimeout(() => {
              swipeCommitTimerRef.current = null;
              onSwipeRefreshCommitted?.();
              onPressFindOther();
            }, SWIPE_REFRESH_COMMIT_DELAY_MS);
            unlockSwipeWhenSafe();
          });
        },
        onPanResponderMove: (_, gestureState) => {
          if (phaseRef.current !== "calling") return;
          if (chatComposerOpen) return;
          if (swipeRefreshLockedRef.current) return;

          const dx = Math.min(0, Number(gestureState.dx || 0));
          const rawDistance = Math.min(SWIPE_REFRESH_MAX_DISTANCE, Math.max(0, -dx));
          swipeHoldDistanceRef.current = Math.max(swipeHoldDistanceRef.current, rawDistance);
          const swipeDistance = swipeHoldDistanceRef.current;
          const targetShift = -swipeDistance * SWIPE_REFRESH_VISUAL_DAMPING;
          const nextShift = swipeVisualXRef.current + (targetShift - swipeVisualXRef.current) * SWIPE_REFRESH_FOLLOW_SMOOTHING;
          swipeVisualXRef.current = nextShift;
          swipeDragTranslateX.setValue(nextShift);
        },
        onPanResponderTerminate: () => {
          if (swipeRefreshLockedRef.current) return;
          resetSwipePreview();
        },
      }),
    [chatComposerOpen, lastSwipeRefreshAtRef, onPressFindOther, onSwipeRefreshCommitted, phaseRef, resetSwipePreview, swipeDragTranslateX, unlockSwipeWhenSafe]
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
    swipeDragTranslateX,
  };
}
