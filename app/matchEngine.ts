import {
  cloneBoard,
  findMatchRuns,
  hasAnyValidMove,
  neighborsOf,
  type GoalRule,
  type MatchBoard,
  type MatchCell,
  type MatchIconId,
  type MatchRun,
} from "./matchLevels";

export type MatchProgress = {
  collected: Partial<Record<MatchIconId, number>>;
  obstaclesTotal: number;
  obstaclesCleared: number;
  score: number;
};

export function countInitialObstacles(board: MatchBoard) {
  return board.cells.filter((cell) => cell.active && cell.cover > 0).length;
}

export function goalStatus(goal: GoalRule, progress: MatchProgress) {
  if (goal.type === "collect") {
    const current = Math.min(goal.amount, progress.collected[goal.icon] ?? 0);
    return { current, target: goal.amount, done: current >= goal.amount };
  }
  if (goal.type === "clearObstacles") {
    return { current: progress.obstaclesCleared, target: progress.obstaclesTotal, done: progress.obstaclesCleared >= progress.obstaclesTotal };
  }
  const current = Math.min(goal.amount, progress.score);
  return { current, target: goal.amount, done: progress.score >= goal.amount };
}

export function allGoalsDone(goals: GoalRule[], progress: MatchProgress) {
  return goals.every((goal) => goalStatus(goal, progress).done);
}

export type SpecialKind = "stripedRow" | "stripedCol" | "rainbow" | "blockBomb";

export type ResolveResult = {
  board: MatchBoard;
  collectGain: Partial<Record<MatchIconId, number>>;
  obstacleCleared: number;
  scoreGain: number;
  cellsCleared: number;
  specialsCreated: number;
  specialsTriggered: number;
};

function addGain(target: Partial<Record<MatchIconId, number>>, icon: MatchIconId, amount = 1) {
  target[icon] = (target[icon] ?? 0) + amount;
}

function decideSpecials(runs: MatchRun[], preferredPivot: number | null) {
  const specialAt = new Map<number, SpecialKind>();
  const rowRuns = runs.filter((run) => run.orientation === "row");
  const colRuns = runs.filter((run) => run.orientation === "col");
  const intersectionCells = new Set<number>();
  rowRuns.forEach((rowRun) => {
    colRuns.forEach((colRun) => {
      const shared = rowRun.cells.find((cell) => colRun.cells.includes(cell));
      if (shared !== undefined) intersectionCells.add(shared);
    });
  });

  // L/T-shaped crossings (two perpendicular 3+ runs sharing a cell) only earn a
  // contained 3x3 block bomb, not a full-board color bomb — a straight 5-run is
  // the only way to earn the much stronger rainbow, otherwise it triggers on
  // nearly every cascade and can clear an entire level in one swap.
  runs.forEach((run) => {
    const intersect = run.cells.find((cell) => intersectionCells.has(cell));
    if (intersect !== undefined) {
      const pivot = preferredPivot !== null && run.cells.includes(preferredPivot) ? preferredPivot : intersect;
      if (!specialAt.has(pivot) || specialAt.get(pivot) !== "rainbow") specialAt.set(pivot, "blockBomb");
      return;
    }
    if (run.cells.length >= 5) {
      const pivot = preferredPivot !== null && run.cells.includes(preferredPivot)
        ? preferredPivot
        : run.cells[Math.floor(run.cells.length / 2)];
      specialAt.set(pivot, "rainbow");
    } else if (run.cells.length === 4) {
      const pivot = preferredPivot !== null && run.cells.includes(preferredPivot)
        ? preferredPivot
        : run.cells[1];
      if (!specialAt.has(pivot)) specialAt.set(pivot, run.orientation === "row" ? "stripedRow" : "stripedCol");
    }
  });

  return specialAt;
}

function specialAffectedCells(board: MatchBoard, index: number, kind: SpecialKind, icon: MatchIconId | null) {
  const { width, height, cells } = board;
  const affected = new Set<number>();
  if (kind === "stripedRow") {
    const row = Math.floor(index / width);
    for (let col = 0; col < width; col += 1) {
      const cellIndex = row * width + col;
      if (cells[cellIndex].active) affected.add(cellIndex);
    }
  } else if (kind === "stripedCol") {
    const col = index % width;
    for (let row = 0; row < height; row += 1) {
      const cellIndex = row * width + col;
      if (cells[cellIndex].active) affected.add(cellIndex);
    }
  } else if (kind === "rainbow" && icon !== null) {
    cells.forEach((cell, cellIndex) => {
      if (cell.active && cell.icon === icon) affected.add(cellIndex);
    });
  } else if (kind === "blockBomb") {
    const row = Math.floor(index / width);
    const col = index % width;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= height || c < 0 || c >= width) continue;
        const cellIndex = r * width + c;
        if (cells[cellIndex].active) affected.add(cellIndex);
      }
    }
  }
  affected.add(index);
  return affected;
}

