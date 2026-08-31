import { describe, expect, it, vi } from "vitest";
import {
  setupTauriInvokeWrapperTestState,
} from "./tauriTestSetup";
import { invoke } from "@tauri-apps/api/core";
import {
  getGitHubIssues,
  getGitLog,
  getGitCommitHistory,
  getGitPushPreview,
  getGitStatus,
  getGitDiffs,
  getGitFileBlame,
  pushGit,
  pullGit,
  updateGitBranch,
  listGitBranches,
  listGitRepositorySummaries,
  checkoutGitBranch,
  createGitBranch,
  createGitPrWorkflow,
  resetGitCommit,
  stageGitAll,
  unstageGitAll,
  unstageGitPaths,
  revertGitPaths,
  generateCommitMessage,
} from "./tauri";
import { getStartupTraceSnapshot } from "../features/startup-orchestration/utils/startupTrace";

describe("tauri invoke wrappers", () => {
  setupTauriInvokeWrapperTestState();

  it("maps repository-scoped commit message generation without changing legacy payloads", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue("fix: generated");

    await generateCommitMessage("ws-1", "zh", ["legacy.ts"]);
    expect(invokeMock).toHaveBeenLastCalledWith("generate_commit_message", {
      workspaceId: "ws-1",
      language: "zh",
      selectedPaths: ["legacy.ts"],
    });

    const repositorySelections = [
      { repositoryRoot: "services/api", selectedPaths: ["pom.xml"] },
      { repositoryRoot: "services/web", selectedPaths: ["package.json"] },
    ];
    await generateCommitMessage("ws-1", "en", undefined, repositorySelections);
    expect(invokeMock).toHaveBeenLastCalledWith("generate_commit_message", {
      workspaceId: "ws-1",
      language: "en",
      selectedPaths: undefined,
      repositorySelections,
    });

    await generateCommitMessage("ws-1", "zh", undefined, []);
    expect(invokeMock).toHaveBeenLastCalledWith("generate_commit_message", {
      workspaceId: "ws-1",
      language: "zh",
      selectedPaths: undefined,
      repositorySelections: [],
    });
  });

  it("forwards explicit large-range confirmation only on the confirmed retry", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({
      ok: true,
      status: "success",
      message: "created",
      stages: [],
    });
    const options = {
      upstreamRepo: "example/mossx",
      baseBranch: "main",
      headOwner: "developer",
      headBranch: "feature/large-pr",
      title: "feat(git): large pull request",
    };

    await createGitPrWorkflow("ws-1", options);
    expect(invokeMock).toHaveBeenLastCalledWith("create_git_pr_workflow", {
      workspaceId: "ws-1",
      upstreamRepo: "example/mossx",
      baseBranch: "main",
      headOwner: "developer",
      headBranch: "feature/large-pr",
      title: "feat(git): large pull request",
      body: null,
      commentAfterCreate: null,
      commentBody: null,
      allowLargeRange: null,
      confirmedRangeFingerprint: null,
    });

    await createGitPrWorkflow("ws-1", {
      ...options,
      allowLargeRange: true,
      confirmedRangeFingerprint: "base-revision...head-revision",
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      "create_git_pr_workflow",
      expect.objectContaining({
        allowLargeRange: true,
        confirmedRangeFingerprint: "base-revision...head-revision",
      }),
    );
  });

  it("maps workspace_id to workspaceId for git status", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      branchName: "main",
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 0,
      totalDeletions: 0,
    });

    await getGitStatus("ws-1");

    expect(invokeMock).toHaveBeenCalledWith("get_git_status", {
      workspaceId: "ws-1",
      repositoryRoot: null,
    });
    expect(
      getStartupTraceSnapshot().events.some(
        (event) =>
          event.type === "command" &&
          event.commandLabel === "get_git_status" &&
          event.status === "completed",
      ),
    ).toBe(true);
  });

  it("maps an explicit repository scope for Git History diff loading", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    await getGitDiffs("ws-1", "services/api");

    expect(invokeMock).toHaveBeenCalledWith("get_git_diffs", {
      workspaceId: "ws-1",
      repositoryRoot: "services/api",
    });
  });

  it("maps workspace_id to workspaceId for GitHub issues", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ total: 0, issues: [] });

    await getGitHubIssues("ws-2");

    expect(invokeMock).toHaveBeenCalledWith("get_github_issues", {
      workspaceId: "ws-2",
    });
  });

  it("applies default limit for git log", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      total: 0,
      entries: [],
      ahead: 0,
      behind: 0,
      aheadEntries: [],
      behindEntries: [],
      upstream: null,
    });

    await getGitLog("ws-3");

    expect(invokeMock).toHaveBeenCalledWith("get_git_log", {
      workspaceId: "ws-3",
      limit: 40,
    });
  });

  it("maps optional path and repository scope for git commit history", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      snapshotId: "snapshot-1",
      total: 0,
      offset: 0,
      limit: 100,
      hasMore: false,
      commits: [],
    });

    await getGitCommitHistory("ws-3", {
      path: "src/value.ts",
      repositoryRoot: "packages/app",
    });

    expect(invokeMock).toHaveBeenCalledWith("get_git_commit_history", {
      workspaceId: "ws-3",
      branch: null,
      query: null,
      author: null,
      dateFrom: null,
      dateTo: null,
      snapshotId: null,
      path: "src/value.ts",
      offset: 0,
      limit: 100,
      repositoryRoot: "packages/app",
    });
  });

  it("preserves the repository-wide git commit history payload when path is omitted", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      snapshotId: "snapshot-1",
      total: 0,
      offset: 0,
      limit: 100,
      hasMore: false,
      commits: [],
    });

    await getGitCommitHistory("ws-3");

    expect(invokeMock).toHaveBeenCalledWith("get_git_commit_history", {
      workspaceId: "ws-3",
      branch: null,
      query: null,
      author: null,
      dateFrom: null,
      dateTo: null,
      snapshotId: null,
      path: null,
      offset: 0,
      limit: 100,
    });
  });

  it("maps repository scope for file blame", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      path: "src/value.ts",
      headSha: "abc123",
      lineCount: 1,
      hunks: [],
    });

    await getGitFileBlame("ws-3", "src/value.ts", "packages/app");

    expect(invokeMock).toHaveBeenCalledWith("get_git_file_blame", {
      workspaceId: "ws-3",
      path: "src/value.ts",
      repositoryRoot: "packages/app",
    });
  });

  it("invokes stage_git_all", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await stageGitAll("ws-6");

    expect(invokeMock).toHaveBeenCalledWith("stage_git_all", {
      workspaceId: "ws-6",
      repositoryRoot: null,
    });
  });

  it("invokes unstage_git_all and unstage_git_paths", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await unstageGitAll("ws-6");
    await unstageGitPaths("ws-6", ["a.ts", "b.ts"], "services/api");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "unstage_git_all", {
      workspaceId: "ws-6",
      repositoryRoot: null,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "unstage_git_paths", {
      workspaceId: "ws-6",
      paths: ["a.ts", "b.ts"],
      repositoryRoot: "services/api",
    });
  });

  it("invokes revert_git_paths", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await revertGitPaths("ws-6", ["a.ts", "b.ts"]);

    expect(invokeMock).toHaveBeenCalledWith("revert_git_paths", {
      workspaceId: "ws-6",
      paths: ["a.ts", "b.ts"],
      repositoryRoot: null,
    });
  });

  it("maps reset git commit payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await resetGitCommit("ws-20", "abcdef1234567890", "mixed");

    expect(invokeMock).toHaveBeenCalledWith("reset_git_commit", {
      workspaceId: "ws-20",
      commitHash: "abcdef1234567890",
      mode: "mixed",
    });
  });

  it("maps push git payload with options", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await pushGit("ws-30", {
      remote: "origin",
      branch: "main",
      forceWithLease: true,
      pushTags: true,
      runHooks: false,
      pushToGerrit: true,
      topic: "topic-1",
      reviewers: "alice,bob",
      cc: "carol",
    });

    expect(invokeMock).toHaveBeenCalledWith("push_git", {
      workspaceId: "ws-30",
      remote: "origin",
      branch: "main",
      forceWithLease: true,
      pushTags: true,
      runHooks: false,
      pushToGerrit: true,
      topic: "topic-1",
      reviewers: "alice,bob",
      cc: "carol",
      repositoryRoot: null,
    });
  });

  it("maps pull git payload with options", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await pullGit("ws-32", {
      remote: "origin",
      branch: "main",
      strategy: "--rebase",
      noCommit: false,
      noVerify: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("pull_git", {
      workspaceId: "ws-32",
      remote: "origin",
      branch: "main",
      strategy: "--rebase",
      noCommit: false,
      noVerify: true,
      repositoryRoot: null,
    });
  });

  it("maps explicit repository scope for status and stage", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({
      branchName: "main",
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 0,
      totalDeletions: 0,
    });

    await getGitStatus("ws-1", "services/api");
    await stageGitAll("ws-1", "services/api");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_git_status", {
      workspaceId: "ws-1",
      repositoryRoot: "services/api",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "stage_git_all", {
      workspaceId: "ws-1",
      repositoryRoot: "services/api",
    });
  });

  it("maps update git branch payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      branch: "feature/demo",
      status: "success",
      reason: null,
      message: "updated",
      worktreePath: null,
    });

    await updateGitBranch("ws-33", "feature/demo", "services/api");

    expect(invokeMock).toHaveBeenCalledWith("update_git_branch", {
      workspaceId: "ws-33",
      branchName: "feature/demo",
      repositoryRoot: "services/api",
    });
  });

  it("maps repository-scoped Git command payloads", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue([]);

    await listGitRepositorySummaries("ws-scoped", 3);
    await listGitBranches("ws-scoped", "services\\api");
    await checkoutGitBranch("ws-scoped", "main", "services/api");
    await createGitBranch("ws-scoped", "feature/new", "");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_git_repository_summaries", {
      workspaceId: "ws-scoped",
      depth: 3,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_git_branches", {
      workspaceId: "ws-scoped",
      repositoryRoot: "services\\api",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "checkout_git_branch", {
      workspaceId: "ws-scoped",
      name: "main",
      repositoryRoot: "services/api",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "create_git_branch", {
      workspaceId: "ws-scoped",
      name: "feature/new",
      repositoryRoot: "",
    });
  });

  it("maps get git push preview payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      sourceBranch: "main",
      targetRemote: "origin",
      targetBranch: "main",
      targetRef: "refs/remotes/origin/main",
      targetFound: true,
      hasMore: false,
      commits: [],
    });

    await getGitPushPreview("ws-31", {
      remote: "origin",
      branch: "main",
    });

    expect(invokeMock).toHaveBeenCalledWith("get_git_push_preview", {
      workspaceId: "ws-31",
      remote: "origin",
      branch: "main",
      limit: 120,
    });
  });

  it("maps repository scope for git push preview", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      sourceBranch: "main",
      targetRemote: "origin",
      targetBranch: "main",
      targetRef: "refs/remotes/origin/main",
      targetFound: true,
      hasMore: false,
      commits: [],
    });

    await getGitPushPreview("ws-31", {
      remote: "origin",
      branch: "main",
      repositoryRoot: "services/api",
    });

    expect(invokeMock).toHaveBeenCalledWith("get_git_push_preview", {
      workspaceId: "ws-31",
      remote: "origin",
      branch: "main",
      limit: 120,
      repositoryRoot: "services/api",
    });
  });

});
