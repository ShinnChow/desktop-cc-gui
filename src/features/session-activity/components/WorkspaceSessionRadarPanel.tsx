import BellDot from "lucide-react/dist/esm/icons/bell-dot";
import CheckCheck from "lucide-react/dist/esm/icons/check-check";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import type { SessionRadarEntry } from "../hooks/useSessionRadarFeed";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import { loadSessionActivityStyles } from "../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../styles/useFeatureStylesReady";
import { formatRelativeTimeShort } from "../../../utils/time";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { deleteSessionRadarHistoryEntries } from "../utils/sessionRadarHistoryManagement";
import {
  RADAR_STORE_NAME,
  SESSION_RADAR_COLLAPSED_DATE_GROUPS_KEY,
  SESSION_RADAR_HISTORY_UPDATED_EVENT,
  SESSION_RADAR_READ_STATE_KEY,
} from "../utils/sessionRadarPersistence";

type WorkspaceSessionRadarPanelProps = {
  runningSessions: SessionRadarEntry[];
  recentCompletedSessions: SessionRadarEntry[];
  onSelectThread: (workspaceId: string, threadId: string) => void;
};

type RadarDeleteIconButtonProps = {
  className: string;
  ariaLabel: string;
  title: string;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  iconSize: number;
};

const WORKSPACE_ACCENT_PALETTE = [
  "#c2410c",
  "#d97706",
  "#ca8a04",
  "#a16207",
  "#b45309",
  "#9a3412",
  "#be123c",
  "#a21caf",
  "#7c2d12",
  "#78350f",
];

function formatActivityAbsoluteTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatDuration(durationMs: number | null, t: ReturnType<typeof useTranslation>["t"]) {
  if (durationMs == null) {
    return t("activityPanel.radar.durationUnknown");
  }
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${restSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${restSeconds}s`;
  }
  return `${restSeconds}s`;
}

function resolveDurationToneClass(durationMs: number | null) {
  if (durationMs == null) {
    return "is-unknown";
  }
  const totalMinutes = durationMs / (60 * 1000);
  if (totalMinutes < 1) {
    return "is-seconds";
  }
  if (totalMinutes <= 5) {
    return "is-lt-5m";
  }
  if (totalMinutes <= 10) {
    return "is-lt-10m";
  }
  if (totalMinutes <= 20) {
    return "is-lt-20m";
  }
  if (totalMinutes <= 30) {
    return "is-lt-30m";
  }
  return "is-gt-30m";
}

function formatDateKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveWorkspaceAccent(workspaceSeed: string) {
  if (!workspaceSeed) {
    return WORKSPACE_ACCENT_PALETTE[0];
  }
  let hash = 0;
  for (let index = 0; index < workspaceSeed.length; index += 1) {
    hash = (hash * 31 + workspaceSeed.charCodeAt(index)) | 0;
  }
  const paletteIndex = Math.abs(hash) % WORKSPACE_ACCENT_PALETTE.length;
  return WORKSPACE_ACCENT_PALETTE[paletteIndex];
}

function RadarDeleteIconButton({
  className,
  ariaLabel,
  title,
  disabled,
  onClick,
  iconSize,
}: RadarDeleteIconButtonProps) {
  return (
    <button
      type="button"
      className={`session-activity-radar-delete-icon-button ${className}`}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
    >
      <Trash2 size={iconSize} aria-hidden />
    </button>
  );
}

export function WorkspaceSessionRadarPanel({
  runningSessions,
  recentCompletedSessions,
  onSelectThread,
}: WorkspaceSessionRadarPanelProps) {
  // activity 面板已被 kill-switch 关掉，雷达是 session-activity.css 的唯一生产入口。
  // 不在这里拉 loader，右栏会整片退化为无卡片/无间距的裸文本。
  const stylesReady = useFeatureStylesReady(loadSessionActivityStyles);
  const { t } = useTranslation();
  const [previewExpandedById, setPreviewExpandedById] = useState<Record<string, boolean>>({});
  const [deletingEntryIds, setDeletingEntryIds] = useState<Record<string, boolean>>({});
  const [readStateById, setReadStateById] = useState<Record<string, number>>(
    () =>
      getClientStoreSync<Record<string, number>>(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY) ??
      {},
  );
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Record<string, boolean>>(
    () =>
      getClientStoreSync<Record<string, boolean>>(
        RADAR_STORE_NAME,
        SESSION_RADAR_COLLAPSED_DATE_GROUPS_KEY,
      ) ??
      {},
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 日期组整体删除的待确认快照；非空时展示 ConfirmDialog（替代 WKWebView 下静默返回 false 的 window.confirm）
  const [pendingDeleteDateGroup, setPendingDeleteDateGroup] = useState<{
    dateKey: string;
    entries: SessionRadarEntry[];
  } | null>(null);
  // 设置页历史管理等外部入口改动 radar 历史后会派发该事件，面板收到后重读未读态与折叠态
  useEffect(() => {
    const syncFromStore = () => {
      setReadStateById(
        getClientStoreSync<Record<string, number>>(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY) ??
          {},
      );
      setCollapsedDateGroups(
        getClientStoreSync<Record<string, boolean>>(
          RADAR_STORE_NAME,
          SESSION_RADAR_COLLAPSED_DATE_GROUPS_KEY,
        ) ?? {},
      );
    };
    window.addEventListener(SESSION_RADAR_HISTORY_UPDATED_EVENT, syncFromStore);
    return () => window.removeEventListener(SESSION_RADAR_HISTORY_UPDATED_EVENT, syncFromStore);
  }, []);
  // 完成条目按本地日期分组；dateKey 字典序即时间序
  const recentDateKeysDesc = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of recentCompletedSessions) {
      keys.add(formatDateKey(entry.completedAt ?? entry.updatedAt));
    }
    return Array.from(keys).sort((left, right) => right.localeCompare(left));
  }, [recentCompletedSessions]);
  // 修剪 collapsedDateGroups 中已不存在 dateKey 的陈旧记录，避免持久化状态只增不减；
  // 列表为空时跳过（可能是 feed 尚未加载完成），避免误清用户手动折叠态；
  // 写盘与 setState 按顺序调用，不在 updater 内做副作用
  useEffect(() => {
    if (recentDateKeysDesc.length === 0) {
      return;
    }
    const validKeys = new Set(recentDateKeysDesc);
    const next = Object.fromEntries(
      Object.entries(collapsedDateGroups).filter(([dateKey]) => validKeys.has(dateKey)),
    );
    if (Object.keys(next).length === Object.keys(collapsedDateGroups).length) {
      return;
    }
    writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_COLLAPSED_DATE_GROUPS_KEY, next, {
      immediate: true,
    });
    setCollapsedDateGroups(next);
  }, [recentDateKeysDesc, collapsedDateGroups]);
  const headerSummary = useMemo(
    () =>
      [
        t("activityPanel.radar.runningSection", { count: runningSessions.length }),
        t("activityPanel.radar.recentSection", { count: recentCompletedSessions.length }),
      ].join(" · "),
    [recentCompletedSessions.length, runningSessions.length, t],
  );

  const markEntryAsRead = (entry: SessionRadarEntry) => {
    if (entry.isProcessing) {
      return;
    }
    setReadStateById((current) => {
      const next = { ...current, [entry.id]: Date.now() };
      writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY, next, {
        immediate: true,
      });
      return next;
    });
  };

  const resolveEngine = (entry: SessionRadarEntry): "codex" | "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder" => {
    const normalizedEngine = entry.engine.toUpperCase();
    if (normalizedEngine === "CLAUDE") {
      return "claude";
    }
    if (normalizedEngine === "GEMINI") {
      return "gemini";
    }
    if (normalizedEngine === "GROK") {
      return "grok";
    }
    if (normalizedEngine === "KIMI") {
      return "kimi";
    }
    if (normalizedEngine === "OPENCODE") {
      return "opencode";
    }
    if (normalizedEngine === "DSH") {
      return "dsh";
    }
    if (normalizedEngine === "QODER") {
      return "qoder";
    }
    if (normalizedEngine === "PI") {
      return "pi";
    }
    if (normalizedEngine === "OMP") {
      return "omp";
    }
    return "codex";
  };

  const renderReadMarkerIcon = (isUnreadRecent: boolean) =>
    isUnreadRecent ? <BellDot size={11} aria-hidden /> : <CheckCheck size={11} aria-hidden />;

  const deleteRecentEntries = (entries: SessionRadarEntry[]) => {
    const dedupedTargets = new Map<
      string,
      {
        id: string;
        completedAt: number;
        liveUpdatedAt: number;
      }
    >();
    for (const entry of entries) {
      dedupedTargets.set(entry.id, {
        id: entry.id,
        completedAt: entry.completedAt ?? entry.updatedAt,
        // UI 展示的 updatedAt 已是 live 刷新值；带上它可消除
        // 「thread 刚更新、feed 未回写、用户立即删除」的复活窗口
        liveUpdatedAt: entry.updatedAt,
      });
    }
    if (dedupedTargets.size === 0) {
      return;
    }
    const targetIds = Array.from(dedupedTargets.keys());
    if (targetIds.some((entryId) => deletingEntryIds[entryId])) {
      return;
    }
    setDeletingEntryIds((current) => {
      const next = { ...current };
      targetIds.forEach((entryId) => {
        next[entryId] = true;
      });
      return next;
    });
    try {
      const result = deleteSessionRadarHistoryEntries(Array.from(dedupedTargets.values()));
      if (result.succeededEntryIds.length > 0) {
        const succeededIdSet = new Set(result.succeededEntryIds);
        setPreviewExpandedById((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([entryId]) => !succeededIdSet.has(entryId)),
          ),
        );
        setReadStateById((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([entryId]) => !succeededIdSet.has(entryId)),
          ),
        );
      }
      // 删除失败不再静默：复用 follow 错误气泡的视觉模式展示可恢复错误提示
      setDeleteError(
        result.failed.length > 0
          ? t("activityPanel.radar.deleteFailedBody", { count: result.failed.length })
          : null,
      );
    } finally {
      setDeletingEntryIds((current) => {
        const next = { ...current };
        targetIds.forEach((entryId) => {
          delete next[entryId];
        });
        return next;
      });
    }
  };

  const togglePreviewAndSelectThread = (entry: SessionRadarEntry) => {
    markEntryAsRead(entry);
    setPreviewExpandedById((current) => {
      const nextExpanded = !current[entry.id];
      return { ...current, [entry.id]: nextExpanded };
    });
    onSelectThread(entry.workspaceId, entry.threadId);
  };

  const handleDeleteRecentEntry = (event: MouseEvent<HTMLButtonElement>, entry: SessionRadarEntry) => {
    event.preventDefault();
    event.stopPropagation();
    deleteRecentEntries([entry]);
  };

  const handleDeleteDateGroupEntries = (
    event: MouseEvent<HTMLButtonElement>,
    dateKey: string,
    groupEntries: SessionRadarEntry[],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (groupEntries.length === 0) {
      return;
    }
    // 日期组整体删除影响面大，先弹 ConfirmDialog 二次确认
    // （window.confirm 在 macOS Tauri WKWebView 下静默返回 false，不可使用）
    setPendingDeleteDateGroup({ dateKey, entries: groupEntries });
  };

  const handleConfirmDeleteDateGroup = () => {
    const pending = pendingDeleteDateGroup;
    setPendingDeleteDateGroup(null);
    if (pending) {
      deleteRecentEntries(pending.entries);
    }
  };

  const handleRecentRowActionsClick = (event: MouseEvent<HTMLSpanElement>, entry: SessionRadarEntry) => {
    const clickTarget = event.target as HTMLElement | null;
    if (clickTarget?.closest(".session-activity-radar-delete-icon-button")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    togglePreviewAndSelectThread(entry);
  };

  const renderSection = (
    sectionTitle: string,
    emptyCopyKey: "activityPanel.radar.emptyRunning" | "activityPanel.radar.emptyRecent",
    entries: SessionRadarEntry[],
  ) => (
    <section className="session-activity-radar-section">
      <header className="session-activity-radar-section-header">
        <span>{sectionTitle}</span>
      </header>
      {entries.length === 0 ? (
        <div className="session-activity-radar-empty">{t(emptyCopyKey)}</div>
      ) : (
        <div className="session-activity-radar-list">
          {entries.map((entry) => {
            const completedAt = entry.completedAt ?? entry.updatedAt;
            const readAt = readStateById[entry.id] ?? 0;
            const isUnreadRecent = !entry.isProcessing && completedAt > readAt;
            return (
              <button
                key={entry.id}
                type="button"
                className={`session-activity-radar-row${entry.isProcessing ? " is-running" : ""}${
                  isUnreadRecent ? " is-unread" : ""
                }${previewExpandedById[entry.id] ? " is-preview-expanded" : ""}`}
                onClick={() => togglePreviewAndSelectThread(entry)}
                aria-expanded={previewExpandedById[entry.id] ? true : false}
                aria-label={entry.threadName}
              >
                {!entry.isProcessing ? (
                  <span
                    className={`session-activity-radar-corner-badge${
                      isUnreadRecent ? " is-unread" : " is-read"
                    }`}
                    aria-label={
                      isUnreadRecent
                        ? t("activityPanel.radar.unreadMark")
                        : t("activityPanel.radar.readMark")
                    }
                    title={
                      isUnreadRecent
                        ? t("activityPanel.radar.unreadMark")
                        : t("activityPanel.radar.readMark")
                    }
                  >
                    {renderReadMarkerIcon(isUnreadRecent)}
                  </span>
                ) : null}
                <span className="session-activity-radar-row-main">
                  <span className="session-activity-radar-row-meta-line">
                    <span
                      className={`session-activity-radar-engine-icon${
                        entry.isProcessing ? " is-running" : ""
                      }`}
                      aria-label={entry.engine}
                      title={entry.engine}
                    >
                      <EngineIcon engine={resolveEngine(entry)} size={13} />
                    </span>
                    <span
                      className="session-activity-radar-workspace"
                      style={{ color: resolveWorkspaceAccent(entry.workspaceId || entry.workspaceName) }}
                    >
                      {entry.workspaceName}
                    </span>
                    <span
                      title={
                        entry.startedAt ? formatActivityAbsoluteTime(entry.startedAt) : undefined
                      }
                    >
                      {t("activityPanel.radar.startedAt")}{" "}
                      {entry.startedAt ? formatRelativeTimeShort(entry.startedAt) : t("activityPanel.radar.timeUnknown")}
                    </span>
                    {!entry.isProcessing ? (
                      <>
                        <span
                          title={
                            entry.completedAt ? formatActivityAbsoluteTime(entry.completedAt) : undefined
                          }
                        >
                          {t("activityPanel.radar.endedAt")}{" "}
                          {entry.completedAt ? formatRelativeTimeShort(entry.completedAt) : t("activityPanel.status.running")}
                        </span>
                        <span>
                          {t("activityPanel.radar.totalDuration")}{" "}
                          <span
                            className={`session-activity-radar-duration ${resolveDurationToneClass(entry.durationMs)}`}
                          >
                            {formatDuration(entry.durationMs, t)}
                          </span>
                        </span>
                      </>
                    ) : null}
                  </span>
                  <span className="session-activity-radar-row-preview">
                    {entry.preview || t("activityPanel.commandPendingSummary")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );

  const renderRecentSection = (
    sectionTitle: string,
    entries: SessionRadarEntry[],
  ) => {
    const groups = new Map<string, SessionRadarEntry[]>();
    for (const entry of entries) {
      const dateKey = formatDateKey(entry.completedAt ?? entry.updatedAt);
      const existing = groups.get(dateKey);
      if (existing) {
        existing.push(entry);
      } else {
        groups.set(dateKey, [entry]);
      }
    }
    const groupEntries = Array.from(groups.entries()).sort((left, right) =>
      right[0].localeCompare(left[0]),
    );
    // 仅最新日期组默认展开，其余维持用户手动折叠态
    const latestDateKey = groupEntries.length > 0 ? groupEntries[0][0] : null;

    return (
      <section className="session-activity-radar-section">
        <header className="session-activity-radar-section-header">
          <span>{sectionTitle}</span>
        </header>
        {entries.length === 0 ? (
          <div className="session-activity-radar-empty">{t("activityPanel.radar.emptyRecent")}</div>
        ) : (
          <div className="session-activity-radar-list">
            {groupEntries.map(([dateKey, group]) => {
              const isCollapsed = collapsedDateGroups[dateKey] ?? dateKey !== latestDateKey;
              const isDeletingDateGroup = group.some((entry) => Boolean(deletingEntryIds[entry.id]));
              const deleteDateGroupLabel = t("activityPanel.radar.deleteDateGroupEntries", {
                date: dateKey,
                count: group.length,
              });
              return (
                <div key={dateKey} className="session-activity-radar-date-group">
                  <div className="session-activity-radar-date-group-header">
                    <button
                      type="button"
                      className="session-activity-radar-date-toggle"
                      onClick={() => {
                        // 先算 next，再按顺序写盘 + setState；updater 内不做副作用、不嵌套 setState
                        const next = { ...collapsedDateGroups, [dateKey]: !isCollapsed };
                        writeClientStoreValue(
                          RADAR_STORE_NAME,
                          SESSION_RADAR_COLLAPSED_DATE_GROUPS_KEY,
                          next,
                          { immediate: true },
                        );
                        setCollapsedDateGroups(next);
                        if (!isCollapsed) {
                          setPreviewExpandedById((expandedCurrent) => {
                            const expandedNext = { ...expandedCurrent };
                            for (const entry of group) {
                              delete expandedNext[entry.id];
                            }
                            return expandedNext;
                          });
                        }
                      }}
                      aria-expanded={!isCollapsed}
                    >
                      <span className="session-activity-radar-date-toggle-left">
                        <CalendarDays size={14} aria-hidden />
                        {isCollapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                        <span>{dateKey}</span>
                      </span>
                      <span className="session-activity-radar-date-toggle-count">{group.length}</span>
                    </button>
                    <RadarDeleteIconButton
                      className="session-activity-radar-date-group-delete-button is-date-group"
                      onClick={(event) => handleDeleteDateGroupEntries(event, dateKey, group)}
                      ariaLabel={deleteDateGroupLabel}
                      title={deleteDateGroupLabel}
                      disabled={isDeletingDateGroup}
                      iconSize={12}
                    />
                  </div>
                  {!isCollapsed ? (
                    <div className="session-activity-radar-date-group-list">
                      {group.map((entry) => {
                        const completedAt = entry.completedAt ?? entry.updatedAt;
                        const readAt = readStateById[entry.id] ?? 0;
                        const isUnreadRecent = completedAt > readAt;
                        const isDeletingRecentEntry = Boolean(deletingEntryIds[entry.id]);
                        return (
                          <div key={entry.id} className="session-activity-radar-row-shell">
                            <button
                              type="button"
                              className={`session-activity-radar-row has-delete-action${isUnreadRecent ? " is-unread" : ""}${
                                previewExpandedById[entry.id] ? " is-preview-expanded" : ""
                              }`}
                              onClick={() => togglePreviewAndSelectThread(entry)}
                              aria-expanded={previewExpandedById[entry.id] ? true : false}
                              aria-label={entry.threadName}
                            >
                              <span className="session-activity-radar-row-main">
                                <span className="session-activity-radar-row-meta-line">
                                  <span
                                    className="session-activity-radar-engine-icon"
                                    aria-label={entry.engine}
                                    title={entry.engine}
                                  >
                                    <EngineIcon engine={resolveEngine(entry)} size={13} />
                                  </span>
                                  <span
                                    className="session-activity-radar-workspace"
                                    style={{ color: resolveWorkspaceAccent(entry.workspaceId || entry.workspaceName) }}
                                  >
                                    {entry.workspaceName}
                                  </span>
                                  <span
                                    title={
                                      entry.startedAt
                                        ? formatActivityAbsoluteTime(entry.startedAt)
                                        : undefined
                                    }
                                  >
                                    {t("activityPanel.radar.startedAt")}{" "}
                                    {entry.startedAt
                                      ? formatRelativeTimeShort(entry.startedAt)
                                      : t("activityPanel.radar.timeUnknown")}
                                  </span>
                                  <span
                                    title={
                                      entry.completedAt
                                        ? formatActivityAbsoluteTime(entry.completedAt)
                                        : undefined
                                    }
                                  >
                                    {t("activityPanel.radar.endedAt")}{" "}
                                    {entry.completedAt
                                      ? formatRelativeTimeShort(entry.completedAt)
                                      : t("activityPanel.status.running")}
                                  </span>
                                  <span>
                                    {t("activityPanel.radar.totalDuration")}{" "}
                                    <span
                                      className={`session-activity-radar-duration ${resolveDurationToneClass(entry.durationMs)}`}
                                    >
                                      {formatDuration(entry.durationMs, t)}
                                    </span>
                                  </span>
                                </span>
                                <span className="session-activity-radar-row-preview">
                                  {entry.preview || t("activityPanel.commandPendingSummary")}
                                </span>
                              </span>
                            </button>
                            <span
                              className="session-activity-radar-row-actions"
                              onClick={(event) => handleRecentRowActionsClick(event, entry)}
                            >
                              <span
                                className={`session-activity-radar-corner-badge${
                                  isUnreadRecent ? " is-unread" : " is-read"
                                }`}
                                aria-label={
                                  isUnreadRecent
                                    ? t("activityPanel.radar.unreadMark")
                                    : t("activityPanel.radar.readMark")
                                }
                                title={
                                  isUnreadRecent
                                    ? t("activityPanel.radar.unreadMark")
                                    : t("activityPanel.radar.readMark")
                                }
                              >
                                {renderReadMarkerIcon(isUnreadRecent)}
                              </span>
                              {/* 未读条目同样展示删除按钮，行点击仍触发跳转 + 标已读 */}
                              <RadarDeleteIconButton
                                className="session-activity-radar-delete-button is-entry"
                                onClick={(event) => handleDeleteRecentEntry(event, entry)}
                                ariaLabel={t("activityPanel.radar.deleteHistoryEntry", { name: entry.threadName })}
                                title={t("activityPanel.radar.deleteHistoryEntry", { name: entry.threadName })}
                                disabled={isDeletingRecentEntry}
                                iconSize={11}
                              />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  if (!stylesReady) {
    return null;
  }

  return (
    <div className="session-activity-panel">
      <div className="session-activity-header">
        <div className="session-activity-title-group">
          <div className="session-activity-heading-row">
            <div className="session-activity-title-row">
              <span>{t("activityPanel.radar.modeWorkspaceRadar")}</span>
            </div>
          </div>
        </div>
        <div className="session-activity-summary">{headerSummary}</div>
      </div>
      {deleteError ? (
        <div
          className="session-activity-follow-bubble is-error"
          role="alert"
          style={{ position: "static", width: "auto", overflow: "hidden" }}
        >
          <div className="session-activity-follow-bubble-title">
            {t("activityPanel.radar.deleteFailedTitle")}
          </div>
          <p className="session-activity-follow-bubble-copy">{deleteError}</p>
          <div className="session-activity-follow-bubble-actions">
            <button
              type="button"
              className="session-activity-follow-bubble-secondary"
              onClick={() => setDeleteError(null)}
            >
              {t("activityPanel.radar.deleteFailedDismiss")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="session-activity-radar">
        {renderSection(
          t("activityPanel.radar.runningSection", { count: runningSessions.length }),
          "activityPanel.radar.emptyRunning",
          runningSessions,
        )}
        {renderRecentSection(
          t("activityPanel.radar.recentSection", { count: recentCompletedSessions.length }),
          recentCompletedSessions,
        )}
      </div>
      <ConfirmDialog
        open={pendingDeleteDateGroup != null}
        danger
        title={
          pendingDeleteDateGroup
            ? t("activityPanel.radar.deleteDateGroupEntries", {
                date: pendingDeleteDateGroup.dateKey,
                count: pendingDeleteDateGroup.entries.length,
              })
            : ""
        }
        body={
          pendingDeleteDateGroup
            ? t("activityPanel.radar.confirmDeleteDateGroup", {
                date: pendingDeleteDateGroup.dateKey,
                count: pendingDeleteDateGroup.entries.length,
              })
            : ""
        }
        confirmText={t("common.delete")}
        onConfirm={handleConfirmDeleteDateGroup}
        onCancel={() => setPendingDeleteDateGroup(null)}
      />
    </div>
  );
}
