"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useGameAudio } from "./useGameAudio";

type PuzzleStatus = "ready" | "playing" | "won" | "failed";
type PuzzleMark = 0 | 1 | 2;
type PuzzleTutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | null;
type ToolCounts = { scan: number; tidy: number; intuition: number };
type ConflictType = "region" | "line" | "adjacent";
type DeadEndIssue = { kind: "region" | "row" | "col" | "global"; cells: Set<number>; message: string };

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
const NO_GIVEN_FROM_LEVEL = 16;
const DOUBLE_TAP_WINDOW_MS = 480;
const REGION_HUES = [8, 32, 52, 78, 106, 136, 166, 192, 212, 232, 256, 280, 306, 330, 350];

function levelUsesGiven(levelIndex: number) {
  return levelIndex < NO_GIVEN_FROM_LEVEL;
}

function openingMessage(levelIndex: number) {
  return levelUsesGiven(levelIndex)
    ? "系统已放好第一个牛角包。请从它所在的颜色、行列和相邻格开始排除。"
    : "本关不预放牛角包：先找候选最少的颜色或行列；没有唯一格时，可以从影响面大的位置开始假设。";
}

function levelRegionPalette(levelIndex: number) {
  const hueShift = (levelIndex * 13) % 43;
  const saturation = 55 + (levelIndex % 3) * 4;
  return REGION_HUES.map((hue, index) => {
    const variedHue = (hue + hueShift + index * (levelIndex % 4)) % 360;
    const lightness = 80 + ((levelIndex + index) % 4) * 1.5;
    return `hsl(${variedHue} ${saturation}% ${lightness}%)`;
  });
}

