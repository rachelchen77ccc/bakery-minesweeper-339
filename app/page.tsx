"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type Breakfast = "croissant" | "bread" | null;
type GameStatus = "idle" | "playing" | "won" | "lost";
type DifficultyKey = "cozy" | "date" | "robot";

type Cell = {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  nearby: number;
  breakfast: Breakfast;
};

const DIFFICULTIES = {
  cozy: { label: "简单", rows: 9, cols: 9, mines: 10, breakfast: 4 },
  date: { label: "中等", rows: 10, cols: 10, mines: 16, breakfast: 5 },
  robot: { label: "复杂", rows: 11, cols: 11, mines: 23, breakfast: 6 },
} as const;

const ASSET_ROOT = "assets";

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
  const [cells, setCells] = useState<Cell[]>(() => emptyCells(config.rows * config.cols));
  const [status, setStatus] = useState<GameStatus>("idle");
  const [generated, setGenerated] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [flagMode, setFlagMode] = useState(false);
  const [scanUsed, setScanUsed] = useState(false);
  const [hintCell, setHintCell] = useState<number | null>(null);
  const [message, setMessage] = useState("小顾出发啦！帮小温找到最喜欢的牛角包。");
  const [showHelp, setShowHelp] = useState(false);
  const [best, setBest] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntil = useRef(0);

  useEffect(() => {
    const saved = window.localStorage.getItem(`bakery-best-${difficulty}`);
    setBest(saved ? Number(saved) : null);
  }, [difficulty]);

  useEffect(() => {
    if (!window.localStorage.getItem("bakery-guide-seen")) setShowHelp(true);
  }, []);

  useEffect(() => {
    if (status !== "playing") return;
    const timer = window.setInterval(() => setSeconds((value) => Math.min(value + 1, 999)), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const restart = useCallback((nextDifficulty: DifficultyKey = difficulty) => {
    const next = DIFFICULTIES[nextDifficulty];
    setDifficulty(nextDifficulty);
    setCells(emptyCells(next.rows * next.cols));
    setStatus("idle");
    setGenerated(false);
    setSeconds(0);
    setFlagMode(false);
    setScanUsed(false);
    setHintCell(null);
    setMessage("小顾出发啦！帮小温找到最喜欢的牛角包。");
  }, [difficulty]);

  const breakfastFound = useMemo(
    () => cells.filter((cell) => cell.revealed && cell.breakfast).length,
    [cells],
  );
  const flagsUsed = useMemo(() => cells.filter((cell) => cell.flagged).length, [cells]);

  const finishWin = useCallback((time: number) => {
    setStatus("won");
    setMessage("任务完成！小温收到了小顾准备的早餐 ♡");
    vibrate([45, 35, 45, 35, 80]);
    const storageKey = `bakery-best-${difficulty}`;
    const previous = Number(window.localStorage.getItem(storageKey) || 0);
    if (!previous || time < previous) {
      window.localStorage.setItem(storageKey, String(time));
      setBest(time);
    }
  }, [difficulty]);

  const reveal = useCallback((index: number) => {
    if (status === "won" || status === "lost") return;
    let working = cells;
    if (!generated) {
      working = buildBoard(config.rows, config.cols, config.mines, config.breakfast, index);
      setGenerated(true);
      setStatus("playing");
      setMessage("339：扫描正常！数字是周围烤焦面包的数量。");
    }
    const chosen = working[index];
    if (chosen.revealed || chosen.flagged) return;
    if (chosen.mine) {
      const lostBoard = working.map((cell) => cell.mine ? { ...cell, revealed: true } : cell);
      setCells(lostBoard);
      setStatus("lost");
      setMessage("烤过头啦！339 已启动厨房降温程序。");
      vibrate([100, 55, 140]);
      return;
    }
    const next = floodReveal(working, index, config.rows, config.cols);
    setCells(next);
    if (chosen.breakfast) {
      setMessage(chosen.breakfast === "croissant" ? "找到牛角包！小温的眼睛亮起来了。" : "找到软面包！早餐篮更香了。" );
      vibrate(35);
    }
    if (next.every((cell) => cell.mine || cell.revealed)) finishWin(seconds);
  }, [cells, config, finishWin, generated, seconds, status]);

  const toggleFlag = useCallback((index: number) => {
    if (status === "won" || status === "lost" || cells[index].revealed) return;
    if (!cells[index].flagged && flagsUsed >= config.mines) {
      setMessage("小顾贴纸已经用完啦。再检查一下标记的位置吧！");
      return;
    }
    setCells((current) => current.map((cell, cellIndex) =>
      cellIndex === index ? { ...cell, flagged: !cell.flagged } : cell,
    ));
    setMessage(cells[index].flagged ? "收回一张小顾贴纸。" : "小顾贴纸：这里可能有烤焦面包！" );
    vibrate(22);
  }, [cells, config.mines, flagsUsed, status]);

  const handleCellClick = (index: number) => {
    if (hintCell !== null) return;
    if (Date.now() < suppressClickUntil.current) return;
    if (flagMode) toggleFlag(index);
    else reveal(index);
  };

  const beginLongPress = (index: number) => {
    if (hintCell !== null) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      toggleFlag(index);
      suppressClickUntil.current = Date.now() + 360;
    }, 320);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const closeHelp = () => {
    window.localStorage.setItem("bakery-guide-seen", "1");
    setShowHelp(false);
  };

  const useScan = () => {
    if (scanUsed) return;
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
    <main className="game-shell">
      <img className="floating-food floating-croissant" src={`${ASSET_ROOT}/croissant.png`} alt="" aria-hidden="true" />
      <img className="floating-food floating-bread" src={`${ASSET_ROOT}/bread.png`} alt="" aria-hidden="true" />

      <header className="topbar">
        <div className="brand-mark"><img src={`${ASSET_ROOT}/339.png`} alt="339 机器人" /></div>
        <div className="title-block">
          <p className="eyebrow">339&apos;s bakery protocol</p>
          <h1>心动烘焙扫雷</h1>
        </div>
        <button className="round-button pressable" onClick={() => setShowHelp(true)} aria-label="查看游戏说明">?</button>
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
          <div className="window-controls"><b>—</b><b>□</b><b>×</b></div>
        </div>

        <div className="status-row">
          <div className="status-pill breakfast-counter">
            <span className="mini-foods"><img src={`${ASSET_ROOT}/croissant.png`} alt="" /><img src={`${ASSET_ROOT}/bread.png`} alt="" /></span>
            <span>早餐</span><strong>{breakfastFound}/{config.breakfast}</strong>
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
                className={`cell ${cell.revealed ? "revealed" : ""} ${cell.mine && cell.revealed ? "mine" : ""} ${cell.flagged ? "flagged" : ""} ${hintCell === index ? "hint" : ""} number-${cell.nearby}`}
                role="gridcell"
                aria-label={`第 ${Math.floor(index / config.cols) + 1} 行，第 ${index % config.cols + 1} 列${cell.flagged ? "，已贴小顾标记" : cell.revealed ? "，已翻开" : "，未翻开"}`}
                onClick={() => handleCellClick(index)}
                onContextMenu={(event) => { event.preventDefault(); toggleFlag(index); }}
                onPointerDown={() => beginLongPress(index)}
                onPointerUp={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onPointerLeave={cancelLongPress}
              >
                {content}
              </button>
            );
          })}
        </div>

        <div className="tool-row">
          <button className={`tool-button pressable ${flagMode ? "active" : ""}`} onClick={() => setFlagMode((value) => !value)} aria-pressed={flagMode}>
            <span className="tool-icon"><img className="flag-mode-avatar" src={`${ASSET_ROOT}/xiaogu.png`} alt="" /></span><span><b>{flagMode ? "小顾标记" : "轻点翻格"}</b><small>{flagMode ? `${flagsUsed}/${config.mines} 张贴纸` : "点按切换模式"}</small></span>
          </button>
          <button className="tool-button scan-button pressable" onClick={useScan} disabled={scanUsed}>
            <img src={`${ASSET_ROOT}/339.png`} alt="" /><span><b>{scanUsed ? "扫描已用" : "339 扫描"}</b><small>{scanUsed ? "下局充能" : "安全翻 1 格"}</small></span>
          </button>
        </div>

        <div className="tip-line"><span>手机：轻点翻格 · 长按贴小顾</span><span>电脑：左键翻格 · 右键贴小顾</span></div>

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
            <div><strong>{status === "won" ? "早餐约会达成！" : "这炉烤过头啦"}</strong><p>{status === "won" ? `用时 ${seconds} 秒，收集了全部 ${config.breakfast} 份早餐。` : "别担心，第一格永远安全，再试一次吧。"}</p></div>
            <button className="result-button pressable" onClick={() => restart()}>{status === "won" ? "再送一份" : "重新烘焙"}</button>
          </div>
        )}
        {status === "won" && <div className="confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} />)}</div>}
      </section>

      <footer><span>DESIGNED FOR 小顾 × 小温</span><span>GUARDED BY 339</span></footer>

      {showHelp && (
        <div className="modal-backdrop" onMouseDown={closeHelp}>
          <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close pressable" onClick={closeHelp} aria-label="关闭说明">×</button>
            <img src={`${ASSET_ROOT}/339.png`} alt="339 机器人" />
            <span className="mission-tag">第一次来？</span>
            <h2 id="help-title">30 秒学会心动扫雷</h2>
            <p className="guide-intro">目标很简单：帮小顾安全地找齐小温喜欢的早餐。</p>
            <ol>
              <li><b>先轻点一格</b>：格子会翻开，而且开局第一格一定安全。</li>
              <li><b>看懂数字</b>：数字是它周围 8 格中“烤焦面包”的数量。</li>
              <li><b>怀疑有危险就长按</b>：约 0.3 秒贴上小顾；再次长按可以收回。</li>
              <li><b>怎样算赢</b>：翻开所有安全格、找齐早餐；卡住时可用一次 339 扫描。</li>
            </ol>
            <button className="primary-button pressable" onClick={closeHelp}>明白，开始找牛角包</button>
          </section>
        </div>
      )}
    </main>
  );
}
