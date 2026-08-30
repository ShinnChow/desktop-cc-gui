/** @vitest-environment jsdom */
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockCodeMirrorDispatch } from "./FileViewPanel.test-utils";
import { FileViewPanel } from "./FileViewPanel";
import {
  getGitFileBlame,
  getGitFileFullDiff,
  readWorkspaceFile,
} from "../../../services/tauri";
import { clearFileDocumentSessionCacheForTests } from "../hooks/useFileDocumentState";
import { clearFileGitBlameCacheForTests } from "../hooks/useFileGitBlame";
import type { GitRepositorySummary } from "../../../types";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const blameResponse = {
  path: "src/value.ts",
  headSha: "abc123",
  lineCount: 1,
  hunks: [],
};

function repository(repositoryRoot: string): GitRepositorySummary {
  return {
    repositoryRoot,
    displayName: repositoryRoot || "root",
    currentBranch: "main",
    headState: "branch",
    upstream: null,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    modifiedCount: 0,
    untrackedCount: 0,
    conflictedCount: 0,
    fileStatuses: [],
    isClean: true,
    error: null,
  };
}

function openFileContentContextMenu() {
  fireEvent.contextMenu(screen.getByTestId("mock-codemirror"));
  return within(screen.getByRole("menu", { name: "files.fileContextMenu" }));
}

function getGitBlameMenuItem() {
  const menu = openFileContentContextMenu();
  const gitTrigger = menu.getByRole("menuitem", {
    name: "files.tabGitActions",
  });
  fireEvent.mouseEnter(gitTrigger);
  const gitMenu = within(
    screen.getByRole("menu", { name: "files.tabGitActions" }),
  );
  return (
    gitMenu.queryByRole("menuitem", { name: "files.gitBlameEnable" }) ??
    gitMenu.queryByRole("menuitem", { name: "files.gitBlameDisable" }) ??
    gitMenu.queryByRole("menuitem", { name: "files.gitBlameLoading" }) ??
    gitMenu.queryByRole("menuitem", { name: "files.gitBlameStale" }) ??
    gitMenu.getByRole("menuitem", { name: "files.gitBlameError" })
  );
}

function toggleFileGitBlame() {
  fireEvent.click(getGitBlameMenuItem());
}

