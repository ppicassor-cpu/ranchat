import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppText from "../components/AppText";
import { theme } from "../config/theme";
import { useTranslation } from "../i18n/LanguageProvider";

type GameState = "idle" | "running" | "gameover";

type Obstacle = {
  id: number;
  x: number;
  width: number;
  height: number;
  scored: boolean;
};

const DINO_WIDTH = 42;
const DINO_HEIGHT = 46;
const DINO_X = 44;
const GROUND_HEIGHT = 46;

const GRAVITY = 2100;
const JUMP_VELOCITY = 760;
const BASE_SPEED = 290;
const SPEED_GROWTH_PER_SEC = 8;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export default function DinoScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [layoutW, setLayoutW] = useState(0);
  const [layoutH, setLayoutH] = useState(0);

  const [state, setState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [dinoBottom, setDinoBottom] = useState(0);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);

  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);
  const obstacleIdRef = useRef(1);
  const velRef = useRef(0);
  const speedRef = useRef(BASE_SPEED);
  const spawnInRef = useRef(1.2);
  const scoreRef = useRef(0);
  const dinoBottomRef = useRef(0);
  const obstaclesRef = useRef<Obstacle[]>([]);

  const canRun = layoutW > 0 && layoutH > 0;
  const playHeight = useMemo(() => Math.max(120, layoutH - GROUND_HEIGHT), [layoutH]);

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const resetWorld = useCallback(() => {
    velRef.current = 0;
    speedRef.current = BASE_SPEED;
    spawnInRef.current = 1.1;
    scoreRef.current = 0;
    dinoBottomRef.current = 0;
    obstaclesRef.current = [];
    setScore(0);
    setDinoBottom(0);
    setObstacles([]);
  }, []);

  const finishGame = useCallback(() => {
    stopLoop();
    setState("gameover");
    const finalScore = Math.floor(scoreRef.current);
    setBest((prev) => (finalScore > prev ? finalScore : prev));
  }, [stopLoop]);

  const spawnObstacle = useCallback(() => {
    if (!layoutW) return;
    const height = 32 + Math.floor(Math.random() * 34);
    const width = 20 + Math.floor(Math.random() * 18);
    const next: Obstacle = {
      id: obstacleIdRef.current++,
      x: layoutW + 10,
      width,
      height,
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

      velRef.current -= GRAVITY * dt;
      dinoBottomRef.current += velRef.current * dt;
      if (dinoBottomRef.current <= 0) {
        dinoBottomRef.current = 0;
        velRef.current = 0;
      }
      setDinoBottom(dinoBottomRef.current);

      spawnInRef.current -= dt;
      if (spawnInRef.current <= 0) {
        spawnObstacle();
        spawnInRef.current = 0.95 + Math.random() * 0.85;
      }

      const moved = obstaclesRef.current
        .map((o) => ({ ...o, x: o.x - speedRef.current * dt }))
        .filter((o) => o.x + o.width > -8);

      const dinoTop = playHeight - DINO_HEIGHT - dinoBottomRef.current;
      const dinoBottomY = dinoTop + DINO_HEIGHT;
      const dinoLeft = DINO_X;
      const dinoRight = DINO_X + DINO_WIDTH;

      let collided = false;
      const scoredObstacles = moved.map((o) => {
        const oTop = playHeight - o.height;
        const oBottom = playHeight;
        const oLeft = o.x;
        const oRight = o.x + o.width;

        const overlapX = dinoRight > oLeft && dinoLeft < oRight;
        const overlapY = dinoBottomY > oTop && dinoTop < oBottom;
        if (overlapX && overlapY) collided = true;

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
        finishGame();
        return;
      }

      rafRef.current = requestAnimationFrame(frame);
    },
    [canRun, finishGame, playHeight, spawnObstacle, state]
  );

  useEffect(() => {
    if (state !== "running") {
      stopLoop();
      return;
    }
    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(frame);
    return stopLoop;
  }, [frame, state, stopLoop]);

  useEffect(() => stopLoop, [stopLoop]);

  const jump = useCallback(() => {
    if (state !== "running") return;
    if (dinoBottomRef.current > 2) return;
    velRef.current = JUMP_VELOCITY;
  }, [state]);

  const startGame = useCallback(() => {
    if (!canRun) return;
    resetWorld();
    setState("running");
  }, [canRun, resetWorld]);

  const onPressGameArea = useCallback(() => {
    if (state === "running") {
      jump();
      return;
    }
    startGame();
  }, [jump, startGame, state]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.scoreRow}>
        <AppText style={styles.scoreText}>{t("dino.score")} {score}</AppText>
        <AppText style={styles.scoreText}>{t("dino.best")} {best}</AppText>
      </View>

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

        <View
          style={[
            styles.dino,
            {
              left: DINO_X,
              top: playHeight - DINO_HEIGHT - dinoBottom,
            },
          ]}
        />

        {obstacles.map((o) => (
          <View
            key={o.id}
            style={[
              styles.cactus,
              {
                left: o.x,
                width: o.width,
                height: o.height,
                top: playHeight - o.height,
              },
            ]}
          />
        ))}

        <View style={[styles.ground, { top: playHeight }]} />

        {state !== "running" ? (
          <View style={styles.overlay}>
            <AppText style={styles.overlayTitle}>{state === "gameover" ? t("dino.game_over") : t("dino.title")}</AppText>
            <AppText style={styles.overlaySub}>
              {state === "gameover" ? t("dino.tap_restart") : t("dino.tap_start_jump")}
            </AppText>
          </View>
        ) : null}
      </Pressable>
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
  gameWrap: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#f9f9f9",
  },
  sky: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fcfcfc",
  },
  dino: {
    position: "absolute",
    width: DINO_WIDTH,
    height: DINO_HEIGHT,
    backgroundColor: "#444",
    borderRadius: 6,
  },
  cactus: {
    position: "absolute",
    backgroundColor: "#3f6f42",
    borderRadius: 3,
  },
  ground: {
    position: "absolute",
    left: 0,
    right: 0,
    height: GROUND_HEIGHT,
    borderTopWidth: 2,
    borderTopColor: "#d7d7d7",
    backgroundColor: "#f0f0f0",
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.28)",
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