const LEVELS: LevelConfig[] = [
  { size: 4, mistakeLimit: 4, tools: { scan: 2, tidy: 1, intuition: 1 }, tier: "热身" },
  { size: 4, mistakeLimit: 3, tools: { scan: 1, tidy: 1, intuition: 1 }, tier: "热身+" },
  { size: 5, mistakeLimit: 3, tools: { scan: 2, tidy: 1, intuition: 1 }, tier: "熟练" },
  { size: 5, mistakeLimit: 2, tools: { scan: 1, tidy: 1, intuition: 1 }, tier: "熟练+" },
  { size: 5, mistakeLimit: 2, tools: { scan: 1, tidy: 1, intuition: 0 }, tier: "进阶" },
  { size: 6, mistakeLimit: 2, tools: { scan: 2, tidy: 1, intuition: 1 }, tier: "进阶" },
  { size: 6, mistakeLimit: 2, tools: { scan: 1, tidy: 1, intuition: 1 }, tier: "进阶+" },
  { size: 6, mistakeLimit: 1, tools: { scan: 1, tidy: 1, intuition: 0 }, tier: "烧脑" },
  { size: 6, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "烧脑+" },
  { size: 7, mistakeLimit: 2, tools: { scan: 1, tidy: 1, intuition: 1 }, tier: "七色" },
  { size: 7, mistakeLimit: 1, tools: { scan: 1, tidy: 1, intuition: 0 }, tier: "七色+" },
  { size: 7, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "高手" },
  { size: 8, mistakeLimit: 2, tools: { scan: 1, tidy: 1, intuition: 1 }, tier: "八色" },
  { size: 8, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "八色+" },
  { size: 8, mistakeLimit: 1, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "专家" },
  { size: 9, mistakeLimit: 2, tools: { scan: 1, tidy: 1, intuition: 0 }, tier: "九色过渡" },
  { size: 9, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "假设入门" },
  { size: 9, mistakeLimit: 1, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "九色高阶" },
  { size: 10, mistakeLimit: 2, tools: { scan: 1, tidy: 1, intuition: 0 }, tier: "十色" },
  { size: 10, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "十色+" },
  { size: 10, mistakeLimit: 1, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "连锁推理" },
  { size: 11, mistakeLimit: 2, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "十一色" },
  { size: 11, mistakeLimit: 1, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "中心法" },
  { size: 11, mistakeLimit: 0, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "十一色大师" },
  { size: 12, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "十二色" },
  { size: 12, mistakeLimit: 1, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "多色联动" },
  { size: 12, mistakeLimit: 0, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "十二色大师" },
  { size: 13, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "十三色" },
  { size: 13, mistakeLimit: 1, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "反证法" },
  { size: 13, mistakeLimit: 0, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "十三色大师" },
  { size: 14, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "十四色" },
  { size: 14, mistakeLimit: 0, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "深度假设" },
  { size: 14, mistakeLimit: 0, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "主厨试炼" },
  { size: 15, mistakeLimit: 1, tools: { scan: 1, tidy: 0, intuition: 0 }, tier: "十五色" },
  { size: 15, mistakeLimit: 0, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "极限推理" },
  { size: 15, mistakeLimit: 0, tools: { scan: 0, tidy: 0, intuition: 0 }, tier: "终极餐盘" },
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
  { badge: "PRECISION PLATE", title: "六乘六精准收官！", copy: "道具越来越少，但你依然把每条行列线索都接了起来。" },
  { badge: "SEVEN COLORS", title: "七种颜色，各就各位", copy: "这一盘像彩色拼图，也像他们今天最满意的作品。" },
  { badge: "ALMOST CHEF", title: "离主厨只差一步了", copy: "有限的帮助也够用，因为最可靠的线索一直在你手里。" },
  { badge: "HALFWAY CHEF", title: "十二盘完成，后厨升级！", copy: "前半份订单全部完成，真正的高难餐盘现在才刚刚开始。" },
  { badge: "EIGHT COLORS", title: "八色餐盘顺利出炉", copy: "颜色更多、边界更绕，但每只牛角包仍然各就各位。" },
  { badge: "TIGHT MARGIN", title: "只差一点也没有出错", copy: "有限容错让每一步都更珍贵，小温为你留了最大的那只。" },
  { badge: "EXPERT HAND", title: "专家订单也整理好了", copy: "339 没有提示答案，你仍然把复杂区域一块块理清。" },
  { badge: "NO HELP", title: "无道具通关，太漂亮了！", copy: "这次只有你的判断，小顾和小温都认真记住了这盘摆法。" },
  { badge: "NINE COLORS", title: "九色大餐盘完成！", copy: "更密的网格没有让你迷路，牛角包排成了完美的队伍。" },
  { badge: "ONE CHANCE", title: "一次容错也足够", copy: "你把最难判断的位置留到最后，然后稳稳放下了答案。" },
  { badge: "TIDY THINKING", title: "高阶餐盘整理完成", copy: "小顾只帮忙收拢了一次线索，剩下的答案全由你推出来。" },
  { badge: "SOLO MASTER", title: "九乘九无援通关！", copy: "没有扫描、整理和直觉，纯粹的推理让 339 都亮起了星星。" },
  { badge: "TEN COLORS", title: "十色餐盘，正式登场", copy: "最大餐盘已经上桌，小顾提醒你慢一点看清每条边界。" },
  { badge: "FINAL STRETCH", title: "距离满分只剩两盘", copy: "十行十列都被你照顾到了，小温已经开始准备庆祝贴贴。" },
  { badge: "MASTER LOGIC", title: "大师级订单完成！", copy: "零道具也难不住你，最后一张无失误挑战正在等待。" },
  { badge: "ELEVEN COLORS", title: "十一色餐盘完成！", copy: "没有开局答案，你仍然从颜色与行列的交点找到了突破口。" },
  { badge: "CENTER LOGIC", title: "中心规则被你看穿了", copy: "候选位置一层层缩小，小顾已经把你的推理写进今日菜单。" },
  { badge: "MASTER XI", title: "十一色无失误收官！", copy: "一次多余的排除都没有，小温把最大的一只牛角包留给了你。" },
  { badge: "TWELVE COLORS", title: "十二色大餐盘完成！", copy: "从零开始摆下第一只，再让十二条线索依次连起来。" },
  { badge: "CHAIN REACTION", title: "多色连锁推理成功", copy: "一个假设牵动多个颜色，你顺着反证找到了确定答案。" },
  { badge: "MASTER XII", title: "十二色大师认证！", copy: "零容错、零道具，339 的逻辑灯为你全部点亮。" },
  { badge: "THIRTEEN COLORS", title: "十三色挑战完成", copy: "更细的颜色边界没有藏住答案，整张餐盘依然井然有序。" },
  { badge: "PROOF COMPLETE", title: "反证成立，答案锁定！", copy: "假设、排除、回看，你把最难的分支一步步验证完了。" },
  { badge: "MASTER XIII", title: "十三色无援通关！", copy: "小顾和小温决定把今天的主厨位置正式交给你。" },
  { badge: "FOURTEEN COLORS", title: "十四色餐盘完成", copy: "棋盘更大、线索更远，你依然抓住了每一次连锁出现。" },
  { badge: "DEEP LOGIC", title: "深度假设也推到底了", copy: "没有唯一候选时，你用影响面最大的格子打开了局面。" },
  { badge: "FIFTEEN COLORS", title: "十五色极限餐盘完成", copy: "最密集的颜色联动也被你拆开了，终极订单只剩最后一张。" },
  { badge: "PERFECT ORDER", title: "三十六盘全部满分！", copy: "十五乘十五终极餐盘通关：牛角包、贴贴和今日主厨徽章都归你。" },
];

