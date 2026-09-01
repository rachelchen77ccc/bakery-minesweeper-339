# 339 心动烘焙游戏屋

小顾、小温和机器人 339 三人一起开的甜品店主题小游戏合集，纯前端 React 应用（无后端依赖），包含三个独立玩法模式，共享同一套 UI 交互规范与音效系统。三个模式互不依赖，可以分别理解、分别修改。

## 三个玩法模式

| 模式 | 入口组件 | 玩法一句话 |
| --- | --- | --- |
| 心动烘焙扫雷 | `app/page.tsx` 内的 `MinesweeperMode` | 经典扫雷，简单/中等/复杂三档难度，每局一次 339 安全扫描辅助 |
| 小温的牛角包摆盘 | `app/CroissantPuzzle.tsx` | 36 关数字摆盘益智题，含唯一解校验与假设法反证提示 |
| 小顾的甜蜜消消乐 | `app/MatchGame.tsx` + `app/matchLevels.ts` + `app/matchEngine.ts` | 339 关三消，参数化生成关卡（棋盘形状/障碍/目标随梯队递进），每个阶段可单独选简单/中等/高级难度 |

模式切换与外层菜单（首页三张卡片）在 `app/page.tsx` 的 `BakeryApp` 组件里，用 `type BakeryMode = "menu" | "minesweeper" | "platter" | "match"` 分发渲染。**修改任一模式时不要改动另外两个模式的组件函数体**——三者是刻意解耦的，只共享 `app/globals.css` 和 `app/useGameAudio.ts`。

消消乐是三者中最复杂的一个，逻辑拆成两层：
- `app/matchLevels.ts`：纯数据/纯函数层。关卡规则（`getMatchLevelRule`）、棋盘形状生成、难度系数表（`DIFFICULTY_ADJUST`）、图标计分表（`ICON_SCORE_VALUE`）、真随机棋盘生成（`generateMatchBoard`）。不依赖 React，可以直接用 Node 脚本单测。
- `app/matchEngine.ts`：交换/消除/连锁/特殊块/道具的纯逻辑引擎，同样不依赖 React。
- `app/MatchGame.tsx`：只负责 UI 状态和动画，调用上面两层。

## 目录结构

```
app/                  三个模式的组件 + 共享样式(globals.css) + 共享音频hook(useGameAudio.ts)
public/assets/        图标、贴纸等图片资源(.webp)
public/audio/bgm/     BGM 源文件(.mp3，随机轮播用，见下)
public/audio/sfx/     音效源文件(.mp3，支持同名多变体 -b/-c 后缀随机取用)
github-pages/         GitHub Pages 构建入口(main.tsx 渲染同一套 app 组件)
minitool/             小红书小工具构建入口(index.html 模板)
scripts/              构建期脚本(小工具打包、BGM 裁剪转码)
outputs/              小工具打包产物(.zip + 校验摘要，gitignore，不进版本库)
dist-pages/           GitHub Pages 构建输出(**会进版本库**，直接被 gh-pages 分支引用)
dist-minitool/        小工具构建的中间产物(gitignore)
```

以下目录是从 vinext/OpenAI Sites Creator 脚手架继承下来的样板代码，**这个游戏本身完全没用到**，看到可以直接忽略，别误以为是核心逻辑：`db/`、`worker/`、`app/chatgpt-auth.ts`、`app/_sites-preview/`、`drizzle/`、`examples/`、`.openai/`。

## 三套构建产物

同一份 `app/` 组件代码，按目标环境的能力限制打包成三种不同产物。改代码前先搞清楚自己改的东西会进哪个（或哪几个）产物。

