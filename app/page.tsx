"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useGameAudio } from "./useGameAudio";

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
  cozy: { label: "简单", rows: 9, cols: 9, mines: 10, breakfast: { min: 3, max: 5 } },
  date: { label: "中等", rows: 10, cols: 10, mines: 16, breakfast: { min: 5, max: 8 } },
  robot: { label: "复杂", rows: 11, cols: 11, mines: 23, breakfast: { min: 8, max: 12 } },
} as const;

const ASSET_ROOT = "assets";

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
  const [flagMode, setFlagMode] = useState(false);
  const [scanUsed, setScanUsed] = useState(false);
  const [hintCell, setHintCell] = useState<number | null>(null);
  const [message, setMessage] = useState("小顾出发啦！帮小温找到最喜欢的牛角包。");
  const [showHelp, setShowHelp] = useState(false);
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [best, setBest] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntil = useRef(0);
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
    if (!window.localStorage.getItem("bakery-guide-seen")) setShowHelp(true);
    setBreakfastGoal(randomBreakfastGoal("cozy"));
  }, []);

  useEffect(() => {
    if (status !== "playing" || isPaused) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.min(value + 1, 999)), 1000);
    return () => window.clearInterval(timer);
  }, [isPaused, status]);

  const restart = useCallback((nextDifficulty: DifficultyKey = difficulty) => {
    playSfx("click");
    const next = DIFFICULTIES[nextDifficulty];
    setDifficulty(nextDifficulty);
    setBreakfastGoal(randomBreakfastGoal(nextDifficulty));
    setCells(emptyCells(next.rows * next.cols));
    setStatus("idle");
    setGenerated(false);
    setSeconds(0);
    setFlagMode(false);
    setScanUsed(false);
    setHintCell(null);
    setIsPaused(false);
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
    let working = cells;
    if (!generated) {
      working = buildBoard(config.rows, config.cols, config.mines, breakfastGoal - 1, index);
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
      playSfx("lose");
      vibrate([100, 55, 140]);
      return;
    }
    const foundBeforeReveal = working.filter((cell) => cell.revealed && cell.breakfast).length;
    const next = floodReveal(working, index, config.rows, config.cols);
    setCells(next);
    const foundAfterReveal = next.filter((cell) => cell.revealed && cell.breakfast).length;
    if (foundAfterReveal > foundBeforeReveal && foundAfterReveal === breakfastGoal - 1) {
      setMessage("棋盘里的早餐都找到了！完成扫雷即可解锁最后一份牛角包。");
      vibrate(35);
    } else if (foundAfterReveal > foundBeforeReveal) {
      setMessage("找到新的早餐！小温的眼睛亮起来了。");
      vibrate(35);
    }
    if (next.every((cell) => cell.mine || cell.revealed)) finishWin(seconds);
    else playSfx("reveal");
  }, [breakfastGoal, cells, config, finishWin, generated, isPaused, playSfx, seconds, status]);

  const toggleFlag = useCallback((index: number) => {
    if (status === "won" || status === "lost" || isPaused || cells[index].revealed) return;
    if (!cells[index].flagged && flagsUsed >= config.mines) {
      setMessage("小顾贴纸已经用完啦。再检查一下标记的位置吧！");
      return;
    }
    setCells((current) => current.map((cell, cellIndex) =>
      cellIndex === index ? { ...cell, flagged: !cell.flagged } : cell,
    ));
    setMessage(cells[index].flagged ? "收回一张小顾贴纸。" : "小顾贴纸：这里可能有烤焦面包！" );
    playSfx("flag");
    vibrate(22);
  }, [cells, config.mines, flagsUsed, isPaused, playSfx, status]);

  const handleCellClick = (index: number) => {
    if (hintCell !== null || isPaused) return;
    if (Date.now() < suppressClickUntil.current) return;
    if (flagMode) toggleFlag(index);
    else reveal(index);
  };

  const beginLongPress = (index: number) => {
    if (hintCell !== null || isPaused) return;
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
    playSfx("click");
    window.localStorage.setItem("bakery-guide-seen", "1");
    setShowHelp(false);
  };

  const useScan = () => {
    if (scanUsed || isPaused) return;
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
    <main className="game-shell" onPointerDown={unlockAudio}>
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
          <button className={`tool-button pressable ${flagMode ? "active" : ""}`} onClick={() => { playSfx("click"); setFlagMode((value) => !value); }} aria-pressed={flagMode}>
            <span className="tool-icon"><img className="flag-mode-avatar" src={`${ASSET_ROOT}/xiaogu.png`} alt="" /></span><span><b>{flagMode ? "小顾标记" : "轻点翻格"}</b><small>{flagMode ? `${flagsUsed}/${config.mines} 张贴纸` : "点按切换模式"}</small></span>
          </button>
          <button className="tool-button scan-button pressable" onClick={useScan} disabled={scanUsed}>
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
            <button className="result-button pressable" onClick={() => restart()}>{status === "won" ? "再送一份" : "重新烘焙"}</button>
          </div>
        )}
        {status === "won" && <div className="confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} />)}</div>}
      </section>

      <footer><span>DESIGNED FOR 小顾 × 小温</span><span>GUARDED BY 339</span></footer>

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
              <li><b>先轻点一格</b>：格子会翻开，而且开局第一格一定安全。</li>
              <li><b>看懂数字</b>：数字是它周围 8 格中“烤焦面包”的数量。</li>
              <li><b>怀疑有危险就长按</b>：约 0.3 秒贴上小顾；再次长按可以收回。</li>
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
