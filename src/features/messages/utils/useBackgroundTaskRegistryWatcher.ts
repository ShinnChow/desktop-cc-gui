import { useEffect, useMemo, useRef, type RefObject } from "react";
import { readWorkspaceFile } from "../../../services/tauri/workspaceFiles";
import { revealInFileManager } from "../../../services/tauri/workspaceRuntime";
import {
  applyBackgroundTaskUpdate,
  getBackgroundTaskUpdateSink,
  listBackgroundTaskRunningCounts,
  listBackgroundTasks,
  type BackgroundTaskLiveRecord,
} from "./backgroundTaskStore";

export type BackgroundTaskRegistryScope = {
  workspaceId: string | null;
  threadId: string | null;
};

export type BackgroundTaskRegistryWatcherOptions = {
  /** 断链判定：进程不存活持续时间（毫秒）超过才标异常终止。 */
  staleAfterMs?: number;
  /** 探测间隔（毫秒）；运行中有任务才计时。 */
  pollMs?: number;
  /** 测试/调试：注入 registry 元数据读取实现。 */
  readFile?: typeof readWorkspaceFile;
  /** 测试/调试：注入进程存活探测。 */
  isProcessAlive?: (pid: number) => Promise<boolean>;
  /** 测试/调试：apply 落到 store 后的观察钩子。 */
  onApply?: (payload: {
    toolId: string | null;
    task: Record<string, unknown>;
    source: string;
  }) => void;
};

const DEFAULT_POLL_MS = 3000;
const DEFAULT_STALE_MS = 30000;

// 终态口径与 backgroundTaskStore.isTerminalBackgroundTaskStatus 一致
// （含 cancelled/canceled）：registry metadata 写取消终态时必须立刻
// 收口，否则 watcher 会把已取消任务当 running 永久探测。
const TERMINAL = new Set([
  "completed",
  "failed",
  "killed",
  "cancelled",
  "canceled",
]);

function isTerminalStatus(status: unknown): boolean {
  return TERMINAL.has(
    typeof status === "string" ? status.trim().toLowerCase() : "",
  );
}

/** `.output` 日志路径 → 同目录 `<taskId>.json` registry 元数据路径。 */
export function registryMetadataPathForOutput(outputPath: string): string {
  return /\.output$/i.test(outputPath)
    ? outputPath.replace(/\.output$/i, ".json")
    : `${outputPath}.json`;
}

function parseRegistrySnapshot(
  content: string,
): Record<string, unknown> | null {
  if (!content.trim()) return null;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || !parsed.id.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function runningTasks(
  tasks: BackgroundTaskLiveRecord[],
): BackgroundTaskLiveRecord[] {
  return tasks.filter((record) => !isTerminalStatus(record.task.status));
}

/**
 * P2 会话级 registry watcher（design §D4）：前端复用 `read_workspace_file`
 * 读 `.pi/tasks/session-<pid>-<pid>/<taskId>.json`，把**终态 metadata** 喂回
 * `applyBackgroundTaskUpdate(source:"registry")` —— 这是 post-settle 通知被
 * per-turn forwarder 丢弃后的收敛通道（B 通道，基石设计指定的根治路径；
 * A 通道 resident 空闲期持续转发明确不做），让任务完成时卡片折叠 / pill 更新。
 *
 * Render Perf 红线：单组件级 interval（运行中有任务才计时，空闲即清），不挂根
 * hook 链、不秒级轮询根链；只在「状态变了」才 apply，读空/无变化跳过。
 *
 * 断链判定（2.2）：pid 已知且存活探测可用时，进程不存活**持续**
 * `staleAfterMs`（避免进程退出→写终态 metadata 的竞态窗口误标）且仍未从
 * registry 读到终态 → 标「异常终止」（failed）。pid 缺失 / 探测不可用 →
 * 保守跳过（D4 pid 失配降级：仅通知/registry 终态驱动）。
 */
export function useBackgroundTaskRegistryWatcher(
  scope: BackgroundTaskRegistryScope,
  options: BackgroundTaskRegistryWatcherOptions = {},
): void {
  const {
    staleAfterMs = DEFAULT_STALE_MS,
    pollMs = DEFAULT_POLL_MS,
    readFile = readWorkspaceFile,
    isProcessAlive,
    onApply,
  } = options;
  const workspaceId = scope.workspaceId;
  const threadId = scope.threadId;
  const readFileRef = useRef(readFile);
  const isProcessAliveRef = useRef(isProcessAlive);
  const onApplyRef = useRef(onApply);
  readFileRef.current = readFile;
  isProcessAliveRef.current = isProcessAlive;
  onApplyRef.current = onApply;

  const enabled = useMemo(
    () => Boolean(workspaceId && threadId),
    [workspaceId, threadId],
  );

  // 断链判定需「持续死亡」，首次见到进程不存活记起始，超过 staleAfterMs 才标。
  const deadSinceRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled || !workspaceId || !threadId) return undefined;
    const deadSince = deadSinceRef.current;
    const apply = createRegistryApply(workspaceId, threadId, onApplyRef);

    const probe = async (): Promise<void> => {
      await probeThreadTasks({
        workspaceId,
        threadId,
        apply,
        deadSince,
        readFile: readFileRef,
        isProcessAlive: isProcessAliveRef,
        staleAfterMs,
      });
    };

    const timer = window.setInterval(() => {
      void probe();
    }, pollMs);
    // 挂载时立即探测一次（capture 掉挂载前已终态但事件丢失的任务）。
    void probe();
    return () => {
      window.clearInterval(timer);
      deadSince.clear();
    };
  }, [enabled, workspaceId, threadId, pollMs, staleAfterMs]);
}

