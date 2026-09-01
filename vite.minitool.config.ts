import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist-minitool",
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    // Container baseline is Android 8.1 factory Chrome/WebView 61 — esbuild's
    // default target is far newer and leaves ES2020+ syntax (?., ??) untouched,
    // which is a hard SyntaxError (not just a missing feature) on that engine.
    target: ["es2017", "chrome61"],
    lib: {
      entry: resolve(__dirname, "github-pages/main.tsx"),
      name: "BakeryMiniTool",
      formats: ["iife"],
      fileName: () => "assets/app.js",
      cssFileName: "style",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
