"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useGameAudio } from "./useGameAudio";

type Breakfast = "croissant" | "bread" | null;
type GameStatus = "idle" | "playing" | "won" | "lost";
type DifficultyKey = "cozy" | "date" | "robot";
type TutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | null;

type Cell = {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  nearby: number;
  breakfast: Breakfast;
};

type GameSnapshot = {
  cells: Cell[];
  status: GameStatus;
  generated: boolean;
  seconds: number;
  scanUsed: boolean;
  message: string;
  best: number | null;
};

const DIFFICULTIES = {
  cozy: { label: "简单", rows: 9, cols: 9, mines: 10, breakfast: { min: 3, max: 5 } },
  date: { label: "中等", rows: 10, cols: 10, mines: 16, breakfast: { min: 5, max: 8 } },
  robot: { label: "复杂", rows: 11, cols: 11, mines: 23, breakfast: { min: 8, max: 12 } },
} as const;

const ASSET_ROOT = "assets";
const TUTORIAL_REVEAL_TARGET = 40;
const TUTORIAL_MINE_TARGET = 41;
const TUTORIAL_STORAGE_KEY = "bakery-tutorial-v2-complete";

function buildTutorialBoard() {
  const board = emptyCells(81);
  [0, 8, 9, 17, 41, 63, 71, 72, 76, 80].forEach((index) => { board[index].mine = true; });
  board.forEach((cell, index) => {
    if (!cell.mine) cell.nearby = neighbors(index, 9, 9).filter((neighbor) => board[neighbor].mine).length;
  });
  return board;
}

function randomBreakfastGoal(difficulty: DifficultyKey) {
  const { min, max } = DIFFICULTIES[difficulty].breakfast;
  return min + Math.floor(Math.random() * (max - min + 1));
}

const emptyCells = (count: number): Cell[] =>
  Array.from({ length: count }, () => ({
    mine: false,
    revealed: false,
    flagged: false,
    nearby: 0,
    breakfast: null,
  }));

function neighbors(index: number, rows: number, cols: number) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const list: number[] = [];
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      const nextRow = row + rowOffset;
      const nextCol = col + colOffset;
      if (
        (rowOffset !== 0 || colOffset !== 0) &&
        nextRow >= 0 && nextRow < rows && nextCol >= 0 && nextCol < cols
      ) {
        list.push(nextRow * cols + nextCol);
      }
    }
  }
  return list;
}

function shuffled(values: number[]) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildBoard(
  rows: number,
  cols: number,
  mineCount: number,
  breakfastCount: number,
  safeIndex: number,
) {
  const board = emptyCells(rows * cols);
  const protectedCells = new Set([safeIndex, ...neighbors(safeIndex, rows, cols)]);
  const available = shuffled(
    board.map((_, index) => index).filter((index) => !protectedCells.has(index)),
  );
  const mineIndexes = available.slice(0, mineCount);
  mineIndexes.forEach((index) => { board[index].mine = true; });

  const safeSpots = shuffled(
    board.map((cell, index) => ({ cell, index })).filter(({ cell }) => !cell.mine).map(({ index }) => index),
  );
  safeSpots.slice(0, breakfastCount).forEach((index, order) => {
    board[index].breakfast = order % 2 === 0 ? "croissant" : "bread";
  });

  board.forEach((cell, index) => {
    if (!cell.mine) {
      cell.nearby = neighbors(index, rows, cols).filter((neighbor) => board[neighbor].mine).length;
    }
  });
  return board;
}

function floodReveal(source: Cell[], start: number, rows: number, cols: number) {
  const board = source.map((cell) => ({ ...cell }));
  const queue = [start];
  const visited = new Set<number>();
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current) || board[current].flagged || board[current].mine) continue;
    visited.add(current);
    board[current].revealed = true;
    if (board[current].nearby === 0) {
      neighbors(current, rows, cols).forEach((neighbor) => {
        if (!visited.has(neighbor) && !board[neighbor].mine) queue.push(neighbor);
      });
    }
  }
  return board;
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
}

