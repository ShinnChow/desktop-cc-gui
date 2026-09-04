// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getClientStoreSync, resetClientStorageForTests } from "../../../services/clientStorage";
import { HomeChat } from "./HomeChat";
import { HomeAppearanceSettings } from "./HomeAppearanceSettings";
import { HOME_APPEARANCE_KEY } from "../utils/homeAppearance";

const props = { workspaces: [], onSelectWorkspace: vi.fn() };
const label = (name: string) => `homeChat.appearance.${name}`;

function Harness() {
  return <><HomeChat {...props} /><HomeAppearanceSettings /></>;
}

describe("home appearance settings flow", () => {
  beforeEach(() => resetClientStorageForTests());

  it("has no Home editor and saves from Settings into an already mounted Home", async () => {
    let view = render(<Harness />);
    expect(screen.queryByRole("button", { name: label("customize") })).toBeNull();
    expect(screen.queryByRole("button", { name: label("apply") })).toBeNull();
    fireEvent.change(screen.getByLabelText(label("title")), { target: { value: "  我的工作台  " } });
    fireEvent.change(screen.getByLabelText(label("font")), { target: { value: "serif" } });
    fireEvent.click(screen.getByRole("button", { name: label("apply") }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("我的工作台"));
    expect(getClientStoreSync("app", HOME_APPEARANCE_KEY)).toMatchObject({ title: "我的工作台", titleStyle: "serif" });
    expect(screen.queryByRole("button", { name: label("apply") })).toBeNull();
    view.unmount();
    view = render(<Harness />);
    expect(screen.getByRole("heading", { level: 1 }).getAttribute("data-title-style")).toBe("serif");
    fireEvent.click(screen.getByRole("button", { name: label("reset") }));
    fireEvent.click(screen.getByRole("button", { name: label("apply") }));
    expect(getClientStoreSync("app", HOME_APPEARANCE_KEY)).toMatchObject({ title: "", titleStyle: "system" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe("我的工作台");
    view.unmount();
  });

  it("cancels unsaved edits and rejects invalid images without changing Home", async () => {
    const view = render(<Harness />);
    fireEvent.change(screen.getByLabelText(label("title")), { target: { value: "未保存" } });
    fireEvent.change(screen.getByLabelText(label("logo")), { target: { files: [new File(["invalid"], "logo.svg", { type: "image/svg+xml" })] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(label("logoError")));
    fireEvent.click(screen.getByRole("button", { name: label("cancel") }));
    expect(getClientStoreSync("app", HOME_APPEARANCE_KEY)).toBeUndefined();
    expect((screen.getByLabelText(label("title")) as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    view.unmount();
  });

  it("makes explicit On override reduced motion while preserving Follow system and Off", () => {
    const view = render(<Harness />);
    for (const [mode, particles, respectReducedMotion] of [["on", true, false], ["off", false, true], ["system", true, true]] as const) {
      fireEvent.change(screen.getByLabelText(label("particles")), { target: { value: mode } });
      fireEvent.click(screen.getByRole("button", { name: label("apply") }));
      expect(getClientStoreSync("app", HOME_APPEARANCE_KEY)).toMatchObject({ particles, respectReducedMotion });
    }
    view.unmount();
  });
});
