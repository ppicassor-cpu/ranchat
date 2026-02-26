import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import AppModal from "../components/AppModal";
import AppText from "../components/AppText";
import PrimaryButton from "../components/PrimaryButton";
import { theme } from "../config/theme";
import { useTranslation } from "../i18n/LanguageProvider";
import { fetchDinoLeaderboard, submitDinoRankEntry, type DinoLeaderboardEntry } from "../services/profile/ProfileSync";
import { bootstrapDeviceBinding } from "../services/auth/AuthBootstrap";
import { useAppStore } from "../store/useAppStore";

type GameState = "idle" | "running" | "gameover";
type AnimMode = "idle" | "run" | "jump_up" | "jump_down" | "land" | "gameover";

type Obstacle = {
  id: number;
  x: number;
  width: number;
  height: number;
  kind: number;
  scored: boolean;
};

type Cloud = {
  id: number;
  x: number;
  y: number;
  size: number;
  speed: number;
};

type Building = {
  id: number;
  x: number;
  width: number;
  height: number;
  speed: number;
  color: string;
  rows: number;
  cols: number;
  seed: number;
};

type PendingRankEntry = {
  score: number;
  obtainedAt: number;
  clientEntryId: string;
};

type RankRow = DinoLeaderboardEntry & {
  isEmpty?: boolean;
};

const DINO_GIRL_FRAMES = [
  require("../../assets/dino-girl-frames/frame_00.png"),
  require("../../assets/dino-girl-frames/frame_01.png"),
  require("../../assets/dino-girl-frames/frame_02.png"),
  require("../../assets/dino-girl-frames/frame_03.png"),
  require("../../assets/dino-girl-frames/frame_04.png"),
  require("../../assets/dino-girl-frames/frame_05.png"),
  require("../../assets/dino-girl-frames/frame_06.png"),
  require("../../assets/dino-girl-frames/frame_07.png"),
  require("../../assets/dino-girl-frames/frame_08.png"),
  require("../../assets/dino-girl-frames/frame_09.png"),
  require("../../assets/dino-girl-frames/frame_10.png"),
  require("../../assets/dino-girl-frames/frame_11.png"),
  require("../../assets/dino-girl-frames/frame_12.png"),
  require("../../assets/dino-girl-frames/frame_13.png"),
  require("../../assets/dino-girl-frames/frame_14.png"),
  require("../../assets/dino-girl-frames/frame_15.png"),
] as const;

const OBSTACLE_SPRITES = [
  require("../../assets/dino-obstacles/puddle.png"),
  require("../../assets/dino-obstacles/cat.png"),
  require("../../assets/dino-obstacles/dog.png"),
  require("../../assets/dino-obstacles/scooter.png"),
  require("../../assets/dino-obstacles/ball.png"),
  require("../../assets/dino-obstacles/cone.png"),
] as const;

const OBSTACLE_TARGET_HEIGHTS = [20, 52, 56, 68, 40, 58] as const;

const OBSTACLE_CONFIGS = OBSTACLE_SPRITES.map((source, index) => {
  const asset = Image.resolveAssetSource(source);
  const srcWidth = asset?.width ?? 60;
  const srcHeight = asset?.height ?? 60;
  const targetHeight = OBSTACLE_TARGET_HEIGHTS[index] ?? 50;
  const scale = targetHeight / srcHeight;
  return {
    source,
    width: Math.max(22, Math.round(srcWidth * scale)),
    height: Math.max(14, Math.round(targetHeight)),
  };
});

const DINO_WIDTH = 42;
const DINO_HEIGHT = 46;
const DINO_X = 44;
const GROUND_HEIGHT = 46;

const SPRITE_SOURCE = Image.resolveAssetSource(DINO_GIRL_FRAMES[0]);
const SPRITE_FRAME_WIDTH = SPRITE_SOURCE?.width ?? 256;
const SPRITE_FRAME_HEIGHT = SPRITE_SOURCE?.height ?? 384;
const SPRITE_RENDER_WIDTH = 90;
const SPRITE_SCALE = SPRITE_RENDER_WIDTH / SPRITE_FRAME_WIDTH;
const SPRITE_RENDER_HEIGHT = Math.round(SPRITE_FRAME_HEIGHT * SPRITE_SCALE);
const SPRITE_OFFSET_X = Math.round((DINO_WIDTH - SPRITE_RENDER_WIDTH) / 2);
const SPRITE_BOTTOM_INSET = 8;

const GRAVITY = 2100;
const JUMP_VELOCITY = 760;
const BASE_SPEED = 290;
const SPEED_GROWTH_PER_SEC = 8;
const LAND_HOLD_MS = 140;
const MAX_JUMP_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
const BRIDGE_TOTAL_HEIGHT = 42;
const BRIDGE_STRIDE = 56;

const RUN_FRAMES = [0, 1, 2, 4, 5, 8, 9, 12];
const JUMP_UP_FRAMES = [6, 10, 11];
const JUMP_DOWN_FRAMES = [3, 9, 14];
const LAND_FRAMES = [13, 12];
const IDLE_FRAME = 12;
const GAMEOVER_FRAME = 7;
const PRELOAD_IMAGE_SOURCES = [...DINO_GIRL_FRAMES, ...OBSTACLE_SPRITES] as const;
const BUILDING_COLORS = ["#e4e7ef", "#dde1ea", "#d8dce6", "#e9ecf3"] as const;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function createCloud(id: number, x: number, playHeight: number): Cloud {
  const size = Math.round(34 + Math.random() * 34);
  const maxY = Math.max(20, Math.min(playHeight * 0.48, 140));
  const y = 10 + Math.random() * maxY;
  const speed = 0.13 + Math.random() * 0.1;
  return { id, x, y, size, speed };
}