type RegistryApply = (payload: {
  toolId: string | null;
  task: Record<string, unknown>;
  source: string;
}) => void;

function createRegistryApply(
  workspaceId: string,
  threadId: string,
  onApplyRef: RefObject<
    | ((payload: {
        toolId: string | null;
        task: Record<string, unknown>;
        source: string;
      }) => void)
    | undefined
  >,
): RegistryApply {
  return (payload) => {
    // 有 sink（正常挂载）：走与 receipt/notification 同构的完整路径
    // （store 合并 + 合成 item 写 reducer），timeline 卡片与 pill 同步翻终态。
    const sink = getBackgroundTaskUpdateSink();
    if (sink) {
      sink(workspaceId, threadId, payload);
      onApplyRef.current?.(payload);
      return;
    }
    // 无 sink（纯 pill 场景 / 测试）：降级直写 store，pill 仍正确。
    applyBackgroundTaskUpdate(workspaceId, threadId, payload);
    onApplyRef.current?.(payload);
  };
}

type ProbeDeps = {
  workspaceId: string;
  threadId: string;
  apply: RegistryApply;
  deadSince: Map<string, number>;
  readFile: RefObject<typeof readWorkspaceFile>;
  isProcessAlive: RefObject<
    ((pid: number) => Promise<boolean>) | undefined
  >;
  staleAfterMs: number;
};

