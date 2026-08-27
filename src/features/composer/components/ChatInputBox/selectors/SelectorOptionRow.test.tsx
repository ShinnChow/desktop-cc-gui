// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SelectorOptionRow } from "./SelectorOptionRow";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

/**
 * Radix DropdownMenuItem 必须在 DropdownMenu 上下文内渲染；
 * 渲染后菜单内容挂到 body portal，用 document.body 查询。
 */
function renderInMenu(ui: ReactNode) {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <button type="button">trigger</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>{ui}</DropdownMenuContent>
    </DropdownMenu>,
  );
}

const codiconIcon = (
  <span
    className="codicon codicon-lightbulb mt-0.5 shrink-0"
    aria-hidden="true"
  />
);
const toolMenuIcon = (
  <span
    className="codicon codicon-lightbulb composer-tool-menu-option-icon"
    aria-hidden="true"
  />
);

describe('SelectorOptionRow · variant="dropdown"（standalone DropdownMenuItem 行）', () => {
  it("渲染 label/description 行结构与 data-selected，选中显示 check 图标", async () => {
    renderInMenu(
      <SelectorOptionRow
        variant="dropdown"
        icon={codiconIcon}
        label="High"
        description="Deep thinking"
        selected
        onSelect={() => {}}
      />,
    );
    const item = await waitFor(() => {
      const el = document.body.querySelector('[data-selected="true"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(item.className).toContain("items-start gap-2");
    expect(item.querySelector(".text-sm.font-medium")?.textContent).toBe(
      "High",
    );
    expect(
      item.querySelector(".text-xs.text-muted-foreground")?.textContent,
    ).toBe("Deep thinking");
    // 选中指示：lucide CheckIcon（svg，带 mt-0.5 size-4 shrink-0）
    expect(item.querySelector('svg[class*="shrink-0"]')).toBeTruthy();
  });

  it("未选中：无 data-selected、无 check 图标", async () => {
    renderInMenu(
      <SelectorOptionRow
        variant="dropdown"
        icon={codiconIcon}
        label="Low"
        description="Quick"
        onSelect={() => {}}
      />,
    );
    await waitFor(() => {
      expect(document.body.textContent).toContain("Low");
    });
    const item = document.body.querySelector(
      "[role='menuitem']",
    ) as HTMLElement;
    expect(item.getAttribute("data-selected")).toBeNull();
    expect(item.querySelector("svg[class*='shrink-0']")).toBeNull();
  });

  it("点击触发 onSelect（preventDefault 语义不改变外层受控开关）", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSelect = vi.fn();
    renderInMenu(
      <SelectorOptionRow
        variant="dropdown"
        label="Medium"
        onSelect={onSelect}
      />,
    );
    await user.click(await screen.findByText("Medium"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("透传 data-* 属性（如 data-reasoning-id）", async () => {
    renderInMenu(
      <SelectorOptionRow
        variant="dropdown"
        label="High"
        dataAttrs={{ "data-reasoning-id": "high" }}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => {
      expect(
        document.body.querySelector("[data-reasoning-id='high']"),
      ).toBeTruthy();
    });
  });

  it("disabled 时不触发 onSelect", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSelect = vi.fn();
    renderInMenu(
      <SelectorOptionRow
        variant="dropdown"
        label="Plan"
        disabled
        onSelect={onSelect}
      />,
    );
    const item = await screen.findByText("Plan");
    // Radix disabled item 阻断点击
    await user.click(item).catch(() => {});
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('SelectorOptionRow · variant="tool-menu" host="button"（inline 子菜单按钮行）', () => {
  it("渲染 composer-tool-menu-option 结构与 is-selected/is-disabled、codicon-check", () => {
    const { container } = render(
      <SelectorOptionRow
        variant="tool-menu"
        icon={toolMenuIcon}
        label="High"
        description="Deep thinking"
        selected
        disabled
        onSelect={() => {}}
      />,
    );
    const button = container.querySelector(
      "button.composer-tool-menu-option.is-selected.is-disabled",
    );
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      button?.querySelector(".composer-tool-menu-option-icon"),
    ).toBeTruthy();
    expect(
      button?.querySelector(".composer-tool-menu-option-label")?.textContent,
    ).toBe("High");
    expect(
      button?.querySelector(".composer-tool-menu-option-description")
        ?.textContent,
    ).toBe("Deep thinking");
    expect(
      button?.querySelector(
        ".composer-tool-menu-option-check.codicon.codicon-check",
      ),
    ).toBeTruthy();
  });

  it("未选中：无 is-selected、无 check span；description 未传时不渲染 span", () => {
    const { container } = render(
      <SelectorOptionRow
        variant="tool-menu"
        icon={toolMenuIcon}
        label="Low"
        onSelect={() => {}}
      />,
    );
    const button = container.querySelector(
      "button.composer-tool-menu-option",
    ) as HTMLElement;
    expect(button.className).not.toContain("is-selected");
    expect(button.querySelector(".composer-tool-menu-option-check")).toBeNull();
    expect(
      button.querySelector(".composer-tool-menu-option-description"),
    ).toBeNull();
    // description 缺省时 label span 仍在
    expect(
      button.querySelector(".composer-tool-menu-option-label"),
    ).toBeTruthy();
  });

  it("点击触发 onSelect；disabled 点击不触发", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSelect = vi.fn();
    render(
      <>
        <SelectorOptionRow
          variant="tool-menu"
          label="Enabled"
          onSelect={onSelect}
        />
        <SelectorOptionRow
          variant="tool-menu"
          label="Disabled"
          disabled
          onSelect={onSelect}
        />
      </>,
    );
    await user.click(screen.getByText("Enabled"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("Disabled")).catch(() => {});
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("checkIndicator 覆盖默认 check（ModeSelect inline 的 img 指示器）", () => {
    const { container } = render(
      <SelectorOptionRow
        variant="tool-menu"
        label="Plan"
        selected
        checkIndicator={
          <img src="x.svg" className="composer-tool-menu-option-check" alt="" />
        }
        onSelect={() => {}}
      />,
    );
    const button = container.querySelector(
      "button.composer-tool-menu-option",
    ) as HTMLElement;
    expect(
      button.querySelector("img.composer-tool-menu-option-check"),
    ).toBeTruthy();
    expect(button.querySelector(".codicon-check")).toBeNull();
  });
});

describe('SelectorOptionRow · variant="tool-menu" host="menu-item"（HUD DropdownMenuItem 行）', () => {
  it("渲染 DropdownMenuItem.composer-tool-menu-option 与 is-selected class + check span", async () => {
    renderInMenu(
      <SelectorOptionRow
        variant="tool-menu"
        host="menu-item"
        icon={toolMenuIcon}
        label="Agent A"
        description="desc"
        selected
        onSelect={() => {}}
      />,
    );
    const item = await waitFor(() => {
      const el = document.body.querySelector(
        "[role='menuitem'].composer-tool-menu-option.is-selected",
      );
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(item.querySelector(".composer-tool-menu-option-body")).toBeTruthy();
    expect(
      item.querySelector(
        ".composer-tool-menu-option-check.codicon.codicon-check",
      ),
    ).toBeTruthy();
  });

  it("无 icon / 无 description 的行（ButtonArea memory-reference 形态）DOM 等价", async () => {
    renderInMenu(
      <SelectorOptionRow
        variant="tool-menu"
        host="menu-item"
        label="一直开启"
        selected
        onSelect={() => {}}
      />,
    );
    const item = await waitFor(() => {
      const el = document.body.querySelector(
        "[role='menuitem'].composer-tool-menu-option",
      );
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(item.querySelector(".composer-tool-menu-option-icon")).toBeNull();
    expect(
      item.querySelector(".composer-tool-menu-option-description"),
    ).toBeNull();
    expect(
      item.querySelector(".composer-tool-menu-option-label")?.textContent,
    ).toBe("一直开启");
  });

  it("点击触发 onSelect（不 preventDefault，菜单自行关闭语义）", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSelect = vi.fn();
    renderInMenu(
      <SelectorOptionRow
        variant="tool-menu"
        host="menu-item"
        label="Pick"
        onSelect={onSelect}
      />,
    );
    await user.click(await screen.findByText("Pick"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

// 2026-08-27: 显式标注——本文件与同目录 SelectorOptionRow.tsx 配对（module resolution 曾被陈旧 LSP 快照误报）。
