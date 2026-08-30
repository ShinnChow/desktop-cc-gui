import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { CollapsibleReveal } from "../../../../components/common/CollapsibleReveal";

/**
 * Canonical snapshot shape mirrored from the pi-background-tasks extension
 * (`result.details.task` / notification `details` / registry metadata).
 * All fields beyond `id` are optional: text-receipt fallbacks only carry a
 * subset (id / name / status / outputPath / pid).
 */
export type CanonicalBackgroundTask = {
  id: string;
  name?: string | null;
  command?: string | null;
  status?: string | null;
  outputPath?: string | null;
  exitCode?: number | null;
  startTime?: number | null;
  endTime?: number | null;
  pid?: number | null;
  error?: string | null;
  /** 终态通知里的人类可读摘要（`<summary>`/`<result>` 清洗后），实时与历史同源。 */
  completionText?: string | null;
};

export type BackgroundTaskCardProps = {
  /** Originating bg tool (`bg_run` / `bg_delegate` / `fusion_*` ...). */
  toolName: string;
  /** Tool call arguments (receipt 到达前只有这些：name/command)。 */
  input?: unknown;
  /** 最新快照（receipt / notification 合并后的视图）。 */
  task?: CanonicalBackgroundTask | null;
  /** 终态：原地折叠为 message-agent-task-fold 行；运行中：活体卡。 */
  terminal: boolean;
  onOpenLog?: (task: CanonicalBackgroundTask) => void;
};

type TaskTone = "running" | "completed" | "error" | "neutral";

const TERMINAL_STATUSES = new Set(["completed", "failed", "killed"]);

export function isTerminalBackgroundTaskStatus(
  status: string | null | undefined,
): boolean {
  return TERMINAL_STATUSES.has((status ?? "").trim().toLowerCase());
}

/** 行渲染适配：ConversationItem.output 里的 task 快照 JSON → CanonicalBackgroundTask。 */
export function parseBackgroundTaskSnapshot(
  output: string | null | undefined,
): CanonicalBackgroundTask | null {
  const text = output?.trim() ?? "";
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    if (!id) return null;
    return {
      id,
      name: typeof parsed.name === "string" ? parsed.name : null,
      command: typeof parsed.command === "string" ? parsed.command : null,
      status: typeof parsed.status === "string" ? parsed.status : null,
      outputPath:
        typeof parsed.outputPath === "string" ? parsed.outputPath : null,
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : null,
      startTime: typeof parsed.startTime === "number" ? parsed.startTime : null,
      endTime: typeof parsed.endTime === "number" ? parsed.endTime : null,
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      error: typeof parsed.error === "string" ? parsed.error : null,
      completionText:
        typeof parsed.completionText === "string" ? parsed.completionText : null,
    };
  } catch {
    return null;
  }
}

/** 行渲染适配：ConversationItem.detail 里的工具参数 JSON → input 对象。 */
export function parseBackgroundTaskInput(
  detail: string | null | undefined,
): unknown {
  const text = detail?.trim() ?? "";
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * store 权威记录（四路合流的 live task）→ CanonicalBackgroundTask。
 * 与 parseBackgroundTaskSnapshot 对称：卡片状态优先取 store 直读快照
 * （时间线 upsert 丢失时自愈），output 快照仅作兜底。
 */
export function canonicalBackgroundTaskFromRecord(
  task: Record<string, unknown> | null | undefined,
): CanonicalBackgroundTask | null {
  if (!task || typeof task !== "object") return null;
  const id = typeof task.id === "string" ? task.id.trim() : "";
  if (!id) return null;
  return {
    id,
    name: typeof task.name === "string" ? task.name : null,
    command: typeof task.command === "string" ? task.command : null,
    status: typeof task.status === "string" ? task.status : null,
    outputPath: typeof task.outputPath === "string" ? task.outputPath : null,
    exitCode: typeof task.exitCode === "number" ? task.exitCode : null,
    startTime: typeof task.startTime === "number" ? task.startTime : null,
    endTime: typeof task.endTime === "number" ? task.endTime : null,
    pid: typeof task.pid === "number" ? task.pid : null,
    error: typeof task.error === "string" ? task.error : null,
    completionText:
      typeof task.completionText === "string" ? task.completionText : null,
  };
}

function resolveTone(
  task: CanonicalBackgroundTask | null | undefined,
): TaskTone {
  const status = (task?.status ?? "").trim().toLowerCase();
  if (status === "completed") return "completed";
  if (status === "failed" || status === "killed") return "error";
  if (status === "running" || !status) return "running";
  return "neutral";
}

function inputString(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

/** 运行中 elapsed：组件本地 1s tick，禁止上根链（Render Perf 红线）。 */
function useElapsedSeconds(
  startTimeMs: number | null,
  active: boolean,
): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || startTimeMs == null) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startTimeMs]);
  if (startTimeMs == null) return 0;
  return Math.max(0, (now - startTimeMs) / 1000);
}

