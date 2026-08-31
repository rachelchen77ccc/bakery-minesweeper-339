"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  MATCH_DIFFICULTIES,
  MATCH_ICON_FILES,
  MATCH_ICON_LABELS,
  MATCH_LEVEL_COUNT,
  captionForLevel,
  getMatchLevelRule,
  emptyMatchBoard,
  generateMatchBoard,
  hasAnyValidMove,
  neighborsOf,
  tierIndexForLevel,
  tierList,
  type GoalRule,
  type MatchBoard,
  type MatchDifficulty,
  type MatchIconId,
  type MatchLevelRule,
} from "./matchLevels";
import {
  allGoalsDone,
  countInitialObstacles,
  detonateArea,
  goalStatus,
  peekSwap,
  powerShuffleBoard,
  resolveStep,
  shuffleBoard,
  type MatchProgress,
} from "./matchEngine";
import { useGameAudio } from "./useGameAudio";

const ASSET_ROOT = "assets";
const asset = (name: string) => `${ASSET_ROOT}/${name}.webp`;

const LEGACY_UNLOCKED_KEY = "bakery-match-unlocked";
const UNLOCKED_KEY_BY_DIFFICULTY: Record<MatchDifficulty, string> = {
  easy: "bakery-match-unlocked-easy",
  normal: "bakery-match-unlocked-normal",
  hard: "bakery-match-unlocked-hard",
};
const TIER_DIFFICULTY_KEY = "bakery-match-tier-difficulty";
const LAST_LEVEL_KEY = "bakery-match-last-level";
const TUTORIAL_KEY = "bakery-match-tutorial-v1-complete";
const TIER_COUNT = tierList().length;
const DEFAULT_TIER_DIFFICULTY: MatchDifficulty[] = Array.from({ length: TIER_COUNT }, () => "normal");

function isMatchDifficulty(value: unknown): value is MatchDifficulty {
  return MATCH_DIFFICULTIES.some((entry) => entry.id === value);
}

const STAGE_INTRO: { name: string; text: string }[] = [
  { name: "甜蜜启程", text: "小顾：欢迎来到甜蜜启程，跟着节奏慢慢来，我们会一直陪着你。" },
  { name: "双人协作", text: "小温：接下来是双人协作，小顾和小温消除的时候得分是一样多的，而且比牛角包、面包、339 都高——两个人的分量，谁都不比谁轻。" },
  { name: "五味俱全", text: "339：五味俱全阶段，五种口味全部登场，棋盘也会更花，看清楚再交换。" },
  { name: "层层用心", text: "小顾：层层用心开始了，奶油冻变多了，得多留意哪里该优先清理。" },
  { name: "烘焙大师", text: "小温：烘焙大师阶段，两个目标常常要一起追，节奏要抓得比之前更紧。" },
  { name: "终极告白", text: "339：终极告白，这是最后一段路，339 会陪着你们走到第 339 关。" },
];

type MatchStatus = "playing" | "won" | "failed";
type MatchTutorialStep = 0 | 1 | 2 | 3 | null;
type ToolCounts = { reshuffle: number; bomb: number; extend: number };
const EXTEND_MOVES_AMOUNT = 5;
const BOMB_RADIUS = 1;

const TOOL_BUDGET_BY_TIER: ToolCounts[] = [
  { reshuffle: 2, bomb: 3, extend: 2 },
  { reshuffle: 2, bomb: 3, extend: 2 },
  { reshuffle: 1, bomb: 2, extend: 1 },
  { reshuffle: 1, bomb: 2, extend: 1 },
  { reshuffle: 1, bomb: 1, extend: 1 },
  { reshuffle: 0, bomb: 1, extend: 1 },
];

function toolBudgetFor(rule: MatchLevelRule) {
  return { ...TOOL_BUDGET_BY_TIER[rule.tierIndex] };
}

function emptyProgress(obstaclesTotal: number): MatchProgress {
  return { collected: {}, obstaclesTotal, obstaclesCleared: 0, score: 0 };
}

function mergeCollect(progress: MatchProgress, gain: Partial<Record<MatchIconId, number>>) {
  const next = { ...progress.collected };
  (Object.keys(gain) as unknown as MatchIconId[]).forEach((icon) => {
    next[icon] = (next[icon] ?? 0) + (gain[icon] ?? 0);
  });
  return next;
}

function buildTutorialBoard(): MatchBoard {
  const layout = [
    [3, 4, 3, 4, 3],
    [4, 3, 4, 3, 4],
    [0, 0, 1, 0, 2],
    [4, 3, 4, 3, 4],
    [3, 4, 3, 4, 3],
  ];
  const cells = layout.flat().map((icon) => ({ active: true, icon: icon as MatchIconId, cover: 0 as const, special: null }));
  return { width: 5, height: 5, cells, iconPool: [0, 1, 2, 3, 4] };
}

