"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useGameAudio } from "./useGameAudio";

type PuzzleStatus = "ready" | "playing" | "won" | "failed";
type PuzzleMark = 0 | 1 | 2;
type PuzzleTutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | null;
type ToolCounts = { scan: number; tidy: number; intuition: number };
type ConflictType = "region" | "line" | "adjacent";

type PuzzleSnapshot = {
  marks: PuzzleMark[];
  mistakes: number;
  status: PuzzleStatus;
  message: string;
};

type LevelConfig = {
  size: number;
  mistakeLimit: number;
  tools: ToolCounts;
  tier: string;
};

type LevelVictory = { badge: string; title: string; copy: string };

const ASSET_ROOT = "assets";
const PUZZLE_TUTORIAL_KEY = "croissant-platter-tutorial-v2-complete";
const PUZZLE_PROGRESS_KEY = "croissant-platter-unlocked";
const REGION_COLORS = ["#f9dfcf", "#f8eab8", "#dcebcf", "#d9e9ec", "#e2ddf1", "#f2d9e4", "#e6d6c5", "#d8eadf"];

const LEVELS: LevelConfig[] = [
  { size: 4, mistakeLimit: 4, tools: { scan: 2, tidy: 1, intuition: 1 }, tier: "热身" },
  { size: 4, mistakeLimit: 3, tools: { scan: 1, tidy: 1, intuition: 1 }, tier: "热身+" },
  { size: 5, mistakeLimit: 3, tools: { scan: 2, tidy: 1, intuition: 1 }, tier: "熟练" },
  { size: 5, mistakeLimit: 3, tools: { scan: 1, tidy: 1, intuition: 1 }, tier: "熟练+" },
  { size: 5, mistakeLimit: 2, tools: { scan: 1, tidy: 1, intuition: 0 }, tier: "进阶" },
  { size: 6, mistakeLimit: 2, tools: { scan: 2, tidy: 1, intuition: 1 }, tier: "进阶" },
  { size: 6, mistakeLimit: 2, tools: { scan: 1, tidy: 1, intuition: 1 }, tier: "进阶+" },
  { size: 6, mistakeLimit: 1, tools: { scan: 1, tidy: 1, intuition: 0 }, tier: "烧脑" },
  { size: 7, mistakeLimit: 1, tools: { scan: 2, tidy: 1, intuition: 1 }, tier: "烧脑" },
  { size: 7, mistakeLimit: 1, tools: { scan: 1, tidy: 1, intuition: 0 }, tier: "烧脑+" },
  { size: 8, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "主厨" },
  { size: 8, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "终极" },
];

const LEVEL_VICTORIES: LevelVictory[] = [
  { badge: "FIRST PLATE", title: "第一盘，稳稳端上桌！", copy: "小温找到节奏了，小顾在旁边认真记住了每一步。" },
  { badge: "SWEET START", title: "热身完成，贴贴庆祝！", copy: "四乘四已经难不住你，他们决定再多烤一盘。" },
  { badge: "COLOR MASTER", title: "颜色区域全部理顺啦", copy: "每种颜色都刚刚好，339 给你的摆盘打了满分。" },
  { badge: "PERFECT LINES", title: "行列整整齐齐！", copy: "小顾负责端盘，小温负责偷偷奖励你一只牛角包。" },
  { badge: "NO HINT NEEDED", title: "进阶订单也完成了", copy: "少一次直觉帮助，你依然靠推理找到了全部位置。" },
  { badge: "BIGGER PLATE", title: "六乘六，漂亮收官！", copy: "餐盘变大了，默契也升级了，下一单正在等你。" },
  { badge: "TEAM WORK", title: "三个人的配合刚刚好", copy: "339 扫描方向，小顾整理线索，小温等你端来成品。" },
  { badge: "SHARP LOGIC", title: "烧脑关也被你拿下！", copy: "相邻陷阱一个都没骗到你，贴贴时间延长十秒。" },
  { badge: "SEVEN COLORS", title: "七种颜色，各就各位", copy: "这一盘像彩色拼图，也像他们今天最满意的作品。" },
  { badge: "ALMOST CHEF", title: "离主厨只差一步了", copy: "有限的帮助也够用，因为最可靠的线索一直在你手里。" },
  { badge: "MASTER PLATE", title: "八乘八主厨认证！", copy: "小顾和小温已经贴在一起等你宣布最后一关开始。" },
  { badge: "FINAL ORDER", title: "终极订单完成，今日满分！", copy: "十二张餐盘全部完成：牛角包、贴贴和掌声都归你。" },
];

const solutionCache = new Map<number, number[][]>();

function queenSolutions(size: number) {
  const cached = solutionCache.get(size);
  if (cached) return cached;
  const results: number[][] = [];
  const columns = new Set<number>();
  const down = new Set<number>();
  const up = new Set<number>();
  const current: number[] = [];
  const visit = (row: number) => {
    if (row === size) {
      results.push([...current]);
      return;
    }
    for (let col = 0; col < size; col += 1) {
      if (columns.has(col) || down.has(row - col) || up.has(row + col)) continue;
      columns.add(col); down.add(row - col); up.add(row + col); current.push(col);
      visit(row + 1);
      current.pop(); columns.delete(col); down.delete(row - col); up.delete(row + col);
    }
  };
  visit(0);
  solutionCache.set(size, results);
  return results;
}