const solutionCache = new Map<string, number[]>();

function queenSolution(size: number, seed: number) {
  const key = `${size}:${seed}`;
  const cached = solutionCache.get(key);
  if (cached) return cached;
  const columns = new Set<number>();
  const down = new Set<number>();
  const up = new Set<number>();
  const current: number[] = [];
  const visit = (row: number) => {
    if (row === size) return true;
    const columnOrder = Array.from({ length: size }, (_, col) => col).sort((a, b) => (
      seededNoise(seed * 101 + row * 37 + a * 17) - seededNoise(seed * 101 + row * 37 + b * 17)
    ));
    for (const col of columnOrder) {
      if (columns.has(col) || down.has(row - col) || up.has(row + col)) continue;
      columns.add(col); down.add(row - col); up.add(row + col); current.push(col);
      if (visit(row + 1)) return true;
      current.pop(); columns.delete(col); down.delete(row - col); up.delete(row + col);
    }
    return false;
  };
  if (!visit(0)) throw new Error(`无法生成 ${size}×${size} 摆盘解`);
  const solution = [...current];
  solutionCache.set(key, solution);
  return solution;
}

function seededNoise(value: number) {
  const next = Math.sin(value * 12.9898) * 43758.5453;
  return next - Math.floor(next);
}

function buildPuzzle(levelIndex: number, variant: number) {
  const config = LEVELS[levelIndex];
  const seed = (levelIndex + 1) * 97 + variant * 53;
  const solution = queenSolution(config.size, seed);
  const queenCells = solution.map((col, row) => row * config.size + col);
  let regions: number[];
  if (levelIndex < 8) {
    regions = Array.from({ length: config.size * config.size }, (_, index) => {
      const row = Math.floor(index / config.size);
      const col = index % config.size;
      let winner = 0;
      let winnerCost = Number.POSITIVE_INFINITY;
      queenCells.forEach((queenIndex, region) => {
        const queenRow = Math.floor(queenIndex / config.size);
        const queenCol = queenIndex % config.size;
        const distance = Math.abs(row - queenRow) + Math.abs(col - queenCol);
        const jitter = seededNoise(seed * 31 + index * 17 + region * 43) * .38;
        const cost = distance + jitter;
        if (cost < winnerCost) { winner = region; winnerCost = cost; }
      });
      return winner;
    });
  } else {
    regions = Array(config.size * config.size).fill(-1);
    const regionSizes = Array(config.size).fill(1);
    queenCells.forEach((index, region) => { regions[index] = region; });
    let remaining = regions.length - queenCells.length;
    const directions = [-config.size, 1, config.size, -1];
    while (remaining > 0) {
      let bestCell = -1;
      let bestRegion = -1;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let index = 0; index < regions.length; index += 1) {
        if (regions[index] !== -1) continue;
        const row = Math.floor(index / config.size);
        const col = index % config.size;
        const adjacent = new Set<number>();
        directions.forEach((offset) => {
          const neighbor = index + offset;
          if (neighbor < 0 || neighbor >= regions.length) return;
          const neighborRow = Math.floor(neighbor / config.size);
          const neighborCol = neighbor % config.size;
          if (Math.abs(neighborRow - row) + Math.abs(neighborCol - col) !== 1) return;
          if (regions[neighbor] >= 0) adjacent.add(regions[neighbor]);
        });
        adjacent.forEach((region) => {
          const irregularity = 2.8 + Math.min(4.8, (levelIndex - 8) * .34);
          const score = regionSizes[region] * .62 + seededNoise(seed * 71 + index * 29 + region * 47) * irregularity;
          if (score < bestScore) { bestCell = index; bestRegion = region; bestScore = score; }
        });
      }
      if (bestCell < 0) break;
      regions[bestCell] = bestRegion;
      regionSizes[bestRegion] += 1;
      remaining -= 1;
    }
  }
  const autoRow = (levelIndex + variant) % config.size;
  return { solution, solutionCells: new Set(queenCells), regions, autoCell: queenCells[autoRow] };
}

