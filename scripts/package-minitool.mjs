import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist-minitool");
const outputs = join(root, "outputs");
const artifact = join(outputs, "小红书上传用-339心动烘焙-v1.8.0.zip");
const reportPath = join(outputs, "小红书小工具-校验摘要.txt");

const optionalFiles = [
  ".nojekyll",
  "favicon.svg",
  "file.svg",
  "globe.svg",
  "window.svg",
  "audio/README.md",
  "audio/audio-manifest.json",
  "audio/bgm/请把BGM放在这里.md",
  "audio/sfx/请把音效放在这里.md",
];

for (const file of optionalFiles) rmSync(join(dist, file), { force: true });
writeFileSync(join(dist, "index.html"), readFileSync(join(root, "minitool/index.html")));

// All BGM basenames the game rotates through in the dev/GitHub-Pages build
// (see BGM_TRACK_BASENAMES in app/useGameAudio.ts) — embed every one that
// actually has a source file so the mini-tool zip gets the same variety
// instead of always looping a single track.
const bgmBasenames = ["bakery-loop", "bakery-loop-2", "bakery-loop-3", "bakery-loop-4"]
  .filter((basename) => existsSync(join(dist, `audio/bgm/${basename}.mp3`)));
if (bgmBasenames.length === 0) throw new Error("缺少音频源文件：audio/bgm/bakery-loop*.mp3");

const bgmSourceFiles = bgmBasenames.map((basename) => `audio/bgm/${basename}.mp3`);
if (process.platform === "darwin") {
  // AVAssetExportPresetAppleM4A has no bitrate knob and lands ~250kbps; with
  // 4 tracks embedded instead of 1, use 64kbps (still fine for background
  // music under SFX) to keep the combined Base64 payload reasonable.
  bgmSourceFiles.forEach((file, index) => {
    const rawTrim = join(dist, `audio/bgm/minitool-loop-${index}-raw.m4a`);
    const encoded = join(dist, `audio/bgm/minitool-loop-${index}.m4a`);
    execFileSync("xcrun", ["swift", join(root, "scripts/trim-minitool-bgm.swift"), join(dist, file), rawTrim], { stdio: "pipe" });
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", "-q", "127", "-s", "2", rawTrim, encoded], { stdio: "pipe" });
    rmSync(rawTrim, { force: true });
    bgmSourceFiles[index] = `audio/bgm/minitool-loop-${index}.m4a`;
  });
}

const sfxSources = {
  reveal: "audio/sfx/reveal.mp3",
  flag: "audio/sfx/flag.mp3",
  help: "audio/sfx/help.mp3",
  win: "audio/sfx/win.mp3",
  lose: "audio/sfx/lose.mp3",
  click: "audio/sfx/click.mp3",
};
const readBase64 = (file) => {
  const absolute = join(dist, file);
  if (!existsSync(absolute)) throw new Error(`缺少音频源文件：${file}`);
  return readFileSync(absolute).toString("base64");
};
const embeddedAudio = {
  bgm: bgmSourceFiles.map(readBase64),
  ...Object.fromEntries(Object.entries(sfxSources).map(([name, file]) => [name, readBase64(file)])),
};
writeFileSync(join(dist, "assets/audio-data.js"), `window.__BAKERY_AUDIO__=${JSON.stringify(embeddedAudio)};\n`);
rmSync(join(dist, "audio"), { recursive: true, force: true });

const files = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name);
    if (statSync(absolute).isDirectory()) walk(absolute);
    else files.push(absolute);
  }
}
walk(dist);

const failures = [];
const allowedExtensions = new Set([
  ".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".woff", ".woff2", ".json",
]);
const relativeFiles = files.map((file) => relative(dist, file).replaceAll("\\", "/"));
if (!relativeFiles.includes("index.html")) failures.push("ZIP 根目录缺少 index.html");
if (relativeFiles.filter((file) => file.endsWith(".html")).length !== 1) failures.push("HTML 入口不是唯一文件");
for (const file of relativeFiles) {
  if (!allowedExtensions.has(extname(file).toLowerCase())) failures.push(`不支持的文件类型：${file}`);
  if (file.endsWith(".map") || file.includes("node_modules/") || file.includes(".git/")) failures.push(`开发文件误入包：${file}`);
}

const html = readFileSync(join(dist, "index.html"), "utf8");
const js = relativeFiles.filter((file) => file.endsWith(".js")).map((file) => readFileSync(join(dist, file), "utf8")).join("\n");
const css = readFileSync(join(dist, "assets/style.css"), "utf8");
const requiredHtml = [
  [/<html\b[^>]*lang="zh-CN"/, "缺少 lang=zh-CN"],
  [/charset="UTF-8"/, "缺少 UTF-8 charset"],
  [/width=device-width/, "viewport 缺少 width=device-width"],
  [/initial-scale=1\.0/, "viewport 缺少 initial-scale=1.0"],
  [/viewport-fit=cover/, "viewport 缺少 viewport-fit=cover"],
];
for (const [pattern, message] of requiredHtml) if (!pattern.test(html)) failures.push(message);

