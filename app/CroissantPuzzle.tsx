"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useGameAudio } from "./useGameAudio";

type PuzzleStatus = "ready" | "playing" | "won" | "failed";
type PuzzleMark = 0 | 1 | 2;
type PuzzleTutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | null;
type ToolCounts = { scan: number; tidy: number; intuition: number };

type LevelConfig = {
  size: number;
  mistakeLimit: number;
  tools: ToolCounts;
};

const ASSET_ROOT = "assets";
const PUZZLE_TUTORIAL_KEY = "croissant-platter-tutorial-v1-complete";
const PUZZLE_PROGRESS_KEY = "croissant-platter-unlocked";
const REGION_COLORS = ["#f9dfcf", "#f8eab8", "#dcebcf", "#d9e9ec", "#e2ddf1", "#f2d9e4", "#e6d6c5", "#d8eadf"];

const LEVELS: LevelConfig[] = [
  { size: 4, mistakeLimit: 5, tools: { scan: 2, tidy: 1, intuition: 1 } },
  { size: 4, mistakeLimit: 4, tools: { scan: 2, tidy: 1, intuition: 1 } },
  { size: 5, mistakeLimit: 4, tools: { scan: 2, tidy: 2, intuition: 1 } },
  { size: 5, mistakeLimit: 4, tools: { scan: 2, tidy: 2, intuition: 1 } },
  { size: 5, mistakeLimit: 3, tools: { scan: 2, tidy: 2, intuition: 1 } },
  { size: 6, mistakeLimit: 3, tools: { scan: 3, tidy: 2, intuition: 2 } },
  { size: 6, mistakeLimit: 3, tools: { scan: 3, tidy: 2, intuition: 2 } },
  { size: 6, mistakeLimit: 2, tools: { scan: 3, tidy: 2, intuition: 2 } },
  { size: 7, mistakeLimit: 2, tools: { scan: 3, tidy: 2, intuition: 2 } },
  { size: 7, mistakeLimit: 2, tools: { scan: 4, tidy: 3, intuition: 2 } },
  { size: 8, mistakeLimit: 2, tools: { scan: 4, tidy: 3, intuition: 2 } },
  { size: 8, mistakeLimit: 1, tools: { scan: 4, tidy: 3, intuition: 2 } },
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
  return { solution, solutionCells: new Set(queenCells), regions };
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
  const [marks, setMarks] = useState<PuzzleMark[]>(() => Array(16).fill(0));
  const marksRef = useRef<PuzzleMark[]>(marks);
  const [conflicts, setConflicts] = useState<Set<number>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const mistakesRef = useRef(0);
  const [status, setStatus] = useState<PuzzleStatus>("ready");
  const [toolsLeft, setToolsLeft] = useState<ToolCounts>(() => toolCounts(LEVELS[0]));
  const [unlockedLevel, setUnlockedLevel] = useState(1);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [message, setMessage] = useState("每种颜色、每行、每列都要恰好摆 1 个牛角包。");
  const [scanFocus, setScanFocus] = useState<{ type: "row" | "col" | "region"; value: number } | null>(null);
  const [tutorialStep, setTutorialStep] = useState<PuzzleTutorialStep>(null);
  const [tutorialReady, setTutorialReady] = useState(false);
  const [showIdleHint, setShowIdleHint] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const hintedRef = useRef(false);
  const pendingTap = useRef<{ index: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const {
    musicEnabled, playSfx, setMusicEnabled, setSfxEnabled, sfxEnabled, unlockAudio,
  } = useGameAudio(false);

  const tutorialSolutionCell = puzzle.solution[0];
  const tutorialCrossTarget = tutorialSolutionCell === 0 ? 1 : 0;
  const tutorialDragTargets = useMemo(() => {
    const row = 1;
    return [row * config.size, row * config.size + 1, row * config.size + 2];
  }, [config.size]);

  const resetBoard = useCallback((nextLevel = levelIndex, nextVariant = variant) => {
    const nextConfig = LEVELS[nextLevel];
    const empty = Array(nextConfig.size * nextConfig.size).fill(0) as PuzzleMark[];
    marksRef.current = empty;
    mistakesRef.current = 0;
    setLevelIndex(nextLevel);
    setVariant(nextVariant);
    setMarks(empty);
    setConflicts(new Set());
    setMistakes(0);
    setToolsLeft(toolCounts(nextConfig));
    setStatus("ready");
    setScanFocus(null);
    setShowIdleHint(false);
    hintedRef.current = false;
    setActivityTick((value) => value + 1);
    setMessage("每种颜色、每行、每列都要恰好摆 1 个牛角包。");
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

  const applyMark = useCallback((index: number, nextMark: PuzzleMark, countConflict = true) => {
    const current = marksRef.current;
    if (current[index] === nextMark || status === "won" || status === "failed") return;
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
      setMessage("这两个位置撞规则啦，红框会提示冲突，重新调整就好。");
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
    playSfx(nextMark === 2 ? "flag" : "click");
  }, [config.mistakeLimit, config.size, finishLevel, playSfx, puzzle.regions, status, tutorialStep]);

  const tutorialAllows = useCallback((index: number, kind: "cross" | "place") => {
    if (tutorialStep === null) return true;
    if (tutorialStep === 1) return kind === "cross" && index === tutorialCrossTarget;
    if (tutorialStep === 2) return kind === "place" && index === tutorialSolutionCell;
    if (tutorialStep === 3) return kind === "cross" && tutorialDragTargets.includes(index);
    return false;
  }, [tutorialDragTargets, tutorialSolutionCell, tutorialStep, tutorialCrossTarget]);

  const markCross = useCallback((index: number) => {
    if (!tutorialAllows(index, "cross")) return;
    if (tutorialStep === 3) return;
    const current = marksRef.current[index];
    if (current === 2) return;
    applyMark(index, current === 1 ? 0 : 1, tutorialStep === null);
    if (tutorialStep === 1) setTutorialStep(2);
    if (tutorialStep === 3) {
      const next = marksRef.current;
      if (tutorialDragTargets.every((target) => next[target] === 1)) setTutorialStep(4);
    }
  }, [applyMark, tutorialAllows, tutorialDragTargets, tutorialStep]);

  const toggleCroissant = useCallback((index: number) => {
    if (!tutorialAllows(index, "place")) return;
    applyMark(index, marksRef.current[index] === 2 ? 0 : 2, tutorialStep === null);
    if (tutorialStep === 2 && marksRef.current[index] === 2) setTutorialStep(3);
  }, [applyMark, tutorialAllows, tutorialStep]);

  const handleCellClick = (index: number) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (tutorialStep !== null && tutorialStep !== 1 && tutorialStep !== 2 && tutorialStep !== 3) return;
    if (pendingTap.current?.index === index) {
      clearTimeout(pendingTap.current.timer);
      pendingTap.current = null;
      toggleCroissant(index);
      return;
    }
    if (pendingTap.current) {
      clearTimeout(pendingTap.current.timer);
      markCross(pendingTap.current.index);
    }
    const timer = setTimeout(() => {
      pendingTap.current = null;
      markCross(index);
    }, 230);
    pendingTap.current = { index, timer };
  };

  const pointerIndex = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-puzzle-index]");
    return element ? Number(element.dataset.puzzleIndex) : null;
  };

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (marksRef.current[index] === 2 || (tutorialStep !== null && tutorialStep !== 3)) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      dragging.current = true;
      suppressClick.current = true;
      if (pendingTap.current) { clearTimeout(pendingTap.current.timer); pendingTap.current = null; }
      if (marksRef.current[index] !== 1) applyMark(index, 1, false);
      vibrate(18);
    }, 260);
  };

  const dragAcross = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const index = pointerIndex(event);
    if (index === null || marksRef.current[index] === 2 || !tutorialAllows(index, "cross")) return;
    if (marksRef.current[index] !== 1) applyMark(index, 1, false);
    if (tutorialStep === 3 && tutorialDragTargets.every((target) => marksRef.current[target] === 1)) setTutorialStep(4);
  };

  const endDrag = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    dragging.current = false;
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
    if (tool === "scan") {
      const candidates = puzzle.solution.map((col, row) => row * config.size + col).filter((index) => marksRef.current[index] !== 2);
      if (!candidates.length) return;
      const target = candidates[0];
      const row = Math.floor(target / config.size);
      const col = target % config.size;
      const type = (["row", "col", "region"] as const)[toolsLeft.scan % 3];
      const value = type === "row" ? row : type === "col" ? col : puzzle.regions[target];
      const label = type === "row" ? `第 ${row + 1} 行` : type === "col" ? `第 ${col + 1} 列` : `颜色区域 ${value + 1}`;
      setScanFocus({ type, value });
      setMessage(`339：观察${label}，有一个位置能同时满足三条规则。`);
      window.setTimeout(() => setScanFocus(null), 2400);
      playSfx("help");
    }
    if (tool === "tidy") {
      const placed = marksRef.current.map((mark, index) => ({ mark, index })).filter(({ mark }) => mark === 2).map(({ index }) => index);
      const next = [...marksRef.current];
      next.forEach((mark, index) => {
        if (mark !== 0) return;
        const row = Math.floor(index / config.size); const col = index % config.size;
        if (placed.some((placedIndex) => {
          const placedRow = Math.floor(placedIndex / config.size); const placedCol = placedIndex % config.size;
          return row === placedRow || col === placedCol || puzzle.regions[index] === puzzle.regions[placedIndex] || (Math.abs(row - placedRow) <= 1 && Math.abs(col - placedCol) <= 1);
        })) next[index] = 1;
      });
      marksRef.current = next;
      setMarks(next);
      setMessage("小顾把已经能排除的位置都整理好啦。");
      playSfx("flag");
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
      applyMark(candidates[0], 2, false);
      if (!solved(marksRef.current, config.size, puzzle.regions)) {
        setMessage("小温的直觉命中！这里可以安心放牛角包。");
        playSfx("reveal");
      }
    }
    setToolsLeft((current) => ({ ...current, [tool]: current[tool] - 1 }));
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
  const allMuted = !musicEnabled && !sfxEnabled;

  return (
    <main className={`game-shell platter-shell ${!tutorialReady || tutorialStep !== null ? "tutorial-active" : ""}`} onPointerDown={unlockAudio}>
      <header className="topbar platter-topbar">
        <button className="brand-mark mode-back pressable" onClick={onBack} aria-label="返回游戏模式选择"><img src={`${ASSET_ROOT}/xiaowen.png`} alt="小温" /><span>‹</span></button>
        <div className="title-block"><p className="eyebrow">CROISSANT LOGIC</p><h1>牛角包摆盘</h1></div>
        <div className="top-actions">
          <button className={`round-button audio-button pressable ${allMuted ? "muted" : ""}`} onClick={() => { setMusicEnabled(allMuted); setSfxEnabled(allMuted); if (!allMuted) playSfx("click"); }} aria-label={allMuted ? "打开声音" : "关闭声音"}>♫</button>
          <button className="round-button pressable" onClick={() => { playSfx("click"); setShowRules(true); }} aria-label="查看摆盘规则">?</button>
        </div>
      </header>

      <section className="platter-mission">
        <img src={`${ASSET_ROOT}/xiaowen.png`} alt="小温" />
        <div><span>小温的摆盘课</span><b>{message}</b></div>
        <img src={`${ASSET_ROOT}/croissant.png`} alt="牛角包" />
      </section>

      <section className={`platter-panel ${status}`} aria-label={`牛角包摆盘第 ${levelIndex + 1} 关`}>
        <div className="platter-levelbar">
          <button className="level-menu-button pressable" onClick={() => setShowLevelPicker(true)}><span>第 {levelIndex + 1} 关</span><small>{config.size} × {config.size} ▾</small></button>
          <div className="platter-progress"><span>已摆</span><b>{placedCount}/{config.size}</b></div>
          <div className={`mistake-meter ${mistakes > config.mistakeLimit ? "danger" : ""}`}><span>失误</span><b>{mistakes}/{config.mistakeLimit}</b></div>
        </div>

        <div
          className="puzzle-board"
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
            const tutorialTarget = (tutorialStep === 1 && index === tutorialCrossTarget) || (tutorialStep === 2 && index === tutorialSolutionCell) || (tutorialStep === 3 && tutorialDragTargets.includes(index));
            const scanHighlighted = (scanFocus?.type === "row" && row === scanFocus.value) || (scanFocus?.type === "col" && col === scanFocus.value) || (scanFocus?.type === "region" && region === scanFocus.value);
            return (
              <button
                key={index}
                data-puzzle-index={index}
                className={`puzzle-cell ${mark === 1 ? "crossed" : ""} ${mark === 2 ? "has-croissant" : ""} ${conflicts.has(index) ? "conflict" : ""} ${tutorialTarget ? "tutorial-target" : ""} ${scanHighlighted ? "scan-focus" : ""}`}
                style={{
                  "--region": REGION_COLORS[region % REGION_COLORS.length],
                  borderTopWidth: topDifferent ? 3 : 1,
                  borderLeftWidth: leftDifferent ? 3 : 1,
                  borderRightWidth: rightDifferent ? 3 : 1,
                  borderBottomWidth: bottomDifferent ? 3 : 1,
                } as CSSProperties}
                role="gridcell"
                aria-label={`第 ${row + 1} 行第 ${col + 1} 列，颜色区域 ${region + 1}${mark === 1 ? "，已排除" : mark === 2 ? "，已放牛角包" : "，空格"}`}
                onPointerDown={(event) => beginDrag(event, index)}
                onPointerUp={endDrag}
                onClick={() => handleCellClick(index)}
                onContextMenu={(event) => event.preventDefault()}
              >
                {mark === 1 && <span className="puzzle-cross">×</span>}
                {mark === 2 && <img src={`${ASSET_ROOT}/croissant.png`} alt="牛角包" />}
              </button>
            );
          })}
        </div>

        <p className="platter-gesture-tip">单击打 × · 双击摆牛角包 · 按住划过可批量排除</p>

        <div className={`platter-tools ${tutorialStep === 4 ? "tutorial-target" : ""}`}>
          <button className="prop-button pressable" onClick={() => handleTool("scan")} disabled={toolsLeft.scan <= 0 || tutorialStep !== null}><img src={`${ASSET_ROOT}/339.png`} alt="" /><span><b>339扫描</b><small>提示一行</small></span><i>{toolsLeft.scan}</i></button>
          <button className="prop-button pressable" onClick={() => handleTool("tidy")} disabled={toolsLeft.tidy <= 0 || tutorialStep !== null}><img src={`${ASSET_ROOT}/xiaogu.png`} alt="" /><span><b>小顾整理</b><small>批量排除</small></span><i>{toolsLeft.tidy}</i></button>
          <button className="prop-button pressable" onClick={() => handleTool("intuition")} disabled={toolsLeft.intuition <= 0 || tutorialStep !== null}><img src={`${ASSET_ROOT}/xiaowen.png`} alt="" /><span><b>小温直觉</b><small>摆对一个</small></span><i>{toolsLeft.intuition}</i></button>
        </div>

        {showIdleHint && <button className="idle-hint-bubble pressable" onClick={() => { setShowIdleHint(false); handleTool("scan"); }}><img src={`${ASSET_ROOT}/339.png`} alt="" /><span>要不要试试 339 扫描？</span></button>}

        {(status === "won" || status === "failed") && (
          <section className={`platter-result ${status}`} role="status">
            <img src={`${ASSET_ROOT}/${status === "won" ? "success-bakery.jpg" : "xiaowen.png"}`} alt="" />
            <div><small>{status === "won" ? "LEVEL CLEAR" : "TRY A NEW PLATE"}</small><h2>{status === "won" ? `第 ${levelIndex + 1} 关完成！` : "摆盘需要调整一下"}</h2><p>{status === "won" ? "每个区域和每行每列都刚刚好。" : "重试会生成同尺寸、但颜色区域不同的新棋盘。"}</p></div>
            <div className="result-actions">
              {status === "won" && levelIndex < 11 ? <button className="result-button pressable" onClick={() => resetBoard(levelIndex + 1, 0)}>下一关</button> : status === "won" ? <button className="result-button pressable" onClick={() => setShowLevelPicker(true)}>查看全部关卡</button> : <button className="result-button pressable" onClick={() => resetBoard(levelIndex, variant + 1)}>换盘重试</button>}
            </div>
          </section>
        )}
      </section>

      {(!tutorialReady || tutorialStep !== null) && <div className="tutorial-shield" aria-hidden="true" />}
      {tutorialStep !== null && (
        <section className={`tutorial-coach platter-tutorial ${tutorialStep === 0 || tutorialStep === 5 ? "centered" : ""} ${tutorialStep === 4 ? "upper" : ""}`} role="dialog" aria-modal="true" aria-live="polite">
          <div className="tutorial-head"><img src={`${ASSET_ROOT}/xiaowen.png`} alt="小温" /><span>小温的摆盘课</span><b>{tutorialStep === 0 ? "欢迎" : tutorialStep === 5 ? "完成" : `${tutorialStep}/4`}</b></div>
          {tutorialStep === 0 && <><h2>欢迎来到牛角包摆盘！</h2><p>我是小温，接下来只能操作高亮区域。跟我走完固定 4×4 练习盘，再开始正式第 1 关。</p><button className="tutorial-button pressable" onClick={startTutorial}>开始教学</button></>}
          {tutorialStep === 1 && <><h2>① 先排除不能放的位置</h2><p>高亮格肯定不能放牛角包，单击它打一个 ×。</p><span className="tutorial-wait">等待你单击高亮格…</span></>}
          {tutorialStep === 2 && <><h2>② 摆下第一个牛角包</h2><p>这个位置同时满足颜色、行列和不相邻规则。请快速双击高亮格。</p><span className="tutorial-wait">等待你双击摆放…</span></>}
          {tutorialStep === 3 && <><h2>③ 批量排除更快</h2><p>按住第一个高亮格，再拖动划过另外两格，一次把它们都打上 ×。</p><span className="tutorial-wait">等待你按住并划过…</span></>}
          {tutorialStep === 4 && <><h2>④ 认识三位帮手</h2><div className="tutorial-props-list"><span><img src={`${ASSET_ROOT}/339.png`} alt="" /><b>339 扫描</b><small>高亮一行、列或区域，提示推理方向</small></span><span><img src={`${ASSET_ROOT}/xiaogu.png`} alt="" /><b>小顾整理</b><small>批量打 ×，清掉已确定不能放的位置</small></span><span><img src={`${ASSET_ROOT}/xiaowen.png`} alt="" /><b>小温直觉</b><small>直接摆好一个确定正确的牛角包</small></span></div><p>头像变灰代表本关次数用完。</p><button className="tutorial-button pressable" onClick={() => setTutorialStep(5)}>我学会了</button></>}
          {tutorialStep === 5 && <><h2>现在开始第 1 关吧！</h2><p>目标是摆满 {config.size} 个牛角包：每种颜色、每行、每列各一个，而且任何两个都不能相邻。</p><button className="tutorial-button pressable" onClick={finishTutorial}>进入正式关卡</button></>}
        </section>
      )}

      {showLevelPicker && tutorialStep === null && (
        <div className="modal-backdrop">
          <section className="level-picker" role="dialog" aria-modal="true" aria-labelledby="level-picker-title">
            <button className="modal-close pressable" onClick={() => setShowLevelPicker(false)} aria-label="关闭关卡选择">×</button>
            <img src={`${ASSET_ROOT}/croissant.png`} alt="" />
            <span className="mission-tag">12 份摆盘订单</span>
            <h2 id="level-picker-title">选择关卡</h2>
            <p>通过当前最高关卡，才会解锁下一张餐盘。</p>
            <div className="level-grid">
              {LEVELS.map((level, index) => {
                const locked = index + 1 > unlockedLevel;
                return <button key={index} className={`level-tile pressable ${index === levelIndex ? "current" : ""}`} disabled={locked} onClick={() => chooseLevel(index)}><b>{locked ? "🔒" : index + 1}</b><small>{level.size}×{level.size}</small></button>;
              })}
            </div>
          </section>
        </div>
      )}

      {showRules && (
        <div className="modal-backdrop">
          <section className="help-modal platter-rules" role="dialog" aria-modal="true">
            <button className="modal-close pressable" onClick={() => setShowRules(false)} aria-label="关闭规则">×</button>
            <img src={`${ASSET_ROOT}/xiaowen.png`} alt="小温" />
            <span className="mission-tag">摆盘规则</span><h2>三个条件要同时满足</h2>
            <ol><li><b>颜色唯一</b>：每种颜色区域恰好放 1 个牛角包。</li><li><b>行列唯一</b>：每一行、每一列恰好放 1 个。</li><li><b>不能相邻</b>：横、竖、斜方向挨着都不可以。</li><li><b>操作</b>：单击打 ×，双击摆放或拿走，按住划过可批量打 ×。</li><li><b>冲突提示</b>：红框只提醒，不会阻止操作；超过本关失误上限才会失败。</li></ol>
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
