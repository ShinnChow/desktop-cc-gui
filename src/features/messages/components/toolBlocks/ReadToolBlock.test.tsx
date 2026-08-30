// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetRealtimePerfFlagCacheForTests,
  LIVE_TOOL_RENDER_BUDGET_FLAG_KEY,
  resetRealtimePerfFlags,
} from "../../../threads/utils/realtimePerfFlags";
import type { ConversationItem } from "../../../../types";
import { READ_OUTPUT_MARKDOWN_BUDGET, ReadToolBlock } from "./ReadToolBlock";

function createReadItem(
  id: string,
  detail: Record<string, unknown>,
  output?: string,
): Extract<ConversationItem, { kind: "tool" }> {
  return {
    id,
    kind: "tool",
    toolType: "read",
    title: "Tool: read",
    detail: JSON.stringify(detail),
    output,
    status: "completed",
  };
}

describe("ReadToolBlock", () => {
  afterEach(() => {
    cleanup();
    resetRealtimePerfFlags();
    __resetRealtimePerfFlagCacheForTests();
  });

  it("renders markdown output for markdown file reads", () => {
    const item = createReadItem(
      "tool-read-markdown",
      { file_path: "README.md" },
      "## Section\n\n- item one\n- item two",
    );

    const view = render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);

    fireEvent.click(screen.getByText("tools.readFile"));

    expect(view.container.querySelector(".read-tool-markdown")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeTruthy();
    expect(screen.getByText("item one")).toBeTruthy();
  });

  it("falls back to plain text rendering for non-markdown files", () => {
    const item = createReadItem(
      "tool-read-code",
      { file_path: "src/main.ts" },
      "const value = 1;\nconsole.log(value);",
    );

    const view = render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);

    fireEvent.click(screen.getByText("tools.readFile"));

    expect(view.container.querySelector(".read-tool-markdown")).toBeNull();
    expect(screen.getByText(/const value = 1;/)).toBeTruthy();
    expect(screen.getByText(/console\.log\(value\);/)).toBeTruthy();
  });

  it("shows a file-type icon for the read path", () => {
    const item = createReadItem("tool-read-icon", { file_path: "src/main.ts" }, "ok");
    const view = render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);
    expect(view.container.querySelector(".tool-marker-file-type-icon")).toBeTruthy();
    expect(screen.getByText("main.ts")).toBeTruthy();
  });

  it("shows monochrome action icon + kind label aligned with batch-read / search rows", () => {
    const item = createReadItem("tool-read-kind", { file_path: "src/main.ts" }, "ok");
    const view = render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/tools\.kindRead|Read|读取/)).toBeTruthy();
    expect(view.container.querySelector(".explore-inline-kind")).toBeTruthy();
    expect(view.container.querySelector(".tool-meta-sep")).toBeTruthy();
    expect(view.container.querySelector(".tool-meta-path")).toBeTruthy();
    // 行首单色动作 icon（FileText）+ 文件名旁彩色类型 icon 并存
    expect(view.container.querySelector('[data-slot="marker"] svg')).toBeTruthy();
    expect(view.container.querySelector(".tool-marker-file-type-icon")).toBeTruthy();
  });

  it("shows folder icon and list kind for list_dir target directories", () => {
    const item: Extract<ConversationItem, { kind: "tool" }> = {
      id: "tool-list-dir",
      kind: "tool",
      toolType: "list_dir",
      title: "list_dir",
      detail: JSON.stringify({ target_directory: "src/features/vendors" }),
      output: "VendorSettingsPanel.tsx\nindex.ts",
      status: "completed",
    };

    const view = render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);

    expect(screen.getByText(/tools\.kindList|List|列表/)).toBeTruthy();
    expect(screen.getByText("vendors")).toBeTruthy();
    expect(screen.getByText(/tools\.readDirectory|目录|directory/i)).toBeTruthy();
    // 文件夹图标应渲染（getFileTreeIconSvg isFolder=true）
    expect(view.container.querySelector(".tool-marker-file-type-icon")).toBeTruthy();
  });

  it("treats trailing-slash paths as directories", () => {
    const item = createReadItem("tool-read-dir-slash", { path: "src/features/" }, "ok");
    render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/tools\.kindList|List|列表/)).toBeTruthy();
    expect(screen.getByText("features")).toBeTruthy();
  });

  it("renders a real image preview for image file reads instead of path-only text", () => {
    const imagePath =
      "/Users/zhukunpeng/.grok/sessions/demo/assets/image-0b1d7113-f591-407a-8332-b678fdcc7e96.png";
    const item = createReadItem(
      "tool-read-image",
      { file_path: imagePath },
      `Read image file: ${imagePath}`,
    );

    const view = render(
      <ReadToolBlock item={item} workspaceId="ws-1" isExpanded={false} onToggle={() => {}} />,
    );

    fireEvent.click(screen.getByText("tools.readFile"));

    const image = screen.getByRole("img", {
      name: "image-0b1d7113-f591-407a-8332-b678fdcc7e96.png",
    });
    expect(image.getAttribute("src")).toContain(imagePath);
    // 不应再只展示 “Read image file: …” 纯文案路径
    expect(view.container.textContent).not.toMatch(/Read image file:\s*\//);
  });

  it("extracts image path from Read image file output when args path is relative", () => {
    const absolutePath =
      "/Users/demo/Desktop/assets/screenshot-preview.webp";
    const item = createReadItem(
      "tool-read-image-from-output",
      { path: "screenshot-preview.webp" },
      `Read image file: ${absolutePath}`,
    );

    render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);
    fireEvent.click(screen.getByText("tools.readFile"));

    const image = screen.getByRole("img", { name: "screenshot-preview.webp" });
    expect(image.getAttribute("src")).toContain(absolutePath);
  });

  it("degrades heavy markdown-shaped read output to plain text", () => {
    const heavyOutput = "## Section\n\n- item\n".repeat(
      Math.ceil((READ_OUTPUT_MARKDOWN_BUDGET + 1024) / "## Section\n\n- item\n".length),
    );
    const item = createReadItem(
      "tool-read-heavy-markdown",
      { file_path: "README.md" },
      heavyOutput,
    );

    const view = render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);
    fireEvent.click(screen.getByText("tools.readFile"));

    // 超过 64KB 的 markdown 形态输出不进 <Markdown> 编译，走纯文本容器。
    expect(view.container.querySelector(".read-tool-markdown")).toBeNull();
    expect(view.container.querySelector(".task-field-content")?.textContent).toContain(
      "## Section",
    );
  });

  it("still renders markdown at the budget boundary", () => {
    const boundaryOutput = ("## Section\n\n- item\n").repeat(4);
    const item = createReadItem(
      "tool-read-boundary-markdown",
      { file_path: "README.md" },
      boundaryOutput,
    );

    const view = render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);
    fireEvent.click(screen.getByText("tools.readFile"));
    expect(view.container.querySelector(".read-tool-markdown")).toBeTruthy();
  });

  it("keeps markdown rendering for heavy output when the render budget flag is off", () => {
    window.localStorage.setItem(LIVE_TOOL_RENDER_BUDGET_FLAG_KEY, "off");
    __resetRealtimePerfFlagCacheForTests();
    const heavyOutput = "## Section\n\n- item\n".repeat(
      Math.ceil((READ_OUTPUT_MARKDOWN_BUDGET + 1024) / "## Section\n\n- item\n".length),
    );
    const item = createReadItem(
      "tool-read-heavy-markdown-flag-off",
      { file_path: "README.md" },
      heavyOutput,
    );

    const view = render(<ReadToolBlock item={item} isExpanded={false} onToggle={() => {}} />);
    fireEvent.click(screen.getByText("tools.readFile"));
    expect(view.container.querySelector(".read-tool-markdown")).toBeTruthy();
  });
});