async function probeThreadTasks({
  workspaceId,
  threadId,
  apply,
  deadSince,
  readFile,
  isProcessAlive,
  staleAfterMs,
}: ProbeDeps): Promise<void> {
  const tasks = runningTasks(listBackgroundTasks(workspaceId, threadId));
  if (tasks.length === 0) return;
  const nowMs = Date.now();
  for (const record of tasks) {
    const task = record.task as Record<string, unknown>;
    const pid = pickNumber(task.pid);
    const outputPath =
      typeof task.outputPath === "string" ? task.outputPath.trim() : "";
    const rawId = task.id ?? task.taskId;
    const taskId =
      typeof rawId === "string" ? rawId : ((record.toolId as string) ?? "");
    if (!taskId) continue;
    // deadSince 按 workspace+thread+taskId 复合 key：不同会话的 taskId
    // 可能撞号，裸 key 会互相重置「持续死亡」计时。
    const deadKey = `${workspaceId}\u0000${threadId}\u0000${taskId}`;

    let terminal: Record<string, unknown> | null = null;
    if (outputPath) {
      const metaPath = registryMetadataPathForOutput(outputPath);
      try {
        const res = await readFile.current(workspaceId, metaPath);
        const snapshot = parseRegistrySnapshot(res.content);
        if (snapshot && isTerminalStatus(snapshot.status)) {
          terminal = snapshot;
        }
      } catch (error) {
        // 文件可能尚不存在 / 已清理；fall through 到断链判定。
        if (import.meta.env.DEV) {
          console.warn(
            `[bg-task-registry] read metadata failed: ${metaPath}`,
            error,
          );
        }
      }
    }

    if (terminal) {
      deadSince.delete(deadKey);
      apply({ toolId: null, task: terminal, source: "registry" });
      continue;
    }

    const alive =
      pid != null && isProcessAlive.current
        ? await isProcessAlive.current(pid)
        : null;
    if (alive === null) {
      continue;
    }
    if (alive === true) {
      deadSince.delete(deadKey);
      continue;
    }
    const firstSeen = deadSince.get(deadKey) ?? nowMs;
    deadSince.set(deadKey, firstSeen);
    if (nowMs - firstSeen < staleAfterMs) {
      continue;
    }
    apply({
      toolId: null,
      task: {
        ...task,
        status: "failed",
        error:
          typeof task.error === "string"
            ? task.error
            : "后台任务进程异常退出（未收到完成通知）",
        endTime: task.endTime ?? nowMs,
      },
      source: "registry",
    });
  }
}

/**
 * App 级 registry watcher（真机修订）：不再挂 composer strip、不再只探测
 * 当前活跃会话——改为枚举 backgroundTaskStore 里所有 runningCount > 0 的
 * 会话逐个 probe。用户切走会话后，原会话的终态依然被探测并经 sink 全路径
 * 回写（store + 时间线卡片 + pill + 会话行呼吸灯）。挂载点在 useThreadEventHandlers
 * （与 sink 注册同层，sink 必在）。
 */
export function useBackgroundTaskRegistryWatcherForRunningThreads(
  options: Pick<
    BackgroundTaskRegistryWatcherOptions,
    "staleAfterMs" | "pollMs" | "readFile" | "isProcessAlive" | "onApply"
  > = {},
): void {
  const {
    staleAfterMs = DEFAULT_STALE_MS,
    pollMs = DEFAULT_POLL_MS,
    readFile = readWorkspaceFile,
    isProcessAlive,
    onApply,
  } = options;
  const readFileRef = useRef(readFile);
  const isProcessAliveRef = useRef(isProcessAlive);
  const onApplyRef = useRef(onApply);
  readFileRef.current = readFile;
  isProcessAliveRef.current = isProcessAlive;
  onApplyRef.current = onApply;
  const deadSinceRef = useRef(new Map<string, number>());

  useEffect(() => {
    const deadSince = deadSinceRef.current;
    const applyFor = new Map<string, RegistryApply>();
    const applyForThread = (
      workspaceId: string,
      threadId: string,
    ): RegistryApply => {
      const key = `${workspaceId}\u0000${threadId}`;
      let apply = applyFor.get(key);
      if (!apply) {
        apply = createRegistryApply(workspaceId, threadId, onApplyRef);
        applyFor.set(key, apply);
      }
      return apply;
    };

    const probe = async (): Promise<void> => {
      const runningScopes = listBackgroundTaskRunningCounts().filter(
        (entry) => entry.runningCount > 0,
      );
      for (const scope of runningScopes) {
        await probeThreadTasks({
          workspaceId: scope.workspaceId,
          threadId: scope.threadId,
          apply: applyForThread(scope.workspaceId, scope.threadId),
          deadSince,
          readFile: readFileRef,
          isProcessAlive: isProcessAliveRef,
          staleAfterMs,
        });
      }
    };

    const timer = window.setInterval(() => {
      void probe();
    }, pollMs);
    void probe();
    return () => {
      window.clearInterval(timer);
      deadSince.clear();
    };
  }, [pollMs, staleAfterMs]);
}

/** 3.2 面板「查看日志」：reveal 输出文件；日志字节内容 tail 归 P2 2.3。 */
export async function revealBackgroundTaskLog(
  outputPath: string,
): Promise<void> {
  await revealInFileManager(outputPath);
}