function seededNoise(value: number) {
  const next = Math.sin(value * 12.9898) * 43758.5453;
  return next - Math.floor(next);
}

function buildPuzzle(levelIndex: number, variant: number) {
  const config = LEVELS[levelIndex];
  const solutions = queenSolutions(config.size);
  const solution = solutions[(levelIndex * 11 + variant * 7) % solutions.length];
  const queenCells = solution.map((col, row) => row * config.size + col);
  const regions = Array.from({ length: config.size * config.size }, (_, index) => {
    const row = Math.floor(index / config.size);
    const col = index % config.size;
    let winner = 0;
    let winnerCost = Number.POSITIVE_INFINITY;
    queenCells.forEach((queenIndex, region) => {
      const queenRow = Math.floor(queenIndex / config.size);
      const queenCol = queenIndex % config.size;
      const distance = Math.abs(row - queenRow) + Math.abs(col - queenCol);
      const jitter = seededNoise((levelIndex + 1) * 991 + variant * 313 + index * 17 + region * 43) * .32;
      const cost = distance + jitter;
      if (cost < winnerCost) { winner = region; winnerCost = cost; }
    });
    return winner;
  });
  queenCells.forEach((index, region) => { regions[index] = region; });
  const autoRow = (levelIndex + variant) % config.size;
  return { solution, solutionCells: new Set(queenCells), regions, autoCell: queenCells[autoRow] };
}

function startingMarks(levelIndex: number, variant: number) {
  const config = LEVELS[levelIndex];
  const puzzle = buildPuzzle(levelIndex, variant);
  const marks = Array(config.size * config.size).fill(0) as PuzzleMark[];
  marks[puzzle.autoCell] = 2;
  return marks;
}

function conflictsFor(marks: PuzzleMark[], size: number, regions: number[]) {
  const placed = marks.map((mark, index) => ({ mark, index })).filter(({ mark }) => mark === 2).map(({ index }) => index);
  const conflicts = new Set<number>();
  for (let first = 0; first < placed.length; first += 1) {
    for (let second = first + 1; second < placed.length; second += 1) {
      const a = placed[first];
      const b = placed[second];
      const ar = Math.floor(a / size); const ac = a % size;
      const br = Math.floor(b / size); const bc = b % size;
      const collision = ar === br || ac === bc || regions[a] === regions[b] || (Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1);
      if (collision) { conflicts.add(a); conflicts.add(b); }
    }
  }
  return conflicts;
}

function conflictTypesFor(marks: PuzzleMark[], size: number, regions: number[]) {
  const types = new Set<ConflictType>();
  const placed = marks.map((mark, index) => ({ mark, index })).filter(({ mark }) => mark === 2).map(({ index }) => index);
  for (let first = 0; first < placed.length; first += 1) {
    for (let second = first + 1; second < placed.length; second += 1) {
      const a = placed[first]; const b = placed[second];
      const ar = Math.floor(a / size); const ac = a % size;
      const br = Math.floor(b / size); const bc = b % size;
      if (regions[a] === regions[b]) types.add("region");
      if (ar === br || ac === bc) types.add("line");
      if (Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1) types.add("adjacent");
    }
  }
  return types;
}

function conflictMessage(types: Set<ConflictType>) {
  const reasons: string[] = [];
  if (types.has("region")) reasons.push("同一颜色区域重复");
  if (types.has("line")) reasons.push("同一行或同一列重复");
  if (types.has("adjacent")) reasons.push("两个牛角包相邻");
  return `${reasons.join("、")}。双击红框牛角包拿走，或点“撤回一步”。`;
}

function solved(marks: PuzzleMark[], size: number, regions: number[]) {
  return marks.filter((mark) => mark === 2).length === size && conflictsFor(marks, size, regions).size === 0;
}

function toolCounts(config: LevelConfig): ToolCounts {
  return { ...config.tools };
}