const TUTORIAL_FIRST = 12;
const TUTORIAL_SECOND = 13;

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
}

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

const nextFrame = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

function swapOffset(a: number, b: number, width: number) {
  const rowA = Math.floor(a / width);
  const colA = a % width;
  const rowB = Math.floor(b / width);
  const colB = b % width;
  return { dx: colB - colA, dy: rowB - rowA };
}

type CascadeTotals = { collectGain: Partial<Record<MatchIconId, number>>; obstacleCleared: number; scoreGain: number; specialsCreated: number };

function mergeIntoTotals(totals: CascadeTotals, gain: CascadeTotals) {
  (Object.keys(gain.collectGain) as unknown as MatchIconId[]).forEach((icon) => {
    totals.collectGain[icon] = (totals.collectGain[icon] ?? 0) + (gain.collectGain[icon] ?? 0);
  });
  totals.obstacleCleared += gain.obstacleCleared;
  totals.scoreGain += gain.scoreGain;
  totals.specialsCreated += gain.specialsCreated;
}

function goalLabel(goal: GoalRule) {
  if (goal.type === "collect") return MATCH_ICON_LABELS[goal.icon];
  if (goal.type === "clearObstacles") return "清除障碍格";
  return "累计分数";
}

export function MatchGame({ onBack }: { onBack: () => void }) {
  const [levelIndex, setLevelIndex] = useState(0);
  const [tierDifficulty, setTierDifficulty] = useState<MatchDifficulty[]>(DEFAULT_TIER_DIFFICULTY);
  const [unlockedByDifficulty, setUnlockedByDifficulty] = useState<Record<MatchDifficulty, number>>({ easy: 1, normal: 1, hard: 1 });
  const rule = useMemo(
    () => getMatchLevelRule(levelIndex, tierDifficulty[tierIndexForLevel(levelIndex)] ?? "normal"),
    [levelIndex, tierDifficulty],
  );
  const [board, setBoard] = useState<MatchBoard>(() => emptyMatchBoard(getMatchLevelRule(0)));
  const [progress, setProgress] = useState<MatchProgress>(() => emptyProgress(0));
  const [movesUsed, setMovesUsed] = useState(0);
  const [bonusMoves, setBonusMoves] = useState(0);
  const [status, setStatus] = useState<MatchStatus>("playing");
  const [selected, setSelected] = useState<number | null>(null);
  const [toolsLeft, setToolsLeft] = useState<ToolCounts>(() => toolBudgetFor(getMatchLevelRule(0)));
  const [bombArmed, setBombArmed] = useState(false);
  const [shaking, setShaking] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [slidePair, setSlidePair] = useState<{ a: number; b: number; dx: number; dy: number } | null>(null);
  const [clearingCells, setClearingCells] = useState<Set<number>>(new Set());
  const [sweptCells, setSweptCells] = useState<Set<number>>(new Set());
  const [fallingCells, setFallingCells] = useState<Map<number, number>>(new Map());
  const [shuffleFx, setShuffleFx] = useState(false);
  const [message, setMessage] = useState("小顾：一起把棋盘收拾整齐吧，先点一个格子看看。");
  const [showHelp, setShowHelp] = useState(false);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<MatchTutorialStep>(null);
  const [tutorialReady, setTutorialReady] = useState(false);
  const [stageIntroTier, setStageIntroTier] = useState<number | null>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTierRef = useRef<number | null>(null);
  const { musicEnabled, playSfx, setMusicEnabled, setSfxEnabled, sfxEnabled, unlockAudio } = useGameAudio(false);

  const loadLevel = useCallback((index: number, tierDifficultyOverride?: MatchDifficulty[]) => {
    const difficultyTable = tierDifficultyOverride ?? tierDifficulty;
    const nextTierIndex = tierIndexForLevel(index);
    const difficulty = difficultyTable[nextTierIndex] ?? "normal";
    const nextRule = getMatchLevelRule(index, difficulty);
    const nextBoard = generateMatchBoard(nextRule);
    setLevelIndex(index);
    setBoard(nextBoard);
    setProgress(emptyProgress(countInitialObstacles(nextBoard)));
    setMovesUsed(0);
    setBonusMoves(0);
    setStatus("playing");
    setSelected(null);
    setBombArmed(false);
    setToolsLeft(toolBudgetFor(nextRule));
    setMessage(captionForLevel(index));
    setBoardLoaded(true);
    window.localStorage.setItem(LAST_LEVEL_KEY, String(index));
    if (lastTierRef.current !== null && lastTierRef.current !== nextTierIndex) {
      setStageIntroTier(nextTierIndex);
    }
    lastTierRef.current = nextTierIndex;
  }, [tierDifficulty]);

  const setTierDifficultyAt = (tierIndex: number, difficulty: MatchDifficulty) => {
    setTierDifficulty((current) => {
      if (current[tierIndex] === difficulty) return current;
      const next = [...current];
      next[tierIndex] = difficulty;
      window.localStorage.setItem(TIER_DIFFICULTY_KEY, JSON.stringify(next));
      return next;
    });
    playSfx("click");
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let loadedTierDifficulty = DEFAULT_TIER_DIFFICULTY;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(TIER_DIFFICULTY_KEY) || "null");
        if (Array.isArray(parsed) && parsed.length === TIER_COUNT && parsed.every(isMatchDifficulty)) {
          loadedTierDifficulty = parsed;
        }
      } catch {
        loadedTierDifficulty = DEFAULT_TIER_DIFFICULTY;
      }
      setTierDifficulty(loadedTierDifficulty);

      const legacyUnlocked = Math.max(0, Number(window.localStorage.getItem(LEGACY_UNLOCKED_KEY) || 0));
      const nextUnlocked: Record<MatchDifficulty, number> = { easy: 1, normal: 1, hard: 1 };
      (Object.keys(UNLOCKED_KEY_BY_DIFFICULTY) as MatchDifficulty[]).forEach((difficulty) => {
        const raw = window.localStorage.getItem(UNLOCKED_KEY_BY_DIFFICULTY[difficulty]);
        if (raw) {
          nextUnlocked[difficulty] = Math.min(MATCH_LEVEL_COUNT, Math.max(1, Number(raw)));
        } else if (difficulty === "normal" && legacyUnlocked > 0) {
          nextUnlocked[difficulty] = Math.min(MATCH_LEVEL_COUNT, Math.max(1, legacyUnlocked));
        }
      });
      setUnlockedByDifficulty(nextUnlocked);

      const savedLastRaw = Math.max(0, Number(window.localStorage.getItem(LAST_LEVEL_KEY) || 0));
      const lastDifficulty = loadedTierDifficulty[tierIndexForLevel(savedLastRaw)] ?? "normal";
      const savedLast = Math.min(nextUnlocked[lastDifficulty] - 1, savedLastRaw);

      if (!window.localStorage.getItem(TUTORIAL_KEY)) {
        setTutorialStep(0);
        loadLevel(0, loadedTierDifficulty);
      } else {
        loadLevel(savedLast, loadedTierDifficulty);
        setShowLevelPicker(true);
      }
      setTutorialReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
  }, []);

  const flashShake = (indexes: number[]) => {
    setShaking(new Set(indexes));
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShaking(new Set()), 260);
  };

  const finishTutorial = () => {
    window.localStorage.setItem(TUTORIAL_KEY, "1");
    setTutorialStep(null);
    loadLevel(0);
    playSfx("click");
  };

  const startTutorial = () => {
    setBoard(buildTutorialBoard());
    setSelected(null);
    setTutorialStep(1);
    playSfx("click");
  };

  const applyTotals = useCallback((totals: CascadeTotals) => {
    if (!totals.scoreGain && !totals.obstacleCleared && Object.keys(totals.collectGain).length === 0) return;
    setProgress((current) => ({
      collected: mergeCollect(current, totals.collectGain),
      obstaclesTotal: current.obstaclesTotal,
      obstaclesCleared: Math.min(current.obstaclesTotal, current.obstaclesCleared + totals.obstacleCleared),
      score: current.score + totals.scoreGain,
    }));
  }, []);

  const runCascade = useCallback(async (
    startBoard: MatchBoard,
    triggers: number[],
    pivot: number | null,
    seed?: CascadeTotals,
  ) => {
    const totals: CascadeTotals = seed
      ? { ...seed, collectGain: { ...seed.collectGain } }
      : { collectGain: {}, obstacleCleared: 0, scoreGain: 0, specialsCreated: 0 };
    let current = startBoard;
    let pendingTriggers = triggers;
    let pendingPivot = pivot;
    let iterations = 0;
    while (iterations < 30) {
      iterations += 1;
      const step = resolveStep(current, pendingTriggers, pendingPivot);
      pendingTriggers = [];
      pendingPivot = null;
      if (step.stable) break;
      setClearingCells(step.clearedIndexes);
      setSweptCells(step.sweptIndexes);
      playSfx(step.specialsCreated > 0 ? "flag" : "reveal");
      vibrate(step.specialsCreated > 0 ? [18, 18, 18] : 20);
      await wait(150);
      setBoard(step.board);
      setClearingCells(new Set());
      setSweptCells(new Set());
      setFallingCells(step.fallOffsets);
      await nextFrame();
      setFallingCells(new Map());
      mergeIntoTotals(totals, { collectGain: step.collectGain, obstacleCleared: step.obstacleCleared, scoreGain: step.scoreGain, specialsCreated: step.specialsCreated });
      current = step.board;
      await wait(step.fallOffsets.size > 0 ? 220 : 100);
    }
    applyTotals(totals);
    return current;
  }, [applyTotals, playSfx, rule.tileTypes]);

  const triggerAutoReshuffle = useCallback(async (currentBoard: MatchBoard) => {
    setBusy(true);
    setMessage("339：棋盘卡住了，已经自动帮你重新排列（不消耗次数）。");
    playSfx("help");
    setShuffleFx(true);
    await wait(180);
    setBoard(shuffleBoard(currentBoard));
    setShuffleFx(false);
    setBusy(false);
  }, [playSfx, rule.tileTypes]);

  useEffect(() => {
    if (!boardLoaded || busy || tutorialStep !== null || status !== "playing") return;
    const done = allGoalsDone(rule.goals, progress);
    if (done) {
      setStatus("won");
      playSfx("win");
      vibrate([45, 35, 45, 35, 80]);
      setUnlockedByDifficulty((current) => {
        const nextForDifficulty = Math.min(MATCH_LEVEL_COUNT, Math.max(current[rule.difficulty], levelIndex + 2));
        if (nextForDifficulty === current[rule.difficulty]) return current;
        window.localStorage.setItem(UNLOCKED_KEY_BY_DIFFICULTY[rule.difficulty], String(nextForDifficulty));
        return { ...current, [rule.difficulty]: nextForDifficulty };
      });
      setMessage("339：这一盘完成了！小顾和小温都在为你鼓掌。");
      return;
    }
    if (movesUsed >= rule.moveLimit + bonusMoves) {
      setStatus("failed");
      playSfx("lose");
      vibrate([100, 55, 140]);
      setMessage("339：步数用完了，目标还没达成，重开再试一次吧。");
      return;
    }
    if (!hasAnyValidMove(board)) void triggerAutoReshuffle(board);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, boardLoaded, bonusMoves, busy, movesUsed, progress, rule, status, tutorialStep]);

  const trySwap = useCallback(async (a: number, b: number) => {
    const peek = peekSwap(board, a, b);
    if (!peek.valid) {
      flashShake([a, b]);
      playSfx("click");
      setMessage("小温：这样交换不会消除，换个方向试试。");
      return;
    }
    setBusy(true);
    const { dx, dy } = swapOffset(a, b, board.width);
    setSlidePair({ a, b, dx, dy });
    await wait(170);
    setBoard(peek.swappedBoard);
    setSlidePair(null);
    setMovesUsed((value) => value + 1);
    await runCascade(peek.swappedBoard, peek.triggers, peek.preferredPivot);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, playSfx, runCascade]);

  const useExtendMovesTool = () => {
    if (toolsLeft.extend <= 0 || status !== "playing" || tutorialStep !== null || busy) return;
    setToolsLeft((current) => ({ ...current, extend: current.extend - 1 }));
    setBonusMoves((value) => value + EXTEND_MOVES_AMOUNT);
    setMessage(`小温：多给你 ${EXTEND_MOVES_AMOUNT} 步，别着急。`);
    playSfx("help");
    vibrate([18, 25, 18]);
  };

  const selectCell = (index: number) => {
    if (!board.cells[index].active || busy) return;
    if (tutorialStep !== null) {
      if (tutorialStep !== 1) return;
      if (selected === null) {
        if (index !== TUTORIAL_FIRST) return;
        setSelected(index);
        return;
      }
      if (index !== TUTORIAL_SECOND) return;
      const peek = peekSwap(board, selected, index);
      if (peek.valid) {
        const { dx, dy } = swapOffset(selected, index, board.width);
        setSlidePair({ a: selected, b: index, dx, dy });
        setSelected(null);
        void (async () => {
          await wait(170);
          setBoard(peek.swappedBoard);
          setSlidePair(null);
          playSfx("reveal");
          setTutorialStep(2);
        })();
      }
      return;
    }
    if (status !== "playing") return;
    if (bombArmed) {
      void handleGuBombTarget(index);
      return;
    }
    if (selected === null) {
      setSelected(index);
      return;
    }
    if (selected === index) {
      setSelected(null);
      return;
    }
    if (!neighborsOf(selected, board.width, board.height).includes(index)) {
      setSelected(index);
      return;
    }
    const pair = selected;
    setSelected(null);
    void trySwap(pair, index);
  };

  const useReshuffleTool = async () => {
    if (toolsLeft.reshuffle <= 0 || status !== "playing" || tutorialStep !== null || busy) return;
    setBusy(true);
    setToolsLeft((current) => ({ ...current, reshuffle: current.reshuffle - 1 }));
    playSfx("help");
    vibrate([18, 25, 18]);
    setShuffleFx(true);
    await wait(180);
    setBoard(powerShuffleBoard(board));
    setShuffleFx(false);
    setMessage("339：洗牌完成，棋盘上已经有一手大连击等你打出来。");
    setBusy(false);
  };

  const armGuBombTool = () => {
    if (toolsLeft.bomb <= 0 || status !== "playing" || tutorialStep !== null || busy) return;
    if (bombArmed) {
      setBombArmed(false);
      setMessage("小顾：先取消了，想清楚了再点我。");
      return;
    }
    setSelected(null);
    setBombArmed(true);
    setMessage("小顾：点棋盘上任意一格，我帮你炸开周围一整片。");
    playSfx("click");
  };

  const handleGuBombTarget = useCallback(async (index: number) => {
    setBombArmed(false);
    setBusy(true);
    setToolsLeft((current) => ({ ...current, bomb: current.bomb - 1 }));
    playSfx("flag");
    vibrate([20, 20, 30]);
    const step = detonateArea(board, index, BOMB_RADIUS);
    setClearingCells(step.clearedIndexes);
    await wait(150);
    setBoard(step.board);
    setClearingCells(new Set());
    setFallingCells(step.fallOffsets);
    await nextFrame();
    setFallingCells(new Map());
    setMovesUsed((value) => value + 1);
    await wait(step.fallOffsets.size > 0 ? 220 : 100);
    const settled = await runCascade(step.board, [], null, {
      collectGain: step.collectGain,
      obstacleCleared: step.obstacleCleared,
      scoreGain: step.scoreGain,
      specialsCreated: 0,
    });
    setMessage("小顾：炸开一片，接着看看能不能接上连击。");
    setBusy(false);
    return settled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, playSfx, runCascade]);


  const restartLevel = async () => {
    if (tutorialStep !== null || busy) return;
    setBusy(true);
    playSfx("click");
    setShuffleFx(true);
    await wait(180);
    loadLevel(levelIndex);
    setShuffleFx(false);
    setBusy(false);
  };

  const chooseLevel = (index: number) => {
    const difficulty = tierDifficulty[tierIndexForLevel(index)] ?? "normal";
    if (index + 1 > unlockedByDifficulty[difficulty] || busy) return;
    loadLevel(index);
    setShowLevelPicker(false);
    playSfx("click");
  };

  const goalStatuses = useMemo(() => rule.goals.map((goal) => ({ goal, status: goalStatus(goal, progress) })), [progress, rule.goals]);
  const movesLeft = Math.max(0, rule.moveLimit + bonusMoves - movesUsed);
  const allMuted = !musicEnabled && !sfxEnabled;

  return (
    <main className={`game-shell match-shell ${!tutorialReady || tutorialStep !== null ? "tutorial-active" : ""}`} onPointerDown={unlockAudio}>
      <header className="topbar match-topbar">
        <button className="brand-mark mode-back pressable" onClick={onBack} aria-label="返回游戏模式选择">
          <img src={asset("match-339")} alt="339 机器人" /><span>‹</span>
        </button>
        <div className="title-block">
          <p className="eyebrow">SWEET MATCH LAB</p>
          <h1>小顾的甜蜜消消乐</h1>
        </div>
        <div className="top-actions">
          <button
            className={`round-button audio-button pressable ${allMuted ? "muted" : ""}`}
            onClick={() => { setMusicEnabled(allMuted); setSfxEnabled(allMuted); if (!allMuted) playSfx("click"); }}
            aria-label={allMuted ? "打开声音" : "关闭声音"}
          >♫</button>
          <button className="round-button pressable" onClick={() => { playSfx("click"); setShowHelp(true); }} aria-label="查看消消乐说明">?</button>
        </div>
      </header>

      <section className="match-mission" aria-label="剧情任务">
        <img src={asset("match-xiaogu")} alt="小顾" />
        <div><span>甜蜜配方 · 第 {rule.displayNumber} 关</span><b>{message}</b></div>
        <img src={asset("match-xiaowen")} alt="小温" />
      </section>

      <section className={`match-panel ${status}`} aria-label={`消消乐第 ${rule.displayNumber} 关棋盘`}>
        <div className="match-levelbar">
          <button className="match-level-btn pressable" onClick={() => setShowLevelPicker(true)}>
            <span>第 {rule.displayNumber} 关</span><small>{rule.tier} ▾</small>
          </button>
          <span className={`match-difficulty-badge ${rule.difficulty}`}>{MATCH_DIFFICULTIES.find((option) => option.id === rule.difficulty)?.label}</span>
          <div className="match-moves-pill"><span>步数</span><b className={movesLeft <= 3 ? "danger" : ""}>{movesLeft}</b></div>
        </div>

        <div className="match-info-strip">
          <div className="match-goal-strip" aria-label="本关目标">
            {goalStatuses.map(({ goal, status: gs }, order) => (
              <div key={order} className={`match-goal-chip ${gs.done ? "done" : ""}`}>
                {goal.type === "collect" ? (
                  <img src={asset(MATCH_ICON_FILES[goal.icon])} alt={goalLabel(goal)} />
                ) : goal.type === "clearObstacles" ? (
                  <span className="match-goal-icon match-goal-icon-obstacle" aria-hidden="true" />
                ) : (
                  <span className="match-goal-icon match-goal-icon-score" aria-hidden="true">★</span>
                )}
                <b>{gs.current}/{gs.target}</b>
              </div>
            ))}
          </div>

          <div className="match-combo-legend" aria-label="特殊块生成规则">
            <span className="match-combo-row">
              <span className="match-combo-preview stripedRow" aria-hidden="true"><b>↔</b></span>
              <small>连 4 个消一行/列</small>
            </span>
            <span className="match-combo-row">
              <span className="match-combo-preview blockBomb" aria-hidden="true"><b>◆</b></span>
              <small>拐角相连消 3×3</small>
            </span>
            <span className="match-combo-row">
              <span className="match-combo-preview rainbow" aria-hidden="true"><b>✦</b></span>
              <small>连 5 个消同色</small>
            </span>
          </div>
        </div>

        <div
          className={`match-board ${tutorialStep === 1 ? "tutorial-board-focus" : ""} ${busy ? "busy" : ""} ${shuffleFx ? "shuffle-out" : ""} ${bombArmed ? "bomb-armed" : ""}`}
          role="grid"
          aria-label={`${rule.height} 行 ${rule.width} 列消消乐棋盘`}
          style={{ "--match-cols": board.width, "--match-rows": board.height, aspectRatio: `${board.width} / ${board.height}` } as CSSProperties}
        >
          {board.cells.map((cell, index) => {
            if (!cell.active) return <div key={index} className="match-hole" aria-hidden="true" />;
            const isTutorialTarget = tutorialStep === 1 && (index === TUTORIAL_FIRST || index === TUTORIAL_SECOND);
            const toneIndex = (Math.floor(index / board.width) + (index % board.width)) % 3;
            const toneClass = toneIndex === 1 ? "tone-b" : toneIndex === 2 ? "tone-c" : "";
            let cellStyle: CSSProperties | undefined;
            if (slidePair) {
              if (index === slidePair.a) cellStyle = { transform: `translate(${slidePair.dx * 100}%, ${slidePair.dy * 100}%)`, zIndex: 5 };
              else if (index === slidePair.b) cellStyle = { transform: `translate(${-slidePair.dx * 100}%, ${-slidePair.dy * 100}%)`, zIndex: 5 };
            }
            if (!cellStyle) {
              const fallRows = fallingCells.get(index);
              if (fallRows) cellStyle = { transform: `translateY(${-fallRows * 100}%)`, transition: "none", zIndex: 4 };
            }
            return (
              <button
                key={index}
                className={`match-cell ${toneClass} ${cell.special ?? ""} ${selected === index ? "selected" : ""} ${shaking.has(index) ? "shake" : ""} ${isTutorialTarget ? "tutorial-target" : ""} ${clearingCells.has(index) ? "clearing" : ""} ${sweptCells.has(index) ? "swept" : ""}`}
                style={cellStyle}
                role="gridcell"
                aria-label={`${MATCH_ICON_LABELS[cell.icon ?? 0]}${cell.cover ? "，有障碍" : ""}${cell.special ? "，特殊块" : ""}`}
                onClick={() => selectCell(index)}
              >
                {cell.icon !== null && <img key={`${cell.icon}-${cell.special ?? "n"}`} src={asset(MATCH_ICON_FILES[cell.icon])} alt={MATCH_ICON_LABELS[cell.icon]} />}
                {cell.cover > 0 && <span className={`match-cover cover-${cell.cover}`} aria-hidden="true" />}
                {cell.special === "rainbow" && <span className="match-special-badge rainbow" aria-hidden="true">✦</span>}
                {cell.special === "stripedRow" && <span className="match-special-badge stripe-row" aria-hidden="true">↔</span>}
                {cell.special === "stripedCol" && <span className="match-special-badge stripe-col" aria-hidden="true">↕</span>}
                {cell.special === "blockBomb" && <span className="match-special-badge block-bomb" aria-hidden="true">◆</span>}
              </button>
            );
          })}
        </div>

        <div className="match-tools">
          <button className="match-tool-btn pressable" onClick={useReshuffleTool} disabled={toolsLeft.reshuffle <= 0 || tutorialStep !== null}>
            <img src={asset("match-339")} alt="" /><span><b>339洗牌</b><small>棋盘重排</small></span><i>{toolsLeft.reshuffle}</i>
          </button>
          <button className={`match-tool-btn pressable ${bombArmed ? "active" : ""}`} onClick={armGuBombTool} disabled={toolsLeft.bomb <= 0 || tutorialStep !== null}>
            <img src={asset("match-xiaogu")} alt="" /><span><b>小顾炸弹</b><small>{bombArmed ? "点棋盘选目标" : "炸开周围3×3"}</small></span><i>{toolsLeft.bomb}</i>
          </button>
          <button className="match-tool-btn pressable" onClick={useExtendMovesTool} disabled={toolsLeft.extend <= 0 || tutorialStep !== null}>
            <img src={asset("match-xiaowen")} alt="" /><span><b>小温续力</b><small>+{EXTEND_MOVES_AMOUNT} 步数</small></span><i>{toolsLeft.extend}</i>
          </button>
        </div>

        <button className="match-restart pressable" onClick={restartLevel} disabled={tutorialStep !== null}>
          <span>↻</span>重开本关（随机新棋盘）
        </button>

        {(status === "won" || status === "failed") && (
          <div className={`match-result ${status}`} role="status">
            <div className="match-result-portraits">
              <img src={asset("match-xiaogu")} alt="小顾" />
              <span>{status === "won" ? "♡" : "…"}</span>
              <img src={asset("match-xiaowen")} alt="小温" />
            </div>
            <div><strong>{status === "won" ? `第 ${rule.displayNumber} 关完成！` : "这一关还没成功"}</strong><p>{status === "won" ? `用了 ${movesUsed} 步，达成了本关全部目标。` : "步数已经用完，重开一局，盘面会重新随机。"}</p></div>
            <div className="result-actions">
              <button className="result-button secondary pressable" onClick={restartLevel}>重开本关</button>
              {status === "won" && rule.index < MATCH_LEVEL_COUNT - 1 ? (
                <button className="result-button pressable" onClick={() => loadLevel(rule.index + 1)}>下一关</button>
              ) : (
                <button className="result-button pressable" onClick={() => setShowLevelPicker(true)}>选择关卡</button>
              )}
            </div>
          </div>
        )}
        {status === "won" && <div className="confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} />)}</div>}
      </section>

      {(!tutorialReady || tutorialStep !== null || stageIntroTier !== null) && <div className="tutorial-shield" aria-hidden="true" />}
      {stageIntroTier !== null && tutorialStep === null && (
        <section className="tutorial-coach match-tutorial centered" role="dialog" aria-modal="true" aria-live="polite">
          <div className="tutorial-head">
            <img src={asset("match-339")} alt="339 机器人" />
            <span>{STAGE_INTRO[stageIntroTier]?.name}</span>
          </div>
          <h2>新的阶段开始了</h2>
          <p>{STAGE_INTRO[stageIntroTier]?.text}</p>
          <button className="tutorial-button pressable" onClick={() => setStageIntroTier(null)}>知道了</button>
        </section>
      )}
      {tutorialStep !== null && (
        <section className={`tutorial-coach match-tutorial ${tutorialStep === 0 ? "centered" : ""}`} role="dialog" aria-modal="true" aria-live="polite">
          <div className="tutorial-head">
            <img src={asset("match-339")} alt="339 机器人" />
            <span>339 消消乐教学</span>
            <b>{tutorialStep}/3</b>
          </div>
          {tutorialStep === 0 && (
            <><h2>三个一样，碰一下就消失</h2><p>点第一个格子，再点它旁边的格子，两个位置会交换。交换后如果凑成三个连在一起的图标，它们就会被消掉。</p><button className="tutorial-button pressable" onClick={startTutorial}>用小棋盘试一次</button></>
          )}
          {tutorialStep === 1 && <><h2>试试交换这两格</h2><p>高亮的两个格子交换后，最下面会连成三个一样的图标。先点左边高亮格，再点右边高亮格。</p><span className="tutorial-wait">等待你完成交换…</span></>}
          {tutorialStep === 2 && <><h2>步数、目标与特殊块</h2><p>每一关都有<b className="number-rule">步数上限</b>，用完还没达成目标就算失败。连起 4 个会变成条纹块（清一整行/列），拐角形（L/T）会变成炸弹块（清周围 3×3），连起 5 个直线才会变成彩虹块（清掉同色全部，威力最大也最难凑出）。</p><button className="tutorial-button pressable" onClick={() => setTutorialStep(3)}>知道了，继续</button></>}
          {tutorialStep === 3 && <><h2>三个小帮手</h2><p><b>339 洗牌</b>会重排棋盘，而且保证换完一定有一手大连击等你打出来；<b>小顾炸弹</b>能直接炸开任意一格周围 3×3；<b>小温续力</b>能直接多给你 {EXTEND_MOVES_AMOUNT} 步。都限量使用，谨慎选择时机。每个阶段还能单独选<b>简单/中等/高级</b>难度，在关卡选择里就能切换，想练手就选简单，想挑战就选高级。</p><button className="tutorial-button pressable" onClick={finishTutorial}>开始正式挑战</button></>}
        </section>
      )}

      {showLevelPicker && tutorialStep === null && (
        <div className="modal-backdrop" onMouseDown={() => setShowLevelPicker(false)}>
          <section className="match-level-picker" role="dialog" aria-modal="true" aria-labelledby="match-level-picker-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close pressable" onClick={() => setShowLevelPicker(false)} aria-label="关闭关卡选择">×</button>
            <img src={asset("match-croissant")} alt="" />
            <span className="mission-tag">{MATCH_LEVEL_COUNT} 关甜蜜配方</span>
            <h2 id="match-level-picker-title">选择关卡</h2>
            <div className="match-level-groups">
              {tierList().map((tier) => {
                const currentDifficulty = tierDifficulty[tier.tierIndex] ?? "normal";
                const unlockedForTier = unlockedByDifficulty[currentDifficulty];
                return (
                  <div className="match-level-group" key={tier.tierIndex}>
                    <p className="match-level-group-title">{tier.name}<small>第 {tier.start + 1}–{tier.start + tier.count} 关</small></p>
                    <div className="match-difficulty-toggle" role="group" aria-label={`${tier.name} 难度选择`}>
                      {MATCH_DIFFICULTIES.map((option) => (
                        <button
                          key={option.id}
                          className={`match-difficulty-btn pressable ${currentDifficulty === option.id ? "active" : ""}`}
                          onClick={() => setTierDifficultyAt(tier.tierIndex, option.id)}
                        >{option.label}</button>
                      ))}
                    </div>
                    <div className="match-level-grid">
                      {Array.from({ length: tier.count }, (_, offset) => tier.start + offset).map((index) => {
                        const locked = index + 1 > unlockedForTier;
                        return (
                          <button key={index} className={`match-level-tile pressable ${index === levelIndex ? "current" : ""}`} disabled={locked} onClick={() => chooseLevel(index)}>
                            {locked ? "🔒" : index + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {showHelp && (
        <div className="modal-backdrop" onMouseDown={() => setShowHelp(false)}>
          <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="match-help-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close pressable" onClick={() => setShowHelp(false)} aria-label="关闭说明">×</button>
            <img src={asset("match-339")} alt="339 机器人" />
            <span className="mission-tag">消消乐说明</span>
            <h2 id="match-help-title">在步数用完前达成目标</h2>
            <ol>
              <li><b>交换</b>：点一个格子再点相邻格子，会尝试交换；交换后能凑成三连才会真正生效。</li>
              <li><b>特殊块</b>：四连生成条纹块（清一整行/列），拐角形（L/T）生成炸弹块（清周围 3×3），五连直线才会生成彩虹块（清掉同色全部）。</li>
              <li><b>糖霜格</b>：薄糖霜碰一次就化开，厚奶油需要两次；相邻的消除也能帮忙化掉一层。</li>
              <li><b>计分</b>：消除小顾、小温得分更高（每格15分），其他材料每格10分，生成/触发特殊块还有额外加分。</li>
              <li><b>步数与目标</b>：每关步数有限，达成全部目标即通关，步数用完还没达成就要重开。</li>
              <li><b>三个道具</b>：339 洗牌（重排棋盘，并保证换完一定留有一手大连击）、小顾炸弹（点棋盘任意一格，炸开周围 3×3）、小温续力（直接多给 {EXTEND_MOVES_AMOUNT} 步），每关限量，谨慎使用。</li>
              <li><b>关卡随机</b>：每次进入或重开关卡，棋盘图标都会重新随机排列。</li>
              <li><b>难度选择</b>：在「选择关卡」里，每个阶段都能单独选简单/中等/高级，切换后步数、障碍和目标数值都会一起调整；三档难度的通关进度各自独立。</li>
            </ol>
            <button className="primary-button pressable" onClick={() => setShowHelp(false)}>明白，开始消除</button>
          </section>
        </div>
      )}
    </main>
  );
}