| 命令 | 配置文件 | 产物 | 运行环境 | 音频实现 |
| --- | --- | --- | --- | --- |
| `npm run dev` | `vite.config.ts`（vinext） | 本地开发服务器 | 现代浏览器，Cloudflare Workers 本地模拟 | 按文件 URL 播放 mp3，多首 BGM 随机轮播 |
| `npm run build:pages` | `vite.github-pages.config.ts` | `dist-pages/`，静态站点 | 现代浏览器（GitHub Pages 托管） | 同上，按文件 URL 播放 |
| `npm run build:minitool` | `vite.minitool.config.ts` + `scripts/package-minitool.mjs` | `outputs/小红书上传用-*.zip` | 小红书小工具容器，**最低基线 Android 8.1 出厂 Chrome/WebView 61，纯离线不联网** | 音频转 Base64 嵌进 `assets/audio-data.js`，用 Web Audio 解码播放（容器不允许 zip 里出现 mp3 等音频文件类型，也不允许 `<audio>` 走 `data:`/`blob:`） |

`build:minitool` 的约束比前两者严格得多，踩坑的地方基本都记在 `scripts/package-minitool.mjs` 顶部和它跑的自检里：
- zip 内文件类型白名单：`html/css/js/png/jpg/jpeg/gif/webp/svg/woff/woff2/json`，**没有任何音频扩展名**。
- JS 必须能在 Chrome 61 上直接解析——`vite.minitool.config.ts` 显式把 esbuild `target` 设成 `["es2017", "chrome61"]`，否则 `?.`/`??` 这类新语法会在老 WebView 上直接抛 `SyntaxError`。
- 单条内嵌 Base64 解码后不能超过 1 MiB（脚本里有硬校验，超了直接构建失败）；BGM 源文件先用 `scripts/trim-minitool-bgm.swift` 裁剪、再用 `afconvert` 转 64kbps AAC 压体积。
- 已知未处理的缺口：`app/globals.css` 里有一批 Chrome 61 不支持且没有 `@supports` 兜底的现代 CSS（`clamp()` / `aspect-ratio` / `dvh` 视口单位）。不会导致崩溃（浏览器只会忽略这条声明），但老设备上局部布局可能跑偏，还没有回填 fallback。

## 共享机制

**音频系统**（`app/useGameAudio.ts`，三个模式和三套构建共用）：通过 `document.documentElement.dataset.audioBundle` 是否存在来判断是不是小工具的"嵌入模式"，自动切到对应的加载/播放路径，业务代码（`playSfx` / `unlockAudio` 等 API）三个模式调用方式完全一样，不需要关心底层差异。

**localStorage 存档 key**（都在浏览器本地，跟部署到哪个域名无关，不同域名/设备之间不同步）：

| Key | 用途 |
| --- | --- |
| `bakery-audio-settings` | 音乐/音效开关、音量、循环设置 |
| `bakery-tutorial-v2-complete`、`bakery-guide-seen` | 扫雷首次教学是否看过 |
| `bakery-best-{difficulty}` | 扫雷各难度最快用时 |
| `croissant-platter-tutorial-v2-complete`、`croissant-platter-unlocked` | 摆盘教学状态、已解锁到第几关 |
| `bakery-match-tutorial-v1-complete`、`bakery-match-last-level` | 消消乐教学状态、上次玩到第几关 |
| `bakery-match-tier-difficulty` | 消消乐每个阶段各自选的难度（简单/中等/高级），JSON 数组 |
| `bakery-match-unlocked-{easy,normal,hard}` | 消消乐三档难度各自独立的解锁进度；`bakery-match-unlocked`（无后缀）是旧版单一存档，仅用于一次性迁移进 `normal` |

## 本地开发

```bash
npm install
npm run dev          # 本地预览，三个模式都在同一个页面里
npm run lint
npm test             # 构建 + 渲染 HTML 快照测试
npm run build:pages    # 生成 GitHub Pages 静态产物到 dist-pages/
npm run build:minitool # 生成小红书小工具 zip 到 outputs/（依赖 macOS 的 afconvert/swift，非 macOS 上会跳过 BGM 转码分支）
```
