import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Extract the body of a single CSS rule by its exact selector text.
 * Returns the text between the selector's `{` and its matching `}`.
 */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`selector not found: ${selector}`);
  }
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("Sidebar styles", () => {
  // Regression guard for the P0 where clicking "更多" (expand) hid every
  // session: the virtualized thread list uses only `max-height` for its scroll
  // viewport, so `size` containment (via `contain: strict`) collapsed it to 0px
  // and the virtualizer rendered nothing. Must stay `contain: content`.
  it("does not size-contain the virtualized thread list into a 0px viewport", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar.css"),
      "utf8",
    );
    const body = ruleBody(css, '.thread-list[data-virtualized="true"]');

    // `strict` == `size layout paint`; the `size` part is what collapses a
    // max-height-only scroll container. `content` == `layout paint`, safe.
    expect(body).not.toMatch(/contain:\s*strict/);
    expect(body).not.toMatch(/contain:[^;]*\bsize\b/);
    expect(body).toMatch(/contain:\s*content/);
    // The scroll viewport still relies on max-height + overflow to work.
    expect(body).toMatch(/max-height:\s*360px/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  // Regression: virtualized rows used min-height:36 while flex rows pitch at
  // 30+2=32, so expanding "更多" past the virtualization threshold looked gappy.
  it("keeps virtualized thread row pitch aligned with non-virtualized rows", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar.css"),
      "utf8",
    );
    const body = ruleBody(css, ".thread-list-virtual-row");

    expect(body).not.toMatch(/min-height:\s*36px/);
    expect(body).toMatch(
      /min-height:\s*calc\(\s*var\(--sidebar-row-height-thread\)\s*\+\s*2px\s*\)/,
    );
  });

  it("does not bold the active quick-new-thread sidebar item", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.sidebar-primary-nav-mode-item\.is-active\s*\{[\s\S]*?font-weight:\s*400;/,
    );
  });

  it("keeps pinned thread rows aligned with workspace rows", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar.css"),
      "utf8",
    );

    expect(ruleBody(css, ".pinned-thread-list")).toMatch(/padding:\s*0;/);
    expect(ruleBody(css, ".sidebar-pinned-section")).toMatch(
      /padding:\s*0\s+4px;/,
    );
    expect(css).not.toMatch(/\.sidebar-pinned-header\s*\{/);
    expect(css).not.toMatch(/\.sidebar-pinned-day-chevron\s*\{/);
    expect(ruleBody(css, ".sidebar-pinned-day-header")).toMatch(
      /cursor:\s*pointer;/,
    );
  });

  it("aligns thread active selection with workspace soft fill", () => {
    const sidebarCss = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar.css"),
      "utf8",
    );
    const shellCss = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar-shell.css"),
      "utf8",
    );

    // Primary active token must be the soft surface-hover mix (not full hover).
    expect(shellCss).toMatch(
      /--sidebar-color-active-primary:\s*color-mix\(\s*in srgb,\s*var\(--surface-hover\)\s+72%,\s*transparent\s*\)/,
    );
    expect(ruleBody(sidebarCss, ".thread-row.active")).toMatch(
      /background:\s*var\(--sidebar-color-active-primary\);/,
    );
    // Session pills are intentionally more inset than workspace rows (4px) so
    // nested selection backgrounds stay narrower and do not flush-align with
    // the project pill above. Anchor on base `.thread-list` (not worktree).
    expect(sidebarCss).toMatch(
      /\.thread-list\s*\{[\s\S]*?padding:\s*1px\s+4px\s+2px\s+10px;/,
    );
    expect(shellCss).toMatch(/--sidebar-row-radius:\s*6px;/);
  });

  it("keeps workspace children visually connected as a tree", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar.css"),
      "utf8",
    );

    // 树线不占子行空间：容器不新增左 padding，线位落在
    // .thread-list 现成的 10px 左 padding 沟槽（= 行盒左缘）。
    expect(ruleBody(css, ".workspace-children")).toMatch(
      /padding-left:\s*0;/,
    );
    // 子级整体缩进靠 margin-left: 4px（rail / 弯钩 / 遮罩随容器刚性
    // 右移，内部对齐不变）；禁用 padding 方案——那会把弯钩与 rail 拆开。
    expect(ruleBody(css, ".workspace-children")).toMatch(
      /margin:\s*2px 0 0 4px;/,
    );
    // rail 基于 --text-muted（border-subtle 实测过浅）。
    expect(ruleBody(css, ".workspace-children")).toMatch(
      /--workspace-tree-rail:\s*color-mix\(in srgb, var\(--text-muted\)/,
    );
    // v4：容器贯穿竖线回归（每行分段方案在相邻行高不一致时必然断缝，
    // -50% 猜不准上一行中线），竖线连续性由一条线保证。
    expect(ruleBody(css, ".workspace-children::before")).toMatch(
      /content:\s*"";[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;/,
    );
    expect(ruleBody(css, ".workspace-children::before")).toMatch(
      /left:\s*var\(--workspace-tree-rail-x\);/,
    );
    // 竖线起点贴容器顶（v4.2 校准，2026-08-30 用户反馈上延 4px）：
    // 原 top: 4px 起点距 workspace 标题行过远、线头悬空。
    expect(ruleBody(css, ".workspace-children::before")).toMatch(/top:\s*0;/);
    // ╰ 圆弧弯钩叠加在贯穿线上：只画「弧 + 水平线」（单 border-bottom
    // + 圆角画出完整弧线，无竖线尾巴、无叠色），盒子只覆盖
    // [中线-4px, 中线]，top 自适应行高、flex/virtual 统一。
    // 半径 6→4px（v4.2）：斜段（抗锯齿摊薄区）变短、弯头观感更实；
    // 半径 < 盒高会留无墨直段，盒高同步收到 4px = 弧段外接矩形。
    expect(css).toMatch(
      /\.workspace-children-inner\s*>\s*\.thread-list\s*>\s*\.thread-row::before,[\s\S]*?left:\s*0;[\s\S]*?top:\s*calc\(50% - 4px\);[\s\S]*?height:\s*4px;[\s\S]*?border-bottom:\s*1px solid var\(--workspace-tree-rail\);[\s\S]*?border-bottom-left-radius:\s*4px;/,
    );
    // 弯钩不带竖线尾巴：与贯穿线同像素相切，禁止 border-left 叠色变深。
    expect(css).not.toMatch(
      /\.thread-row::before\s*\{[^}]*border-left:\s*1px solid var\(--workspace-tree-rail\)/,
    );
    // 「更多」footer 用侧栏底色遮罩盖住贯穿线（线只到最后一个标题行
    // 的弯钩处）；窄遮罩带上探 19px（v4.2，原 20px，用户拍板）：
    // 露出段 = 行高 30 + gap 2 = 17px，19 留 1.5px 余量；零咬合上限
    // 探针 ≤ 露出段 + 1.35 = 18.35（R=4 弧墨在带列最低点），19 超限
    // 0.65 的亚像素豁口隐没在抗锯齿内，若可见回 18。
    // 带宽必须 = 竖线宽 1px：2px 带会擦掉弯钩弧线 x∈[1,2) 的左上
    // 过渡段，最后一项视觉上从树上脱开（2026-08-30 用户截图实证）。
    const footerBody = ruleBody(
      css,
      ".workspace-children-inner > .thread-list > .thread-list-footer",
    );
    expect(footerBody).toMatch(
      /position:\s*relative;[\s\S]*?background:\s*var\(\s*--desktop-sidebar-background,/,
    );
    expect(footerBody).toMatch(/z-index:\s*2;/);
    const footerMask = ruleBody(
      css,
      ".workspace-children-inner > .thread-list > .thread-list-footer::before",
    );
    expect(footerMask).toMatch(/top:\s*-19px;/);
    expect(footerMask).toMatch(/height:\s*calc\(100%\s*\+\s*19px\);/);
    expect(footerMask).toMatch(/width:\s*1px;/);
    // folder 内嵌 footer 的遮罩带左移 8px 对准嵌套 guide 线位。
    expect(
      ruleBody(
        css,
        ".workspace-session-folder-children .thread-list-footer::before",
      ),
    ).toMatch(/left:\s*-8px;/);
  });

  it("hides the workspace menu scrollbar without disabling vertical scrolling", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/sidebar.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.sidebar-workspace-menu,\s*\.renderer-context-menu\s*\{[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(ruleBody(css, ".sidebar-workspace-menu {")).toMatch(
      /scrollbar-width:\s*none;/,
    );
    expect(ruleBody(css, ".sidebar-workspace-menu::-webkit-scrollbar")).toMatch(
      /display:\s*none;/,
    );
  });
});