function createBuilding(id: number, x: number, playHeight: number): Building {
  const minH = 44;
  const maxH = Math.max(minH + 10, Math.min(playHeight * 0.52, 128));
  const height = Math.round(minH + Math.random() * (maxH - minH));
  const width = Math.round(height * (0.58 + Math.random() * 0.34));
  const speed = 0.23 + Math.random() * 0.1;
  const color = BUILDING_COLORS[Math.floor(Math.random() * BUILDING_COLORS.length)] ?? BUILDING_COLORS[0];
  const cols = Math.max(2, Math.min(5, Math.floor(width / 16)));
  const rows = Math.max(3, Math.min(8, Math.floor(height / 18)));
  const seed = Math.floor(Math.random() * 100000);
  return { id, x, width, height, speed, color, rows, cols, seed };
}

function frameSetOf(mode: AnimMode) {
  if (mode === "run") return RUN_FRAMES;
  if (mode === "jump_up") return JUMP_UP_FRAMES;
  if (mode === "jump_down") return JUMP_DOWN_FRAMES;
  if (mode === "land") return LAND_FRAMES;
  if (mode === "gameover") return [GAMEOVER_FRAME];
  return [IDLE_FRAME];
}

function fpsOf(mode: AnimMode) {
  if (mode === "run") return 14;
  if (mode === "jump_up") return 10;
  if (mode === "jump_down") return 10;
  if (mode === "land") return 12;
  return 0;
}

