import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, InteractionManager, Keyboard, Platform, TextInput } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ChatMessage = { id: string; mine: boolean; text: string };

type UseChatSystemArgs = {
  phase: string;
  phaseRef: React.MutableRefObject<string>;
  localStreamURL: string | null;
  myCamOn: boolean;
  rtcRef: React.MutableRefObject<any>;
  beforeSendChat?: (text: string) => Promise<boolean> | boolean;
  onSendBlocked?: (reason: string) => void;
};

const SWIPE_GUIDE_REFRESH_HIDE_COUNT = 2;
const SWIPE_GUIDE_STORAGE_KEY = "@ranchat/call/swipe-guide-refresh-count-v1";

export default function useChatSystem({
  phase,
  phaseRef,
  localStreamURL,
  myCamOn,
  rtcRef,
  beforeSendChat,
  onSendBlocked,
}: UseChatSystemArgs) {
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatReady, setChatReady] = useState(false);
  const [chatFeedVisible, setChatFeedVisible] = useState(false);
  const [chatComposerOpen, setChatComposerOpen] = useState(false);
  const [showSwipeGuide, setShowSwipeGuide] = useState(false);
  const [swipeGuideFrame, setSwipeGuideFrame] = useState(0);
  const [swipeGuideStorageReady, setSwipeGuideStorageReady] = useState(false);

  const chatSeqRef = useRef(0);
  const chatHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatFeedOpacityRef = useRef(new Animated.Value(0));
  const chatFeedHideProgressRef = useRef(new Animated.Value(0));
  const chatInputRef = useRef<TextInput | null>(null);
  const chatComposerOpenRef = useRef(false);
  const chatOpenPendingRef = useRef(false);
  const chatComposerOpenedAtRef = useRef(0);
  const chatIgnoreHideUntilRef = useRef(0);
  const chatOpenBlockUntilRef = useRef(0);
  const chatFocusTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const chatKeyboardVisibleRef = useRef(false);

  const swipeGuideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeGuideFlipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const swipeGuideCamOpenPrevRef = useRef(false);
  const lastSwipeRefreshAtRef = useRef(0);
  const swipeRefreshSuccessCountRef = useRef(0);
  const swipeGuideDisabledRef = useRef(false);

  const clearChatHideTimer = useCallback(() => {
    if (chatHideTimerRef.current) clearTimeout(chatHideTimerRef.current);
    chatHideTimerRef.current = null;
  }, []);

  const clearSwipeGuideTimer = useCallback(() => {
    if (swipeGuideTimerRef.current) clearTimeout(swipeGuideTimerRef.current);
    swipeGuideTimerRef.current = null;
  }, []);

  const clearSwipeGuideFlipTimer = useCallback(() => {
    if (swipeGuideFlipTimerRef.current) clearInterval(swipeGuideFlipTimerRef.current);
    swipeGuideFlipTimerRef.current = null;
  }, []);

  const persistSwipeGuideRefreshCount = useCallback(async (count: number) => {
    const normalized = Math.max(0, Math.floor(Number(count) || 0));
    try {
      await AsyncStorage.setItem(SWIPE_GUIDE_STORAGE_KEY, String(normalized));
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let restoredCount = 0;
      try {
        const raw = await AsyncStorage.getItem(SWIPE_GUIDE_STORAGE_KEY);
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
          restoredCount = Math.floor(parsed);
        }
      } catch {}

      swipeRefreshSuccessCountRef.current = restoredCount;
      swipeGuideDisabledRef.current = restoredCount >= SWIPE_GUIDE_REFRESH_HIDE_COUNT;

      if (cancelled) return;
      if (swipeGuideDisabledRef.current) {
        setShowSwipeGuide(false);
        setSwipeGuideFrame(0);
      }
      setSwipeGuideStorageReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSwipeRefreshCommitted = useCallback(() => {
    const nextCount = swipeRefreshSuccessCountRef.current + 1;
    swipeRefreshSuccessCountRef.current = nextCount;
    void persistSwipeGuideRefreshCount(nextCount);
    if (nextCount < SWIPE_GUIDE_REFRESH_HIDE_COUNT) return;
    swipeGuideDisabledRef.current = true;
    clearSwipeGuideTimer();
    clearSwipeGuideFlipTimer();
    setShowSwipeGuide(false);
    setSwipeGuideFrame(0);
  }, [clearSwipeGuideFlipTimer, clearSwipeGuideTimer, persistSwipeGuideRefreshCount]);

  const clearChatFocusTimers = useCallback(() => {
    chatFocusTimerRefs.current.forEach((tm) => clearTimeout(tm));
    chatFocusTimerRefs.current = [];
  }, []);

  const resetChatFeedAnimations = useCallback(() => {
    chatFeedOpacityRef.current.stopAnimation();
    chatFeedHideProgressRef.current.stopAnimation();
    chatFeedOpacityRef.current.setValue(0);
    chatFeedHideProgressRef.current.setValue(0);
  }, []);

  const animateChatFeedOpacity = useCallback((toValue: number, duration: number, onDone?: () => void) => {
    chatFeedOpacityRef.current.stopAnimation();
    Animated.timing(chatFeedOpacityRef.current, {
      toValue,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      onDone?.();
    });
  }, []);

  const animateChatFeedHideProgress = useCallback((toValue: number, duration: number, onDone?: () => void) => {
    chatFeedHideProgressRef.current.stopAnimation();
    Animated.timing(chatFeedHideProgressRef.current, {
      toValue,
      duration,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      onDone?.();
    });
  }, []);

  const showChatFeedForAWhile = useCallback(() => {
    setChatFeedVisible(true);
    chatFeedHideProgressRef.current.stopAnimation();
    chatFeedHideProgressRef.current.setValue(0);
    animateChatFeedOpacity(1, 160);
    clearChatHideTimer();
    chatHideTimerRef.current = setTimeout(() => {
      chatHideTimerRef.current = null;
      animateChatFeedHideProgress(1, 420, () => {
        animateChatFeedOpacity(0, 120, () => {
          setChatFeedVisible(false);
          chatFeedHideProgressRef.current.setValue(0);
        });
      });
    }, 7000);
  }, [animateChatFeedHideProgress, animateChatFeedOpacity, clearChatHideTimer]);

  const appendChatMessage = useCallback(
    (mine: boolean, message: string) => {
      const text = String(message || "").trim();
      if (!text) return;

      const id = `${Date.now()}_${chatSeqRef.current++}`;
      setChatMessages((prev) => {
        const next = [...prev, { id, mine, text }];
        return next.length > 5 ? next.slice(next.length - 5) : next;
      });
      showChatFeedForAWhile();
    },
    [showChatFeedForAWhile]
  );

  const sendChat = useCallback(async () => {
    const text = String(chatInput || "").trim();
    if (!text) return;

    if (beforeSendChat) {
      let allowed = false;
      try {
        allowed = Boolean(await Promise.resolve(beforeSendChat(text)));
      } catch {
        allowed = false;
      }
      if (!allowed) {
        onSendBlocked?.("poptalk_blocked");
        return;
      }
    }

    const ok = rtcRef.current?.sendChatMessage(text);
    if (!ok) {
      onSendBlocked?.("send_failed");
      return;
    }

    appendChatMessage(true, text);
    setChatInput("");
    clearChatFocusTimers();
    chatOpenPendingRef.current = false;
    chatComposerOpenRef.current = false;
    chatKeyboardVisibleRef.current = false;
    chatIgnoreHideUntilRef.current = 0;
    chatOpenBlockUntilRef.current = 0;
    chatInputRef.current?.blur?.();
    Keyboard.dismiss();
    setChatComposerOpen(false);
  }, [appendChatMessage, beforeSendChat, chatInput, clearChatFocusTimers, onSendBlocked, rtcRef]);

  const closeChatComposer = useCallback(() => {
    clearChatFocusTimers();
    chatOpenPendingRef.current = false;
    chatComposerOpenRef.current = false;
    chatKeyboardVisibleRef.current = false;
    chatIgnoreHideUntilRef.current = 0;
    chatOpenBlockUntilRef.current = Date.now() + 320;
    chatInputRef.current?.blur?.();
    Keyboard.dismiss();
    setChatComposerOpen(false);
  }, [clearChatFocusTimers]);

  const queueChatInputFocus = useCallback((extraDelay = 0) => {
    const tm = setTimeout(() => {
      if (!chatComposerOpenRef.current) return;
      const input = chatInputRef.current;
      if (!input) return;
      if (input.isFocused?.()) {
        chatOpenPendingRef.current = false;
        return;
      }
      input.focus?.();
    }, Math.max(0, extraDelay));
    chatFocusTimerRefs.current.push(tm);
  }, []);

  const armChatInputFocus = useCallback(() => {
    if (!chatComposerOpenRef.current && !chatOpenPendingRef.current) return;
    chatIgnoreHideUntilRef.current = Date.now() + 700;
    queueChatInputFocus(0);
    queueChatInputFocus(36);
    queueChatInputFocus(72);
    queueChatInputFocus(144);
    queueChatInputFocus(240);
    queueChatInputFocus(340);
    requestAnimationFrame(() => {
      if (!chatComposerOpenRef.current) return;
      chatInputRef.current?.focus?.();
    });
    try {
      InteractionManager.runAfterInteractions(() => {
        if (!chatComposerOpenRef.current) return;
        chatInputRef.current?.focus?.();
      });
    } catch {}
  }, [queueChatInputFocus]);

  const openChatComposer = useCallback(() => {
    if (phaseRef.current !== "calling") return;
    if (Date.now() < chatOpenBlockUntilRef.current) return;
    if (chatOpenPendingRef.current) return;
    if (chatComposerOpenRef.current) return;

    clearChatFocusTimers();
    chatComposerOpenedAtRef.current = Date.now();
    chatOpenPendingRef.current = true;
    chatComposerOpenRef.current = true;
    setChatComposerOpen(true);
    armChatInputFocus();
  }, [armChatInputFocus, clearChatFocusTimers, phaseRef]);

  const onPressChatControl = useCallback(() => {
    if (!chatComposerOpenRef.current && !chatOpenPendingRef.current) {
      openChatComposer();
      return;
    }
    armChatInputFocus();
  }, [armChatInputFocus, openChatComposer]);

  const onChatComposerBackdropPress = useCallback(() => {
    if (Date.now() - chatComposerOpenedAtRef.current < 260) return;
    closeChatComposer();
  }, [closeChatComposer]);

  const onChatInputFocus = useCallback(() => {
    chatOpenPendingRef.current = false;
    chatKeyboardVisibleRef.current = true;
  }, []);

  const resetChatAndSwipeState = useCallback(() => {
    setChatReady(false);
    setChatInput("");
    setChatMessages([]);
    setChatFeedVisible(false);
    resetChatFeedAnimations();
    chatOpenPendingRef.current = false;
    chatComposerOpenRef.current = false;
    chatKeyboardVisibleRef.current = false;
    chatIgnoreHideUntilRef.current = 0;
    chatOpenBlockUntilRef.current = 0;
    chatInputRef.current?.blur?.();
    setChatComposerOpen(false);
    clearChatHideTimer();
    clearSwipeGuideTimer();
    clearSwipeGuideFlipTimer();
    setShowSwipeGuide(false);
    setSwipeGuideFrame(0);
    swipeGuideCamOpenPrevRef.current = false;
    clearChatFocusTimers();
    chatSeqRef.current = 0;
  }, [
    clearChatFocusTimers,
    clearChatHideTimer,
    clearSwipeGuideFlipTimer,
    clearSwipeGuideTimer,
    resetChatFeedAnimations,
  ]);

  useEffect(() => {
    chatComposerOpenRef.current = chatComposerOpen;
  }, [chatComposerOpen]);

  useEffect(() => {
    if (!chatComposerOpen) return;
    armChatInputFocus();
  }, [armChatInputFocus, chatComposerOpen]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const subShow = Keyboard.addListener(showEvent as any, () => {
      chatKeyboardVisibleRef.current = true;
      if (phaseRef.current !== "calling") return;
      if (!chatComposerOpenRef.current) return;
      chatOpenPendingRef.current = false;
      armChatInputFocus();
    });
    const subHide = Keyboard.addListener(hideEvent as any, () => {
      chatKeyboardVisibleRef.current = false;
      if (Date.now() < chatIgnoreHideUntilRef.current) {
        if (chatComposerOpenRef.current) {
          armChatInputFocus();
        }
        return;
      }
      if (chatOpenPendingRef.current) {
        armChatInputFocus();
        return;
      }

      if (chatComposerOpenRef.current) {
        const openedAgo = Date.now() - chatComposerOpenedAtRef.current;
        if (openedAgo < 220) {
          armChatInputFocus();
          return;
        }

        clearChatFocusTimers();
        chatComposerOpenRef.current = false;
        chatOpenPendingRef.current = false;
        chatIgnoreHideUntilRef.current = 0;
        chatOpenBlockUntilRef.current = Date.now() + 320;
        chatInputRef.current?.blur?.();
        setChatComposerOpen(false);
      }
    });

    return () => {
      try {
        subShow.remove();
      } catch {}
      try {
        subHide.remove();
      } catch {}
    };
  }, [armChatInputFocus, clearChatFocusTimers, phaseRef]);

  useEffect(() => {
    return () => {
      clearChatFocusTimers();
      chatOpenPendingRef.current = false;
      chatComposerOpenRef.current = false;
      chatKeyboardVisibleRef.current = false;
      chatIgnoreHideUntilRef.current = 0;
      chatOpenBlockUntilRef.current = 0;
      chatInputRef.current?.blur?.();
      clearChatHideTimer();
      resetChatFeedAnimations();
      clearSwipeGuideTimer();
      clearSwipeGuideFlipTimer();
    };
  }, [clearChatFocusTimers, clearChatHideTimer, clearSwipeGuideFlipTimer, clearSwipeGuideTimer, resetChatFeedAnimations]);

  useEffect(() => {
    if (!swipeGuideStorageReady) return;
    const camOpenedNow = phase === "calling" && myCamOn && Boolean(localStreamURL);

    if (camOpenedNow && !swipeGuideCamOpenPrevRef.current) {
      if (swipeGuideDisabledRef.current || swipeRefreshSuccessCountRef.current >= SWIPE_GUIDE_REFRESH_HIDE_COUNT) {
        clearSwipeGuideTimer();
        clearSwipeGuideFlipTimer();
        setShowSwipeGuide(false);
        setSwipeGuideFrame(0);
        swipeGuideCamOpenPrevRef.current = camOpenedNow;
        return;
      }
      clearSwipeGuideTimer();
      clearSwipeGuideFlipTimer();
      setShowSwipeGuide(true);
      setSwipeGuideFrame(0);
      swipeGuideFlipTimerRef.current = setInterval(() => {
        setSwipeGuideFrame((prev) => (prev === 0 ? 1 : 0));
      }, 700);
      swipeGuideTimerRef.current = setTimeout(() => {
        setShowSwipeGuide(false);
        swipeGuideTimerRef.current = null;
        clearSwipeGuideFlipTimer();
      }, 10000);
    }

    if (!camOpenedNow) {
      clearSwipeGuideTimer();
      clearSwipeGuideFlipTimer();
      setShowSwipeGuide(false);
      setSwipeGuideFrame(0);
    }

    swipeGuideCamOpenPrevRef.current = camOpenedNow;
  }, [clearSwipeGuideFlipTimer, clearSwipeGuideTimer, localStreamURL, myCamOn, phase, swipeGuideStorageReady]);

  return {
    chatInput,
    setChatInput,
    chatMessages,
    setChatMessages,
    chatReady,
    setChatReady,
    chatFeedVisible,
    setChatFeedVisible,
    chatComposerOpen,
    setChatComposerOpen,
    showSwipeGuide,
    setShowSwipeGuide,
    swipeGuideFrame,
    setSwipeGuideFrame,
    chatInputRef,
    chatComposerOpenRef,
    chatOpenPendingRef,
    chatKeyboardVisibleRef,
    chatIgnoreHideUntilRef,
    chatOpenBlockUntilRef,
    chatSeqRef,
    chatFeedOpacityRef,
    chatFeedHideProgressRef,
    lastSwipeRefreshAtRef,
    onSwipeRefreshCommitted,
    appendChatMessage,
    sendChat,
    openChatComposer,
    onPressChatControl,
    onChatComposerBackdropPress,
    onChatInputFocus,
    clearChatHideTimer,
    clearSwipeGuideTimer,
    clearSwipeGuideFlipTimer,
    clearChatFocusTimers,
    resetChatFeedAnimations,
    resetChatAndSwipeState,
  };
}
