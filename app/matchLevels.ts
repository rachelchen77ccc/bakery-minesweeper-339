export type MatchIconId = 0 | 1 | 2 | 3 | 4;

export const MATCH_ICON_FILES = [
  "match-croissant",
  "match-bread",
  "match-xiaogu",
  "match-xiaowen",
  "match-339",
] as const;

export const MATCH_ICON_LABELS = ["牛角包", "面包", "小顾", "小温", "339"] as const;

// 小顾、小温消除得分相等，且比其他材料高——呼应"双人协作"两人并肩的设定。
export const ICON_SCORE_VALUE: Record<MatchIconId, number> = {
  0: 10, // 牛角包
  1: 10, // 面包
  2: 15, // 小顾
  3: 15, // 小温
  4: 10, // 339
};

export type GoalRule =
  | { type: "collect"; icon: MatchIconId; amount: number }
  | { type: "clearObstacles" }
  | { type: "score"; amount: number };

export type ShapeId =
  | "rect"
  | "diamond"
  | "heart"
  | "doubleHeart"
  | "ring"
  | "plus"
  | "xcross"
  | "hourglass"
  | "bowtie"
  | "star"
  | "staircase"
  | "finale339";

export type MatchLevelRule = {
  index: number;
  displayNumber: number;
  tier: string;
  tierIndex: number;
  difficulty: MatchDifficulty;
  width: number;
  height: number;
  shapeId: ShapeId;
  tileTypes: number;
  moveLimit: number;
  obstacle: { light: number; heavy: number };
  goals: GoalRule[];
};

export const MATCH_LEVEL_COUNT = 339;

export type MatchDifficulty = "easy" | "normal" | "hard";

export const MATCH_DIFFICULTIES: { id: MatchDifficulty; label: string }[] = [
  { id: "easy", label: "简单" },
  { id: "normal", label: "中等" },
  { id: "hard", label: "高级" },
];

// hard = 上线时的原始数值（保留给想要挑战的玩家）；normal/easy 在此基础上
// 放宽步数、减少障碍、降低目标数值，三个维度各自独立生效。maxGoals 控制同一关
// 最多要求同时达成几个目标——hard 保留原有的多目标组合，easy/normal 结构性地
// 减少"必须同时达成两三件事"这种难点，而不只是把数值调低。
const DIFFICULTY_ADJUST: Record<MatchDifficulty, { moveMul: number; obstacleMul: number; goalMul: number; maxGoals: number }> = {
  easy: { moveMul: 1.55, obstacleMul: 0.45, goalMul: 0.7, maxGoals: 1 },
  normal: { moveMul: 1.25, obstacleMul: 0.7, goalMul: 0.85, maxGoals: 2 },
  hard: { moveMul: 1, obstacleMul: 1, goalMul: 1, maxGoals: 3 },
};

// 目标裁剪优先级：清障碍格 > 收集 > 分数——障碍格已经生成在棋盘上了，砍掉这个
// 目标会让玩家看着障碍格却没有对应目标，体感最奇怪，所以最后才砍它；分数目标
// 相对最抽象，maxGoals 收紧时优先砍它。
function goalPriority(goal: GoalRule) {
  if (goal.type === "clearObstacles") return 0;
  if (goal.type === "collect") return 1;
  return 2;
}

function capGoals(goals: GoalRule[], maxGoals: number): GoalRule[] {
  if (goals.length <= maxGoals) return goals;
  return goals
    .map((goal, order) => ({ goal, order }))
    .sort((a, b) => goalPriority(a.goal) - goalPriority(b.goal) || a.order - b.order)
    .slice(0, maxGoals)
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.goal);
}

function hash(index: number, salt: number) {
  const x = Math.sin(index * 12.9898 + salt * 78.233 + 1.7) * 43758.5453;
  return x - Math.floor(x);
}

function pick<T>(index: number, salt: number, list: readonly T[]): T {
  return list[Math.floor(hash(index, salt) * list.length) % list.length];
}

function lerp(t: number, a: number, b: number) {
  const clamped = Math.min(1, Math.max(0, t));
  return a + (b - a) * clamped;
}