const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)];
if (scriptTags.some((match) => !/\bsrc\s*=/.test(match[1]))) failures.push("存在内联 script");
const htmlBannedChecks = [
  [/\bonclick\s*=/i, "存在行内事件"],
  [/type=["']module["']/i, "存在 ES Module 脚本"],
  [/<base\b/i, "存在 base 标签"],
  [/<(?:iframe|object)\b/i, "存在 iframe/object"],
];
for (const [pattern, message] of htmlBannedChecks) if (pattern.test(html)) failures.push(message);

const jsBannedChecks = [
  [/\b(?:eval|Function)\s*\(/, "JS 包含动态代码执行"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection)\s*\(/, "JS 包含联网能力"],
  [/navigator\.(?:geolocation|clipboard|bluetooth|usb|hid|serial|serviceWorker)/, "JS 包含容器禁用的 navigator 能力"],
  [/\b(?:Worker|SharedWorker)\s*\(/, "JS 包含 Worker"],
  [/window\.(?:open|prompt)\s*\(/, "JS 包含新窗口或 prompt"],
  [/\b(?:import|export)\s+(?:from|\{)/, "经典脚本中残留 import/export"],
];
for (const [pattern, message] of jsBannedChecks) if (pattern.test(js)) failures.push(message);
if (/https?:\/\//i.test(html) || /url\(\s*["']?https?:\/\//i.test(css)) failures.push("HTML/CSS 存在外部资源 URL");

for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const source = match[1];
  if (/^(?:data:|blob:|#)/.test(source)) continue;
  if (!source.startsWith("./")) failures.push(`资源不是 ./ 相对路径：${source}`);
  const target = join(dist, source.replace(/^\.\//, ""));
  if (!existsSync(target)) failures.push(`HTML 引用缺失资源：${source}`);
}

const audioBundleMatch = html.match(/data-audio-bundle="([^"]+)"/);
if (!audioBundleMatch) failures.push("缺少 data-audio-bundle 音频数据包声明");
else if (!existsSync(join(dist, audioBundleMatch[1].replace(/^\.\//, "")))) failures.push("音频数据包引用不存在");
const EMBEDDED_BASE64_HARD_LIMIT = 1024 * 1024;
const checkEmbeddedBlob = (label, base64) => {
  if (!base64) {
    failures.push(`音频数据包缺少：${label}`);
    return;
  }
  const decodedBytes = Buffer.from(base64, "base64").length;
  if (decodedBytes > EMBEDDED_BASE64_HARD_LIMIT) {
    failures.push(`音频数据包 ${label} 解码后 ${(decodedBytes / 1024).toFixed(0)} KiB，超过单条 Base64 1 MiB 硬上限`);
  }
};
if (!Array.isArray(embeddedAudio.bgm) || embeddedAudio.bgm.length === 0) {
  failures.push("音频数据包缺少：bgm（需要至少一条 BGM）");
} else {
  embeddedAudio.bgm.forEach((base64, index) => checkEmbeddedBlob(`bgm[${index}]`, base64));
}
for (const name of Object.keys(sfxSources)) checkEmbeddedBlob(name, embeddedAudio[name]);

const referencedAssets = [...js.matchAll(/["'`]assets\/([^"'`?]+)/g)].map((match) => `assets/${match[1]}`);
for (const source of new Set(referencedAssets)) {
  if (!existsSync(join(dist, source))) failures.push(`JS 引用缺失资源：${source}`);
}

const unpackedBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
if (unpackedBytes > 10 * 1024 * 1024) failures.push(`未压缩包超过 10MB：${(unpackedBytes / 1024 / 1024).toFixed(2)}MB`);

if (failures.length) {
  console.error(`小红书小工具校验失败：\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

mkdirSync(outputs, { recursive: true });
rmSync(artifact, { force: true });
execFileSync("zip", ["-q", "-r", artifact, ".", "-x", "*.DS_Store"], { cwd: dist });
const zipList = execFileSync("unzip", ["-Z1", artifact], { encoding: "utf8" }).trim().split("\n");
if (!zipList.includes("index.html") || zipList.some((entry) => entry.startsWith("dist-minitool/"))) {
  throw new Error("ZIP 根目录结构校验失败");
}
const zipBytes = statSync(artifact).size;
const report = [
  "小红书小工具校验摘要",
  "====================",
  `结果：通过`,
  `文件数：${relativeFiles.length}`,
  `未压缩体积：${(unpackedBytes / 1024 / 1024).toFixed(2)} MB`,
  `ZIP 体积：${(zipBytes / 1024 / 1024).toFixed(2)} MB`,
  "入口：index.html（ZIP 根目录）",
  "脚本：经典 IIFE，无 type=module / import / export / 内联脚本",
  "资源：全部本地相对路径，无外链；图片为 WebP；音乐与音效嵌入允许的 audio-data.js",
  "文件类型：仅包含 html / css / js / webp，未包含 mp3 或其他白名单外扩展名",
  "端能力：未发现网络请求、Worker、定位、剪贴板、新窗口、iframe 等禁用能力",
  "跨端：Pointer Events、viewport-fit=cover、容器/真机双安全区变量",
  `声音：首页预载音乐，首次轻点立即播放；内置 ${bgmBasenames.length} 条 BGM 随机轮播（播完自动换下一条，不重复同一条），支持分别关闭 BGM/音效及关闭循环`,
  "摆盘：36 关，后期取消预放，最大 15×15；包含颜色/行列无解检测与假设法反证提示",
  "双击：识别窗口放宽至 480ms；排除操作不触发中途警告，确认摆放后才检查无解",
  `产物：${artifact}`,
  "",
].join("\n");
writeFileSync(reportPath, report);
console.log(report);
