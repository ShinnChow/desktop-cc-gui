import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ContextUsageIcon,
  formatContextPercent,
} from "@/components/ai-elements/context";
import {
  ompCompact,
  ompGetSessionStats,
  ompSessionIdFromThreadId,
  piCompact,
  piGetSessionStats,
  piSessionIdFromThreadId,
  type PiSessionStats,
} from "../api/piSessionRpc";

type PiCompactEntryProps = {
  /** pi-family 引擎身份（omp 与 pi 共享本组件，默认 pi）。 */
  engine?: "pi" | "omp";
  workspaceId: string;
  threadId: string;
  disabled?: boolean;
  /** 当前上下文占用百分比（0-100），用于渲染圆环；null 显示空环 */
  percentage?: number | null;
};

/**
 * Composer footer entry for PI RPC manual compaction（native pi cli 专属展现）：
 * 直接复用上下文圆圈作为触发器——没有 hover 用量卡，点击圆圈即打开
 * PiCompactDialog（占用统计 + 压缩指令），替换其他引擎的「上下文 等待回传」弹层。
 */
export function PiCompactEntry({
  engine = "pi",
  workspaceId,
  threadId,
  disabled = false,
  percentage = null,
}: PiCompactEntryProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const percentLabel = formatContextPercent(percentage);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="pi-compact-entry"
        title={t("piSession.compact.entryTitle")}
        aria-label={t("piSession.compact.entryLabel")}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
      >
        {percentLabel ? (
          <span className="pi-compact-entry-percent">{percentLabel}</span>
        ) : null}
        <ContextUsageIcon usedPercent={percentage} />
      </button>
      <PiCompactDialog
        engine={engine}
        open={open}
        workspaceId={workspaceId}
        threadId={threadId}
        variant="popover"
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        onCompacted={() => {
          // compact 后下一次打开 dialog 时会重新拉 stats；不留 store 切片。
        }}
      />
    </>
  );
}

type PiCompactDialogProps = {
  /** pi-family 引擎身份（omp 与 pi 共享本组件，默认 pi）。 */
  engine?: "pi" | "omp";
  open: boolean;
  workspaceId: string;
  threadId: string;
  onClose: () => void;
  /** popover: 锚定在触发按钮上方的无遮罩弹层；缺省为居中模态 */
  variant?: "popover";
  /** popover 模式下的锚点元素（触发按钮） */
  anchorRef?: RefObject<HTMLElement | null>;
  onCompacted: (result: {
    tokensBefore: number | null;
    estimatedTokensAfter: number | null;
  }) => void;
};

function formatTokens(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return value >= 1000 ? `~${Math.round(value / 1000)}k` : `${value}`;
}

/**
 * pi 的「会话太短无可压缩」是正常状态，不是故障——映射为中性提示而非
 * 红色错误。pi 默认完整保留最近约 20k tokens（keepRecentTokens），短会话
 * 整体落在保留窗口内时没有可压缩前缀。
 */
export function compactErrorToNotice(message: string): string | null {
  if (/nothing to compact|too small/i.test(message)) {
    return "会话还很短，没有可压缩的内容（pi 会完整保留最近约 20k tokens）。";
  }
  return null;
}

/**
 * Manual `/compact` dialog for PI RPC sessions: stats triple + optional
 * custom instructions (RPC `compact.customInstructions`).
 */
