import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { resetSidebarTestMocks } from "./Sidebar.test-utils";
import { resetClientStorageForTests } from "../../../services/clientStorage";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  resetSidebarTestMocks();
  resetClientStorageForTests();
});

function openWorkspaceActionsMenu(workspaceCard: HTMLElement) {
  act(() => {
    fireEvent.click(
      within(workspaceCard).getByRole("button", { name: "New Session" }),
    );
  });
  const menu = screen.getByRole("menu", { name: /New Session/ });
  const sectionToggle = within(menu).getByRole("button", {
    name: "Workspace actions",
  });
  // 三栏默认全部展开：仅在被本地折叠时才点开展开。
  if (sectionToggle.getAttribute("aria-expanded") === "false") {
    act(() => {
      fireEvent.click(sectionToggle);
    });
  }
  return menu;
}

export { openWorkspaceActionsMenu };
