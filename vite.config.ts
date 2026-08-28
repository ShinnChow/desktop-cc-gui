import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// Preserves readable React component names in production bundles so the bundled
// react-scan overlay can attribute renders to real names (e.g. MessagesTimeline)
// instead of minified identifiers. It suppresses name minification and inflates
// the bundle, so it is opt-in: only profiling builds (VITE_ENABLE_REACT_SCAN=1)
// pay for it; regular release builds ship fully minified names.
import reactComponentName from "react-scan/react-component-name/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const rawDevPort =
  process.env.MOSS_DEV_PORT_ISOLATED === "1" ? Number(process.env.MOSS_DEV_PORT ?? "") : NaN;
const devPort =
  Number.isInteger(rawDevPort) && rawDevPort > 0 && rawDevPort <= 65535 ? rawDevPort : 1420;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const workerSafeConditionalEntries = new Map([
  [
    "decode-named-character-reference",
    nodeRequire.resolve("decode-named-character-reference"),
  ],
  [
    "hast-util-from-html-isomorphic",
    nodeRequire.resolve("hast-util-from-html-isomorphic"),
  ],
]);

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    ...(command === "build" && process.env.VITE_ENABLE_REACT_SCAN === "1"
      ? [reactComponentName({}) as PluginOption]
      : []),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // fix-session-load-bridge-freeze（Phase C 根因修复）：该包 exports 的
      // browser 条件指向 index.dom.js（模块顶层 document.createElement），
      // 在 worker 里必炸（实测 ReferenceError: Can't find variable: document，
      // 45 字符 / hash 1wt84ny，worker 每次实例化必崩 → markdown 全量回退主线程）。
      // 强制走离线构建（纯 JS 字符表，无 DOM），主线程/worker/dev/build 全栈一致；
      // 与 workerSafeConditionalEntries 互补（那里覆盖 rollup resolveId，
      // 这里覆盖 optimizeDeps 预打包——dev worker 实际加载的是后者产物）。
      "decode-named-character-reference": path.resolve(
        __dirname,
        "node_modules/decode-named-character-reference/index.js",
      ),
    },
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/autocomplete",
      "@codemirror/lint",
      "@codemirror/search",
    ],
  },
  optimizeDeps: {
    include: [
      // vendored TokenTracker 页面（usage / skills）全部经 React.lazy 异步
      // 加载，vite 的 entry 扫描发现不了这些只出现在 lazy chunk 里的依赖；
      // 首次点击进入页面时才被发现会触发 re-optimize + 整页 reload，这里
      // 显式预 bundling。
      "@base-ui/react/checkbox",
      "@base-ui/react/dialog",
      "@base-ui/react/popover",
      "@base-ui/react/select",
      "@base-ui/react/toast",
      "motion/react",
    ],
  },
  worker: {
    format: "es",
    plugins: () => [
      {
        name: "fast-markdown-worker-safe-conditional-exports",
        enforce: "pre",
        resolveId(source) {
          return workerSafeConditionalEntries.get(source) ?? null;
        },
      },
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    // Cold-start: optional heavy vendors must not be force-preloaded with AppShell.
    // They remain available via normal dynamic import when a feature actually needs them.
    modulePreload: {
      resolveDependencies(_filename, deps) {
        const blockedPrefixes = [
          "vendor-mermaid",
          "vendor-markdown",
          "vendor-codemirror",
          "vendor-docs",
          "vendor-ui-heavy",
        ];
        const blockedEntryPrefixes = [
          "AboutView-",
          "Detached",
          "ClientDocumentation",
          "SpecHub-",
          "FileViewPanel-",
          "BrowserDock-",
          "treemap-",
          "mermaidExport-",
          "normalizeMermaidSource-",
        ];
        return deps.filter((dep) => {
          const base = dep.split(/[\\/]/).pop() ?? dep;
          if (blockedPrefixes.some((prefix) => base.startsWith(prefix))) {
            return false;
          }
          if (blockedEntryPrefixes.some((prefix) => base.startsWith(prefix))) {
            return false;
          }
          if (base.includes("mermaid") || base.includes("markdown-")) {
            return false;
          }
          return true;
        });
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          // Cold-start P0-1: force perfBaseline off mermaid/treemap shared facades.
          // Without this, Rollup co-chunks isPerfBaselineEnabled with TreemapModule
          // and bootstrapApp statically pays ~656KB gzip vendor-mermaid.
          if (normalizedId.includes("/src/services/perfBaseline/")) {
            return "perf-baseline";
          }
          // featureStyleLoaders is shared by AppShell; Rollup previously co-chunked
          // it with mermaid diagram facades, reintroducing a static mermaid edge.
          if (
            normalizedId.includes("/src/styles/featureStyleLoaders") ||
            normalizedId.includes("/src/styles/featureStyle")
          ) {
            return "feature-style-loaders";
          }
          // saveMermaidPngFile is a tiny Tauri invoke wrapper. If left for Rollup's
          // shared merger it co-lands with mermaid diagram facades; the services/tauri
          // barrel then statically pulls vendor-mermaid into AppShell.
          if (normalizedId.includes("/src/services/tauri/mermaidExport")) {
            return "mermaid-export";
          }
          // Vite/Rollup 的共享 helper 虚拟模块不带 node_modules 路径，默认并进
          // 「首个使用者」chunk；一旦落进 vendor-mermaid / vendor-docs，入口会静态
          // 依赖这些重 chunk，把懒加载全部击穿。钉进常驻小 chunk（不要用 \0 全量
          // 兜底：commonjs 代理模块也带 \0 前缀，会把真实代码扫进来并造成循环 chunk）。
          if (id === "\0vite/preload-helper.js" || id === "\0commonjsHelpers.js")
            return "vendor-shared";
          if (!id.includes("node_modules")) return;
          // Radix compose-refs is tiny and used by shell UI; if left for Rollup's
          // shared-chunk merger it co-lands with mermaid diagram facades and the
          // whole vendor-mermaid becomes a static edge of app-shell (P0-1 follow-up).
          if (normalizedId.includes("/@radix-ui/react-compose-refs/")) {
            return "vendor-compose-refs";
          }
          if (id.includes("/react-dom/") || /\/react\//.test(id) || id.includes("scheduler"))
            return "vendor-react";
          if (id.includes("@codemirror/") || id.includes("@lezer/")) return "vendor-codemirror";
          if (id.includes("@tauri-apps/")) return "vendor-tauri";
          // Pure markdown parsing chains (no React deps) — keeps vendor-react acyclic
          if (id.includes("/katex/") || id.includes("micromark") ||
              id.includes("mdast-") || id.includes("hast-") || id.includes("unist-") ||
              id.includes("remark-") || id.includes("rehype-"))
            return "vendor-markdown";
          // dompurify 被启动路径静态引用，又被 mermaid 依赖；不单独分包时 Rollup 会把
          // 它并进 vendor-mermaid，导致 2.3MB 的 mermaid 变成启动即加载。
          if (id.includes("/dompurify/")) return "vendor-sanitize";
          if (id.includes("/mermaid/")) return "vendor-mermaid";
          if (id.includes("/viewerjs/") || id.includes("/viewerjs-")) return "vendor-mermaid";
          if (id.includes("/pdfjs-dist/") || id.includes("/mammoth/") || id.includes("/xlsx/"))
            return "vendor-docs";
          if (id.includes("/lucide-react/"))
            return "vendor-ui-heavy";
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/vitest.setup.ts"],
    maxWorkers: 2,
    minWorkers: 1,
    deps: {
      optimizer: {
        web: {
          include: ["react-i18next"],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    proxy: {
      // 纯 vite dev（非 Tauri webview）下预览 TokenTracker dashboard 用：
      // tt-transport 在非 Tauri 环境把请求打到 /tt-dev<path>，这里转发到本地
      // `tokentracker` CLI server。不影响 tauri dev / build。
      "/tt-dev": {
        target: "http://127.0.0.1:7680",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tt-dev/, ""),
      },
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: devPort + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**", "**/.codex-worktrees/**"],
    },
  },
}));