function round(value: number) {
  return Math.round(value);
}

function dist(u: number, v: number, cu: number, cv: number) {
  return Math.hypot(u - cu, v - cv);
}

function heartAt(u: number, v: number) {
  const lobeR = 0.6;
  const lobeV = -0.32;
  const left = dist(u, v, -0.5, lobeV) <= lobeR;
  const right = dist(u, v, 0.5, lobeV) <= lobeR;
  const topV = lobeV - 0.05;
  const bottomV = 1.08;
  let tri = false;
  if (v >= topV && v <= bottomV) {
    const ratio = (bottomV - v) / (bottomV - lobeV);
    tri = Math.abs(u) <= 1.02 * ratio;
  }
  return left || right || tri;
}

function scanShape(w: number, h: number, fn: (u: number, v: number) => boolean) {
  const active = new Set<number>();
  for (let r = 0; r < h; r += 1) {
    const v = ((r + 0.5) / h) * 2 - 1;
    for (let c = 0; c < w; c += 1) {
      const u = ((c + 0.5) / w) * 2 - 1;
      if (fn(u, v)) active.add(r * w + c);
    }
  }
  return active;
}

const FINALE_339_ROWS = [
  ".###...###...###.",
  "#...#.#...#.#...#",
  "....#.....#.#...#",
  "..##....##...####",
  "....#.....#.....#",
  "#...#.#...#.#...#",
  ".###...###...###.",
];

function finale339Mask() {
  const active = new Set<number>();
  const width = FINALE_339_ROWS[0].length;
  FINALE_339_ROWS.forEach((row, r) => {
    for (let c = 0; c < width; c += 1) {
      if (row[c] === "#") active.add(r * width + c);
    }
  });
  return active;
}

export const FINALE_339_SIZE = { width: FINALE_339_ROWS[0].length, height: FINALE_339_ROWS.length };