function startingMarks(levelIndex: number, variant: number) {
  const config = LEVELS[levelIndex];
  const puzzle = buildPuzzle(levelIndex, variant);
  const marks = Array(config.size * config.size).fill(0) as PuzzleMark[];
  if (levelUsesGiven(levelIndex)) marks[puzzle.autoCell] = 2;
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

function canonicalSolutionFits(marks: PuzzleMark[], size: number, solution: number[]) {
  const solutionCells = new Set(solution.map((col, row) => row * size + col));
  return marks.every((mark, index) => mark !== 1 || !solutionCells.has(index))
    && marks.every((mark, index) => mark !== 2 || solutionCells.has(index));
}

function canCompletePuzzle(marks: PuzzleMark[], size: number, regions: number[], solution: number[]) {
  if (conflictsFor(marks, size, regions).size) return false;
  if (canonicalSolutionFits(marks, size, solution)) return true;

  const rows = Array.from({ length: size }, (_, row) => {
    const rowStart = row * size;
    const placed = Array.from({ length: size }, (_, col) => rowStart + col).filter((index) => marks[index] === 2);
    if (placed.length > 1) return { row, candidates: [] as number[] };
    const candidates = placed.length
      ? placed
      : Array.from({ length: size }, (_, col) => rowStart + col).filter((index) => marks[index] !== 1);
    return { row, candidates };
  }).sort((a, b) => a.candidates.length - b.candidates.length);

  if (rows.some(({ candidates }) => candidates.length === 0)) return false;
  const usedColumns = new Set<number>();
  const usedRegions = new Set<number>();
  const selected = new Map<number, number>();
  let visits = 0;
  const visitLimit = 120000;

  const visit = (position: number): boolean => {
    visits += 1;
    // Hard levels can have many valid branches. If the bounded check cannot disprove
    // the move quickly, stay conservative and do not punish the player.
    if (visits > visitLimit) return true;
    if (position === rows.length) return true;
    const { row, candidates } = rows[position];
    for (const index of candidates) {
      const col = index % size;
      const region = regions[index];
      if (usedColumns.has(col) || usedRegions.has(region)) continue;
      let adjacent = false;
      selected.forEach((selectedIndex, selectedRow) => {
        if (Math.abs(selectedRow - row) <= 1 && Math.abs((selectedIndex % size) - col) <= 1) adjacent = true;
      });
      if (adjacent) continue;
      usedColumns.add(col);
      usedRegions.add(region);
      selected.set(row, index);
      if (visit(position + 1)) return true;
      selected.delete(row);
      usedRegions.delete(region);
      usedColumns.delete(col);
    }
    return false;
  };

  return visit(0);
}

function findDeadEndIssue(
  marks: PuzzleMark[], size: number, regions: number[], solution: number[], changedIndex?: number,
): DeadEndIssue | null {
  for (let region = 0; region < size; region += 1) {
    const cells = marks.map((_, index) => index).filter((index) => regions[index] === region);
    if (cells.every((index) => marks[index] === 1)) {
      return {
        kind: "region",
        cells: new Set(cells),
        message: `颜色 ${region + 1} 已经全部打 ×，没有位置能放牛角包。请撤回这一步。`,
      };
    }
  }
  for (let row = 0; row < size; row += 1) {
    const cells = Array.from({ length: size }, (_, col) => row * size + col);
    if (cells.every((index) => marks[index] === 1)) {
      return { kind: "row", cells: new Set(cells), message: `第 ${row + 1} 行已经全部排除，但每行必须有 1 个牛角包。请撤回这一步。` };
    }
  }
  for (let col = 0; col < size; col += 1) {
    const cells = Array.from({ length: size }, (_, row) => row * size + col);
    if (cells.every((index) => marks[index] === 1)) {
      return { kind: "col", cells: new Set(cells), message: `第 ${col + 1} 列已经全部排除，但每列必须有 1 个牛角包。请撤回这一步。` };
    }
  }
  if (!canCompletePuzzle(marks, size, regions, solution)) {
    return {
      kind: "global",
      cells: new Set(changedIndex === undefined ? [] : [changedIndex]),
      message: "这一步会让剩余棋盘无解。假设法中，这就是反证：撤回后可排除刚才的假设。",
    };
  }
  return null;
}

function nextDeductionMessage(marks: PuzzleMark[], size: number, regions: number[], advanced: boolean) {
  const placed = marks.map((mark, index) => ({ mark, index })).filter(({ mark }) => mark === 2).map(({ index }) => index);
  const viable = (index: number) => {
    if (marks[index] === 1) return false;
    if (marks[index] === 2) return true;
    const trial = [...marks];
    trial[index] = 2;
    return !conflictsFor(trial, size, regions).has(index);
  };
  for (let region = 0; region < size; region += 1) {
    if (placed.some((index) => regions[index] === region)) continue;
    const candidates = marks.map((_, index) => index).filter((index) => regions[index] === region && viable(index));
    if (candidates.length === 1) return `颜色 ${region + 1} 只剩 1 个可行格，它不能再打 ×，可以双击摆下牛角包。`;
  }
  for (let row = 0; row < size; row += 1) {
    if (placed.some((index) => Math.floor(index / size) === row)) continue;
    const candidates = Array.from({ length: size }, (_, col) => row * size + col).filter(viable);
    if (candidates.length === 1) return `第 ${row + 1} 行只剩 1 个可行格，继续排除它会导致无解。`;
  }
  return advanced
    ? "暂时没有唯一位置：可假设一个牵连多个颜色、行列的候选，再沿影响范围排除；出现无解就撤回假设。"
    : "这一步排除成功。继续从候选最少的颜色、行或列寻找唯一位置。";
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
  const regionPalette = useMemo(() => levelRegionPalette(levelIndex), [levelIndex]);
  const regionBoundary = config.size >= 10 ? 2 : 3;
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
  const [deadEndCells, setDeadEndCells] = useState<Set<number>>(new Set());
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
    setDeadEndCells(new Set());
    setMessage(clearHistory ? "已撤回最近一次操作。棋盘和失误次数都恢复了。" : snapshot.message);
    if (clearHistory) setUndoSnapshot(null);
  };

  const resetBoard = useCallback((nextLevel = levelIndex, nextVariant = variant) => {
    if (pendingTap.current) { clearTimeout(pendingTap.current.timer); pendingTap.current = null; }
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
    setDeadEndCells(new Set());
    setShowIdleHint(false);
    hintedRef.current = false;
    setActivityTick((value) => value + 1);
    setMessage(openingMessage(nextLevel));
  }, [levelIndex, variant]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = Number(window.localStorage.getItem(PUZZLE_PROGRESS_KEY) || 1);
      const nextUnlocked = Math.min(LEVELS.length, Math.max(1, saved));
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
    const nextUnlocked = Math.min(LEVELS.length, Math.max(unlockedLevel, levelIndex + 2));
    setUnlockedLevel(nextUnlocked);
    window.localStorage.setItem(PUZZLE_PROGRESS_KEY, String(nextUnlocked));
  }, [levelIndex, playSfx, unlockedLevel]);

  const registerBoardMistake = (copy: string) => {
    const nextMistakes = mistakesRef.current + 1;
    mistakesRef.current = nextMistakes;
    setMistakes(nextMistakes);
    setMessage(copy);
    playSfx("lose");
    vibrate([35, 25, 55]);
    if (nextMistakes > config.mistakeLimit) {
      setStatus("failed");
      setMessage(`${copy} 本关容错已经用完，请撤回或重新开始。`);
    }
  };

  const applyMark = (index: number, nextMark: PuzzleMark, countConflict = true, saveHistory = true, history?: PuzzleSnapshot) => {
    const current = marksRef.current;
    if (current[index] === nextMark || status === "won" || status === "failed") return;
    if (saveHistory) setUndoSnapshot(history || makeSnapshot());
    const next = [...current];
    next[index] = nextMark;
    const nextConflicts = conflictsFor(next, config.size, puzzle.regions);
    // 排除标记先保持轻量：只有用户明确双击摆下牛角包后，才检查整盘是否无解。
    // 这样稍慢的第二次点击仍能被识别，不会在双击中途弹出误导性的红色警告。
    const nextIssue = nextMark === 2 && !nextConflicts.size
      ? findDeadEndIssue(next, config.size, puzzle.regions, puzzle.solution, index)
      : null;
    marksRef.current = next;
    setMarks(next);
    setConflicts(nextConflicts);
    setDeadEndCells(nextIssue?.cells || new Set());
    setStatus("playing");
    registerActivity();

    if (countConflict && nextMark !== 0 && (nextConflicts.has(index) || nextIssue)) {
      const copy = nextConflicts.has(index)
        ? conflictMessage(conflictTypesFor(next, config.size, puzzle.regions))
        : nextIssue!.message;
      if (nextConflicts.has(index)) setDeadEndCells(new Set(nextConflicts));
      registerBoardMistake(copy);
      return;
    }

    if (solved(next, config.size, puzzle.regions) && tutorialStep === null) {
      finishLevel();
      return;
    }
    if (tutorialStep === null) {
      if (nextConflicts.size === 0 && conflicts.size > 0) setMessage("冲突已经解除，三条规则重新满足啦。");
      else if (nextIssue && nextMark !== 0) setMessage(nextIssue.message);
      else if (nextMark === 1) setMessage(nextDeductionMessage(next, config.size, puzzle.regions, !levelUsesGiven(levelIndex)));
      else if (nextMark === 2) setMessage(levelUsesGiven(levelIndex) ? "摆下一个牛角包。继续检查它的颜色、行列和周围 8 格。" : "假设已摆下。沿它影响的颜色、行列和周围继续排除；出现无解就撤回。" );
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

  const markCross = (index: number, history?: PuzzleSnapshot, countConflict = true) => {
    if (!tutorialAllows(index, "cross")) return;
    if (tutorialStep === 3) return;
    const current = marksRef.current[index];
    if (current === 2) return;
    applyMark(index, current === 1 ? 0 : 1, tutorialStep === null && countConflict, true, history);
    if (tutorialStep === 2) setTutorialStep(3);
  };

  const toggleCroissant = (index: number, history?: PuzzleSnapshot, saveHistory = true) => {
    if (!tutorialAllows(index, "place")) return;
    applyMark(index, marksRef.current[index] === 2 ? 0 : 2, tutorialStep === null, saveHistory, history);
    if (tutorialStep === 4 && marksRef.current[index] === 2) setTutorialStep(5);
  };

  const handleCellClick = (index: number) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (tutorialStep === null && levelUsesGiven(levelIndex) && index === puzzle.autoCell) {
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
    markCross(index, before, false);
    const timer = setTimeout(() => {
      pendingTap.current = null;
    }, DOUBLE_TAP_WINDOW_MS);
    pendingTap.current = { index, timer, before };
  };

  const pointerIndex = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-puzzle-index]");
    return element ? Number(element.dataset.puzzleIndex) : null;
  };

  const paintDragPath = (from: number, to: number) => {
    if (status === "won" || status === "failed") return false;
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
    // 连续划 × 不在手势中途打断用户；无解检查延后到下一次明确摆放。
    setDeadEndCells(new Set());
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
    }, 105);
  };

  const dragAcross = (event: ReactPointerEvent<HTMLDivElement>) => {
    const index = pointerIndex(event);
    if (index === null || !dragStart.current) return;
    if (!dragging.current) {
      const distance = Math.hypot(event.clientX - dragStart.current.x, event.clientY - dragStart.current.y);
      if (distance < 4) return;
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
    setMessage(levelUsesGiven(levelIndex)
      ? "本局已重新开始：餐盘和系统给定位置保持不变，请从第一步重新推理。"
      : "本局已重新开始：餐盘保持不变，本关没有预放位置，请重新判断第一只牛角包。"
    );
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
      window.setTimeout(() => { setScanFocus(null); setScanHintTarget(null); }, 5200);
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

        <div className={`puzzle-feedback ${conflicts.size || deadEndCells.size ? "error" : ""} ${scanHintTarget !== null || tidyHighlights.size ? "helper" : ""}`} role="status">
          <span>{conflicts.size || deadEndCells.size ? "!" : scanHintTarget !== null || tidyHighlights.size ? "✦" : "✓"}</span>
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
                className={`puzzle-cell ${mark === 1 ? "crossed" : ""} ${mark === 2 ? "has-croissant" : ""} ${levelUsesGiven(levelIndex) && index === puzzle.autoCell ? "system-anchor" : ""} ${conflicts.has(index) ? "conflict" : ""} ${deadEndCells.has(index) ? "dead-end" : ""} ${tutorialTarget ? "tutorial-target" : ""} ${scanHighlighted ? "scan-focus" : ""} ${scanHintTarget === index ? "scan-answer" : ""} ${tidyHighlights.has(index) ? "tidy-focus" : ""}`}
                style={{
                  "--region": regionPalette[region % regionPalette.length],
                  borderTopWidth: topDifferent ? regionBoundary : 1,
                  borderLeftWidth: leftDifferent ? regionBoundary : 1,
                  borderRightWidth: rightDifferent ? regionBoundary : 1,
                  borderBottomWidth: bottomDifferent ? regionBoundary : 1,
                } as CSSProperties}
                role="gridcell"
                aria-label={`第 ${row + 1} 行第 ${col + 1} 列，颜色区域 ${region + 1}${levelUsesGiven(levelIndex) && index === puzzle.autoCell ? "，系统给定牛角包" : mark === 1 ? "，已排除" : mark === 2 ? "，已放牛角包" : "，空格"}`}
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
            <div><small>{status === "won" ? victory.badge : "TRY AGAIN"}</small><h2>{status === "won" ? victory.title : "摆盘需要调整一下"}</h2><p>{status === "won" ? victory.copy : levelUsesGiven(levelIndex) ? "保留这张餐盘，从系统给定的第一个牛角包重新推理。" : "保留这张餐盘，撤回刚才的假设，或从候选最少的颜色重新开始。"}</p></div>
            <div className="result-actions">
              {status === "failed" && undoSnapshot && <button className="result-button secondary pressable" onClick={undoLastAction}>撤回这步</button>}
              {status === "won" && levelIndex < LEVELS.length - 1 ? <button className="result-button pressable" onClick={() => resetBoard(levelIndex + 1, 0)}>下一关</button> : status === "won" ? <button className="result-button pressable" onClick={() => setShowLevelPicker(true)}>查看全部关卡</button> : <button className="result-button pressable" onClick={restartCurrentPuzzle}>本局重来</button>}
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
            <span className="mission-tag">{LEVELS.length} 份摆盘订单</span>
            <h2 id="level-picker-title">选择关卡</h2>
            <p>每位玩家的进度独立保存在自己的设备；通过当前最高关卡，才会解锁下一张餐盘。</p>
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
            <ol><li><b>开局方式</b>：前 16 关系统给 1 个带星标的起点；第 17 关起不再预放，由你判断第一只。</li><li><b>颜色唯一</b>：每种颜色区域恰好放 1 个牛角包；某个颜色全部打 × 会直接无解。</li><li><b>行列唯一</b>：每一行、每一列恰好放 1 个；整行或整列不能全部排除。</li><li><b>不能相邻</b>：横、竖、斜方向挨着都不可以，所以一个牛角包周围 8 格都能排除。</li><li><b>操作</b>：单击立即打 ×，同一格稍慢一点双击也能摆放或拿走；按住或直接滑动会连续补齐 ×。</li><li><b>提醒时机</b>：打 × 时不会中途弹出无解警告；双击确认摆放后，才检查颜色、行列和整盘是否仍有解。</li><li><b>道具与撤回</b>：339 锁定正确格，小顾批量排除；道具一经使用不能撤回，次数也不会退还。</li></ol>
            <div className="advanced-strategies"><b>后期技巧 · 假设与联动</b><p>先找只剩 1 格的颜色、行或列。若没有唯一格，优先假设一个能影响多个颜色与行列的位置，再沿同行、同列、同色和周围 8 格继续排除；一旦系统提示“无解”，就说明这条假设被反证。</p><p>当三种颜色的候选全部集中在三行或三列时，这些行列里的其他颜色可以排除；反过来也同样成立。</p></div>
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