const SPECIAL_CREATE_BONUS: Record<SpecialKind, number> = { stripedRow: 25, stripedCol: 25, blockBomb: 18, rainbow: 45 };

/**
 * Drops surviving pieces down to fill gaps and spawns new pieces at the top,
 * returning how many rows each final cell actually fell (for animation) —
 * survivors fall by their real row delta; brand-new pieces are treated as
 * spawning just above row 0 of their column, so the topmost new piece falls
 * 1 row and each one below it falls one row further.
 */
function applyGravity(board: MatchBoard, randomFn: () => number) {
  const { width, height, cells, iconPool } = board;
  const fallOffsets = new Map<number, number>();
  for (let col = 0; col < width; col += 1) {
    const columnIndexes: number[] = [];
    for (let row = 0; row < height; row += 1) {
      const index = row * width + col;
      if (cells[index].active) columnIndexes.push(index);
    }
    const survivors: Array<{ icon: MatchIconId; special: SpecialKind | null; fromOrder: number }> = [];
    columnIndexes.forEach((index, order) => {
      const cell = cells[index];
      if (cell.icon !== null) survivors.push({ icon: cell.icon, special: cell.special, fromOrder: order });
    });
    const missing = columnIndexes.length - survivors.length;
    columnIndexes.forEach((index, order) => {
      if (order < missing) {
        cells[index].icon = iconPool[Math.floor(randomFn() * iconPool.length)];
        cells[index].special = null;
        fallOffsets.set(index, order + 1);
      } else {
        const survivor = survivors[order - missing];
        cells[index].icon = survivor.icon;
        cells[index].special = survivor.special;
        const fallDistance = order - survivor.fromOrder;
        if (fallDistance > 0) fallOffsets.set(index, fallDistance);
      }
    });
  }
  return fallOffsets;
}

export type StepResult = ResolveResult & {
  clearedIndexes: Set<number>;
  sweptIndexes: Set<number>;
  fallOffsets: Map<number, number>;
  stable: boolean;
};

/**
 * Resolves exactly one cascade wave (one round of clears + gravity/refill).
 * Callers that want to animate each wave should call this in a loop and
 * pause between calls; `resolveBoard` below just drains it synchronously.
 */
export function resolveStep(
  startBoard: MatchBoard,
  pendingTriggers: number[] = [],
  preferredPivot: number | null = null,
  randomFn: () => number = Math.random,
): StepResult {
  const board = cloneBoard(startBoard);
  const collectGain: Partial<Record<MatchIconId, number>> = {};
  let obstacleCleared = 0;
  let scoreGain = 0;
  let cellsCleared = 0;
  let specialsCreated = 0;
  let specialsTriggered = 0;
  const clearSet = new Set<number>();
  const sweptIndexes = new Set<number>();

  pendingTriggers.forEach((index) => {
    const cell = board.cells[index];
    if (!cell.active || !cell.special) return;
    specialsTriggered += 1;
    specialAffectedCells(board, index, cell.special, cell.icon).forEach((affected) => {
      clearSet.add(affected);
      if (affected !== index) sweptIndexes.add(affected);
    });
  });

  const runs = findMatchRuns(board.cells, board.width, board.height);
  runs.forEach((run) => run.cells.forEach((index) => clearSet.add(index)));

  if (clearSet.size === 0) {
    return { board, collectGain, obstacleCleared, scoreGain, cellsCleared, specialsCreated, specialsTriggered, clearedIndexes: clearSet, sweptIndexes, fallOffsets: new Map(), stable: true };
  }

  const specialAt = decideSpecials(runs, preferredPivot);

  clearSet.forEach((index) => {
    const cell = board.cells[index];
    if (!cell.active || cell.icon === null) return;
    addGain(collectGain, cell.icon);
    scoreGain += 10;
    cellsCleared += 1;
    if (cell.cover > 0) {
      cell.cover -= 1;
      obstacleCleared += 1;
    }
  });

  const splashTargets = new Set<number>();
  clearSet.forEach((index) => {
    neighborsOf(index, board.width, board.height).forEach((neighbor) => {
      if (!clearSet.has(neighbor) && board.cells[neighbor].active) splashTargets.add(neighbor);
    });
  });
  splashTargets.forEach((index) => {
    const cell = board.cells[index];
    if (cell.cover > 0) {
      cell.cover -= 1;
      obstacleCleared += 1;
    }
  });

  specialAt.forEach((kind, index) => {
    specialsCreated += 1;
    scoreGain += SPECIAL_CREATE_BONUS[kind];
    board.cells[index].special = kind;
  });

  clearSet.forEach((index) => {
    if (specialAt.has(index)) return;
    board.cells[index].icon = null;
    board.cells[index].special = null;
  });

  const fallOffsets = applyGravity(board, randomFn);

  return { board, collectGain, obstacleCleared, scoreGain, cellsCleared, specialsCreated, specialsTriggered, clearedIndexes: clearSet, sweptIndexes, fallOffsets, stable: false };
}