const SHAPE_BUILDERS: Record<ShapeId, (w: number, h: number) => Set<number>> = {
  rect: (w, h) => scanShape(w, h, () => true),
  diamond: (w, h) => scanShape(w, h, (u, v) => Math.abs(u) + Math.abs(v) <= 1.06),
  heart: (w, h) => scanShape(w, h, heartAt),
  doubleHeart: (w, h) => scanShape(w, h, (u, v) => heartAt((u - 0.55) / 0.62, v / 0.62) || heartAt((u + 0.55) / 0.62, v / 0.62)),
  ring: (w, h) => scanShape(w, h, (u, v) => { const d = Math.hypot(u, v); return d <= 1.05 && d >= 0.48; }),
  plus: (w, h) => scanShape(w, h, (u, v) => Math.abs(u) <= 0.38 || Math.abs(v) <= 0.38),
  xcross: (w, h) => scanShape(w, h, (u, v) => Math.abs(u - v) <= 0.34 || Math.abs(u + v) <= 0.34),
  hourglass: (w, h) => scanShape(w, h, (u, v) => Math.abs(u) <= 0.16 + Math.abs(v) * 0.86),
  bowtie: (w, h) => scanShape(w, h, (u, v) => Math.abs(v) <= 0.16 + Math.abs(u) * 0.86),
  star: (w, h) => scanShape(w, h, (u, v) => {
    const angle = Math.atan2(v, u);
    const r = Math.hypot(u, v);
    const spikes = 5;
    const seg = (2 * Math.PI) / spikes;
    const t = (((angle + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const local = (t % seg) / seg;
    const radius = 0.46 + (1.02 - 0.46) * (1 - Math.abs(local - 0.5) * 2);
    return r <= radius;
  }),
  staircase: (w, h) => {
    const active = new Set<number>();
    const steps = 5;
    for (let r = 0; r < h; r += 1) {
      const band = Math.min(steps - 1, Math.floor((r / h) * steps));
      const cols = Math.round(((band + 1) / steps) * w);
      for (let c = 0; c < cols; c += 1) active.add(r * w + c);
    }
    return active;
  },
  finale339: () => finale339Mask(),
};

export function buildShapeMask(shapeId: ShapeId, width: number, height: number) {
  return SHAPE_BUILDERS[shapeId](width, height);
}

type GoalRecipe =
  | "collect1"
  | "collect2"
  | "collect1score"
  | "clearObstacles"
  | "collect1clear"
  | "score"
  | "clearScore"
  | "finaleTriple";

type TierConfig = {
  name: string;
  start: number;
  count: number;
  shapes: ShapeId[];
  sizeAt: (posInTier: number, count: number) => { width: number; height: number };
  tileTypesAt: (posInTier: number, count: number) => number;
  moveLimitRange: [number, number];
  lightRange: [number, number];
  heavyRange: [number, number];
  goalRecipes: GoalRecipe[];
  captions: string[];
};

const TIERS: TierConfig[] = [
  {
    name: "甜蜜启程",
    start: 0,
    count: 40,
    shapes: ["rect", "diamond", "plus", "ring"],
    sizeAt: () => ({ width: 9, height: 9 }),
    tileTypesAt: () => 4,
    moveLimitRange: [26, 20],
    lightRange: [0, 5],
    heavyRange: [0, 0],
    goalRecipes: ["collect1"],
    captions: [
      "小顾：先凑三个一样的试试手感，339 都在旁边看着呢。",
      "小温：慢慢来，第一批订单不难，我陪你一起数。",
      "339：检测到新手玩家，已切换到温柔提示模式。",
      "小顾：三个连在一起就会消失，挺神奇的对不对？",
    ],
  },
  {
    name: "双人协作",
    start: 40,
    count: 50,
    shapes: ["heart", "xcross", "bowtie", "hourglass", "diamond"],
    sizeAt: (pos) => (pos < 25 ? { width: 9, height: 9 } : { width: 10, height: 9 }),
    tileTypesAt: (pos) => (pos < 25 ? 4 : 5),
    moveLimitRange: [22, 17],
    lightRange: [4, 10],
    heavyRange: [0, 0],
    goalRecipes: ["collect2", "collect1score"],
    captions: [
      "小温：两种口味一起收集，才够开一次像样的下午茶。",
      "小顾：步数比刚才紧一点了，尽量少走弯路。",
      "339：双目标协议启动，小顾和小温都在等成果。",
      "小温：出现烤焦纸罩了，碰一下它旁边就能揭掉。",
    ],
  },
  {
    name: "五味俱全",
    start: 90,
    count: 70,
    shapes: ["ring", "star", "doubleHeart", "plus", "diamond", "xcross"],
    sizeAt: () => ({ width: 10, height: 10 }),
    tileTypesAt: () => 5,
    moveLimitRange: [19, 15],
    lightRange: [6, 10],
    heavyRange: [2, 6],
    goalRecipes: ["clearObstacles", "collect1clear"],
    captions: [
      "339：奶油冻要碰两次才会化开，别只盯着一个角落。",
      "小顾：五种口味全上齐了，棋盘也更花了，看清楚再点。",
      "小温：障碍格清完，这盘才算真的收拾干净。",
      "小顾：靠近障碍格消除也算数，不用非得正中它。",
    ],
  },
  {
    name: "层层用心",
    start: 160,
    count: 70,
    shapes: ["heart", "hourglass", "staircase", "bowtie", "star"],
    sizeAt: (pos) => (pos < 35 ? { width: 10, height: 10 } : { width: 11, height: 10 }),
    tileTypesAt: () => 5,
    moveLimitRange: [16, 13],
    lightRange: [4, 8],
    heavyRange: [6, 12],
    goalRecipes: ["score", "collect1clear"],
    captions: [
      "339：分数目标已上线，连击越长，分数涨得越快。",
      "小温：步数真的不多了，每一步都要想清楚方向。",
      "小顾：奶油冻变多了，四连消除清障碍格特别快。",
      "339：这一关的地形，339 也要多算两遍才敢确认。",
    ],
  },
  {
    name: "烘焙大师",
    start: 230,
    count: 70,
    shapes: ["heart", "doubleHeart", "ring", "star", "xcross", "staircase", "diamond"],
    sizeAt: () => ({ width: 11, height: 11 }),
    tileTypesAt: () => 5,
    moveLimitRange: [14, 11],
    lightRange: [8, 14],
    heavyRange: [8, 14],
    goalRecipes: ["collect1clear", "collect1score", "clearScore"],
    captions: [
      "小顾：两个目标一起追，节奏要抓得比之前更紧。",
      "小温：主厨级订单，339 都开始认真计时了。",
      "339：警告：棋盘密度已达大师级，请谨慎交换。",
      "小顾：先看清哪种目标更紧急，别平均分配步数。",
    ],
  },
  {
    name: "终极告白",
    start: 300,
    count: 39,
    shapes: ["heart", "doubleHeart", "star", "ring", "xcross"],
    sizeAt: () => ({ width: 11, height: 11 }),
    tileTypesAt: () => 5,
    moveLimitRange: [12, 9],
    lightRange: [10, 16],
    heavyRange: [10, 18],
    goalRecipes: ["collect1clear", "clearScore", "finaleTriple"],
    captions: [
      "小温：这已经是最后一段路了，339 会一直陪着我们。",
      "小顾：步数少到几乎没有容错，但我们练了这么久。",
      "339：终章协议启动，检测到两个人的默契值满格。",
      "小温：消完这一关，我们就正式开这家烘焙屋了。",
    ],
  },
];

function goalsForRecipe(recipe: GoalRecipe, index: number, tileTypes: number, moveLimit: number, goalMul: number = 1): GoalRule[] {
  const iconA = Math.floor(hash(index, 11) * tileTypes) as MatchIconId;
  let iconB = Math.floor(hash(index, 23) * tileTypes) as MatchIconId;
  if (iconB === iconA) iconB = ((iconB + 1) % tileTypes) as MatchIconId;
  const collectFactor = 1.6 + hash(index, 31) * 0.7;
  const scoreFactor = 80 + hash(index, 41) * 55;
  const singleAmount = Math.max(3, round(moveLimit * collectFactor * goalMul));
  const splitAmount = Math.max(2, round(moveLimit * collectFactor * 0.62 * goalMul));
  const scoreAmount = Math.max(20, round((moveLimit * scoreFactor * goalMul) / 10) * 10);

  switch (recipe) {
    case "collect1":
      return [{ type: "collect", icon: iconA, amount: singleAmount }];
    case "collect2":
      return [
        { type: "collect", icon: iconA, amount: splitAmount },
        { type: "collect", icon: iconB, amount: splitAmount },
      ];
    case "collect1score":
      return [
        { type: "collect", icon: iconA, amount: splitAmount },
        { type: "score", amount: scoreAmount },
      ];
    case "clearObstacles":
      return [{ type: "clearObstacles" }];
    case "collect1clear":
      return [
        { type: "collect", icon: iconA, amount: splitAmount },
        { type: "clearObstacles" },
      ];
    case "score":
      return [{ type: "score", amount: scoreAmount }];
    case "clearScore":
      return [{ type: "clearObstacles" }, { type: "score", amount: scoreAmount }];
    case "finaleTriple":
      return [
        { type: "collect", icon: iconA, amount: splitAmount },
        { type: "clearObstacles" },
        { type: "score", amount: scoreAmount },
      ];
    default:
      return [{ type: "collect", icon: iconA, amount: singleAmount }];
  }
}

export function tierIndexForLevel(index: number): number {
  const clamped = Math.min(MATCH_LEVEL_COUNT - 1, Math.max(0, index));
  const tierIndex = TIERS.findIndex((tier) => clamped < tier.start + tier.count);
  return tierIndex === -1 ? TIERS.length - 1 : tierIndex;
}

export function getMatchLevelRule(index: number, difficulty: MatchDifficulty = "normal"): MatchLevelRule {
  const clamped = Math.min(MATCH_LEVEL_COUNT - 1, Math.max(0, index));
  const tierIndex = tierIndexForLevel(clamped);
  const tier = TIERS[tierIndex];
  const pos = clamped - tier.start;
  const t = tier.count <= 1 ? 0 : pos / (tier.count - 1);
  const adjust = DIFFICULTY_ADJUST[difficulty];

  const isFinaleLevel = clamped === MATCH_LEVEL_COUNT - 1;
  const size = isFinaleLevel ? FINALE_339_SIZE : tier.sizeAt(pos, tier.count);
  const shapeId: ShapeId = isFinaleLevel ? "finale339" : pick(clamped, 3, tier.shapes);
  const tileTypes = tier.tileTypesAt(pos, tier.count);
  const baseMoveLimit = isFinaleLevel
    ? tier.moveLimitRange[1]
    : round(lerp(t, tier.moveLimitRange[0], tier.moveLimitRange[1]));
  const moveLimit = Math.max(6, round(baseMoveLimit * adjust.moveMul));
  const baseLight = round(lerp(t, tier.lightRange[0], tier.lightRange[1]));
  const baseHeavy = round(lerp(t, tier.heavyRange[0], tier.heavyRange[1]));
  const light = round(baseLight * adjust.obstacleMul);
  const heavy = round(baseHeavy * adjust.obstacleMul);
  const recipe: GoalRecipe = isFinaleLevel ? "finaleTriple" : pick(clamped, 51, tier.goalRecipes);
  const goals = capGoals(goalsForRecipe(recipe, clamped, tileTypes, baseMoveLimit, adjust.goalMul), adjust.maxGoals);

  return {
    index: clamped,
    displayNumber: clamped + 1,
    tier: tier.name,
    tierIndex,
    difficulty,
    width: size.width,
    height: size.height,
    shapeId,
    tileTypes,
    moveLimit,
    obstacle: { light, heavy },
    goals,
  };
}

export function captionForLevel(index: number) {
  const tier = TIERS[tierIndexForLevel(index)];
  return pick(index, 61, tier.captions);
}

export function tierList() {
  return TIERS.map((tier, tierIndex) => ({ name: tier.name, start: tier.start, count: tier.count, tierIndex }));
}

export type MatchCell = {
  active: boolean;
  icon: MatchIconId | null;
  cover: 0 | 1 | 2;
  special: "stripedRow" | "stripedCol" | "rainbow" | "blockBomb" | null;
};

export type MatchBoard = {
  width: number;
  height: number;
  cells: MatchCell[];
  /** Which icons are in play for this board — always all 5 (牛角包/面包/
   * 小顾/小温/339), so every icon can appear on every level's board. */
  iconPool: MatchIconId[];
};

function neighborsOf(index: number, width: number, height: number) {
  const row = Math.floor(index / width);
  const col = index % width;
  const list: number[] = [];
  if (row > 0) list.push(index - width);
  if (row < height - 1) list.push(index + width);
  if (col > 0) list.push(index - 1);
  if (col < width - 1) list.push(index + 1);
  return list;
}

export type MatchRun = { cells: number[]; orientation: "row" | "col" };

export function findMatchRuns(cells: MatchCell[], width: number, height: number): MatchRun[] {
  const runs: MatchRun[] = [];
  for (let row = 0; row < height; row += 1) {
    let runStart = 0;
    for (let col = 0; col <= width; col += 1) {
      const index = row * width + col;
      const icon = col < width ? cells[index]?.icon ?? null : null;
      const active = col < width ? cells[index]?.active : false;
      const startIcon = cells[row * width + runStart]?.icon ?? null;
      const sameRun = active && icon !== null && icon === startIcon && cells[row * width + runStart]?.active;
      if (!sameRun) {
        if (col - runStart >= 3) {
          runs.push({ cells: Array.from({ length: col - runStart }, (_, k) => row * width + runStart + k), orientation: "row" });
        }
        runStart = col;
      }
    }
  }
  for (let col = 0; col < width; col += 1) {
    let runStart = 0;
    for (let row = 0; row <= height; row += 1) {
      const index = row * width + col;
      const icon = row < height ? cells[index]?.icon ?? null : null;
      const active = row < height ? cells[index]?.active : false;
      const startIcon = cells[runStart * width + col]?.icon ?? null;
      const sameRun = active && icon !== null && icon === startIcon && cells[runStart * width + col]?.active;
      if (!sameRun) {
        if (row - runStart >= 3) {
          runs.push({ cells: Array.from({ length: row - runStart }, (_, k) => (runStart + k) * width + col), orientation: "col" });
        }
        runStart = row;
      }
    }
  }
  return runs;
}

function findRunMatches(cells: MatchCell[], width: number, height: number) {
  const matched = new Set<number>();
  findMatchRuns(cells, width, height).forEach((run) => run.cells.forEach((index) => matched.add(index)));
  return matched;
}

export function hasAnyValidMove(board: MatchBoard) {
  const { cells, width, height } = board;
  for (let index = 0; index < cells.length; index += 1) {
    if (!cells[index].active) continue;
    for (const neighbor of neighborsOf(index, width, height)) {
      if (!cells[neighbor].active) continue;
      const trial = cells.map((cell) => ({ ...cell }));
      const a = trial[index].icon;
      trial[index].icon = trial[neighbor].icon;
      trial[neighbor].icon = a;
      if (findRunMatches(trial, width, height).size > 0) return true;
    }
  }
  return false;
}

export function emptyMatchBoard(rule: MatchLevelRule): MatchBoard {
  const { width, height } = rule;
  const mask = buildShapeMask(rule.shapeId, width, height);
  const cells: MatchCell[] = Array.from({ length: width * height }, (_, index) => ({
    active: mask.has(index),
    icon: null,
    cover: 0,
    special: null,
  }));
  return { width, height, cells, iconPool: [0, 1, 2, 3, 4] };
}

export function generateMatchBoard(rule: MatchLevelRule): MatchBoard {
  const { width, height } = rule;
  const mask = buildShapeMask(rule.shapeId, width, height);
  const activeIndexes = Array.from(mask.values());
  const maxObstacles = Math.floor(activeIndexes.length * 0.35);
  const targetHeavy = Math.min(rule.obstacle.heavy, maxObstacles);
  const targetLight = Math.min(rule.obstacle.light, Math.max(0, maxObstacles - targetHeavy));

  // All 5 icons are always in play — 牛角包/面包/小顾/小温/339 must every one
  // be able to show up on every board, not just whichever subset a level's
  // difficulty tier used to narrow things down to.
  const iconPool: MatchIconId[] = [0, 1, 2, 3, 4];
  const randomIcon = () => iconPool[Math.floor(Math.random() * iconPool.length)];

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const cells: MatchCell[] = Array.from({ length: width * height }, () => ({
      active: false,
      icon: null,
      cover: 0,
      special: null,
    }));
    activeIndexes.forEach((index) => {
      cells[index] = { active: true, icon: randomIcon(), cover: 0, special: null };
    });

    const shuffledActive = [...activeIndexes].sort(() => Math.random() - 0.5);
    shuffledActive.slice(0, targetHeavy).forEach((index) => { cells[index].cover = 2; });
    shuffledActive.slice(targetHeavy, targetHeavy + targetLight).forEach((index) => { cells[index].cover = 1; });

    let guard = 0;
    let existing = findRunMatches(cells, width, height);
    while (existing.size > 0 && guard < 60) {
      existing.forEach((index) => { cells[index].icon = randomIcon(); });
      existing = findRunMatches(cells, width, height);
      guard += 1;
    }

    const board = { width, height, cells, iconPool };
    if (hasAnyValidMove(board)) return board;
  }

  const cells: MatchCell[] = Array.from({ length: width * height }, () => ({
    active: false,
    icon: null,
    cover: 0,
    special: null,
  }));
  activeIndexes.forEach((index, order) => {
    cells[index] = { active: true, icon: iconPool[order % iconPool.length], cover: 0, special: null };
  });
  return { width, height, cells, iconPool };
}

export function cloneBoard(board: MatchBoard): MatchBoard {
  return { width: board.width, height: board.height, cells: board.cells.map((cell) => ({ ...cell })), iconPool: board.iconPool };
}

export { neighborsOf };