export function CroissantPuzzle({ onBack }: { onBack: () => void }) {
  const [levelIndex, setLevelIndex] = useState(0);
  const [variant, setVariant] = useState(0);
  const config = LEVELS[levelIndex];
  const puzzle = useMemo(() => buildPuzzle(levelIndex, variant), [levelIndex, variant]);
  const [marks, setMarks] = useState<PuzzleMark[]>(() => startingMarks(0, 0));
  const marksRef = useRef<PuzzleMark[]>(marks);
  const [conflicts, setConflicts] = useState<Set<number>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const mistakesRef = useRef(0);
  const [status, setStatus] = useState<PuzzleStatus>("ready");
  const [toolsLeft, setToolsLeft] = useState<ToolCounts>(() => toolCounts(LEVELS[0]));
  const [unlockedLevel, setUnlockedLevel] = useState(1);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [message, setMessage] = useState("系统已放好第一个牛角包。请从它所在的颜色、行列和相邻格开始排除。");
  const [scanFocus, setScanFocus] = useState<{ type: "row" | "col" | "region"; value: number } | null>(null);
  const [scanHintTarget, setScanHintTarget] = useState<number | null>(null);
  const [tidyHighlights, setTidyHighlights] = useState<Set<number>>(new Set());
  const [tutorialStep, setTutorialStep] = useState<PuzzleTutorialStep>(null);
  const [tutorialReady, setTutorialReady] = useState(false);
  const [showIdleHint, setShowIdleHint] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const [undoSnapshot, setUndoSnapshot] = useState<PuzzleSnapshot | null>(null);
  const hintedRef = useRef(false);
  const pendingTap = useRef<{ index: number; timer: ReturnType<typeof setTimeout>; before: PuzzleSnapshot } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const dragStart = useRef<{ x: number; y: number; index: number } | null>(null);
  const dragLastIndex = useRef<number | null>(null);
  const dragSnapshot = useRef<PuzzleSnapshot | null>(null);
  const {
    musicEnabled, playSfx, setMusicEnabled, setSfxEnabled, sfxEnabled, unlockAudio,
  } = useGameAudio(false);

  const tutorialAutoCell = puzzle.autoCell;
  const tutorialAutoRow = Math.floor(tutorialAutoCell / config.size);
  const tutorialAutoCol = tutorialAutoCell % config.size;
  const tutorialCrossRow = tutorialAutoRow < config.size - 1 ? tutorialAutoRow + 1 : tutorialAutoRow - 1;
  const tutorialCrossCol = tutorialAutoCol < config.size - 1 ? tutorialAutoCol + 1 : tutorialAutoCol - 1;
  const tutorialCrossTarget = tutorialCrossRow * config.size + tutorialCrossCol;
  const tutorialNextSolutionCell = config.size + puzzle.solution[1];
  const tutorialDragTargets = useMemo(() => {
    return [1, 2, 3].map((row) => row * config.size + tutorialAutoCol);
  }, [config.size, tutorialAutoCol]);

  const makeSnapshot = (): PuzzleSnapshot => ({
    marks: [...marksRef.current], mistakes: mistakesRef.current, status, message,
  });

  const restoreSnapshot = (snapshot: PuzzleSnapshot, clearHistory = true) => {
    marksRef.current = [...snapshot.marks];
    mistakesRef.current = snapshot.mistakes;
    setMarks([...snapshot.marks]);
    setConflicts(conflictsFor(snapshot.marks, config.size, puzzle.regions));
    setMistakes(snapshot.mistakes);
    setStatus(snapshot.status);
    setScanFocus(null);
    setScanHintTarget(null);
    setTidyHighlights(new Set());
    setMessage(clearHistory ? "已撤回最近一次操作。棋盘和失误次数都恢复了。" : snapshot.message);
    if (clearHistory) setUndoSnapshot(null);
  };

  const resetBoard = useCallback((nextLevel = levelIndex, nextVariant = variant) => {
    const nextConfig = LEVELS[nextLevel];
    const initial = startingMarks(nextLevel, nextVariant);
    marksRef.current = initial;
    mistakesRef.current = 0;
    setLevelIndex(nextLevel);
    setVariant(nextVariant);
    setMarks(initial);
    setConflicts(new Set());
    setMistakes(0);
    setToolsLeft(toolCounts(nextConfig));
    setStatus("ready");
    setUndoSnapshot(null);
    setScanFocus(null);
    setScanHintTarget(null);
    setTidyHighlights(new Set());
    setShowIdleHint(false);
    hintedRef.current = false;
    setActivityTick((value) => value + 1);
    setMessage("系统已放好第一个牛角包。请从它所在的颜色、行列和相邻格开始排除。");
  }, [levelIndex, variant]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = Number(window.localStorage.getItem(PUZZLE_PROGRESS_KEY) || 1);
      const nextUnlocked = Math.min(12, Math.max(1, saved));
      setUnlockedLevel(nextUnlocked);
      if (!window.localStorage.getItem(PUZZLE_TUTORIAL_KEY)) setTutorialStep(0);
      else setShowLevelPicker(true);
      setTutorialReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    if (pendingTap.current) clearTimeout(pendingTap.current.timer);
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  useEffect(() => {
    if (tutorialStep !== null || status === "won" || status === "failed" || hintedRef.current) return;
    setShowIdleHint(false);
    const hintTimer = window.setTimeout(() => {
      hintedRef.current = true;
      setShowIdleHint(true);
    }, 45000);
    return () => window.clearTimeout(hintTimer);
  }, [activityTick, status, tutorialStep]);

  useEffect(() => {
    if (!showIdleHint) return;
    const timer = window.setTimeout(() => setShowIdleHint(false), 6500);
    return () => window.clearTimeout(timer);
  }, [showIdleHint]);

  const registerActivity = () => {
    setShowIdleHint(false);
    setActivityTick((value) => value + 1);
  };

  const finishLevel = useCallback(() => {
    setStatus("won");
    setMessage("摆盘完成！小温已经把这一盘端上桌啦 ♡");
    playSfx("win");
    vibrate([40, 30, 40, 30, 75]);
    const nextUnlocked = Math.min(12, Math.max(unlockedLevel, levelIndex + 2));
    setUnlockedLevel(nextUnlocked);
    window.localStorage.setItem(PUZZLE_PROGRESS_KEY, String(nextUnlocked));
  }, [levelIndex, playSfx, unlockedLevel]);

  const applyMark = (index: number, nextMark: PuzzleMark, countConflict = true, saveHistory = true, history?: PuzzleSnapshot) => {
    const current = marksRef.current;
    if (current[index] === nextMark || status === "won" || status === "failed") return;
    if (saveHistory) setUndoSnapshot(history || makeSnapshot());
    const next = [...current];
    next[index] = nextMark;
    const nextConflicts = conflictsFor(next, config.size, puzzle.regions);
    marksRef.current = next;
    setMarks(next);
    setConflicts(nextConflicts);
    setStatus("playing");
    registerActivity();

    if (countConflict && nextMark === 2 && nextConflicts.has(index)) {
      const nextMistakes = mistakesRef.current + 1;
      mistakesRef.current = nextMistakes;
      setMistakes(nextMistakes);
      setMessage(conflictMessage(conflictTypesFor(next, config.size, puzzle.regions)));
      playSfx("lose");
      vibrate([35, 25, 55]);
      if (nextMistakes > config.mistakeLimit) {
        setStatus("failed");
        setMessage("这次摆盘先到这里，换一张新餐盘再试试吧。");
      }
      return;
    }

    if (solved(next, config.size, puzzle.regions) && tutorialStep === null) {
      finishLevel();
      return;
    }
    if (tutorialStep === null) {
      if (nextConflicts.size === 0 && conflicts.size > 0) setMessage("冲突已经解除，三条规则重新满足啦。");
      else if (nextMark === 1) setMessage("已标记 ×：这里暂时排除，不会放牛角包。");
      else if (nextMark === 2) setMessage("摆下一个牛角包。继续检查它的颜色、行列和周围 8 格。");
      else setMessage("已拿走这格的标记，可以重新判断。");
    }
    playSfx(nextMark === 2 ? "flag" : "click");
  };

  const tutorialAllows = (index: number, kind: "cross" | "place") => {
    if (tutorialStep === null) return true;
    if (tutorialStep === 2) return kind === "cross" && index === tutorialCrossTarget;
    if (tutorialStep === 3) return kind === "cross" && tutorialDragTargets.includes(index);
    if (tutorialStep === 4) return kind === "place" && index === tutorialNextSolutionCell;
    return false;
  };

  const markCross = (index: number, history?: PuzzleSnapshot) => {
    if (!tutorialAllows(index, "cross")) return;
    if (tutorialStep === 3) return;
    const current = marksRef.current[index];
    if (current === 2) return;
    applyMark(index, current === 1 ? 0 : 1, tutorialStep === null, true, history);
    if (tutorialStep === 2) setTutorialStep(3);
  };

  const toggleCroissant = (index: number, history?: PuzzleSnapshot, saveHistory = true) => {
    if (!tutorialAllows(index, "place")) return;
    applyMark(index, marksRef.current[index] === 2 ? 0 : 2, tutorialStep === null, saveHistory, history);
    if (tutorialStep === 4 && marksRef.current[index] === 2) setTutorialStep(5);
  };

  const handleCellClick = (index: number) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (tutorialStep === null && index === puzzle.autoCell) {
      setMessage("带星标的是系统给定位置，不能拿走；请从它开始排除其他格子。");
      playSfx("click");
      return;
    }
    if (tutorialStep !== null && tutorialStep !== 2 && tutorialStep !== 4) return;
    if (pendingTap.current?.index === index) {
      clearTimeout(pendingTap.current.timer);
      const before = pendingTap.current.before;
      pendingTap.current = null;
      restoreSnapshot(before, false);
      setUndoSnapshot(before);
      toggleCroissant(index, before, false);
      return;
    }
    if (pendingTap.current) {
      clearTimeout(pendingTap.current.timer);
      pendingTap.current = null;
    }
    const before = makeSnapshot();
    markCross(index, before);
    const timer = setTimeout(() => {
      pendingTap.current = null;
    }, 300);
    pendingTap.current = { index, timer, before };
  };

  const pointerIndex = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-puzzle-index]");
    return element ? Number(element.dataset.puzzleIndex) : null;
  };

  const paintDragPath = (from: number, to: number) => {
    const fromRow = Math.floor(from / config.size); const fromCol = from % config.size;
    const toRow = Math.floor(to / config.size); const toCol = to % config.size;
    const steps = Math.max(Math.abs(toRow - fromRow), Math.abs(toCol - fromCol));
    const next = [...marksRef.current];
    let changed = false;
    for (let step = 0; step <= steps; step += 1) {
      const ratio = steps === 0 ? 0 : step / steps;
      const row = Math.round(fromRow + (toRow - fromRow) * ratio);
      const col = Math.round(fromCol + (toCol - fromCol) * ratio);
      const index = row * config.size + col;
      if (next[index] !== 2 && tutorialAllows(index, "cross") && next[index] !== 1) {
        next[index] = 1;
        changed = true;
      }
    }
    if (!changed) return false;
    marksRef.current = next;
    setMarks(next);
    setStatus("playing");
    return true;
  };

  const activateDrag = (index: number) => {
    if (dragging.current) return;
    dragging.current = true;
    suppressClick.current = true;
    if (pendingTap.current) { clearTimeout(pendingTap.current.timer); pendingTap.current = null; }
    if (dragSnapshot.current) setUndoSnapshot(dragSnapshot.current);
    dragLastIndex.current = dragStart.current?.index ?? index;
    if (paintDragPath(dragLastIndex.current, index)) {
      setMessage("正在连续标记 ×：划过的格子会一次性更新。");
      registerActivity();
    }
    vibrate(14);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (marksRef.current[index] === 2 || (tutorialStep !== null && tutorialStep !== 3)) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    dragStart.current = { x: event.clientX, y: event.clientY, index };
    dragLastIndex.current = index;
    dragSnapshot.current = makeSnapshot();
    longPressTimer.current = setTimeout(() => {
      activateDrag(index);
    }, 140);
  };

  const dragAcross = (event: ReactPointerEvent<HTMLDivElement>) => {
    const index = pointerIndex(event);
    if (index === null || !dragStart.current) return;
    if (!dragging.current) {
      const distance = Math.hypot(event.clientX - dragStart.current.x, event.clientY - dragStart.current.y);
      if (distance < 7) return;
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      activateDrag(index);
    }
    const previous = dragLastIndex.current ?? index;
    paintDragPath(previous, index);
    dragLastIndex.current = index;
    if (tutorialStep === 3 && tutorialDragTargets.every((target) => marksRef.current[target] === 1)) setTutorialStep(4);
  };

  const endDrag = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    dragging.current = false;
    dragStart.current = null;
    dragLastIndex.current = null;
    dragSnapshot.current = null;
  };

  const undoLastAction = () => {
    if (!undoSnapshot || status === "won" || tutorialStep !== null) return;
    if (pendingTap.current) { clearTimeout(pendingTap.current.timer); pendingTap.current = null; }
    restoreSnapshot(undoSnapshot);
    setShowIdleHint(false);
    playSfx("click");
    vibrate(14);
  };

  const restartCurrentPuzzle = () => {
    if (tutorialStep !== null) return;
    if (pendingTap.current) { clearTimeout(pendingTap.current.timer); pendingTap.current = null; }
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    endDrag();
    resetBoard(levelIndex, variant);
    setMessage("本局已重新开始：餐盘和系统给定位置保持不变，请从第一步重新推理。");
    playSfx("click");
    vibrate(14);
  };

  const chooseLevel = (index: number) => {
    if (index + 1 > unlockedLevel) return;
    playSfx("click");
    resetBoard(index, 0);
    setShowLevelPicker(false);
  };

  const handleTool = (tool: keyof ToolCounts) => {
    if (tutorialStep !== null || status === "won" || status === "failed" || toolsLeft[tool] <= 0) return;
    registerActivity();
    const consumeTool = () => setToolsLeft((current) => ({ ...current, [tool]: current[tool] - 1 }));

    if (tool === "scan") {
      const candidates = puzzle.solution.map((col, row) => row * config.size + col).filter((index) => marksRef.current[index] !== 2);
      if (!candidates.length) return;
      const target = candidates[0];
      const row = Math.floor(target / config.size);
      const col = target % config.size;
      setUndoSnapshot(null);
      setTidyHighlights(new Set());
      setScanFocus({ type: "row", value: row });
      setScanHintTarget(target);
      setMessage(`339 已锁定：第 ${row + 1} 行第 ${col + 1} 列满足三条规则，双击高亮格摆放。`);
      window.setTimeout(() => { setScanFocus(null); setScanHintTarget(null); }, 3200);
      playSfx("help");
      vibrate([18, 25, 18]);
      consumeTool();
      return;
    }

    if (tool === "tidy") {
      const placed = marksRef.current.map((mark, index) => ({ mark, index })).filter(({ mark }) => mark === 2).map(({ index }) => index);
      const next = [...marksRef.current];
      const newlyCrossed: number[] = [];
      next.forEach((mark, index) => {
        if (mark !== 0) return;
        const row = Math.floor(index / config.size); const col = index % config.size;
        if (placed.some((placedIndex) => {
          const placedRow = Math.floor(placedIndex / config.size); const placedCol = placedIndex % config.size;
          return row === placedRow || col === placedCol || puzzle.regions[index] === puzzle.regions[placedIndex] || (Math.abs(row - placedRow) <= 1 && Math.abs(col - placedCol) <= 1);
        })) { next[index] = 1; newlyCrossed.push(index); }
      });
      if (!newlyCrossed.length) {
        setMessage("小顾检查完了：目前没有新的格子可以确定排除，道具次数没有消耗。");
        playSfx("click");
        return;
      }
      setUndoSnapshot(null);
      setScanFocus(null);
      setScanHintTarget(null);
      marksRef.current = next;
      setMarks(next);
      setStatus("playing");
      setTidyHighlights(new Set(newlyCrossed));
      setMessage(`小顾整理完成：一次排除了 ${newlyCrossed.length} 格，闪亮的 × 都是刚刚新增的。`);
      window.setTimeout(() => setTidyHighlights(new Set()), 2200);
      playSfx("flag");
      vibrate([16, 20, 16]);
      consumeTool();
      return;
    }

    if (tool === "intuition") {
      const candidates = puzzle.solution.map((col, row) => row * config.size + col).filter((index) => {
        if (marksRef.current[index] === 2) return false;
        const trial = [...marksRef.current]; trial[index] = 2;
        return !conflictsFor(trial, config.size, puzzle.regions).has(index);
      });
      if (!candidates.length) {
        setMessage("小温：先把红框里的冲突移开，我就能看清正确位置啦。");
        return;
      }
      setUndoSnapshot(null);
      setScanFocus(null);
      setScanHintTarget(null);
      setTidyHighlights(new Set());
      applyMark(candidates[0], 2, false, false);
      if (!solved(marksRef.current, config.size, puzzle.regions)) {
        setMessage("小温的直觉命中！这里可以安心放牛角包。");
        playSfx("reveal");
      }
      consumeTool();
    }
  };

  const startTutorial = () => {
    resetBoard(0, 0);
    setShowLevelPicker(false);
    setTutorialStep(1);
    playSfx("click");
  };

  const finishTutorial = () => {
    window.localStorage.setItem(PUZZLE_TUTORIAL_KEY, "1");
    setTutorialStep(null);
    resetBoard(0, 0);
    setShowLevelPicker(false);
    playSfx("click");
  };

  const placedCount = marks.filter((mark) => mark === 2).length;
  const conflictTypes = useMemo(() => conflictTypesFor(marks, config.size, puzzle.regions), [config.size, marks, puzzle.regions]);
  const allMuted = !musicEnabled && !sfxEnabled;
  const victory = LEVEL_VICTORIES[levelIndex];

  return (
    <main className={`game-shell platter-shell ${!tutorialReady || tutorialStep !== null ? "tutorial-active" : ""}`} onPointerDown={unlockAudio}>
      <header className="topbar platter-topbar">
        <button className="brand-mark mode-back pressable" onClick={onBack} aria-label="返回游戏模式选择"><img src={`${ASSET_ROOT}/xiaowen.webp`} alt="小温" decoding="async" fetchPriority="high" /><span>‹</span></button>
        <div className="title-block"><p className="eyebrow">CROISSANT LOGIC</p><h1>牛角包摆盘</h1></div>
        <div className="top-actions">
          <button className={`round-button audio-button pressable ${allMuted ? "muted" : ""}`} onClick={() => { setMusicEnabled(allMuted); setSfxEnabled(allMuted); if (!allMuted) playSfx("click"); }} aria-label={allMuted ? "打开声音" : "关闭声音"}>♫</button>
          <button className="round-button pressable" onClick={() => { playSfx("click"); setShowRules(true); }} aria-label="查看摆盘规则">?</button>
        </div>
      </header>

      <section className="platter-mission">
        <img src={`${ASSET_ROOT}/xiaowen.webp`} alt="小温" decoding="async" />
        <div><span>小温的摆盘课</span><b>{message}</b></div>
        <img src={`${ASSET_ROOT}/croissant.webp`} alt="牛角包" decoding="async" />
      </section>

      <section className={`platter-panel ${status}`} aria-label={`牛角包摆盘第 ${levelIndex + 1} 关`}>
        <div className="platter-levelbar">
          <button className="level-menu-button pressable" onClick={() => setShowLevelPicker(true)}><span>第 {levelIndex + 1} 关</span><small>{config.size} × {config.size} ▾</small></button>
          <div className="platter-progress"><span>还需摆放</span><b>{Math.max(0, config.size - placedCount)}</b></div>
          <div className={`mistake-meter ${mistakes > config.mistakeLimit ? "danger" : ""}`}><span>失误</span><b>{mistakes}/{config.mistakeLimit}</b></div>
        </div>

        <div className={`puzzle-rule-strip ${tutorialStep === 1 ? "tutorial-target" : ""}`} aria-label="摆盘三条规则">
          <span className={conflictTypes.has("region") ? "rule-error" : ""}><b>颜色</b><small>每色 1 个</small></span>
          <span className={conflictTypes.has("line") ? "rule-error" : ""}><b>行和列</b><small>各 1 个</small></span>
          <span className={conflictTypes.has("adjacent") ? "rule-error" : ""}><b>不相邻</b><small>横竖斜都不挨</small></span>
        </div>

        <div className={`puzzle-feedback ${conflicts.size ? "error" : ""} ${scanHintTarget !== null || tidyHighlights.size ? "helper" : ""}`} role="status">
          <span>{conflicts.size ? "!" : scanHintTarget !== null || tidyHighlights.size ? "✦" : "✓"}</span>
          <b>{conflicts.size ? conflictMessage(conflictTypes) : message}</b>
        </div>

        <div
          className={`puzzle-board ${tutorialStep === 2 || tutorialStep === 3 || tutorialStep === 4 ? "tutorial-board-focus" : ""}`}
          role="grid"
          aria-label={`${config.size} 行 ${config.size} 列牛角包摆盘棋盘`}
          style={{ "--puzzle-size": config.size } as CSSProperties}
          onPointerMove={dragAcross}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={endDrag}
        >
          {marks.map((mark, index) => {
            const row = Math.floor(index / config.size); const col = index % config.size;
            const region = puzzle.regions[index];
            const topDifferent = row === 0 || puzzle.regions[index - config.size] !== region;
            const leftDifferent = col === 0 || puzzle.regions[index - 1] !== region;
            const rightDifferent = col === config.size - 1 || puzzle.regions[index + 1] !== region;
            const bottomDifferent = row === config.size - 1 || puzzle.regions[index + config.size] !== region;
            const tutorialTarget = (tutorialStep === 1 && index === tutorialAutoCell) || (tutorialStep === 2 && index === tutorialCrossTarget) || (tutorialStep === 3 && tutorialDragTargets.includes(index)) || (tutorialStep === 4 && index === tutorialNextSolutionCell);
            const scanHighlighted = (scanFocus?.type === "row" && row === scanFocus.value) || (scanFocus?.type === "col" && col === scanFocus.value) || (scanFocus?.type === "region" && region === scanFocus.value);
            return (
              <button
                key={index}
                data-puzzle-index={index}
                className={`puzzle-cell ${mark === 1 ? "crossed" : ""} ${mark === 2 ? "has-croissant" : ""} ${index === puzzle.autoCell ? "system-anchor" : ""} ${conflicts.has(index) ? "conflict" : ""} ${tutorialTarget ? "tutorial-target" : ""} ${scanHighlighted ? "scan-focus" : ""} ${scanHintTarget === index ? "scan-answer" : ""} ${tidyHighlights.has(index) ? "tidy-focus" : ""}`}
                style={{
                  "--region": REGION_COLORS[region % REGION_COLORS.length],
                  borderTopWidth: topDifferent ? 3 : 1,
                  borderLeftWidth: leftDifferent ? 3 : 1,
                  borderRightWidth: rightDifferent ? 3 : 1,
                  borderBottomWidth: bottomDifferent ? 3 : 1,
                } as CSSProperties}
                role="gridcell"
                aria-label={`第 ${row + 1} 行第 ${col + 1} 列，颜色区域 ${region + 1}${index === puzzle.autoCell ? "，系统给定牛角包" : mark === 1 ? "，已排除" : mark === 2 ? "，已放牛角包" : "，空格"}`}
                onPointerDown={(event) => beginDrag(event, index)}
                onPointerUp={endDrag}
                onClick={() => handleCellClick(index)}
                onContextMenu={(event) => event.preventDefault()}
              >
                {mark === 1 && <span className="puzzle-cross">×</span>}
                {mark === 2 && <img src={`${ASSET_ROOT}/croissant.webp`} alt="牛角包" decoding="async" />}
              </button>
            );
          })}
        </div>

        <div className="platter-action-row">
          <button className="platter-restart pressable" onClick={restartCurrentPuzzle} disabled={tutorialStep !== null || status === "won"}><span>↻</span><b>本局重来</b><small>保留当前餐盘</small></button>
          <button className="platter-undo pressable" onClick={undoLastAction} disabled={!undoSnapshot || status === "won" || tutorialStep !== null}><span>↶</span><b>撤回一步</b><small>{undoSnapshot ? "恢复棋盘与失误" : "暂无记录"}</small></button>
        </div>

        <div className={`platter-tools ${tutorialStep === 5 ? "tutorial-target" : ""}`}>
          <button className="prop-button pressable" onClick={() => handleTool("scan")} disabled={toolsLeft.scan <= 0 || tutorialStep !== null}><img src={`${ASSET_ROOT}/339.webp`} alt="" decoding="async" fetchPriority="low" /><span><b>339扫描</b><small>锁定正确格</small></span><i>{toolsLeft.scan}</i></button>
          <button className="prop-button pressable" onClick={() => handleTool("tidy")} disabled={toolsLeft.tidy <= 0 || tutorialStep !== null}><img src={`${ASSET_ROOT}/xiaogu.webp`} alt="" decoding="async" fetchPriority="low" /><span><b>小顾整理</b><small>闪亮批量 ×</small></span><i>{toolsLeft.tidy}</i></button>
          <button className="prop-button pressable" onClick={() => handleTool("intuition")} disabled={toolsLeft.intuition <= 0 || tutorialStep !== null}><img src={`${ASSET_ROOT}/xiaowen.webp`} alt="" decoding="async" fetchPriority="low" /><span><b>小温直觉</b><small>摆对一个</small></span><i>{toolsLeft.intuition}</i></button>
        </div>

        {showIdleHint && <button className="idle-hint-bubble pressable" onClick={() => { setShowIdleHint(false); handleTool("scan"); }}><img src={`${ASSET_ROOT}/339.webp`} alt="" /><span>要不要试试 339 扫描？</span></button>}

        {(status === "won" || status === "failed") && (
          <section className={`platter-result ${status}`} role="status">
            {status === "won" ? <div className="platter-result-art"><img src={`${ASSET_ROOT}/couple-sticker.webp`} alt="小顾和小温贴贴庆祝" decoding="async" loading="lazy" /></div> : <img src={`${ASSET_ROOT}/xiaowen.webp`} alt="小温" decoding="async" />}
            <div><small>{status === "won" ? victory.badge : "TRY AGAIN"}</small><h2>{status === "won" ? victory.title : "摆盘需要调整一下"}</h2><p>{status === "won" ? victory.copy : "保留这张餐盘，从系统给定的第一个牛角包重新推理。"}</p></div>
            <div className="result-actions">
              {status === "failed" && undoSnapshot && <button className="result-button secondary pressable" onClick={undoLastAction}>撤回这步</button>}
              {status === "won" && levelIndex < 11 ? <button className="result-button pressable" onClick={() => resetBoard(levelIndex + 1, 0)}>下一关</button> : status === "won" ? <button className="result-button pressable" onClick={() => setShowLevelPicker(true)}>查看全部关卡</button> : <button className="result-button pressable" onClick={restartCurrentPuzzle}>本局重来</button>}
            </div>
          </section>
        )}
      </section>

      {(!tutorialReady || tutorialStep !== null) && <div className="tutorial-shield" aria-hidden="true" />}
      {tutorialStep !== null && (
        <section className={`tutorial-coach platter-tutorial ${tutorialStep === 0 || tutorialStep === 6 ? "centered" : ""} ${tutorialStep === 5 ? "upper" : ""}`} role="dialog" aria-modal="true" aria-live="polite">
          <div className="tutorial-head"><img src={`${ASSET_ROOT}/xiaowen.webp`} alt="小温" /><span>小温的摆盘课</span><b>{tutorialStep === 0 ? "玩法" : tutorialStep === 6 ? "完成" : `${tutorialStep}/5`}</b></div>
          {tutorialStep === 0 && <><h2>目标：找出所有牛角包的位置</h2><p>一盘有多块颜色区域。你要在每种颜色里放 1 个，同时每行、每列也只能有 1 个，两个牛角包连斜角都不能挨着。</p><div className="tutorial-rule-summary"><b>每色 1 个</b><b>每行列 1 个</b><b>横竖斜不相邻</b></div><p>系统会先放好 1 个，再由你推理剩下的位置。</p><button className="tutorial-button pressable" onClick={startTutorial}>用 4×4 练习盘学会</button></>}
          {tutorialStep === 1 && <><h2>① 系统先放好了一个</h2><p>看高亮牛角包：它所在的<b>颜色区域、整行、整列，以及周围 8 格</b>都不能再放。上方三条规则会一直显示。</p><button className="tutorial-button pressable" onClick={() => setTutorialStep(2)}>明白，从它开始排除</button></>}
          {tutorialStep === 2 && <><h2>② 单击标记“不能放”</h2><p>高亮格紧挨着已有牛角包，斜角相邻也不允许，所以这里肯定不能放。单击它打 ×。</p><span className="tutorial-wait">等待你单击棋盘中央的高亮格…</span></>}
          {tutorialStep === 3 && <><h2>③ 滑动可以连续排除</h2><p>这 3 格与已有牛角包在同一列。按住第一格并向下划过，系统会自动补齐中间经过的格子。</p><span className="tutorial-wait">等待你按住并滑过 3 格…</span></>}
          {tutorialStep === 4 && <><h2>④ 双击摆放下一个</h2><p>排除后，高亮位置满足颜色、行列和不相邻三条规则。请快速双击摆下牛角包。</p><span className="tutorial-wait">等待你双击高亮格…</span></>}
          {tutorialStep === 5 && <><h2>⑤ 点错也不用慌</h2><div className="tutorial-props-list"><span><span className="tutorial-undo-icon">↶</span><b>撤回一步</b><small>只恢复最近一次普通操作，道具次数不会退还</small></span><span><img src={`${ASSET_ROOT}/339.webp`} alt="" /><b>339 扫描</b><small>直接锁定并高亮一个可以正确摆放的位置</small></span><span><img src={`${ASSET_ROOT}/xiaogu.webp`} alt="" /><b>小顾整理</b><small>批量排除并闪亮标出本次新增的所有 ×</small></span><span><img src={`${ASSET_ROOT}/xiaowen.webp`} alt="" /><b>小温直觉</b><small>直接摆好一个确定正确的牛角包</small></span></div><p>道具一经使用不能撤回；想从头推理时，可点“本局重来”。</p><button className="tutorial-button pressable" onClick={() => setTutorialStep(6)}>我学会了</button></>}
          {tutorialStep === 6 && <><h2>现在开始第 1 关吧！</h2><p>系统已经替你放好第一个牛角包。先给它同颜色、同行列和相邻的位置打 ×，再继续推理。</p><button className="tutorial-button pressable" onClick={finishTutorial}>进入正式关卡</button></>}
        </section>
      )}

      {showLevelPicker && tutorialStep === null && (
        <div className="modal-backdrop">
          <section className="level-picker" role="dialog" aria-modal="true" aria-labelledby="level-picker-title">
            <button className="modal-close pressable" onClick={() => setShowLevelPicker(false)} aria-label="关闭关卡选择">×</button>
            <img src={`${ASSET_ROOT}/croissant.webp`} alt="" />
            <span className="mission-tag">12 份摆盘订单</span>
            <h2 id="level-picker-title">选择关卡</h2>
            <p>通过当前最高关卡，才会解锁下一张餐盘。</p>
            <div className="level-grid">
              {LEVELS.map((level, index) => {
                const locked = index + 1 > unlockedLevel;
                return <button key={index} className={`level-tile pressable ${index === levelIndex ? "current" : ""}`} disabled={locked} onClick={() => chooseLevel(index)}><b>{locked ? "🔒" : index + 1}</b><small>{level.size}×{level.size} · {level.tier}</small></button>;
              })}
            </div>
          </section>
        </div>
      )}

      {showRules && (
        <div className="modal-backdrop">
          <section className="help-modal platter-rules" role="dialog" aria-modal="true">
            <button className="modal-close pressable" onClick={() => setShowRules(false)} aria-label="关闭规则">×</button>
            <img src={`${ASSET_ROOT}/xiaowen.webp`} alt="小温" />
            <span className="mission-tag">摆盘规则</span><h2>三个条件要同时满足</h2>
            <ol><li><b>开局给定</b>：系统先放好一个带星标的牛角包，它不能拿走，是整盘推理的起点。</li><li><b>颜色唯一</b>：每种颜色区域恰好放 1 个牛角包。</li><li><b>行列唯一</b>：每一行、每一列恰好放 1 个。</li><li><b>不能相邻</b>：横、竖、斜方向挨着都不可以。</li><li><b>操作</b>：单击立即打 ×，双击摆放或拿走；按住或直接滑动会连续补齐 ×。</li><li><b>道具与撤回</b>：339 锁定正确格，小顾批量排除；道具一经使用不能撤回，次数也不会退还。</li></ol>
            <button className="primary-button pressable" onClick={() => setShowRules(false)}>继续摆盘</button>
          </section>
        </div>
      )}
    </main>
  );
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
}
