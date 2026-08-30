// Phase C 根因修复护栏（fix-session-load-bridge-freeze）：worker 不安全依赖强制离线构建。
// 实测：decode-named-character-reference 的 browser 构建（index.dom.js）在模块顶层
// document.createElement，worker 里 ReferenceError（45 字符 / hash 1wt84ny）→ worker
// 每次实例化必崩，markdown 全量回退主线程。护栏断言：alias 指向离线文件、离线文件
// 无 DOM 引用、且求值期在无 document 环境下可用（等价 worker 环境）。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const packageRoot = path.resolve(
  __dirname,
  "..",
  "node_modules/decode-named-character-reference",
);
const offlineEntry = path.join(packageRoot, "index.js");

describe("worker 不安全依赖强制离线构建", () => {
  it("vite resolve.alias 将 decode-named-character-reference 指向离线入口", async () => {
    const configSource = readFileSync(
      path.resolve(__dirname, "../vite.config.ts"),
      "utf8",
    );
    expect(configSource).toMatch(
      /"decode-named-character-reference":\s*path\.resolve\(\s*__dirname,\s*"node_modules\/decode-named-character-reference\/index\.js"/,
    );
    // 离线入口存在且无 DOM 引用
    const offlineSource = readFileSync(offlineEntry, "utf8");
    expect(offlineSource).not.toContain("document.");
    expect(offlineSource).not.toContain("createElement");
  });

  it("F6 后续: hast-util-from-html-isomorphic 同样强制离线入口（DOMParser 在 worker 不存在）", async () => {
    // 真机 2026-08-28 20:54:58：decode 修复后下层暴露第二处——
    // rehype-katex 预打包产物内联的 lib/browser.js 顶层 new DOMParser()
    // → ReferenceError（rehype-katex.js:119），worker 崩溃回退主线程。
    const configSource = readFileSync(
      path.resolve(__dirname, "../vite.config.ts"),
      "utf8",
    );
    expect(configSource).toMatch(
      /"hast-util-from-html-isomorphic":\s*path\.resolve\(\s*__dirname,\s*"node_modules\/hast-util-from-html-isomorphic\/index\.js"/,
    );
    // 预打包（optimizeDeps esbuild）同样强制：dev worker 实际加载预打包产物
    expect(configSource).toMatch(
      /esbuildOptions[\s\S]*?"hast-util-from-html-isomorphic"/,
    );
    expect(configSource).toMatch(
      /esbuildOptions[\s\S]*?"decode-named-character-reference"/,
    );

    const workerEntry = path.join(
      packageRoot.replace("decode-named-character-reference", "hast-util-from-html-isomorphic"),
      "index.js",
    );
    const workerSafeSource = readFileSync(workerEntry, "utf8");
    expect(workerSafeSource).not.toContain("new DOMParser");
  });

  it("离线构建在无 DOMParser/document 的 worker 环境求值并可用", async () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("DOMParser", undefined);
    vi.resetModules();
    try {
      const module = await import(offlineEntry + "?worker-safe-probe");
      const decoded = (
        module as {
          decodeNamedCharacterReference: (value: string) => string | null;
        }
      ).decodeNamedCharacterReference("amp");
      expect(decoded).toBe("&");
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("离线构建在无 document 的 worker 环境求值并可用", async () => {
    // 模拟 worker：无 document/window；若模块顶层触碰 DOM 将在此抛错
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    vi.resetModules();
    try {
      const module = await import(offlineEntry + "?worker-safe-probe");
      const decoded = (
        module as {
          decodeNamedCharacterReference: (value: string) => string | null;
        }
      ).decodeNamedCharacterReference("amp");
      expect(decoded).toBe("&");
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