export function resolveBoard(
  startBoard: MatchBoard,
  triggeredSpecialIndexes: number[] = [],
  preferredPivot: number | null = null,
  randomFn: () => number = Math.random,
): ResolveResult {
  let board = startBoard;
  const collectGain: Partial<Record<MatchIconId, number>> = {};
  let obstacleCleared = 0;
  let scoreGain = 0;
  let cellsCleared = 0;
  let specialsCreated = 0;
  let specialsTriggered = 0;
  let pendingTriggers = [...triggeredSpecialIndexes];
  let pivotForThisPass = preferredPivot;
  let iterations = 0;

  while (iterations < 30) {
    iterations += 1;
    const step = resolveStep(board, pendingTriggers, pivotForThisPass, randomFn);
    board = step.board;
    pendingTriggers = [];
    pivotForThisPass = null;
    if (step.stable) break;
    (Object.keys(step.collectGain) as unknown as MatchIconId[]).forEach((icon) => {
      collectGain[icon] = (collectGain[icon] ?? 0) + (step.collectGain[icon] ?? 0);
    });
    obstacleCleared += step.obstacleCleared;
    scoreGain += step.scoreGain;
    cellsCleared += step.cellsCleared;
    specialsCreated += step.specialsCreated;
    specialsTriggered += step.specialsTriggered;
  }

  return { board, collectGain, obstacleCleared, scoreGain, cellsCleared, specialsCreated, specialsTriggered };
}

export type SwapPeek = { valid: boolean; swappedBoard: MatchBoard; triggers: number[]; preferredPivot: number | null };

/** Swaps two adjacent cells (icon + special only, cover stays put) and checks
 * whether the swap is legal, without resolving any cascade yet. Lets the UI
 * animate the slide first and only commit/resolve once that finishes. */
export function peekSwap(board: MatchBoard, indexA: number, indexB: number): SwapPeek {
  const cellA = board.cells[indexA];
  const cellB = board.cells[indexB];
  if (!cellA.active || !cellB.active) return { valid: false, swappedBoard: board, triggers: [], preferredPivot: null };

  const swapped = cloneBoard(board);
  const iconA = swapped.cells[indexA].icon;
  const specialA = swapped.cells[indexA].special;
  swapped.cells[indexA].icon = swapped.cells[indexB].icon;
  swapped.cells[indexA].special = swapped.cells[indexB].special;
  swapped.cells[indexB].icon = iconA;
  swapped.cells[indexB].special = specialA;

  const triggers = [indexA, indexB].filter((index) => swapped.cells[index].special !== null);
  const hasMatch = findMatchRuns(swapped.cells, swapped.width, swapped.height).length > 0;
  const valid = hasMatch || triggers.length > 0;
  return { valid, swappedBoard: swapped, triggers, preferredPivot: triggers.length ? null : indexB };
}

export function attemptSwap(
  board: MatchBoard,
  indexA: number,
  indexB: number,
  randomFn: () => number = Math.random,
): { accepted: boolean; result?: ResolveResult; board: MatchBoard } {
  const peek = peekSwap(board, indexA, indexB);
  if (!peek.valid) return { accepted: false, board };
  const result = resolveBoard(peek.swappedBoard, peek.triggers, peek.preferredPivot, randomFn);
  return { accepted: true, result, board: result.board };
}

/** Immediate single-cell detonation only (no cascade loop yet) so the UI can
 * animate this one "seed" clear before continuing with resolveStep waves. */