export default function DinoScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [layoutW, setLayoutW] = useState(0);
  const [layoutH, setLayoutH] = useState(0);

  const [state, setState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [dinoBottom, setDinoBottom] = useState(0);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [spriteFrame, setSpriteFrame] = useState(IDLE_FRAME);
  const [impactPoint, setImpactPoint] = useState<{ x: number; y: number } | null>(null);
  const best = useAppStore((s: any) => Number(s.ui?.dinoBestScore ?? 0));
  const myCountry = useAppStore((s: any) => String(s.prefs?.country ?? ""));
  const callMatchedSignal = useAppStore((s: any) => Number(s.ui?.callMatchedSignal ?? 0));
  const authToken = useAppStore((s: any) => s.auth?.token);
  const authUserId = useAppStore((s: any) => s.auth?.userId);
  const authDeviceKey = useAppStore((s: any) => s.auth?.deviceKey);
  const setDinoBestScore = useAppStore((s: any) => s.setDinoBestScore);
  const setDinoBestComment = useAppStore((s: any) => s.setDinoBestComment);
  const [newBestScore, setNewBestScore] = useState<number | null>(null);
  const [bestCommentModalVisible, setBestCommentModalVisible] = useState(false);
  const [bestCommentDraft, setBestCommentDraft] = useState("");
  const [leaderboard, setLeaderboard] = useState<DinoLeaderboardEntry[]>([]);
  const [pendingRankEntry, setPendingRankEntry] = useState<PendingRankEntry | null>(null);
  const [rankSubmitting, setRankSubmitting] = useState(false);
  const [matchedModalVisible, setMatchedModalVisible] = useState(false);
  const [matchedCountdown, setMatchedCountdown] = useState(3);
  const [bridgeOffset, setBridgeOffset] = useState(0);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const rafRef = useRef<number | null>(null);
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchedCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialSignalRef = useRef(callMatchedSignal);
  const handledSignalRef = useRef(callMatchedSignal);
  const lastTsRef = useRef<number>(0);
  const obstacleIdRef = useRef(1);
  const cloudIdRef = useRef(1);
  const buildingIdRef = useRef(1);
  const velRef = useRef(0);
  const speedRef = useRef(BASE_SPEED);
  const spawnInRef = useRef(1.2);
  const cloudSpawnInRef = useRef(0.9);
  const buildingSpawnInRef = useRef(0.7);
  const scoreRef = useRef(0);
  const bridgeOffsetRef = useRef(0);
  const dinoBottomRef = useRef(0);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const cloudsRef = useRef<Cloud[]>([]);
  const buildingsRef = useRef<Building[]>([]);

  const spriteFrameRef = useRef(IDLE_FRAME);
  const animModeRef = useRef<AnimMode>("idle");
  const animStepRef = useRef(0);
  const animAccumRef = useRef(0);
  const landUntilMsRef = useRef(0);
  const impactAnim = useRef(new Animated.Value(0)).current;
  const canRun = layoutW > 0 && layoutH > 0;
  const playHeight = useMemo(() => Math.max(120, layoutH - GROUND_HEIGHT), [layoutH]);

  const setSpriteFrameSafe = useCallback((frame: number) => {
    if (spriteFrameRef.current === frame) return;
    spriteFrameRef.current = frame;
    setSpriteFrame(frame);
  }, []);

  const stepAnimation = useCallback(
    (mode: AnimMode, dt: number) => {
      const frames = frameSetOf(mode);
      const fps = fpsOf(mode);

      if (animModeRef.current !== mode) {
        animModeRef.current = mode;
        animStepRef.current = 0;
        animAccumRef.current = 0;
        setSpriteFrameSafe(frames[0]);
        return;
      }

      if (frames.length <= 1 || fps <= 0) {
        setSpriteFrameSafe(frames[0]);
        return;
      }

      const stepSec = 1 / fps;
      animAccumRef.current += dt;

      while (animAccumRef.current >= stepSec) {
        animAccumRef.current -= stepSec;
        if (mode === "land") {
          animStepRef.current = Math.min(animStepRef.current + 1, frames.length - 1);
        } else {
          animStepRef.current = (animStepRef.current + 1) % frames.length;
        }
      }

      setSpriteFrameSafe(frames[animStepRef.current]);
    },
    [setSpriteFrameSafe]
  );

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const clearFinishTimeout = useCallback(() => {
    if (finishTimeoutRef.current != null) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
  }, []);

  const triggerImpact = useCallback(
    (x: number, y: number) => {
      setImpactPoint({ x, y });
      impactAnim.stopAnimation();
      impactAnim.setValue(0);
      Animated.timing(impactAnim, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setImpactPoint(null);
      });
    },
    [impactAnim]
  );

  const resetWorld = useCallback(() => {
    clearFinishTimeout();
    velRef.current = 0;
    speedRef.current = BASE_SPEED;
    spawnInRef.current = 1.1;
    cloudSpawnInRef.current = 0.65 + Math.random() * 0.8;
    buildingSpawnInRef.current = 0.45 + Math.random() * 0.9;
    scoreRef.current = 0;
    bridgeOffsetRef.current = 0;
    dinoBottomRef.current = 0;
    obstaclesRef.current = [];
    cloudsRef.current = [];
    buildingsRef.current = [];
    landUntilMsRef.current = 0;
    animModeRef.current = "idle";
    animStepRef.current = 0;
    animAccumRef.current = 0;
    setScore(0);
    setBridgeOffset(0);
    setDinoBottom(0);
    setObstacles([]);
    setClouds([]);
    setBuildings([]);
    setImpactPoint(null);
    impactAnim.setValue(0);
    setSpriteFrameSafe(IDLE_FRAME);

    if (layoutW > 0 && playHeight > 0) {
      const cloudCount = Math.max(4, Math.ceil(layoutW / 160));
      const buildingCount = Math.max(5, Math.ceil(layoutW / 120));

      let cloudX = -10;
      const initialClouds: Cloud[] = [];
      for (let i = 0; i < cloudCount; i++) {
        cloudX += 55 + Math.random() * 120;
        initialClouds.push(createCloud(cloudIdRef.current++, cloudX, playHeight));
      }

      let buildingX = -30;
      const initialBuildings: Building[] = [];
      for (let i = 0; i < buildingCount; i++) {
        buildingX += 42 + Math.random() * 88;
        initialBuildings.push(createBuilding(buildingIdRef.current++, buildingX, playHeight));
      }

      cloudsRef.current = initialClouds;
      buildingsRef.current = initialBuildings;
      setClouds(initialClouds);
      setBuildings(initialBuildings);
    }
  }, [clearFinishTimeout, impactAnim, layoutW, playHeight, setSpriteFrameSafe]);

  const finishGame = useCallback(() => {
    clearFinishTimeout();
    stopLoop();
    setState("gameover");
    stepAnimation("gameover", 0);
    const finalScore = Math.floor(scoreRef.current);

    const serverTopScores = leaderboard
      .map((row) => Math.max(0, Math.trunc(Number(row.score || 0))))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => b - a)
      .slice(0, 10);
    const cutoff = serverTopScores[serverTopScores.length - 1] ?? 0;
    const isTop10 = finalScore > 0 && (serverTopScores.length < 10 || finalScore > cutoff);
    const isNewBest = finalScore > best;

    if (isTop10 && finalScore > 0) {
      const safe = Math.max(0, Math.trunc(finalScore));
      const nowTs = Date.now();
      setPendingRankEntry({
        score: safe,
        obtainedAt: nowTs,
        clientEntryId: `${nowTs}_${Math.random().toString(16).slice(2)}`,
      });
    }
    if (isNewBest) {
      setDinoBestScore(finalScore);
      setNewBestScore(finalScore);
    } else {
      setNewBestScore(null);
    }
    if (isTop10) {
      setBestCommentDraft("");
      setBestCommentModalVisible(true);
    }
  }, [best, clearFinishTimeout, leaderboard, setDinoBestScore, stepAnimation, stopLoop]);

  const spawnObstacle = useCallback(() => {
    if (!layoutW) return;
    const kind = Math.floor(Math.random() * OBSTACLE_CONFIGS.length);
    const config = OBSTACLE_CONFIGS[kind];
    const sizeJitter = 0.9 + Math.random() * 0.2;
    const height = Math.max(12, Math.round(config.height * sizeJitter));
    const width = Math.max(18, Math.round(config.width * sizeJitter));
    const next: Obstacle = {
      id: obstacleIdRef.current++,
      x: layoutW + 10,
      width,
      height,
      kind,
      scored: false,
    };
    obstaclesRef.current = [...obstaclesRef.current, next];
  }, [layoutW]);

  const frame = useCallback(
    (ts: number) => {
      if (state !== "running") return;
      if (!canRun) return;

      const prevTs = lastTsRef.current || ts;
      const rawDt = (ts - prevTs) / 1000;
      const dt = clamp(rawDt, 0, 0.033);
      lastTsRef.current = ts;

      speedRef.current += SPEED_GROWTH_PER_SEC * dt;
      scoreRef.current += dt * 12;
      setScore(Math.floor(scoreRef.current));

      const prevBottom = dinoBottomRef.current;
      velRef.current -= GRAVITY * dt;
      dinoBottomRef.current += velRef.current * dt;
      if (dinoBottomRef.current <= 0) {
        dinoBottomRef.current = 0;
        velRef.current = 0;
      }
      const justLanded = prevBottom > 1 && dinoBottomRef.current <= 0;
      if (justLanded) {
        landUntilMsRef.current = ts + LAND_HOLD_MS;
      }

      setDinoBottom(dinoBottomRef.current);

      const nextAnimMode: AnimMode =
        dinoBottomRef.current > 2
          ? velRef.current > 20
            ? "jump_up"
            : "jump_down"
          : ts < landUntilMsRef.current
          ? "land"
          : "run";
      stepAnimation(nextAnimMode, dt);

      spawnInRef.current -= dt;
      if (spawnInRef.current <= 0) {
        spawnObstacle();
        spawnInRef.current = 0.95 + Math.random() * 0.85;
      }

      const movedClouds = cloudsRef.current
        .map((c) => ({ ...c, x: c.x - speedRef.current * dt * c.speed }))
        .filter((c) => c.x + c.size * 1.45 > -40);
      cloudSpawnInRef.current -= dt;
      if (cloudSpawnInRef.current <= 0 || movedClouds.length < 3) {
        const rightMostCloud = movedClouds.reduce((m, c) => Math.max(m, c.x + c.size * 1.45), layoutW * 0.65);
        const nextX = Math.max(layoutW + 20, rightMostCloud + 50 + Math.random() * 140);
        movedClouds.push(createCloud(cloudIdRef.current++, nextX, playHeight));
        cloudSpawnInRef.current = 0.9 + Math.random() * 1.2;
      }
      cloudsRef.current = movedClouds;
      setClouds(movedClouds);

      const movedBuildings = buildingsRef.current
        .map((b) => ({ ...b, x: b.x - speedRef.current * dt * b.speed }))
        .filter((b) => b.x + b.width > -45);
      buildingSpawnInRef.current -= dt;
      if (buildingSpawnInRef.current <= 0 || movedBuildings.length < 4) {
        const rightMostBuilding = movedBuildings.reduce((m, b) => Math.max(m, b.x + b.width), layoutW * 0.55);
        const nextX = Math.max(layoutW + 10, rightMostBuilding + 25 + Math.random() * 70);
        movedBuildings.push(createBuilding(buildingIdRef.current++, nextX, playHeight));
        buildingSpawnInRef.current = 0.6 + Math.random() * 1.0;
      }
      buildingsRef.current = movedBuildings;
      setBuildings(movedBuildings);

      bridgeOffsetRef.current = (bridgeOffsetRef.current + speedRef.current * dt * 0.35) % BRIDGE_STRIDE;
      setBridgeOffset(bridgeOffsetRef.current);

      const moved = obstaclesRef.current
        .map((o) => ({ ...o, x: o.x - speedRef.current * dt }))
        .filter((o) => o.x + o.width > -8);

      const dinoTop = playHeight - DINO_HEIGHT - dinoBottomRef.current;
      const dinoBottomY = dinoTop + DINO_HEIGHT;
      const dinoLeft = DINO_X;
      const dinoRight = DINO_X + DINO_WIDTH;

      let collided = false;
      let collisionX = 0;
      let collisionY = 0;
      const scoredObstacles = moved.map((o) => {
        const oTop = playHeight - o.height;
        const oBottom = playHeight;
        const oLeft = o.x;
        const oRight = o.x + o.width;

        const overlapX = dinoRight > oLeft && dinoLeft < oRight;
        const overlapY = dinoBottomY > oTop && dinoTop < oBottom;
        if (overlapX && overlapY) {
          collided = true;
          collisionX = oLeft + o.width / 2;
          collisionY = oTop + o.height / 2;
        }

        if (!o.scored && oRight < dinoLeft) {
          scoreRef.current += 5;
          return { ...o, scored: true };
        }
        return o;
      });

      obstaclesRef.current = scoredObstacles;
      setObstacles(scoredObstacles);
      setScore(Math.floor(scoreRef.current));

      if (collided) {
        triggerImpact(collisionX, collisionY);
        clearFinishTimeout();
        finishTimeoutRef.current = setTimeout(() => {
          finishTimeoutRef.current = null;
          finishGame();
        }, 120);
        return;
      }

      rafRef.current = requestAnimationFrame(frame);
    },
    [canRun, clearFinishTimeout, finishGame, layoutW, playHeight, spawnObstacle, state, stepAnimation, triggerImpact]
  );

  useEffect(() => {
    if (state !== "running") {
      stopLoop();
      if (state === "idle") stepAnimation("idle", 0);
      if (state === "gameover") stepAnimation("gameover", 0);
      return;
    }

    lastTsRef.current = 0;
    stepAnimation("run", 0);
    rafRef.current = requestAnimationFrame(frame);
    return stopLoop;
  }, [frame, state, stepAnimation, stopLoop]);

  useEffect(
    () => () => {
      stopLoop();
      clearFinishTimeout();
      if (matchedTimerRef.current) {
        clearTimeout(matchedTimerRef.current);
        matchedTimerRef.current = null;
      }
      if (matchedCountdownRef.current) {
        clearInterval(matchedCountdownRef.current);
        matchedCountdownRef.current = null;
      }
    },
    [clearFinishTimeout, stopLoop]
  );

  useEffect(() => {
    if (!callMatchedSignal) return;
    if (callMatchedSignal === initialSignalRef.current) return;
    if (callMatchedSignal === handledSignalRef.current) return;
    if (matchedModalVisible) return;
    if (matchedTimerRef.current || matchedCountdownRef.current) return;
    handledSignalRef.current = callMatchedSignal;

    setMatchedModalVisible(true);
    setMatchedCountdown(3);
    matchedCountdownRef.current = setInterval(() => {
      setMatchedCountdown((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);
    matchedTimerRef.current = setTimeout(() => {
      if (matchedCountdownRef.current) {
        clearInterval(matchedCountdownRef.current);
        matchedCountdownRef.current = null;
      }
      matchedTimerRef.current = null;
      setMatchedModalVisible(false);
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate("Call");
    }, 3000);
  }, [callMatchedSignal, matchedModalVisible, navigation]);

  useEffect(() => {
    PRELOAD_IMAGE_SOURCES.forEach((source) => {
      const asset = Image.resolveAssetSource(source);
      if (!asset?.uri) return;
      Image.prefetch(asset.uri).catch(() => undefined);
    });
  }, []);

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const rows = await fetchDinoLeaderboard(authToken);
      setLeaderboard(rows.slice(0, 10));
    } catch {
      // Keep previous list on request failure.
    } finally {
      setLeaderboardLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    loadLeaderboard().catch(() => undefined);
  }, [loadLeaderboard]);

  useEffect(() => {
    if (state !== "gameover") return;
    loadLeaderboard().catch(() => undefined);
  }, [loadLeaderboard, state]);

  const jump = useCallback(() => {
    if (state !== "running") return;
    if (dinoBottomRef.current > 2) return;
    velRef.current = JUMP_VELOCITY;
    stepAnimation("jump_up", 0);
  }, [state, stepAnimation]);

  const startGame = useCallback(() => {
    if (!canRun) return;
    resetWorld();
    setState("running");
  }, [canRun, resetWorld]);

  const onPressGameArea = useCallback(() => {
    if (bestCommentModalVisible) return;
    if (state === "running") {
      jump();
      return;
    }
    startGame();
  }, [bestCommentModalVisible, jump, startGame, state]);

  const impactFlashOpacity = impactAnim.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 0.36, 0],
  });
  const impactBurstOpacity = impactAnim.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 0.9, 0],
  });
  const impactBurstScale = impactAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1.7],
  });
  const normalizedBestComment = useMemo(() => bestCommentDraft.trim().slice(0, 60), [bestCommentDraft]);

  const submitRankToServer = useCallback(
    async (entry: PendingRankEntry, comment: string | null) => {
      let tokenNow = String(authToken || "").trim();
      let userIdNow = authUserId ?? null;
      let deviceKeyNow = authDeviceKey ?? null;

      if (!tokenNow) {
        try {
          await bootstrapDeviceBinding();
          const st: any = useAppStore.getState?.() ?? {};
          tokenNow = String(st?.auth?.token || "").trim();
          userIdNow = st?.auth?.userId ?? userIdNow;
          deviceKeyNow = st?.auth?.deviceKey ?? deviceKeyNow;
        } catch {
          tokenNow = "";
        }
      }

      if (!tokenNow) return false;

      try {
        return await submitDinoRankEntry({
          token: tokenNow,
          userId: userIdNow,
          deviceKey: deviceKeyNow,
          country: myCountry,
          score: Math.max(0, Math.trunc(Number(entry.score || 0))),
          comment,
          obtainedAt: Math.max(0, Math.trunc(Number(entry.obtainedAt || Date.now()))),
          clientEntryId: entry.clientEntryId,
        });
      } catch {
        return false;
      }
    },
    [authDeviceKey, authToken, authUserId, myCountry]
  );

  const saveBestComment = useCallback(() => {
    if (rankSubmitting) return;
    const nextComment = normalizedBestComment || null;
    const pending = pendingRankEntry;

    if (newBestScore != null) {
      setDinoBestComment(nextComment);
    }

    setBestCommentModalVisible(false);
    setNewBestScore(null);
    setPendingRankEntry(null);
    setBestCommentDraft("");

    if (!pending || pending.score <= 0) {
      loadLeaderboard().catch(() => undefined);
      return;
    }

    setRankSubmitting(true);
    setTimeout(() => {
      (async () => {
        await submitRankToServer(pending, nextComment);
        await loadLeaderboard().catch(() => undefined);
      })()
        .catch(() => undefined)
        .finally(() => setRankSubmitting(false));
    }, 180);
  }, [loadLeaderboard, newBestScore, normalizedBestComment, pendingRankEntry, rankSubmitting, setDinoBestComment, submitRankToServer]);

  const skipBestComment = useCallback(() => {
    if (rankSubmitting) return;
    const pending = pendingRankEntry;

    setBestCommentModalVisible(false);
    setNewBestScore(null);
    setPendingRankEntry(null);
    setBestCommentDraft("");

    if (!pending || pending.score <= 0) {
      loadLeaderboard().catch(() => undefined);
      return;
    }

    setRankSubmitting(true);
    setTimeout(() => {
      (async () => {
        // "Skip" means saving the rank with an empty comment.
        await submitRankToServer(pending, null);
        await loadLeaderboard().catch(() => undefined);
      })()
        .catch(() => undefined)
        .finally(() => setRankSubmitting(false));
    }, 180);
  }, [loadLeaderboard, pendingRankEntry, rankSubmitting, submitRankToServer]);

  const pendingEntryRank = useMemo<number | null>(() => {
    if (!pendingRankEntry || pendingRankEntry.score <= 0) return null;

    type CandidateRow = {
      rank: number;
      score: number;
      isCandidate?: boolean;
    };

    const serverRows: CandidateRow[] = leaderboard
      .filter((row) => Number.isFinite(row.score) && row.score > 0)
      .map((row, idx) => ({
        rank: Number.isFinite(row.rank) ? Math.max(1, Math.trunc(row.rank)) : idx + 1,
        score: Math.max(0, Math.trunc(row.score)),
      }))
      .slice(0, 10);

    const ranked = [
      ...serverRows,
      {
        rank: Number.MAX_SAFE_INTEGER,
        score: Math.max(0, Math.trunc(Number(pendingRankEntry.score || 0))),
        isCandidate: true,
      },
    ]
      .filter((row) => row.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.isCandidate && !b.isCandidate) return 1;
        if (!a.isCandidate && b.isCandidate) return -1;
        return a.rank - b.rank;
      })
      .slice(0, 10);

    const foundIdx = ranked.findIndex((row) => row.isCandidate);
    return foundIdx >= 0 ? foundIdx + 1 : null;
  }, [leaderboard, pendingRankEntry]);

  const isPendingTop3 = pendingEntryRank != null && pendingEntryRank <= 3;

  const bestCommentModalTitle = useMemo(
    () =>
      isPendingTop3 && pendingEntryRank != null
        ? t("dino.rank_top3_title", { rank: pendingEntryRank })
        : newBestScore != null
        ? t("dino.new_best_title")
        : t("dino.rank_comment_title"),
    [isPendingTop3, newBestScore, pendingEntryRank, t]
  );
  const bestCommentModalDesc = useMemo(
    () => (isPendingTop3 ? t("dino.rank_top3_desc") : newBestScore != null ? t("dino.new_best_desc") : t("dino.rank_comment_desc")),
    [isPendingTop3, newBestScore, t]
  );
  const bestCommentInputHint = useMemo(() => t("dino.best_comment_input_hint"), [t]);

  const top3Rows = useMemo<RankRow[]>(() => {
    const byRank = new Map<number, DinoLeaderboardEntry>(leaderboard.map((row) => [row.rank, row]));
    return [1, 2, 3].map((rank) => byRank.get(rank) ?? { rank, score: 0, flag: "", comment: "", isEmpty: true });
  }, [leaderboard]);

  const rows4to10 = useMemo<RankRow[]>(() => {
    const byRank = new Map<number, DinoLeaderboardEntry>(leaderboard.map((row) => [row.rank, row]));
    return [4, 5, 6, 7, 8, 9, 10].map((rank) => byRank.get(rank) ?? { rank, score: 0, flag: "", comment: "", isEmpty: true });
  }, [leaderboard]);
  const bridgeTop = useMemo(() => {
    const bridgeBottom = playHeight - (DINO_HEIGHT + MAX_JUMP_HEIGHT) - 14;
    const topByJump = Math.floor(bridgeBottom - BRIDGE_TOTAL_HEIGHT);
    return Math.max(8, Math.min(playHeight - BRIDGE_TOTAL_HEIGHT - 18, topByJump));
  }, [playHeight]);
  const bridgePillarXList = useMemo(() => {
    if (layoutW <= 0) return [];
    const count = Math.max(6, Math.ceil(layoutW / BRIDGE_STRIDE) + 2);
    return Array.from({ length: count }, (_, idx) => idx * BRIDGE_STRIDE - BRIDGE_STRIDE);
  }, [layoutW]);
  const bridgeMotion = useMemo(() => bridgeOffset % BRIDGE_STRIDE, [bridgeOffset]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}> 
      <View style={styles.scoreRow}>
        <AppText style={styles.scoreText}>{t("dino.score")} {score}</AppText>
        <AppText style={styles.scoreText}>{t("dino.best")} {best}</AppText>
      </View>

      <View style={styles.rankTopWrap}>
        {top3Rows.map((row, idx) => (
          <View key={`top-${row.rank}-${idx}`} style={[styles.rankRow, idx === 0 ? styles.rankRowFirst : null]}>
            <View style={styles.rankRowLeft}>
              <View
                style={[
                  styles.rankMedalBadge,
                  idx === 0 ? styles.rankMedalGold : idx === 1 ? styles.rankMedalSilver : styles.rankMedalBronze,
                ]}
              >
                <AppText style={styles.rankMedalText}>{idx + 1}</AppText>
              </View>
              <AppText style={styles.rankFlag}>{row.flag || "🏳️"}</AppText>
              <AppText style={styles.rankComment} numberOfLines={1}>
                {row.comment || "-"}
              </AppText>
            </View>
            <AppText style={[styles.rankScore, idx === 0 ? styles.rankScoreFirst : null]}>
              {row.isEmpty ? "-" : row.score}
            </AppText>
          </View>
        ))}

        {!leaderboardLoading && top3Rows.length === 0 ? (
          <AppText style={styles.rankEmpty}>{t("dino.rank_empty")}</AppText>
        ) : null}
      </View>

      {state === "gameover" ? (
        <View style={styles.rankMoreWrap}>
          {rows4to10.map((row, idx) => (
            <View key={`more-${row.rank}-${idx}`} style={styles.rankMoreRow}>
              <View style={styles.rankRowLeft}>
                <AppText style={styles.rankNum}>{`#${row.rank}`}</AppText>
                <AppText style={styles.rankFlag}>{row.flag || "🏳️"}</AppText>
                <AppText style={styles.rankComment} numberOfLines={1}>
                  {row.comment || "-"}
                </AppText>
              </View>
              <AppText style={styles.rankScore}>{row.isEmpty ? "-" : row.score}</AppText>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        style={styles.gameWrap}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setLayoutW(width);
          setLayoutH(height);
        }}
        onPress={onPressGameArea}
      >
        <View style={styles.sky} />
        <View style={styles.skyGlow} />

        {clouds.map((cloud) => (
          <View
            key={`cloud-${cloud.id}`}
            style={[
              styles.cloudWrap,
              {
                left: cloud.x,
                top: cloud.y,
                width: Math.round(cloud.size * 1.62),
                height: Math.round(cloud.size * 0.94),
              },
            ]}
          >
            <View style={styles.cloudShadow} />
            <View style={[styles.cloudBase, { width: cloud.size * 1.18, height: cloud.size * 0.42, left: cloud.size * 0.22 }]} />
            <View style={[styles.cloudPuff, styles.cloudPuffLeft, { width: cloud.size * 0.56, height: cloud.size * 0.56 }]} />
            <View style={[styles.cloudPuff, styles.cloudPuffMid, { width: cloud.size * 0.78, height: cloud.size * 0.78 }]} />
            <View style={[styles.cloudPuff, styles.cloudPuffRight, { width: cloud.size * 0.52, height: cloud.size * 0.52 }]} />
            <View style={[styles.cloudPuff, styles.cloudPuffTop, { width: cloud.size * 0.4, height: cloud.size * 0.4 }]} />
            <View style={[styles.cloudPuff, styles.cloudPuffTail, { width: cloud.size * 0.34, height: cloud.size * 0.34 }]} />
          </View>
        ))}

        {buildings.map((building) => (
          <View
            key={`building-${building.id}`}
            style={[
              styles.buildingBody,
              {
                left: building.x,
                width: building.width,
                height: building.height,
                top: bridgeTop - building.height + 1,
                backgroundColor: building.color,
              },
            ]}
          >
            <View style={styles.buildingRoof} />
            <View style={styles.buildingRoofEdge} />
            <View style={styles.buildingWindows}>
              {Array.from({ length: building.rows }).map((_, rIdx) => (
                <View key={`brow-${building.id}-${rIdx}`} style={styles.buildingWindowRow}>
                  {Array.from({ length: building.cols }).map((_, cIdx) => {
                    const lit = ((building.seed + rIdx * 13 + cIdx * 19) % 5) !== 0;
                    return (
                      <View
                        key={`bwin-${building.id}-${rIdx}-${cIdx}`}
                        style={[styles.buildingWindow, lit ? styles.buildingWindowLit : styles.buildingWindowDim]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        ))}
        <View style={[styles.bridgeWrap, { top: bridgeTop }]}>
          <View style={styles.bridgeRail} />
          <View style={styles.bridgeDeckTop} />
          <View style={styles.bridgeDeckBody} />
          {bridgePillarXList.map((left, idx) => (
            <View key={`bridge-seam-${idx}`} style={[styles.bridgeSeam, { left: left - bridgeMotion + 8 }]} />
          ))}
          {bridgePillarXList.map((left, idx) => (
            <View key={`bridge-pillar-${idx}`} style={[styles.bridgePillar, { left: left - bridgeMotion + 12 }]} />
          ))}
        </View>

        <View
          style={[
            styles.dinoHitbox,
            {
              left: DINO_X,
              top: playHeight - DINO_HEIGHT - dinoBottom,
            },
          ]}
        >
          <View style={styles.girlSpriteViewport}>
            <Image
              source={DINO_GIRL_FRAMES[spriteFrame] ?? DINO_GIRL_FRAMES[IDLE_FRAME]}
              style={styles.girlSpriteFrame}
              resizeMode="contain"
              fadeDuration={0}
            />
          </View>
        </View>

        {obstacles.map((o) => (
          <Image
            key={o.id}
            source={OBSTACLE_CONFIGS[o.kind].source}
            style={[
              styles.obstacleImage,
              {
                left: o.x,
                width: o.width,
                height: o.height,
                top: playHeight - o.height,
              },
            ]}
            resizeMode="contain"
            fadeDuration={0}
          />
        ))}

        <View style={[styles.ground, { top: playHeight }]} />

        {impactPoint ? (
          <>
            <Animated.View pointerEvents="none" style={[styles.impactFlash, { opacity: impactFlashOpacity }]} />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.impactBurst,
                {
                  left: impactPoint.x - 26,
                  top: impactPoint.y - 26,
                  opacity: impactBurstOpacity,
                  transform: [{ scale: impactBurstScale }],
                },
              ]}
            />
          </>
        ) : null}

        {state !== "running" ? (
          <View style={styles.overlay}>
            <AppText style={styles.overlayTitle}>{state === "gameover" ? t("dino.game_over") : t("dino.title")}</AppText>
            <AppText style={styles.overlaySub}>
              {state === "gameover" ? t("dino.tap_restart") : t("dino.tap_start_jump")}
            </AppText>
          </View>
        ) : null}
      </Pressable>

      <AppModal
        visible={bestCommentModalVisible}
        dismissible={false}
        title={bestCommentModalTitle}
        onClose={skipBestComment}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("dino.best_comment_save")} onPress={saveBestComment} disabled={rankSubmitting} />
            <PrimaryButton title={t("dino.best_comment_skip")} onPress={skipBestComment} variant="ghost" disabled={rankSubmitting} />
          </View>
        }
      >
        <AppText style={styles.bestModalDesc}>{bestCommentModalDesc}</AppText>
        <AppText style={styles.bestModalScore}>
          {t("dino.score")} {newBestScore ?? score}
        </AppText>
        <View style={styles.bestCommentInputWrap}>
          <TextInput
            value={bestCommentDraft}
            onChangeText={setBestCommentDraft}
            placeholder={bestCommentInputHint}
            placeholderTextColor="#9b9b9b"
            maxLength={60}
            style={styles.bestCommentInput}
            returnKeyType="done"
            blurOnSubmit={true}
            onFocus={() => {
              if (bestCommentDraft === bestCommentInputHint) {
                setBestCommentDraft("");
              }
            }}
            onSubmitEditing={saveBestComment}
          />
        </View>
        <AppText style={styles.bestCommentCount}>{normalizedBestComment.length}/60</AppText>
      </AppModal>

      <AppModal visible={matchedModalVisible} dismissible={false} title={t("dino.matched_title")}>
        <AppText style={styles.bestModalDesc}>{t("dino.matched_desc", { seconds: matchedCountdown })}</AppText>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  scoreRow: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
  },
  scoreText: {
    fontSize: 13,
    color: "#3a3a3a",
    fontWeight: "800",
  },
  rankTopWrap: {
    marginBottom: 8,
    gap: 6,
  },
  rankRow: {
    minHeight: 28,
    borderWidth: 1,
    borderColor: "#ececec",
    borderRadius: 10,
    backgroundColor: "#fafafa",
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rankRowFirst: {
    borderColor: "#ff95c6",
    backgroundColor: "#fff4fa",
  },
  rankRowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  rankNum: {
    width: 28,
    fontSize: 12,
    color: "#7a7a7a",
    fontWeight: "800",
  },
  rankNumFirst: {
    color: "#e64996",
    fontSize: 13,
  },
  rankMedalBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ffffff",
  },
  rankMedalGold: {
    backgroundColor: "#f6c343",
  },
  rankMedalSilver: {
    backgroundColor: "#c5ced8",
  },
  rankMedalBronze: {
    backgroundColor: "#cd8f58",
  },
  rankMedalText: {
    fontSize: 10,
    color: "#fff",
    fontWeight: "900",
    lineHeight: 12,
  },
  rankFlag: {
    fontSize: 14,
  },
  rankComment: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    color: "#4a4a4a",
    fontWeight: "600",
  },
  rankScore: {
    fontSize: 12,
    color: "#3a3a3a",
    fontWeight: "900",
    marginLeft: 8,
  },
  rankScoreFirst: {
    color: "#d63384",
    fontSize: 13,
  },
  rankEmpty: {
    fontSize: 12,
    color: "#999",
    textAlign: "center",
    paddingVertical: 2,
  },
  rankMoreWrap: {
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#ececec",
    borderRadius: 10,
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  rankMoreRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  gameWrap: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ececec",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  sky: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#f9fbff",
  },
  skyGlow: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "46%",
    backgroundColor: "rgba(220,236,255,0.28)",
  },
  bridgeWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 58,
  },
  bridgeRail: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 6,
    backgroundColor: "#90a4bf",
  },
  bridgeDeckTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 6,
    height: 8,
    backgroundColor: "#b9c7dc",
  },
  bridgeDeckBody: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 14,
    height: 30,
    backgroundColor: "#9cacbf",
    borderTopWidth: 1,
    borderTopColor: "#cfd8e8",
  },
  bridgeSeam: {
    position: "absolute",
    top: 16,
    width: 2,
    height: 22,
    borderRadius: 1,
    backgroundColor: "rgba(124,141,164,0.6)",
  },
  bridgePillar: {
    position: "absolute",
    top: 18,
    width: 8,
    height: 34,
    marginLeft: -4,
    borderRadius: 2,
    backgroundColor: "#8498b4",
  },
  cloudWrap: {
    position: "absolute",
    opacity: 0.97,
  },
  cloudShadow: {
    position: "absolute",
    left: "18%",
    right: "14%",
    bottom: 3,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(186,201,223,0.34)",
  },
  cloudBase: {
    position: "absolute",
    top: "42%",
    borderRadius: 999,
    backgroundColor: "rgba(251,253,255,0.96)",
    borderWidth: 1,
    borderColor: "#dbe5f3",
  },
  cloudPuff: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dce7f5",
    shadowColor: "#b6c8e3",
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  cloudPuffLeft: {
    left: 0,
    bottom: 4,
  },
  cloudPuffMid: {
    left: "31%",
    bottom: 10,
  },
  cloudPuffRight: {
    right: 0,
    bottom: 5,
  },
  cloudPuffTop: {
    left: "56%",
    top: 1,
  },
  cloudPuffTail: {
    left: "14%",
    top: 10,
  },
  buildingBody: {
    position: "absolute",
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderColor: "#d4dae6",
    justifyContent: "flex-start",
    overflow: "hidden",
  },
  buildingRoof: {
    height: 4,
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  buildingRoofEdge: {
    height: 2,
    width: "100%",
    backgroundColor: "rgba(184,196,216,0.58)",
  },
  buildingWindows: {
    flex: 1,
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 3,
  },
  buildingWindowRow: {
    flex: 1,
    flexDirection: "row",
    gap: 3,
  },
  buildingWindow: {
    flex: 1,
    borderRadius: 2,
    borderWidth: 1,
  },
  buildingWindowLit: {
    backgroundColor: "#fef7d4",
    borderColor: "rgba(238,224,165,0.95)",
  },
  buildingWindowDim: {
    backgroundColor: "rgba(160,175,197,0.45)",
    borderColor: "rgba(147,164,188,0.65)",
  },
  dinoHitbox: {
    position: "absolute",
    width: DINO_WIDTH,
    height: DINO_HEIGHT,
  },
  girlSpriteViewport: {
    position: "absolute",
    left: SPRITE_OFFSET_X,
    bottom: -SPRITE_BOTTOM_INSET,
    width: SPRITE_RENDER_WIDTH,
    height: SPRITE_RENDER_HEIGHT,
    overflow: "hidden",
  },
  girlSpriteFrame: {
    position: "absolute",
    left: 0,
    top: 0,
    width: SPRITE_RENDER_WIDTH,
    height: SPRITE_RENDER_HEIGHT,
  },
  obstacleImage: {
    position: "absolute",
  },
  ground: {
    position: "absolute",
    left: 0,
    right: 0,
    height: GROUND_HEIGHT,
    borderTopWidth: 2,
    borderTopColor: "#dcdcdc",
    backgroundColor: "#fff",
  },
  impactFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#ff4d5d",
    zIndex: 7,
  },
  impactBurst: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: "#ff2f42",
    backgroundColor: "rgba(255,255,255,0.28)",
    zIndex: 8,
  },
  bestModalDesc: {
    width: "100%",
    fontSize: 14,
    color: theme.colors.sub,
    textAlign: "center",
    lineHeight: 20,
  },
  bestModalScore: {
    width: "100%",
    marginTop: 2,
    fontSize: 15,
    color: theme.colors.text,
    textAlign: "center",
    fontWeight: "800",
  },
  bestCommentInputWrap: {
    width: "100%",
    marginTop: 10,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 12,
    backgroundColor: theme.colors.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bestCommentInput: {
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: "600",
    padding: 0,
  },
  bestCommentCount: {
    width: "100%",
    marginTop: 2,
    fontSize: 11,
    color: theme.colors.sub,
    textAlign: "right",
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 130,
    backgroundColor: "rgba(255,255,255,0.22)",
    zIndex: 5,
  },
  overlayTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#2e2e2e",
  },
  overlaySub: {
    marginTop: 8,
    fontSize: 14,
    color: theme.colors.sub,
    fontWeight: "700",
  },
});
