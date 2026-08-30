import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import Bot from "lucide-react/dist/esm/icons/bot";
import ListTodo from "lucide-react/dist/esm/icons/list-todo";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import PanelTop from "lucide-react/dist/esm/icons/panel-top";
import PanelTopClose from "lucide-react/dist/esm/icons/panel-top-close";
import GitFork from "lucide-react/dist/esm/icons/git-fork";
import HardDriveDownload from "lucide-react/dist/esm/icons/hard-drive-download";
import type { LucideIcon } from "lucide-react";
import type { TurnPlan } from "../../../../types";
import { loadComposerRunStatusListStyles } from "../../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../../styles/useFeatureStylesReady";
import type { SubagentInfo, TodoItem } from "../../../status-panel/types";
import type { TurnFileChangesSummary } from "../../../messages/utils/turnFileChanges";
import { TodoList } from "../../../status-panel/components/TodoList";
import { PlanList } from "../../../status-panel/components/PlanList";
import { TurnFilesChangedCard } from "../../../messages/components/conversation/TurnFilesChangedCard";
import { RunStatusSubagentRows } from "./RunStatusSubagentRows";
import { RollingStat } from "./RollingStat";
import {
  useComposerRunStatus,
  type ComposerRunStatusInput,
} from "./useComposerRunStatus";
import {
  useBackgroundTaskPill,
  type BackgroundTaskPillScope,
  type BackgroundTaskPillModel,
} from "./useBackgroundTaskPill";
import type { RunStatusSection } from "./types";
import { readWorkspaceFileTail } from "../../../../services/tauri/workspaceFiles";

export type ComposerRunStatusStripProps = ComposerRunStatusInput & {
  isCodexEngine?: boolean;
  onOpenDiffPath?: (path: string) => void;
  onInspectSubagent?: (agent: SubagentInfo) => void;
  /** 撤销已编辑列表中的单个文件 */
  onRevertFile?: (path: string) => void | Promise<void>;
  /** 撤销已编辑列表中的多个文件（撤销全部） */
  onRevertAllFiles?: (paths: string[]) => void | Promise<void>;
  /** pi 会话树 pill（native pi 专属）：与 todo/subagent/plan/edit 平级，
   *  点击切换会话树 dock 开态，不是 section（无展开面板）。 */
  piTree?: {
    active: boolean;
    laneCount: number | null;
    onToggle: () => void;
  };
  /** 3.1 「后台任务」pill 作用域（active thread）；store 为空时 pill 不占位。 */
  backgroundTasksScope?: BackgroundTaskPillScope;
};

type PillDef = {
  id: RunStatusSection;
  label: string;
  Icon: LucideIcon;
  countLabel: string;
  running: boolean;
  hint?: string | null;
};

function buildPills(
  model: ReturnType<typeof useComposerRunStatus>,
  t: (key: string, opts?: Record<string, unknown>) => string,
  isCodexEngine: boolean,
): PillDef[] {
  const pills: PillDef[] = [];
  if (model.showTodoSection) {
    pills.push({
      id: "todo",
      label: t("statusPanel.tabTodos"),
      Icon: ListChecks,
      countLabel: `${model.todoCompleted}/${model.todoTotal}`,
      running: model.todoRunning,
    });
  }
  if (model.showSubagentSection) {
    pills.push({
      id: "subagent",
      label: isCodexEngine
        ? t("statusPanel.tabAgents")
        : t("statusPanel.tabSubagents"),
      Icon: Bot,
      countLabel: `${model.subagentCompleted}/${model.subagentTotal}`,
      running: model.subagentRunning,
      hint: model.subagentRunning ? model.runningSubagentLabel : null,
    });
  }
  if (model.showPlanSection) {
    pills.push({
      id: "plan",
      label: t("statusPanel.tabPlan"),
      Icon: ListTodo,
      countLabel:
        model.planTotal > 0 ? `${model.planCompleted}/${model.planTotal}` : "…",
      running: false,
    });
  }
  if (model.showEditSection) {
    pills.push({
      id: "edit",
      label: t("composer.runStatus.edited"),
      Icon: Pencil,
      // pill 展示行级 diff 汇总，文件数放在 title / 展开面板
      countLabel: `+${model.totalAdditions} -${model.totalDeletions}`,
      running: model.editRunning,
      hint: t("messages.turnFilesChanged.title", {
        count: model.editFileCount,
      }),
    });
  }
  return pills;
}