export function detonateSeed(board: MatchBoard, index: number, randomFn: () => number = Math.random): StepResult {
  const working = cloneBoard(board);
  const cell = working.cells[index];
  let cellsCleared = 0;
  let obstacleCleared = 0;
  let scoreGain = 0;
  const collectGain: Partial<Record<MatchIconId, number>> = {};
  const clearedIndexes = new Set<number>();
  if (cell.active && cell.icon !== null) {
    clearedIndexes.add(index);
    if (cell.cover > 0) {
      cell.cover -= 1;
      obstacleCleared += 1;
    } else {
      addGain(collectGain, cell.icon);
      scoreGain += 10;
      cellsCleared += 1;
      cell.icon = null;
      cell.special = null;
    }
  }
  const fallOffsets = applyGravity(working, randomFn);
  return { board: working, collectGain, obstacleCleared, scoreGain, cellsCleared, specialsCreated: 0, specialsTriggered: 0, clearedIndexes, sweptIndexes: new Set(), fallOffsets, stable: clearedIndexes.size === 0 };
}

export function detonateCell(
  board: MatchBoard,
  index: number,
  randomFn: () => number = Math.random,
): { result: ResolveResult; board: MatchBoard } {
  const seed = detonateSeed(board, index, randomFn);
  const followUp = resolveBoard(seed.board, [], null, randomFn);
  return {
    result: {
      board: followUp.board,
      collectGain: mergeGain(seed.collectGain, followUp.collectGain),
      obstacleCleared: seed.obstacleCleared + followUp.obstacleCleared,
      scoreGain: seed.scoreGain + followUp.scoreGain,
      cellsCleared: seed.cellsCleared + followUp.cellsCleared,
      specialsCreated: followUp.specialsCreated,
      specialsTriggered: followUp.specialsTriggered,
    },
    board: followUp.board,
  };
}

function mergeGain(
  a: Partial<Record<MatchIconId, number>>,
  b: Partial<Record<MatchIconId, number>>,
): Partial<Record<MatchIconId, number>> {
  const merged: Partial<Record<MatchIconId, number>> = { ...a };
  (Object.keys(b) as unknown as MatchIconId[]).forEach((icon) => {
    merged[icon] = (merged[icon] ?? 0) + (b[icon] ?? 0);
  });
  return merged;
}

export function shuffleBoard(board: MatchBoard, randomFn: () => number = Math.random): MatchBoard {
  const next = cloneBoard(board);
  const activeIndexes = next.cells.map((cell, index) => (cell.active ? index : -1)).filter((index) => index >= 0);
  const { iconPool } = next;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const icons = activeIndexes.map(() => iconPool[Math.floor(randomFn() * iconPool.length)]);
    activeIndexes.forEach((index, order) => {
      next.cells[index].icon = icons[order];
      next.cells[index].special = null;
    });
    if (findMatchRuns(next.cells, next.width, next.height).length === 0 && hasAnyValidMove(next)) return next;
  }
  return next;
}

/**
 * Scores every legal swap by how much it actually advances the level's
 * remaining goals (plus a bonus for creating specials), instead of just
 * returning the first swap that clears anything. This is what "小顾提示"
 * uses so a stuck player gets pointed at the move that matters, not an
 * arbitrary one.
 */
export function findBestHintSwap(board: MatchBoard, goals: GoalRule[], progress: MatchProgress): [number, number] | null {
  const { cells, width, height } = board;
  const unmetGoals = goals.filter((goal) => !goalStatus(goal, progress).done);
  const scoredGoals = unmetGoals.length ? unmetGoals : goals;
  let best: [number, number] | null = null;
  let bestScore = -1;

  for (let index = 0; index < cells.length; index += 1) {
    if (!cells[index].active) continue;
    for (const neighbor of neighborsOf(index, width, height)) {
      if (neighbor < index || !cells[neighbor].active) continue;
      const peek = peekSwap(board, index, neighbor);
      if (!peek.valid) continue;
      const result = resolveBoard(peek.swappedBoard, peek.triggers, peek.preferredPivot);
      let score = result.scoreGain * 0.01 + result.specialsCreated * 3;
      scoredGoals.forEach((goal) => {
        if (goal.type === "collect") score += (result.collectGain[goal.icon] ?? 0) * 5;
        else if (goal.type === "clearObstacles") score += result.obstacleCleared * 4;
        else if (goal.type === "score") score += result.scoreGain * 0.02;
      });
      if (score > bestScore) {
        bestScore = score;
        best = [index, neighbor];
      }
    }
  }
  return best;
}

export type { MatchBoard, MatchCell };