export default function Home() {
  const [difficulty, setDifficulty] = useState<DifficultyKey>("cozy");
  const config = DIFFICULTIES[difficulty];
  const [breakfastGoal, setBreakfastGoal] = useState(DIFFICULTIES.cozy.breakfast.min);
  const [cells, setCells] = useState<Cell[]>(() => emptyCells(config.rows * config.cols));
  const [status, setStatus] = useState<GameStatus>("idle");
  const [generated, setGenerated] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [scanUsed, setScanUsed] = useState(false);
  const [hintCell, setHintCell] = useState<number | null>(null);
  const [message, setMessage] = useState("小顾出发啦！帮小温找到最喜欢的牛角包。");
  const [showHelp, setShowHelp] = useState(false);
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [best, setBest] = useState<number | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<GameSnapshot | null>(null);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(null);
  const [tutorialChecked, setTutorialChecked] = useState(false);
  const pendingTap = useRef<{ index: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const {
    audioUnlocked,
    musicEnabled,
    musicLoop,
    musicVolume,
    playSfx,
    setMusicEnabled,
    setMusicLoop,
    setMusicVolume,
    setSfxEnabled,
    setSfxVolume,
    sfxEnabled,
    sfxVolume,
    unlockAudio,
  } = useGameAudio(isPaused);

  useEffect(() => {
    const saved = window.localStorage.getItem(`bakery-best-${difficulty}`);
    setBest(saved ? Number(saved) : null);
  }, [difficulty]);

  useEffect(() => {
    setBreakfastGoal(randomBreakfastGoal("cozy"));
    if (!window.localStorage.getItem(TUTORIAL_STORAGE_KEY)) setTutorialStep(0);
    setTutorialChecked(true);
  }, []);

  useEffect(() => {
    if (status !== "playing" || isPaused) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.min(value + 1, 999)), 1000);
    return () => window.clearInterval(timer);
  }, [isPaused, status]);

  useEffect(() => () => {
    if (pendingTap.current) clearTimeout(pendingTap.current.timer);
  }, []);

  useEffect(() => {
    if (tutorialStep === 1 && cells[TUTORIAL_REVEAL_TARGET]?.revealed) {
      setTutorialStep(2);
    }
    if (tutorialStep === 3 && cells[TUTORIAL_MINE_TARGET]?.flagged) setTutorialStep(4);
    if (tutorialStep === 5 && scanUsed && hintCell === null) setTutorialStep(6);
  }, [cells, hintCell, scanUsed, tutorialStep]);

  const restart = useCallback((nextDifficulty: DifficultyKey = difficulty) => {
    playSfx("click");
    if (pendingTap.current) clearTimeout(pendingTap.current.timer);
    pendingTap.current = null;
    const next = DIFFICULTIES[nextDifficulty];
    setDifficulty(nextDifficulty);
    setBreakfastGoal(randomBreakfastGoal(nextDifficulty));
    setCells(emptyCells(next.rows * next.cols));
    setStatus("idle");
    setGenerated(false);
    setSeconds(0);
    setScanUsed(false);
    setHintCell(null);
    setIsPaused(false);
    setUndoSnapshot(null);
    setMessage("小顾出发啦！帮小温找到最喜欢的牛角包。");
  }, [difficulty, playSfx]);

  const breakfastFound = useMemo(
    () => {
      const foundOnBoard = cells.filter((cell) => cell.revealed && cell.breakfast).length;
      return status === "won" ? Math.min(breakfastGoal, foundOnBoard + 1) : foundOnBoard;
    },
    [breakfastGoal, cells, status],
  );
  const flagsUsed = useMemo(() => cells.filter((cell) => cell.flagged).length, [cells]);

  const saveUndoSnapshot = useCallback(() => {
    setUndoSnapshot({
      cells: cells.map((cell) => ({ ...cell })),
      status,
      generated,
      seconds,
      scanUsed,
      message,
      best,
    });
  }, [best, cells, generated, message, scanUsed, seconds, status]);

  const undoLastStep = useCallback(() => {
    if (!undoSnapshot || isPaused || (tutorialStep !== null && tutorialStep !== 4)) return;
    if (pendingTap.current) clearTimeout(pendingTap.current.timer);
    pendingTap.current = null;
    setCells(undoSnapshot.cells.map((cell) => ({ ...cell })));
    setStatus(undoSnapshot.status);
    setGenerated(undoSnapshot.generated);
    setSeconds(undoSnapshot.seconds);
    setScanUsed(undoSnapshot.scanUsed);
    setHintCell(null);
    setBest(undoSnapshot.best);
    const storageKey = `bakery-best-${difficulty}`;
    if (undoSnapshot.best === null) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, String(undoSnapshot.best));
    setMessage("339：上一步已经撤回啦。");
    setUndoSnapshot(null);
    if (tutorialStep === 4) setTutorialStep(5);
    playSfx("click");
    vibrate(18);
  }, [difficulty, isPaused, playSfx, tutorialStep, undoSnapshot]);

  const finishWin = useCallback((time: number) => {
    playSfx("win");
    setStatus("won");
    setMessage("扫雷完成！339 送上最后一份牛角包，小温的早餐收集完毕 ♡");
    vibrate([45, 35, 45, 35, 80]);
    const storageKey = `bakery-best-${difficulty}`;
    const previous = Number(window.localStorage.getItem(storageKey) || 0);
    if (!previous || time < previous) {
      window.localStorage.setItem(storageKey, String(time));
      setBest(time);
    }
  }, [difficulty, playSfx]);

  const reveal = useCallback((index: number) => {
    if (status === "won" || status === "lost" || isPaused) return;
    if (tutorialStep !== null && tutorialStep !== 1 && tutorialStep !== 5) return;
    if (tutorialStep === 1 && index !== TUTORIAL_REVEAL_TARGET) return;
    let working = cells;
    if (!generated) {
      working = tutorialStep === 1
        ? buildTutorialBoard()
        : buildBoard(config.rows, config.cols, config.mines, breakfastGoal - 1, index);
      cells.forEach((cell, cellIndex) => { if (cell.flagged) working[cellIndex].flagged = true; });
      setGenerated(true);
      setStatus("playing");
      setMessage("339：扫描正常！数字是周围烤焦面包的数量。");
    }
    const chosen = working[index];
    if (chosen.revealed || chosen.flagged) return;
    saveUndoSnapshot();
    if (chosen.mine) {
      const lostBoard = working.map((cell) => cell.mine ? { ...cell, revealed: true } : cell);
      setCells(lostBoard);
      setStatus("lost");
      setMessage("烤过头啦！339 已启动厨房降温程序。");
      playSfx("lose");
      vibrate([100, 55, 140]);
      return;
    }
    const foundBeforeReveal = working.filter((cell) => cell.revealed && cell.breakfast).length;
    const next = tutorialStep === 1
      ? working.map((cell, cellIndex) => cellIndex === index ? { ...cell, revealed: true } : { ...cell })
      : floodReveal(working, index, config.rows, config.cols);
    setCells(next);
    const foundAfterReveal = next.filter((cell) => cell.revealed && cell.breakfast).length;
    if (foundAfterReveal > foundBeforeReveal && foundAfterReveal === breakfastGoal - 1) {
      setMessage("棋盘里的早餐都找到了！完成扫雷即可解锁最后一份牛角包。");
      vibrate(35);
    } else if (foundAfterReveal > foundBeforeReveal) {
      setMessage("找到新的早餐！小温的眼睛亮起来了。");
      vibrate(35);
    }
    if (tutorialStep === null && next.every((cell) => cell.mine || cell.revealed)) finishWin(seconds);
    else playSfx("reveal");
  }, [breakfastGoal, cells, config, finishWin, generated, isPaused, playSfx, saveUndoSnapshot, seconds, status, tutorialStep]);

  const toggleFlag = useCallback((index: number) => {
    if (status === "won" || status === "lost" || isPaused || cells[index].revealed) return;
    if (tutorialStep !== null && (tutorialStep !== 3 || index !== TUTORIAL_MINE_TARGET)) return;
    if (!cells[index].flagged && flagsUsed >= config.mines) {
      setMessage("小顾贴纸已经用完啦。再检查一下标记的位置吧！");
      return;
    }
    saveUndoSnapshot();
    setCells((current) => current.map((cell, cellIndex) =>
      cellIndex === index ? { ...cell, flagged: !cell.flagged } : cell,
    ));
    setMessage(cells[index].flagged ? "收回一张小顾贴纸。" : "小顾贴纸：这里可能有烤焦面包！" );
    playSfx("flag");
    vibrate(22);
  }, [cells, config.mines, flagsUsed, isPaused, playSfx, saveUndoSnapshot, status, tutorialStep]);

  const handleCellClick = (index: number) => {
    if (hintCell !== null || isPaused) return;
    if (tutorialStep !== null && tutorialStep !== 1 && tutorialStep !== 3) return;
    if (tutorialStep === 1 && index !== TUTORIAL_REVEAL_TARGET) return;
    if (tutorialStep === 3 && index !== TUTORIAL_MINE_TARGET) return;
    if (pendingTap.current?.index === index) {
      clearTimeout(pendingTap.current.timer);
      pendingTap.current = null;
      toggleFlag(index);
      return;
    }
    if (pendingTap.current) {
      clearTimeout(pendingTap.current.timer);
      reveal(pendingTap.current.index);
    }
    const timer = setTimeout(() => {
      pendingTap.current = null;
      reveal(index);
    }, 250);
    pendingTap.current = { index, timer };
  };

  const closeHelp = () => {
    playSfx("click");
    window.localStorage.setItem("bakery-guide-seen", "1");
    setShowHelp(false);
  };

  const startTutorial = () => {
    restart("cozy");
    setShowHelp(false);
    setTutorialStep(1);
  };

  const confirmNumberLesson = () => {
    if (tutorialStep !== 2) return;
    const safeNeighbors = new Set(neighbors(TUTORIAL_REVEAL_TARGET, 9, 9).filter((index) => index !== TUTORIAL_MINE_TARGET));
    setCells((current) => current.map((cell, index) => safeNeighbors.has(index) ? { ...cell, revealed: true } : cell));
    setMessage("339：周围 7 格已经确认安全，剩下的 1 格就是危险位置。");
    setTutorialStep(3);
    playSfx("click");
  };

  const finishTutorial = () => {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "1");
    window.localStorage.setItem("bakery-guide-seen", "1");
    setTutorialStep(null);
    restart("cozy");
  };

  const useScan = () => {
    if (scanUsed || isPaused) return;
    if (tutorialStep !== null && tutorialStep !== 5) return;
    playSfx("help");
    if (!generated) {
      setMessage("339：先翻开一格，我才能校准安全扫描。");
      vibrate(18);
      return;
    }
    const candidates = cells
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => !cell.mine && !cell.revealed && !cell.flagged);
    if (!candidates.length) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)].index;
    setScanUsed(true);
    setHintCell(target);
    setMessage("339：滴——发现一格绝对安全区！");
    vibrate([22, 30, 22]);
    window.setTimeout(() => {
      setHintCell(null);
      reveal(target);
    }, 720);
  };

  const characterLine = status === "won"
    ? "小温：是小顾准备的！全都是我喜欢的 ♡"
    : status === "lost"
      ? "小顾：没关系，我们再烤一炉。"
      : message;

  return (
    <main className={`game-shell ${!tutorialChecked || tutorialStep !== null ? "tutorial-active" : ""}`} onPointerDown={unlockAudio}>
      <img className="floating-food floating-croissant" src={`${ASSET_ROOT}/croissant.png`} alt="" aria-hidden="true" />
      <img className="floating-food floating-bread" src={`${ASSET_ROOT}/bread.png`} alt="" aria-hidden="true" />

      <header className="topbar">
        <div className="brand-mark"><img src={`${ASSET_ROOT}/339.png`} alt="339 机器人" /></div>
        <div className="title-block">
          <p className="eyebrow">339&apos;s bakery protocol</p>
          <h1>心动烘焙扫雷</h1>
        </div>
        <div className="top-actions">
          <button
            className={`round-button audio-button pressable ${!musicEnabled && !sfxEnabled ? "muted" : ""}`}
            onClick={() => { playSfx("click"); setShowAudioSettings(true); }}
            aria-label="打开声音设置"
          >♫</button>
          <button className="round-button pressable" onClick={() => { playSfx("click"); setShowHelp(true); }} aria-label="查看游戏说明">?</button>
        </div>
      </header>

      <section className="mission-card" aria-label="剧情任务">
        <div className="character xiaogu-card">
          <img src={`${ASSET_ROOT}/xiaogu.png`} alt="小顾" />
          <span>小顾</span>
        </div>
        <div className="mission-copy">
          <div className="mission-heading"><span className="mission-tag">今日任务</span><span className="online-dot">● 在线</span></div>
          <h2>小顾的牛角包寻宝计划</h2>
          <p>{characterLine}</p>
        </div>
        <div className="character xiaowen-card">
          <img src={`${ASSET_ROOT}/xiaowen.png`} alt="小温" />
          <span>小温</span>
        </div>
      </section>

      <nav className="difficulty-tabs" aria-label="选择难度">
        {(Object.keys(DIFFICULTIES) as DifficultyKey[]).map((key) => (
          <button
            key={key}
            className={`difficulty-tab pressable ${difficulty === key ? "active" : ""}`}
            onClick={() => restart(key)}
            aria-pressed={difficulty === key}
          >
            {DIFFICULTIES[key].label}
          </button>
        ))}
      </nav>

      <section className={`game-panel ${status}`} aria-label="心动烘焙扫雷棋盘">
        <div className="window-bar">
          <span><i /> BAKERY_MAP.EXE</span>
          <button
            className="pause-button pressable"
            onClick={() => { playSfx("click"); setIsPaused(true); }}
            disabled={status !== "playing" || hintCell !== null}
            aria-label="暂停游戏"
          ><b>Ⅱ</b> 暂停</button>
        </div>

        <div className="status-row">
          <div className="status-pill breakfast-counter">
            <span className="mini-foods"><img src={`${ASSET_ROOT}/croissant.png`} alt="" /><img src={`${ASSET_ROOT}/bread.png`} alt="" /></span>
            <span>早餐</span><strong>{breakfastFound}/{breakfastGoal}</strong>
          </div>
          <button className="face-button pressable" onClick={() => restart()} aria-label="重新开始">
            <img src={`${ASSET_ROOT}/339.png`} alt="" />
          </button>
          <div className="status-pill timer-pill">
            <span>BEST {best === null ? "---" : String(best).padStart(3, "0")}</span>
            <strong>{String(seconds).padStart(3, "0")}</strong>
          </div>
        </div>

        <div
          className={`board ${hintCell !== null ? "scanning" : ""}`}
          role="grid"
          aria-label={`${config.rows} 行 ${config.cols} 列扫雷棋盘`}
          style={{ "--grid": config.cols } as CSSProperties}
        >
          {cells.map((cell, index) => {
            const content = cell.revealed
              ? cell.mine
                ? <img className="burnt-bread" src={`${ASSET_ROOT}/bread.png`} alt="烤焦面包" />
                : cell.breakfast
                  ? <span className="treasure-cell"><img className="found-food" src={`${ASSET_ROOT}/${cell.breakfast === "croissant" ? "croissant" : "bread"}.png`} alt={cell.breakfast === "croissant" ? "牛角包" : "面包"} />{cell.nearby > 0 && <b className="treasure-number">{cell.nearby}</b>}</span>
                  : cell.nearby || ""
              : cell.flagged ? <img className="flag-sticker" src={`${ASSET_ROOT}/xiaogu.png`} alt="小顾标记" /> : "";
            return (
              <button
                key={index}
                className={`cell ${cell.revealed ? "revealed" : ""} ${cell.mine && cell.revealed ? "mine" : ""} ${cell.flagged ? "flagged" : ""} ${hintCell === index ? "hint" : ""} ${(tutorialStep === 1 && index === TUTORIAL_REVEAL_TARGET) || (tutorialStep === 2 && index === TUTORIAL_REVEAL_TARGET) || (tutorialStep === 3 && index === TUTORIAL_MINE_TARGET) ? "tutorial-target" : ""} ${tutorialStep === 2 && neighbors(TUTORIAL_REVEAL_TARGET, 9, 9).includes(index) ? "tutorial-neighbor" : ""} ${tutorialStep === 3 && index === TUTORIAL_REVEAL_TARGET ? "tutorial-reference" : ""} number-${cell.nearby}`}
                role="gridcell"
                aria-label={`第 ${Math.floor(index / config.cols) + 1} 行，第 ${index % config.cols + 1} 列${cell.flagged ? "，已贴小顾标记" : cell.revealed ? "，已翻开" : "，未翻开"}；单击翻格，双击标记`}
                onClick={() => handleCellClick(index)}
                onContextMenu={(event) => { event.preventDefault(); toggleFlag(index); }}
              >
                {content}
              </button>
            );
          })}
        </div>

        <div className="tool-row">
          <button className={`tool-button undo-button pressable ${tutorialStep === 4 ? "tutorial-target" : ""}`} onClick={undoLastStep} disabled={!undoSnapshot || hintCell !== null || (tutorialStep !== null && tutorialStep !== 4)}>
            <span className="tool-icon undo-icon">↶</span><span><b>撤销一步</b><small>{undoSnapshot ? "仅恢复最近操作" : "暂无可撤销操作"}</small></span>
          </button>
          <button className={`tool-button scan-button pressable ${tutorialStep === 5 ? "tutorial-target" : ""}`} onClick={useScan} disabled={scanUsed || (tutorialStep !== null && tutorialStep !== 5)}>
            <img src={`${ASSET_ROOT}/339.png`} alt="" /><span><b>{scanUsed ? "扫描已用" : "339 扫描"}</b><small>{scanUsed ? "下局充能" : "安全翻 1 格"}</small></span>
          </button>
        </div>

        {(status === "won" || status === "lost") && (
          <div className={`result-card ${status}`} role="status">
            {status === "won" ? (
              <figure className="success-scene">
                <img src={`${ASSET_ROOT}/success-bakery.jpg`} alt="小顾和小温成功找到牛角包，一起享用早餐" />
                <figcaption><span>MISSION COMPLETE</span><b>牛角包约会达成 ♡</b></figcaption>
              </figure>
            ) : (
              <div className="result-portraits">
                <img src={`${ASSET_ROOT}/xiaogu.png`} alt="小顾" />
                <span>…</span>
                <img src={`${ASSET_ROOT}/xiaowen.png`} alt="小温" />
              </div>
            )}
            <div><strong>{status === "won" ? "早餐约会达成！" : "这炉烤过头啦"}</strong><p>{status === "won" ? `用时 ${seconds} 秒，完成扫雷并收集了全部 ${breakfastGoal} 份早餐。` : "别担心，第一格永远安全，再试一次吧。"}</p></div>
            <div className="result-actions">
              {status === "lost" && undoSnapshot && <button className="result-button secondary pressable" onClick={undoLastStep}>撤销上一步</button>}
              <button className="result-button pressable" onClick={() => restart()}>{status === "won" ? "再送一份" : "重新烘焙"}</button>
            </div>
          </div>
        )}
        {status === "won" && <div className="confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} />)}</div>}
      </section>

      <footer><span>DESIGNED FOR 小顾 × 小温</span><span>GUARDED BY 339</span></footer>

      {(!tutorialChecked || tutorialStep !== null) && <div className="tutorial-shield" aria-hidden="true" />}
      {tutorialStep !== null && (
          <section className={`tutorial-coach ${tutorialStep === 0 || tutorialStep === 6 ? "centered" : ""} ${tutorialStep === 4 || tutorialStep === 5 ? "upper" : ""}`} role="dialog" aria-modal="true" aria-live="polite">
            <div className="tutorial-head">
              <img src={`${ASSET_ROOT}/339.png`} alt="339 机器人" />
              <span>339 新手训练</span>
              <b>{tutorialStep === 6 ? "5/5" : `${Math.max(0, tutorialStep)}/5`}</b>
            </div>
            {tutorialStep === 0 && (
              <><h2>第一次来烘焙地图吗？</h2><p>接下来只能操作高亮区域。跟着 339 完成 5 步实战，学会看数字和判断危险位置。</p><button className="tutorial-button pressable" onClick={startTutorial}>开始 5 步教学</button></>
            )}
            {tutorialStep === 1 && <><h2>① 单击高亮格</h2><p>轻点一次，翻开这格。第一格一定安全。</p><span className="tutorial-wait">等待你完成单击…</span></>}
            {tutorialStep === 2 && <><h2>② 数字 1 是什么意思？</h2><p><b className="number-rule">1 = 周围 8 格中，共有 1 个烤焦面包</b>。数字只计算紧挨着它的一圈，不是整行数量。</p><button className="tutorial-button pressable" onClick={confirmNumberLesson}>让 339 展开判断示例</button></>}
            {tutorialStep === 3 && <><h2>③ 根据数字找危险格</h2><p>中心是 1，周围 7 格已经翻开并确认安全。因此，唯一没翻开的高亮格就是那 1 个危险位置——请双击贴小顾。</p><span className="tutorial-wait">等待你完成双击…</span></>}
            {tutorialStep === 4 && <><h2>④ 撤销刚才的标记</h2><p>点击高亮的“撤销一步”，恢复最近一次操作。正式游戏中也只能撤销最近一步。</p><span className="tutorial-wait">等待你点击撤销…</span></>}
            {tutorialStep === 5 && <><h2>⑤ 请 339 帮忙</h2><p>无法确定时，可以点击“339 扫描”，机器人会替你找出一格绝对安全区。</p><span className="tutorial-wait">等待扫描完成…</span></>}
            {tutorialStep === 6 && (
              <><h2>训练完成！</h2><p>记住：数字表示周围 8 格的危险总数。先排除已知安全格，再判断剩余格子。现在重置棋盘，开始正式寻宝。</p><button className="tutorial-button pressable" onClick={finishTutorial}>进入正式游戏</button></>
            )}
          </section>
      )}

      {isPaused && (
        <div className="pause-backdrop">
          <section className="pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <img src={`${ASSET_ROOT}/pause-couple.jpg`} alt="小顾抱着小温" />
            <div className="pause-copy">
              <span>BAKERY BREAK</span>
              <h2 id="pause-title">先靠一会儿吧</h2>
              <p>本局时间已经停住，早餐会在这里等你。</p>
              <button className="resume-button pressable" onClick={() => { playSfx("click"); setIsPaused(false); }}>继续寻找牛角包</button>
            </div>
          </section>
        </div>
      )}

      {showHelp && (
        <div className="modal-backdrop" onMouseDown={closeHelp}>
          <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close pressable" onClick={closeHelp} aria-label="关闭说明">×</button>
            <img src={`${ASSET_ROOT}/339.png`} alt="339 机器人" />
            <span className="mission-tag">第一次来？</span>
            <h2 id="help-title">30 秒学会心动扫雷</h2>
            <p className="guide-intro">目标很简单：帮小顾安全地找齐小温喜欢的早餐。</p>
            <ol>
              <li><b>单击一格</b>：格子会翻开，而且开局第一格一定安全。</li>
              <li><b>看懂数字</b>：数字只表示紧挨着它的周围 8 格中，一共有几个“烤焦面包”。</li>
              <li><b>怎样判断</b>：先排除已经翻开的安全格；如果数字是 1、周围只剩 1 格没翻，那格就是危险位置。</li>
              <li><b>双击贴小顾</b>：判断有危险就快速点两次；再次双击可以收回标记。</li>
              <li><b>点错可以撤销</b>：棋盘下方的按钮只能恢复最近一次翻格或标记。</li>
              <li><b>怎样算赢</b>：早餐目标会随机（简单 3–5、中等 5–8、复杂 8–12），最后一份只在扫雷完成时获得。</li>
            </ol>
            <button className="primary-button pressable" onClick={closeHelp}>明白，开始找牛角包</button>
          </section>
        </div>
      )}

      {showAudioSettings && (
        <div className="modal-backdrop" onMouseDown={() => { playSfx("click"); setShowAudioSettings(false); }}>
          <section className="audio-modal" role="dialog" aria-modal="true" aria-labelledby="audio-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close pressable" onClick={() => { playSfx("click"); setShowAudioSettings(false); }} aria-label="关闭声音设置">×</button>
            <div className="audio-robot"><img src={`${ASSET_ROOT}/339.png`} alt="339 机器人" /><span>♫</span></div>
            <span className="mission-tag">339 音频控制台</span>
            <h2 id="audio-title">让烘焙屋听起来刚刚好</h2>
            <p className="audio-status">{audioUnlocked ? "声音已启用，设置会保存在这台设备上。" : "轻点页面后，浏览器才会允许播放声音。"}</p>

            <div className="audio-control-group">
              <div className="audio-control-heading">
                <span><b>背景音乐</b><small>烘焙店循环 BGM</small></span>
                <button
                  className={`sound-switch ${musicEnabled ? "on" : ""}`}
                  role="switch"
                  aria-checked={musicEnabled}
                  onClick={() => { playSfx("click"); setMusicEnabled((value) => !value); }}
                ><i /></button>
              </div>
              <label className="volume-row">
                <span>音乐音量</span>
                <input type="range" min="0" max="100" value={Math.round(musicVolume * 100)} onChange={(event) => setMusicVolume(Number(event.target.value) / 100)} />
                <output>{Math.round(musicVolume * 100)}%</output>
              </label>
              <div className="audio-control-heading loop-row">
                <span><b>循环播放</b><small>关闭后播完即停止</small></span>
                <button
                  className={`sound-switch ${musicLoop ? "on" : ""}`}
                  role="switch"
                  aria-checked={musicLoop}
                  onClick={() => { playSfx("click"); setMusicLoop((value) => !value); }}
                ><i /></button>
              </div>
            </div>

            <div className="audio-control-group">
              <div className="audio-control-heading">
                <span><b>游戏音效</b><small>翻格、提示与胜负反馈</small></span>
                <button
                  className={`sound-switch ${sfxEnabled ? "on" : ""}`}
                  role="switch"
                  aria-checked={sfxEnabled}
                  onClick={() => { if (sfxEnabled) playSfx("click"); setSfxEnabled((value) => !value); }}
                ><i /></button>
              </div>
              <label className="volume-row">
                <span>音效音量</span>
                <input type="range" min="0" max="100" value={Math.round(sfxVolume * 100)} onChange={(event) => setSfxVolume(Number(event.target.value) / 100)} />
                <output>{Math.round(sfxVolume * 100)}%</output>
              </label>
            </div>

            <p className="mix-note">播放提示、胜利或失败音效时，BGM 会自动降低音量，避免互相打架。</p>
          </section>
        </div>
      )}
    </main>
  );
}