const CHROME_OPEN_STORAGE_KEY = "ccgui.composer.runStatusChromeOpen";

function readChromeOpenPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(CHROME_OPEN_STORAGE_KEY);
    if (raw === "0" || raw === "false") return false;
    if (raw === "1" || raw === "true") return true;
  } catch {
    // ignore
  }
  return true;
}

function writeChromeOpenPreference(open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHROME_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // ignore
  }
}

export const ComposerRunStatusStrip = memo(function ComposerRunStatusStrip(
  props: ComposerRunStatusStripProps,
) {
  const { t } = useTranslation();
  const {
    isCodexEngine = false,
    onOpenDiffPath,
    onInspectSubagent,
    onRevertFile,
    onRevertAllFiles,
    isPlanMode,
    isProcessing,
    piTree,
    backgroundTasksScope,
    ...statusInput
  } = props;

  const model = useComposerRunStatus({
    ...statusInput,
    isPlanMode,
    isProcessing,
  });

  // 3.1 「后台任务」pill：会话级状态表事件驱动读副本，无任务不占位。
  const backgroundTasks = useBackgroundTaskPill(
    backgroundTasksScope ?? { workspaceId: null, threadId: null },
  );
  // registry watcher 已上收 useThreadEventHandlers（app 级、枚举全部 running
  // 会话）——strip 挂载只探活跃会话，切走即失守，导致终态只进 store、
  // 时间线卡片不折叠（真机 2026-08-27 事故）。此处仅保留 pill 读副本。

  // 任务 / Plan 复用 .sp-todo-* / .sp-plan-*；Status dock 已退役，必须自己拉切片。
  const needsListStyles = model.showTodoSection || model.showPlanSection;
  const listStylesReady = useFeatureStylesReady(
    loadComposerRunStatusListStyles,
    needsListStyles,
  );

  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const stripRef = useRef<HTMLDivElement>(null);
  const [chromeOpen, setChromeOpen] = useState(readChromeOpenPreference);

  const { markFilesReverted, collapse, expandedSection } = model;

  const toggleChrome = useCallback(() => {
    setChromeOpen((prev) => {
      const next = !prev;
      writeChromeOpenPreference(next);
      if (!next) {
        collapse();
      }
      return next;
    });
  }, [collapse]);

  // 撤销成功后写入 hook 级签名隐藏，pill 与列表共用过滤后的 summary
  const handleRevertFile = useCallback(
    async (path: string) => {
      await onRevertFile?.(path);
      markFilesReverted([path]);
    },
    [markFilesReverted, onRevertFile],
  );

  const handleRevertAllFiles = useCallback(
    async (paths: string[]) => {
      await onRevertAllFiles?.(paths);
      markFilesReverted(paths);
    },
    [markFilesReverted, onRevertAllFiles],
  );

  useEffect(() => {
    if (!expandedSection || !chromeOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        collapse();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chromeOpen, collapse, expandedSection]);

  if (!model.visible && !piTree && !backgroundTasks.hasAny) {
    return null;
  }

  const pills = buildPills(model, t, isCodexEngine);
  if (backgroundTasks.hasAny) {
    pills.push({
      id: "backgroundTask",
      label: t("composer.runStatus.backgroundTasks"),
      Icon: HardDriveDownload,
      countLabel: backgroundTasks.anyRunning
        ? `${backgroundTasks.runningCount}/${backgroundTasks.totalCount}`
        : `${backgroundTasks.totalCount}`,
      running: backgroundTasks.anyRunning,
    });
  }
  const sectionExpanded = chromeOpen ? model.expandedSection : null;
  const hasLive =
    model.todoRunning ||
    model.subagentRunning ||
    model.editRunning ||
    backgroundTasks.anyRunning;
  const ToggleIcon = chromeOpen ? PanelTopClose : PanelTop;

  return (
    <div
      ref={stripRef}
      className={`composer-run-status${sectionExpanded ? " is-expanded" : ""}${
        chromeOpen ? " is-chrome-open" : " is-chrome-collapsed"
      }${hasLive ? " is-live" : ""}`}
      data-testid="composer-run-status"
      data-chrome-open={chromeOpen ? "true" : "false"}
    >
      {chromeOpen ? (
        <div
          className={`composer-run-status-panel-shell${
            sectionExpanded ? " is-open" : ""
          }`}
          aria-hidden={!sectionExpanded}
        >
          <div className="composer-run-status-panel-clip">
            {sectionExpanded ? (
              <div
                id={panelId}
                className="composer-run-status-panel scrollable"
                role="tabpanel"
                aria-label={
                  pills.find((p) => p.id === sectionExpanded)?.label ??
                  t("composer.runStatus.panel")
                }
              >
                <ExpandedBody
                  section={sectionExpanded}
                  listStylesReady={listStylesReady}
                  todos={model.displayTodos}
                  subagents={model.subagents}
                  plan={model.plan}
                  isPlanMode={isPlanMode}
                  isProcessing={isProcessing}
                  isCodexEngine={isCodexEngine}
                  sessionFileChanges={model.sessionFileChanges}
                  backgroundTasks={backgroundTasks}
                  backgroundTasksWorkspaceId={backgroundTasksScope?.workspaceId ?? null}
                  onOpenDiffPath={onOpenDiffPath}
                  onInspectSubagent={onInspectSubagent}
                  onRevertFile={onRevertFile ? handleRevertFile : undefined}
                  onRevertAllFiles={
                    onRevertAllFiles ? handleRevertAllFiles : undefined
                  }
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={`composer-run-status-toolbar${
          chromeOpen ? "" : " is-collapsed"
        }`}
      >
        {chromeOpen ? (
          <div
            className="composer-run-status-pills"
            role="tablist"
            aria-label={t("composer.runStatus.label")}
          >
            {pills.map((pill) => {
              const selected = sectionExpanded === pill.id;
              const Icon = pill.Icon;
              return (
                <button
                  key={pill.id}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${pill.id}`}
                  data-section={pill.id}
                  className={`composer-run-status-pill${selected ? " is-selected" : ""}${
                    pill.running ? " is-running" : ""
                  }`}
                  aria-selected={selected}
                  aria-expanded={selected}
                  aria-controls={selected ? panelId : undefined}
                  title={
                    pill.hint
                      ? `${pill.label} ${pill.countLabel} · ${pill.hint}`
                      : `${pill.label} ${pill.countLabel}`
                  }
                  onClick={() => model.toggleSection(pill.id)}
                >
                  {pill.running ? (
                    <span
                      className={`composer-run-status-live-dot${
                        pill.id === "backgroundTask"
                          ? " composer-run-status-live-dot--info"
                          : ""
                      }`}
                      aria-hidden
                    />
                  ) : null}
                  <Icon
                    size={14}
                    strokeWidth={2.1}
                    aria-hidden
                    className="composer-run-status-pill-icon"
                  />
                  <span className="composer-run-status-pill-label">
                    {pill.label}
                  </span>
                  {pill.id === "edit" ? (
                    <span className="composer-run-status-pill-count composer-run-status-pill-count--edit">
                      <RollingStat
                        className="is-add"
                        prefix="+"
                        value={model.totalAdditions}
                        data-testid="composer-run-status-edit-additions"
                      />
                      <RollingStat
                        className="is-del"
                        prefix="-"
                        value={model.totalDeletions}
                        data-testid="composer-run-status-edit-deletions"
                      />
                    </span>
                  ) : (
                    <span className="composer-run-status-pill-count">
                      {pill.countLabel}
                    </span>
                  )}
                </button>
              );
            })}
            {piTree ? (
              <button
                type="button"
                className={`composer-run-status-pill${piTree.active ? " is-selected" : ""}`}
                title={
                  piTree.active
                    ? "会话树 · 点击关闭"
                    : "会话树 · 点击打开（pi RPC: get_tree）"
                }
                aria-pressed={piTree.active}
                onClick={piTree.onToggle}
              >
                <GitFork
                  size={14}
                  strokeWidth={2.1}
                  aria-hidden
                  className="composer-run-status-pill-icon"
                />
                <span className="composer-run-status-pill-label">会话树</span>
                {piTree.laneCount !== null && piTree.laneCount > 1 ? (
                  <span className="composer-run-status-pill-count">
                    {piTree.laneCount} lane
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
        ) : (
          <span className="composer-run-status-toolbar-spacer" aria-hidden />
        )}

        <button
          type="button"
          className={`composer-run-status-chrome-toggle${
            hasLive ? " is-live" : ""
          }`}
          data-testid="composer-run-status-chrome-toggle"
          aria-expanded={chromeOpen}
          aria-controls={chromeOpen ? panelId : undefined}
          title={
            chromeOpen
              ? t("composer.runStatus.collapseChrome")
              : t("composer.runStatus.expandChrome")
          }
          aria-label={
            chromeOpen
              ? t("composer.runStatus.collapseChrome")
              : t("composer.runStatus.expandChrome")
          }
          onClick={toggleChrome}
        >
          {hasLive && !chromeOpen ? (
            <span className="composer-run-status-live-dot" aria-hidden />
          ) : null}
          <ToggleIcon size={15} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
});

function isTerminalBackgroundTaskStatus(status: unknown): boolean {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  return value === "completed" || value === "failed" || value === "killed";
}

function BackgroundTaskRows({
  model,
  workspaceId,
}: {
  model: BackgroundTaskPillModel;
  workspaceId: string | null;
}) {
  const { t } = useTranslation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const [tailById, setTailById] = useState<
    Map<string, { text: string; truncated: boolean; loading: boolean; error?: boolean }>
  >(new Map());
  useEffect(() => {
    if (!model.anyRunning) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [model.anyRunning]);
  const running = model.tasks.filter(
    (record) => !isTerminalBackgroundTaskStatus(record.task.status),
  );
  const done = model.tasks.filter((record) =>
    isTerminalBackgroundTaskStatus(record.task.status),
  );
  const toggleLog = (taskId: string, outputPath: string): void => {
    const isOpening = openLogId !== taskId;
    setOpenLogId(isOpening ? taskId : null);
    if (!isOpening) return;
    if (!workspaceId || tailById.has(taskId)) return;
    setTailById((prev) => new Map(prev).set(taskId, { text: "", truncated: false, loading: true }));
    readWorkspaceFileTail(workspaceId, outputPath)
      .then((res) =>
        setTailById((prev) =>
          new Map(prev).set(taskId, {
            text: res.content,
            truncated: res.truncated,
            loading: false,
          }),
        ),
      )
      .catch(() =>
        setTailById((prev) =>
          new Map(prev).set(taskId, { text: "", truncated: false, loading: false, error: true }),
        ),
      );
  };
  const renderTail = (taskId: string): ReactNode => {
    const entry = tailById.get(taskId);
    if (!entry) return null;
    if (entry.loading) return <span>{t("composer.runStatus.bgLogLoading")}</span>;
    if (entry.error)
      return <span className="composer-run-status-bg-tail-empty">{t("composer.runStatus.bgLogError")}</span>;
    if (!entry.text.trim())
      return <span className="composer-run-status-bg-tail-empty">{t("composer.runStatus.bgLogEmpty")}</span>;
    return (
      <pre className="composer-run-status-bg-tail-pre">
        {entry.text}
        {entry.truncated ? `\n… ${t("composer.runStatus.bgLogTruncated")}` : ""}
      </pre>
    );
  };
  const renderRow = (record: (typeof model.tasks)[number]): ReactNode => {
    const task = record.task as {
      id?: string;
      name?: string | null;
      command?: string | null;
      status?: string | null;
      exitCode?: number | null;
      startTime?: number | null;
      endTime?: number | null;
      outputPath?: string | null;
    };
    const terminal = isTerminalBackgroundTaskStatus(task.status);
    const label =
      typeof task.name === "string" && task.name.trim()
        ? task.name.trim()
        : (record.toolName ?? record.taskId);
    const durationSeconds =
      typeof task.startTime === "number"
        ? Math.max(
            0,
            Math.floor(
              ((terminal ? (task.endTime ?? nowMs) : nowMs) - task.startTime) /
                1000,
            ),
          )
        : null;
    const mm =
      durationSeconds != null
        ? String(Math.floor(durationSeconds / 60)).padStart(2, "0")
        : "--";
    const ss =
      durationSeconds != null
        ? String(durationSeconds % 60).padStart(2, "0")
        : "--";
    return (
      <li
        key={record.taskId}
        className={`composer-run-status-bg-row${terminal ? " is-terminal" : " is-running"}`}
        data-testid="composer-run-status-bg-row"
      >
        <span
          className={`composer-run-status-bg-status is-${(
            task.status ?? ""
          ).toLowerCase()}`}
        >
          {terminal
            ? (task.status ?? "").toLowerCase() === "completed"
              ? t("messages.backgroundTaskCardCompleted")
              : (task.status ?? "").toLowerCase() === "killed"
                ? t("messages.backgroundTaskCardKilled")
                : t("messages.backgroundTaskCardFailed")
            : t("messages.backgroundTaskCardRunning")}
        </span>
        <span
          className="composer-run-status-bg-name"
          title={typeof task.command === "string" ? task.command : undefined}
        >
          {label}
        </span>
        <span className="composer-run-status-bg-elapsed">
          {mm}:{ss}
        </span>
        {task.exitCode != null ? (
          <span className="composer-run-status-bg-exit">
            exit {task.exitCode}
          </span>
        ) : null}
        {typeof task.outputPath === "string" && task.outputPath ? (
          <button
            type="button"
            className="composer-run-status-bg-log"
            aria-expanded={openLogId === record.taskId}
            onClick={() => toggleLog(record.taskId, task.outputPath as string)}
          >
            {openLogId === record.taskId
              ? t("messages.backgroundTaskFoldCollapse")
              : t("messages.backgroundTaskCardViewLog")}
          </button>
        ) : null}
        {openLogId === record.taskId ? (
          <span className="composer-run-status-bg-tail">
            {renderTail(record.taskId)}
          </span>
        ) : null}
      </li>
    );
  };
  return (
    <div className="composer-run-status-body composer-run-status-body--bg-tasks">
      {running.length > 0 ? (
        <ul
          className="composer-run-status-bg-list"
          data-testid="composer-run-status-bg-list-running"
        >
          {running.map(renderRow)}
        </ul>
      ) : null}
      {done.length > 0 ? (
        <ul
          className="composer-run-status-bg-list is-done"
          data-testid="composer-run-status-bg-list-done"
        >
          {done.map(renderRow)}
        </ul>
      ) : null}
    </div>
  );
}

function ExpandedBody({
  section,
  listStylesReady,
  todos,
  subagents,
  plan,
  isPlanMode,
  isProcessing,
  isCodexEngine,
  sessionFileChanges,
  backgroundTasks,
  backgroundTasksWorkspaceId,
  onOpenDiffPath,
  onInspectSubagent,
  onRevertFile,
  onRevertAllFiles,
}: {
  section: RunStatusSection;
  listStylesReady: boolean;
  todos: TodoItem[];
  subagents: SubagentInfo[];
  plan: TurnPlan | null;
  isPlanMode: boolean;
  isProcessing: boolean;
  isCodexEngine: boolean;
  sessionFileChanges: TurnFileChangesSummary | null;
  backgroundTasks: BackgroundTaskPillModel;
  backgroundTasksWorkspaceId: string | null;
  onOpenDiffPath?: (path: string) => void;
  onInspectSubagent?: (agent: SubagentInfo) => void;
  onRevertFile?: (path: string) => void | Promise<void>;
  onRevertAllFiles?: (paths: string[]) => void | Promise<void>;
}) {
  if (section === "backgroundTask") {
    return (
      <BackgroundTaskRows
        model={backgroundTasks}
        workspaceId={backgroundTasksWorkspaceId}
      />
    );
  }
  if ((section === "todo" || section === "plan") && !listStylesReady) {
    return null;
  }
  if (section === "todo") {
    return (
      <div className="composer-run-status-body composer-run-status-body--todos">
        <TodoList todos={todos} showTitle />
      </div>
    );
  }
  if (section === "subagent") {
    return (
      <div className="composer-run-status-body composer-run-status-body--subagents">
        <RunStatusSubagentRows
          subagents={subagents}
          onInspectSubagent={onInspectSubagent}
        />
      </div>
    );
  }
  if (section === "plan") {
    return (
      <div className="composer-run-status-body">
        <PlanList
          plan={plan}
          isPlanMode={isPlanMode}
          isProcessing={isProcessing}
          isCodexEngine={isCodexEngine}
        />
      </div>
    );
  }
  if (!sessionFileChanges || sessionFileChanges.files.length === 0) {
    return (
      <div className="composer-run-status-body">
        <div className="sp-empty">{/* empty */}</div>
      </div>
    );
  }
  return (
    <div className="composer-run-status-body composer-run-status-body--files">
      <TurnFilesChangedCard
        summary={sessionFileChanges}
        onPreviewFileDiff={onOpenDiffPath}
        onRevertFile={onRevertFile}
        onRevertAll={onRevertAllFiles}
      />
    </div>
  );
}