export const BackgroundTaskCard = memo(function BackgroundTaskCard({
  toolName,
  input,
  task,
  terminal,
  onOpenLog,
}: BackgroundTaskCardProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const tone = resolveTone(task);
  const taskName =
    task?.name?.trim() ||
    inputString(input, "name") ||
    inputString(input, "description");
  const command = task?.command?.trim() || inputString(input, "command");
  const title = taskName
    ? t("messages.backgroundTaskCardTitleNamed", { name: taskName })
    : t("messages.backgroundTaskCardTitle");
  const startTimeMs =
    typeof task?.startTime === "number" ? task.startTime : null;
  const elapsedSeconds = useElapsedSeconds(startTimeMs, !terminal);
  const durationMs =
    task?.startTime != null && task?.endTime != null
      ? task.endTime - task.startTime
      : null;
  const statusLabel = terminal
    ? tone === "completed"
      ? t("messages.backgroundTaskCardCompleted")
      : task?.status === "killed"
        ? t("messages.backgroundTaskCardKilled")
        : t("messages.backgroundTaskCardFailed")
    : t("messages.backgroundTaskCardRunning");

  const foldLabel = useMemo(() => {
    const parts = [title];
    if (durationMs != null) {
      parts.push(
        t("messages.backgroundTaskCardDuration", {
          duration: formatDurationMs(durationMs),
        }),
      );
    }
    if (task?.exitCode != null) {
      parts.push(`exit ${task.exitCode}`);
    }
    return parts.join(" · ");
  }, [title, durationMs, task?.exitCode, t]);

  const kvRows = useMemo(() => {
    const rows: Array<{ key: string; label: string; value: string }> = [];
    const push = (
      key: string,
      label: string,
      value: string | null | undefined,
    ) => {
      const trimmed = value?.trim() ?? "";
      if (trimmed) rows.push({ key, label, value: trimmed });
    };
    push("tool", t("messages.backgroundTaskCardFieldTool"), toolName);
    push("taskId", t("messages.backgroundTaskCardFieldTaskId"), task?.id);
    push("command", t("messages.backgroundTaskCardFieldCommand"), command);
    push("status", t("messages.backgroundTaskCardFieldStatus"), task?.status);
    if (task?.exitCode != null) {
      push(
        "exitCode",
        t("messages.backgroundTaskCardFieldExitCode"),
        String(task.exitCode),
      );
    }
    push(
      "output",
      t("messages.backgroundTaskCardFieldOutput"),
      task?.outputPath,
    );
    if (task?.completionText) {
      push(
        "completion",
        t("messages.backgroundTaskFoldFieldSummary"),
        task.completionText,
      );
    }
    if (task?.error) {
      push("error", t("messages.backgroundTaskCardFieldError"), task.error);
    }
    return rows;
  }, [toolName, task, command, t]);

  const openLog =
    task && task.outputPath && onOpenLog ? () => onOpenLog(task) : null;

  if (terminal) {
    const ariaLabel = `${foldLabel}. ${
      isExpanded
        ? t("messages.backgroundTaskFoldCollapse")
        : t("messages.backgroundTaskFoldExpand")
    }`;
    return (
      <div
        className={`message-agent-task-fold-drawer${
          isExpanded ? " is-expanded" : " is-collapsed"
        }`}
        data-testid="background-task-card-fold"
        data-task-id={task?.id ?? undefined}
      >
        <button
          type="button"
          className={`messages-process-phase-toggle${
            isExpanded ? " is-expanded" : " is-collapsed"
          }`}
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
          aria-label={ariaLabel}
        >
          <span className="messages-process-phase-toggle-copy">
            <span className={`message-agent-task-fold-status is-${tone}`}>
              {statusLabel}
            </span>
            <span className="message-agent-task-fold-label">{foldLabel}</span>
            <ChevronRight
              className="messages-process-phase-toggle-chevron"
              size={14}
              strokeWidth={2}
              aria-hidden
            />
          </span>
          <span className="messages-process-phase-toggle-rule" aria-hidden />
        </button>
        <CollapsibleReveal open={isExpanded}>
          <div className="message-agent-task-fold-detail">
            <dl className="message-agent-task-fold-kv">
              {kvRows.map((row) => (
                <div key={row.key} className="message-agent-task-fold-kv-row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
              {openLog ? (
                <div className="message-agent-task-fold-kv-row">
                  <dt>{t("messages.backgroundTaskCardFieldLog")}</dt>
                  <dd>
                    <button
                      type="button"
                      className="background-task-card-log-link"
                      onClick={openLog}
                    >
                      {t("messages.backgroundTaskCardViewLog")}
                    </button>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </CollapsibleReveal>
      </div>
    );
  }

  return (
    <div
      className="background-task-card"
      data-testid="background-task-card-live"
      data-task-id={task?.id ?? undefined}
    >
      <div className="background-task-card-head">
        <span className="message-agent-task-fold-status is-running">
          {statusLabel}
        </span>
        <span className="background-task-card-title">{title}</span>
        {task?.id ? (
          <span className="background-task-card-id">{task.id}</span>
        ) : null}
        <span className="background-task-card-elapsed">
          {formatElapsed(elapsedSeconds)}
        </span>
      </div>
      {command ? (
        <div className="background-task-card-command">
          <code>{command}</code>
        </div>
      ) : null}
      <div className="background-task-card-foot">
        <span className="background-task-card-tool">{toolName}</span>
        {openLog ? (
          <span className="background-task-card-actions">
            <button type="button" onClick={openLog}>
              {t("messages.backgroundTaskCardViewLog")}
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
});