describe("FileViewPanel Git Blame", () => {
  afterEach(() => {
    cleanup();
    clearFileDocumentSessionCacheForTests();
    clearFileGitBlameCacheForTests();
    vi.clearAllMocks();
    mockCodeMirrorDispatch.mockReset();
  });

  it("keeps file open free of blame and git diff work until the user enables it", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "export const value = 1;",
      truncated: false,
    });
    vi.mocked(getGitFileBlame).mockResolvedValue({
      path: "src/value.ts",
      headSha: "abc123",
      lineCount: 1,
      hunks: [],
    });
    vi.mocked(getGitFileFullDiff).mockResolvedValue(
      "@@ -1 +1 @@\n-export const value = 0;\n+export const value = 1;",
    );

    render(
      <FileViewPanel
        workspaceId="ws-1"
        workspacePath="/repo"
        filePath="src/value.ts"
        gitStatusFiles={[
          { path: "src/value.ts", status: "M", additions: 1, deletions: 1 },
        ]}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    expect(getGitFileBlame).not.toHaveBeenCalled();
    expect(getGitFileFullDiff).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, {
      key: "b",
      altKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(getGitFileBlame).toHaveBeenCalledWith(
        "ws-1",
        "src/value.ts",
        null,
      );
      expect(getGitFileFullDiff).toHaveBeenCalledWith("ws-1", "src/value.ts");
    });
  });

  it("keeps diff markers independent when blame fails", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });
    vi.mocked(getGitFileBlame).mockRejectedValue(
      new Error("blame unavailable"),
    );
    vi.mocked(getGitFileFullDiff).mockResolvedValue("@@ -0,0 +1 @@\n+one");

    render(
      <FileViewPanel
        workspaceId="ws-independent-markers"
        workspacePath="/repo"
        filePath="src/value.ts"
        gitStatusFiles={[
          { path: "src/value.ts", status: "A", additions: 1, deletions: 0 },
        ]}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    toggleFileGitBlame();

    await waitFor(() => {
      expect(getGitFileFullDiff).toHaveBeenCalledWith(
        "ws-independent-markers",
        "src/value.ts",
      );
    });
    expect(getGitBlameMenuItem().textContent).toContain("files.gitBlameError");
  });

  it("does not refetch git diff while an enabled blame view becomes dirty", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });
    vi.mocked(getGitFileBlame).mockResolvedValue(blameResponse);
    vi.mocked(getGitFileFullDiff).mockResolvedValue("@@ -0,0 +1 @@\n+one");

    render(
      <FileViewPanel
        workspaceId="ws-marker-dirty"
        workspacePath="/repo"
        filePath="src/value.ts"
        gitStatusFiles={[
          { path: "src/value.ts", status: "M", additions: 1, deletions: 0 },
        ]}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    toggleFileGitBlame();
    await waitFor(() => expect(getGitFileFullDiff).toHaveBeenCalledTimes(1));

    fireEvent.change(editor, { target: { value: "two" } });
    expect(getGitFileFullDiff).toHaveBeenCalledTimes(1);
  });

  it("ignores an in-flight git marker result when blame is disabled", async () => {
    const pendingDiff = createDeferred<string>();
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });
    vi.mocked(getGitFileBlame).mockResolvedValue(blameResponse);
    vi.mocked(getGitFileFullDiff).mockReturnValue(pendingDiff.promise);

    render(
      <FileViewPanel
        workspaceId="ws-marker-toggle"
        workspacePath="/repo"
        filePath="src/value.ts"
        gitStatusFiles={[
          { path: "src/value.ts", status: "A", additions: 1, deletions: 0 },
        ]}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    toggleFileGitBlame();
    await waitFor(() => {
      expect(getGitFileFullDiff).toHaveBeenCalledTimes(1);
    });

    expect(getGitBlameMenuItem().textContent).toContain(
      "files.gitBlameDisable",
    );
    fireEvent.click(getGitBlameMenuItem());
    await waitFor(() => {
      expect(getGitBlameMenuItem().textContent).toContain(
        "files.gitBlameEnable",
      );
    });
    mockCodeMirrorDispatch.mockClear();

    await act(async () => {
      pendingDiff.resolve("@@ -0,0 +1 @@\n+one");
      await pendingDiff.promise;
    });
    expect(mockCodeMirrorDispatch).not.toHaveBeenCalled();
  });

  it("keeps the first useful editor viewport usable while blame is slow", async () => {
    const slowBlame = createDeferred<typeof blameResponse>();
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "export const value = 1;",
      truncated: false,
    });
    vi.mocked(getGitFileBlame).mockReturnValue(slowBlame.promise);

    render(
      <FileViewPanel
        workspaceId="ws-slow-blame"
        workspacePath="/repo"
        filePath="src/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    toggleFileGitBlame();

    await waitFor(() => {
      expect(getGitFileBlame).toHaveBeenCalledTimes(1);
    });
    expect(getGitBlameMenuItem().textContent).toContain(
      "files.gitBlameLoading",
    );
    expect((editor as HTMLTextAreaElement).value).toBe(
      "export const value = 1;",
    );
    fireEvent.select(editor, {
      target: { selectionStart: 7, selectionEnd: 7 },
    });
    expect(getGitFileBlame).toHaveBeenCalledTimes(1);

    await act(async () => {
      slowBlame.resolve(blameResponse);
      await slowBlame.promise;
    });
    expect(getGitBlameMenuItem().textContent).toContain(
      "files.gitBlameDisable",
    );
  });

  it("keeps the editor usable and exposes a blame error inline", async () => {
    const failedBlame = createDeferred<typeof blameResponse>();
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });
    vi.mocked(getGitFileBlame).mockReturnValue(failedBlame.promise);

    render(
      <FileViewPanel
        workspaceId="ws-blame-error"
        workspacePath="/repo"
        filePath="src/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    toggleFileGitBlame();
    await act(async () => {
      failedBlame.reject(new Error("blame backend unavailable"));
      await failedBlame.promise.catch(() => undefined);
    });

    expect(getGitBlameMenuItem().textContent).toContain("files.gitBlameError");
    expect((editor as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("declines over-budget files without issuing blame IPC", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: Array.from({ length: 50_001 }, () => "x").join("\n"),
      truncated: false,
    });

    render(
      <FileViewPanel
        workspaceId="ws-blame-budget"
        workspacePath="/repo"
        filePath="src/large.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    const menu = openFileContentContextMenu();
    expect(
      menu.queryByRole("menuitem", { name: "files.tabGitActions" }),
    ).toBeNull();
    expect(getGitFileBlame).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight blame request when the same file snapshot changes", async () => {
    const obsoleteBlame = createDeferred<typeof blameResponse>();
    const refreshedBlame = createDeferred<typeof blameResponse>();
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "const value = 1;", truncated: false })
      .mockResolvedValue({ content: "const value = 2;", truncated: false });
    vi.mocked(getGitFileBlame)
      .mockReturnValueOnce(obsoleteBlame.promise)
      .mockReturnValueOnce(refreshedBlame.promise);

    render(
      <FileViewPanel
        workspaceId="ws-blame-snapshot-race"
        workspacePath="/repo"
        filePath="src/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangePollIntervalMs={20}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    toggleFileGitBlame();
    await waitFor(() => expect(getGitFileBlame).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect((editor as HTMLTextAreaElement).value).toBe("const value = 2;");
    });

    expect(getGitFileBlame).toHaveBeenCalledTimes(2);

    await act(async () => {
      obsoleteBlame.resolve(blameResponse);
      await obsoleteBlame.promise;
    });
    expect(getGitBlameMenuItem().textContent).toContain(
      "files.gitBlameLoading",
    );

    await act(async () => {
      refreshedBlame.resolve({ ...blameResponse, headSha: "def456" });
      await refreshedBlame.promise;
    });
  });

  it("preserves nested repository scope and does not refetch while typing", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });
    vi.mocked(getGitFileBlame).mockResolvedValue({
      path: "src/value.ts",
      headSha: "abc123",
      lineCount: 1,
      hunks: [],
    });

    render(
      <FileViewPanel
        workspaceId="ws-1"
        workspacePath="/repo"
        gitRoot="/repo/packages/app"
        filePath="packages/app/src/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    toggleFileGitBlame();
    await waitFor(() => expect(getGitFileBlame).toHaveBeenCalledTimes(1));
    expect(getGitFileBlame).toHaveBeenCalledWith(
      "ws-1",
      "src/value.ts",
      "packages/app",
    );

    fireEvent.change(editor, { target: { value: "two" } });
    fireEvent.select(editor, {
      target: { selectionStart: 1, selectionEnd: 1 },
    });
    expect(getGitFileBlame).toHaveBeenCalledTimes(1);
    expect(getGitBlameMenuItem().textContent).toContain("files.gitBlameStale");
  });

  it("uses the longest owning repository instead of the configured git root", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });
    vi.mocked(getGitFileBlame).mockResolvedValue({
      ...blameResponse,
      path: "src/value.ts",
    });

    render(
      <FileViewPanel
        workspaceId="ws-multi-blame"
        workspacePath="/repo"
        gitRoot="repo-a"
        gitRepositories={[
          repository(""),
          repository("repo-b"),
          repository("repo-b/nested"),
        ]}
        filePath="repo-b/nested/src/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    toggleFileGitBlame();

    await waitFor(() => {
      expect(getGitFileBlame).toHaveBeenCalledWith(
        "ws-multi-blame",
        "src/value.ts",
        "repo-b/nested",
      );
    });
  });

  it("does not blame through another repository when the known inventory has no owner", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });

    render(
      <FileViewPanel
        workspaceId="ws-no-owner"
        workspacePath="/repo"
        gitRoot="repo-a"
        gitRepositories={[repository("repo-a"), repository("repo-b")]}
        filePath="outside/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    const menu = openFileContentContextMenu();
    expect(
      menu.queryByRole("menuitem", { name: "files.tabGitActions" }),
    ).toBeNull();
    expect(getGitFileBlame).not.toHaveBeenCalled();
  });

  it("opens active file history from the content Git submenu using nested repository scope", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "const value = 1;",
      truncated: false,
    });
    const onOpenFileHistory = vi.fn();

    render(
      <FileViewPanel
        workspaceId="ws-content-history"
        workspacePath="/repo"
        gitRepositories={[repository(""), repository("packages/app")]}
        filePath="packages/app/src/value.ts"
        onOpenFileHistory={onOpenFileHistory}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    fireEvent.keyDown(editor, {
      key: "h",
      altKey: true,
      shiftKey: true,
    });
    expect(onOpenFileHistory).toHaveBeenCalledWith({
      workspaceId: "ws-content-history",
      workspacePath: "/repo",
      repositoryRoot: "packages/app",
      path: "src/value.ts",
      displayPath: "packages/app/src/value.ts",
    });
    onOpenFileHistory.mockClear();

    const menu = openFileContentContextMenu();
    fireEvent.mouseEnter(
      menu.getByRole("menuitem", { name: "files.tabGitActions" }),
    );
    const gitMenu = within(
      screen.getByRole("menu", { name: "files.tabGitActions" }),
    );
    const historyItem = gitMenu.getByRole("menuitem", {
      name: "files.tabShowFileHistory",
    });
    expect(
      historyItem.querySelector(".renderer-context-menu-item-shortcut")
        ?.textContent,
    ).toMatch(/^(⌥⇧H|Alt\+Shift\+H)$/);
    fireEvent.click(historyItem);

    expect(onOpenFileHistory).toHaveBeenCalledWith({
      workspaceId: "ws-content-history",
      workspacePath: "/repo",
      repositoryRoot: "packages/app",
      path: "src/value.ts",
      displayPath: "packages/app/src/value.ts",
    });
  });

  it("opens file history for the invoked tab using its nested repository scope", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });
    const onOpenFileHistory = vi.fn();

    render(
      <FileViewPanel
        workspaceId="ws-tab-history"
        workspacePath="/repo"
        gitRepositories={[repository(""), repository("packages/app")]}
        filePath="README.md"
        openTabs={["README.md", "packages/app/src/value.ts"]}
        activeTabPath="README.md"
        onOpenFileHistory={onOpenFileHistory}
        onCloseAllTabs={vi.fn()}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("file-markdown-preview");
    fireEvent.contextMenu(screen.getByRole("tab", { name: "value.ts" }));
    const gitTrigger = screen.getByRole("menuitem", {
      name: "files.tabGitActions",
    });
    fireEvent.mouseEnter(gitTrigger);
    const gitMenu = screen.getByRole("menu", { name: "files.tabGitActions" });
    fireEvent.click(
      within(gitMenu).getByRole("menuitem", {
        name: "files.tabShowFileHistory",
      }),
    );

    expect(onOpenFileHistory).toHaveBeenCalledWith({
      workspaceId: "ws-tab-history",
      workspacePath: "/repo",
      repositoryRoot: "packages/app",
      path: "src/value.ts",
      displayPath: "packages/app/src/value.ts",
    });
  });

  it("activates a background tab before enabling Git Blame", async () => {
    vi.mocked(readWorkspaceFile).mockImplementation(
      async (_workspaceId, path) => ({
        content: `content:${path}`,
        truncated: false,
      }),
    );
    vi.mocked(getGitFileBlame).mockImplementation(
      async (_workspaceId, path) => ({
        ...blameResponse,
        path,
      }),
    );

    function Harness() {
      const [activePath, setActivePath] = useState("src/first.ts");
      return (
        <FileViewPanel
          workspaceId="ws-tab-blame"
          workspacePath="/repo"
          gitRepositories={[repository("")]}
          filePath={activePath}
          openTabs={["src/first.ts", "src/second.ts"]}
          activeTabPath={activePath}
          onActivateTab={setActivePath}
          onCloseAllTabs={vi.fn()}
          openTargets={[]}
          openAppIconById={{}}
          selectedOpenAppId=""
          onSelectOpenAppId={vi.fn()}
          onClose={vi.fn()}
        />
      );
    }

    render(<Harness />);
    await screen.findByTestId("mock-codemirror");
    fireEvent.contextMenu(screen.getByRole("tab", { name: "second.ts" }));
    const gitTrigger = screen.getByRole("menuitem", {
      name: "files.tabGitActions",
    });
    fireEvent.mouseEnter(gitTrigger);
    const gitMenu = screen.getByRole("menu", { name: "files.tabGitActions" });
    fireEvent.click(
      within(gitMenu).getByRole("menuitem", { name: "files.gitBlameEnable" }),
    );

    await waitFor(() => {
      expect(getGitFileBlame).toHaveBeenCalledWith(
        "ws-tab-blame",
        "src/second.ts",
        null,
      );
    });
    expect(getGitFileBlame).not.toHaveBeenCalledWith(
      "ws-tab-blame",
      "src/first.ts",
      null,
    );
  });

  it("offers a footer git blame toggle for eligible files", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });
    vi.mocked(getGitFileBlame).mockResolvedValue(blameResponse);
    vi.mocked(getGitFileFullDiff).mockResolvedValue("");

    render(
      <FileViewPanel
        workspaceId="ws-footer-blame"
        workspacePath="/repo"
        filePath="src/value.ts"
        gitStatusFiles={[
          { path: "src/value.ts", status: "M", additions: 1, deletions: 0 },
        ]}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const toggle = await screen.findByRole("button", {
      name: "files.gitBlameEnable",
    });
    expect(getGitFileBlame).not.toHaveBeenCalled();
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(getGitFileBlame).toHaveBeenCalledWith(
        "ws-footer-blame",
        "src/value.ts",
        null,
      );
    });
    expect(
      screen.getByRole("button", { name: "files.gitBlameDisable" }),
    ).toBeTruthy();
  });

  it("hides the footer git blame toggle when no repository owns the file", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "one",
      truncated: false,
    });

    render(
      <FileViewPanel
        workspaceId="ws-footer-blame-hidden"
        workspacePath="/repo"
        gitRoot="repo-a"
        gitRepositories={[repository("repo-a"), repository("repo-b")]}
        filePath="outside/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    expect(
      screen.queryByRole("button", { name: "files.gitBlameEnable" }),
    ).toBeNull();
  });
});
