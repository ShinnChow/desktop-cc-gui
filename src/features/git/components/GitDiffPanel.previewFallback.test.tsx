/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resetClientStorageForTests } from "../../../services/clientStorage";

// Windows「差异不可用」回归测试：
// 弹窗此前唯一数据源是批量 get_git_diffs 列表；列表缺失/为空（预览截断、
// CRLF 幻影 M 文件、加载时序）时直接显示「差异不可用」，没有单文件兜底。
const mockReviewSurface = vi.fn((_props: Record<string, unknown>) => (
  <div data-testid="mock-review-surface" />
));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "common.loading": "Loading…",
        "menu.maximize": "Maximize",
        "common.restore": "Restore",
        "files.unsavedChanges": "Unsaved changes",
        "files.unsavedChangesCloseDescription": "Changes will be lost.",
        "files.saveAndClose": "Save and close",
        "files.saving": "Saving...",
        "files.continueEditing": "Continue editing",
        "files.discardChangesAction": "Discard changes",
        "git.discardConfirmTitle": "Discard changes",
        "git.discardDialogBeginnerLead": "lead",
        "git.discardDialogAffectsLabel": "affects",
        "git.discardDialogBeginnerHint": "hint",
        "git.discardDialogConfirmAction": "Discard",
        "git.noChangesDetected": "No changes detected",
      };
      const template = translations[key] ?? key;
      if (!options) {
        return template;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(options[token] ?? ""));
    },
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));

vi.mock("./WorkspaceEditableDiffReviewSurface", () => ({
  WorkspaceEditableDiffReviewSurface: (props: Record<string, unknown>) =>
    mockReviewSurface(props),
}));

import { GitDiffPanel } from "./GitDiffPanel";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => true),
}));

vi.mock("../../../styles/featureStyleLoaders", () => ({
  loadDiffStyles: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../styles/useFeatureStylesReady", () => ({
  useFeatureStylesReady: () => true,
}));

const SHORT_WAIT = { timeout: 1500 };

const baseProps = {
  mode: "diff" as const,
  onModeChange: vi.fn(),
  filePanelMode: "git" as const,
  onFilePanelModeChange: vi.fn(),
  branchName: "main",
  totalAdditions: 0,
  totalDeletions: 0,
  fileStatus: "1 file changed",
  logEntries: [],
  stagedFiles: [],
  unstagedFiles: [],
  workspaceId: "workspace-1",
  workspacePath: "C:/repo",
};

function mockInvokeForFullDiff(fullDiff: string | Error) {
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "get_git_file_full_diff") {
      return fullDiff instanceof Error
        ? Promise.reject(fullDiff)
        : Promise.resolve(fullDiff);
    }
    return Promise.resolve(null);
  });
}

function surfaceFiles(): Array<Record<string, unknown>> {
  const lastCall = mockReviewSurface.mock.calls.at(-1)?.[0] as
    | { files?: Array<Record<string, unknown>> }
    | undefined;
  return lastCall?.files ?? [];
}

type DiffEntryStub = { path: string; status: string; diff: string };

function renderPanelWithUnstagedFile(path: string, diffEntries: DiffEntryStub[]) {
  render(
    <GitDiffPanel
      {...baseProps}
      unstagedFiles={[{ path, status: "M", additions: 0, deletions: 0 }]}
      diffEntries={diffEntries}
    />,
  );
  fireEvent.click(screen.getByLabelText(path));
}

afterEach(() => {
  cleanup();
  mockReviewSurface.mockClear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
  resetClientStorageForTests();
});

describe("GitDiffPanel preview modal diff fallback", () => {
  it("recovers a missing bulk-list diff through get_git_file_full_diff and derives header stats", async () => {
    mockInvokeForFullDiff("@@ -0,0 +1,2 @@\n+alpha\n+beta");
    renderPanelWithUnstagedFile("docs/new.md", []);

    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "get_git_file_full_diff",
        expect.objectContaining({ workspaceId: "workspace-1", path: "docs/new.md" }),
      );
    }, SHORT_WAIT);
    await waitFor(() => {
      const files = surfaceFiles();
      expect(files).toHaveLength(1);
      expect(String(files[0]?.diff ?? "")).toContain("+alpha");
    }, SHORT_WAIT);
    await waitFor(() => {
      const stats = document.querySelector(".git-history-diff-modal-stats");
      expect(String(stats?.textContent ?? "")).toContain("+2");
      expect(String(stats?.textContent ?? "")).toContain("-0");
    }, SHORT_WAIT);
    expect(screen.queryByText("git.diffUnavailable")).toBeNull();
  }, 10000);

  it("shows no-text-changes instead of diff unavailable when the file has no textual diff", async () => {
    mockInvokeForFullDiff("");
    renderPanelWithUnstagedFile("Cargo.toml", [
      { path: "Cargo.toml", status: "M", diff: "" },
    ]);

    await waitFor(() => {
      expect(screen.getByText("git.diffNoTextChanges")).toBeTruthy();
    }, SHORT_WAIT);
    expect(screen.queryByText("git.diffUnavailable")).toBeNull();
    expect(screen.queryByText("common.loading")).toBeNull();
  }, 10000);

  it("falls back to diff unavailable when the per-file fetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInvokeForFullDiff(new Error("full diff failed"));
    renderPanelWithUnstagedFile("docs/new.md", []);

    await waitFor(() => {
      expect(screen.getByText("git.diffUnavailable")).toBeTruthy();
    }, SHORT_WAIT);
    errorSpy.mockRestore();
  }, 10000);

  it("does not call the per-file fallback when the bulk list already has diff content", async () => {
    mockInvokeForFullDiff("should not be loaded");
    renderPanelWithUnstagedFile("a.ts", [
      { path: "a.ts", status: "M", diff: "@@ -1 +1 @@\n-old\n+new" },
    ]);

    await waitFor(() => {
      const files = surfaceFiles();
      expect(files[0]?.diff).toContain("+new");
    }, SHORT_WAIT);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith(
      "get_git_file_full_diff",
      expect.anything(),
    );
  }, 10000);
});
