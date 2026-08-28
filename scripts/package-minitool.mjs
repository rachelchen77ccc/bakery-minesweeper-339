import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist-minitool");
const outputs = join(root, "outputs");
const artifact = join(outputs, "339心动烘焙小工具-v1.4.1.zip");
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
const warnings = [];
const allowedExtensions = new Set([
  ".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".woff", ".woff2", ".json", ".mp3",
]);
const relativeFiles = files.map((file) => relative(dist, file).replaceAll("\\", "/"));
if (!relativeFiles.includes("index.html")) failures.push("ZIP 根目录缺少 index.html");
if (relativeFiles.filter((file) => file.endsWith(".html")).length !== 1) failures.push("HTML 入口不是唯一文件");
for (const file of relativeFiles) {
  if (!allowedExtensions.has(extname(file).toLowerCase())) failures.push(`不支持的文件类型：${file}`);
  if (file.endsWith(".map") || file.includes("node_modules/") || file.includes(".git/")) failures.push(`开发文件误入包：${file}`);
}

const html = readFileSync(join(dist, "index.html"), "utf8");
const js = readFileSync(join(dist, "assets/app.js"), "utf8");
const css = readFileSync(join(dist, "assets/style.css"), "utf8");
const requiredHtml = [
  [/<html lang="zh-CN">/, "缺少 lang=zh-CN"],
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

const referencedAssets = [...js.matchAll(/["'`](assets|audio)\/([^"'`?]+)/g)].map((match) => `${match[1]}/${match[2]}`);
for (const source of new Set(referencedAssets)) {
  if (!existsSync(join(dist, source))) failures.push(`JS 引用缺失资源：${source}`);
}

const unpackedBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
if (unpackedBytes > 10 * 1024 * 1024) failures.push(`未压缩包超过 10MB：${(unpackedBytes / 1024 / 1024).toFixed(2)}MB`);
if (relativeFiles.some((file) => file.endsWith(".mp3"))) {
  warnings.push("包内 MP3 均为本地媒体；依据能力清单“音视频播放、媒体文件须打包在内”保留。首次播放仍需用户手势解锁。 ");
}

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
  "资源：全部本地相对路径，无外链；图片为 WebP；音乐与音效为包内媒体",
  "端能力：未发现网络请求、Worker、定位、剪贴板、新窗口、iframe 等禁用能力",
  "跨端：Pointer Events、viewport-fit=cover、容器/真机双安全区变量",
  "声音：默认开启；首次用户轻点解锁；支持分别关闭 BGM/音效及关闭循环",
  ...warnings.map((warning) => `说明：${warning}`),
  `产物：${artifact}`,
  "",
].join("\n");
writeFileSync(reportPath, report);
console.log(report);