export function PiCompactDialog({
  engine = "pi",
  open,
  workspaceId,
  threadId,
  onClose,
  variant,
  anchorRef,
  onCompacted,
}: PiCompactDialogProps) {
  const { t } = useTranslation();
  // pi-family 命令路由：omp 与 pi 的 stats/compact RPC 面全等，仅命令名不同。
  const getSessionStats = engine === "omp" ? ompGetSessionStats : piGetSessionStats;
  const runCompact = engine === "omp" ? ompCompact : piCompact;
  const sessionIdFromThreadId =
    engine === "omp" ? ompSessionIdFromThreadId : piSessionIdFromThreadId;
  const [stats, setStats] = useState<PiSessionStats | null>(null);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setNotice(null);
    setDone(false);
    void getSessionStats({
      workspaceId,
      sessionId: sessionIdFromThreadId(threadId),
    })
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, workspaceId, threadId, getSessionStats, sessionIdFromThreadId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const percent = stats?.contextUsage?.percent ?? null;
  const messageCount = useMemo(() => {
    const total = stats?.totalMessages;
    return total !== null && total !== undefined ? `${total} 条` : "—";
  }, [stats]);

  // ===== popover 模式：锚定在触发按钮上方，无遮罩 =====
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{
    bottom: number;
    right: number;
  } | null>(null);
  const isPopover = variant === "popover";

  useLayoutEffect(() => {
    if (!open || !isPopover) {
      setPopoverPos(null);
      return;
    }
    const update = () => {
      const rect = anchorRef?.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setPopoverPos({
        bottom: window.innerHeight - rect.top + 8,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, isPopover, anchorRef]);

  useEffect(() => {
    if (!open || !isPopover) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (dialogRef.current?.contains(target)) {
        return;
      }
      if (anchorRef?.current?.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, isPopover, anchorRef, onClose]);

  if (!open) {
    return null;
  }
  const dialogBody = (
    <div
      ref={dialogRef}
      className={`pi-dialog${isPopover ? " pi-dialog--popover" : ""}`}
      role="dialog"
      aria-modal={isPopover ? undefined : "true"}
      aria-label={t("piSession.compact.dialogAria")}
      onClick={(event) => event.stopPropagation()}
      style={
        isPopover
          ? popoverPos
            ? { bottom: popoverPos.bottom, right: popoverPos.right }
            : { visibility: "hidden" }
          : undefined
      }
    >
      <h3>
        ⤓ {t("piSession.compact.dialogTitle")}
        <span className="mono">{engine} RPC: compact</span>
      </h3>
      <div className="pi-stat-row">
        <div className="pi-stat">
          <div className={`v${(percent ?? 0) >= 80 ? " warn" : ""}`}>
            {percent !== null ? `${Math.round(percent)}%` : "—"}
          </div>
          <div className="k">{t("piSession.compact.occupancy")}</div>
        </div>
        <div className="pi-stat">
          <div className="v">{messageCount}</div>
          <div className="k">{t("piSession.compact.messages")}</div>
        </div>
        <div className="pi-stat">
          <div className="v">
            {formatTokens(stats?.contextUsage?.tokens ?? null)}
          </div>
          <div className="k">{t("piSession.compact.tokens")}</div>
        </div>
      </div>
      <label htmlFor="pi-compact-instructions">
        {t("piSession.compact.instructionsLabel")}
      </label>
      <textarea
        id="pi-compact-instructions"
        rows={2}
        value={instructions}
        placeholder={t("piSession.compact.instructionsPlaceholder")}
        onChange={(event) => setInstructions(event.target.value)}
      />
      <div className="hint">
        {t("piSession.compact.hint")}
      </div>
      {error ? <p className="pi-dialog-error">{error}</p> : null}
      {notice ? <p className="pi-dialog-notice">{notice}</p> : null}
      <div className="pi-dialog-foot">
        <button
          type="button"
          className="pi-btn-plain"
          onClick={onClose}
          disabled={busy}
        >
          {done
            ? t("piSession.compact.close")
            : t("piSession.compact.cancel")}
        </button>
        <button
          type="button"
          className="pi-btn-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            setNotice(null);
            void runCompact({
              workspaceId,
              sessionId: sessionIdFromThreadId(threadId),
              customInstructions: instructions,
            })
              .then((result) => {
                setBusy(false);
                setDone(true);
                setInstructions("");
                // 成功后原地展示结果并重拉统计（手动压缩无 active run，
                // compaction_start/end 事件不会上屏，dialog 是唯一反馈面）。
                setNotice(
                  `压缩完成：${formatTokens(result.tokensBefore)} → ${formatTokens(result.estimatedTokensAfter)}（估算）。`,
                );
                onCompacted({
                  tokensBefore: result.tokensBefore,
                  estimatedTokensAfter: result.estimatedTokensAfter,
                });
                void getSessionStats({
                  workspaceId,
                  sessionId: sessionIdFromThreadId(threadId),
                })
                  .then(setStats)
                  .catch(() => {
                    // 统计刷新失败不影响压缩结果本身
                  });
              })
              .catch((err) => {
                setBusy(false);
                const message =
                  err instanceof Error ? err.message : String(err);
                const neutral = compactErrorToNotice(message);
                if (neutral !== null) {
                  setNotice(neutral);
                } else {
                  setError(message);
                }
              });
          }}
        >
          {busy
            ? t("piSession.compact.confirming")
            : t("piSession.compact.confirm")}
        </button>
      </div>
    </div>
  );
  if (isPopover) {
    return createPortal(dialogBody, document.body);
  }
  return createPortal(
    <div className="pi-overlay" onClick={onClose} role="presentation">
      {dialogBody}
    </div>,
    document.body,
  );
}
