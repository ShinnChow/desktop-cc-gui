import type { EngineType } from "../../../types";
import type { MutableRefObject } from "react";
import type { TFunction } from "i18next";
import type { ConversationItem, WorkspaceInfo } from "../../../types";
import type { UseThreadMessagingOptions } from "./threadMessagingTypes";
import {
  getWorkspaceFiles as getWorkspaceFilesService,
  listExternalSpecTree as listExternalSpecTreeService,
} from "../../../services/tauri";
import { getClientStoreSync } from "../../../services/clientStorage";
import { normalizeSpecRootInput } from "../../spec/pathUtils";

const SPEC_ROOT_PRIORITY_MARKER = "[Spec Root Priority]";
const SPEC_ROOT_SESSION_MARKER = "[Session Spec Link]";
const SESSION_SPEC_PROBE_TIMEOUT_MS = 1_200;

export type SessionSpecLinkSource = "custom" | "default";
export type SessionSpecProbeStatus = "visible" | "invalid" | "permissionDenied" | "malformed";

export type SessionSpecLinkContext = {
  source: SessionSpecLinkSource;
  rootPath: string;
  status: SessionSpecProbeStatus;
  reason: string | null;
  checkedAt: number;
};

export function shouldProbeSessionSpecForEngine(engine: EngineType): boolean {
  // Spec-root priority injection is currently codex-only. Other engines
  // should not block first-turn send on external spec tree probing.
  return engine === "codex";
}

export function resolveWorkspaceSpecRoot(workspaceId: string): string | null {
  const value = getClientStoreSync<string | null>("app", `specHub.specRoot.${workspaceId}`);
  return normalizeSpecRootInput(value);
}

export function buildDefaultSpecRootPath(workspacePath: string): string {
  const trimmed = workspacePath.trim();
  if (!trimmed) {
    return "openspec";
  }
  const normalized = trimmed.replace(/[\\/]+$/, "");
  const useBackslash = normalized.includes("\\") && !normalized.includes("/");
  return `${normalized}${useBackslash ? "\\" : "/"}openspec`;
}

export function normalizeExtendedWindowsPath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${path.slice("\\\\?\\UNC\\".length)}`;
  }
  if (path.startsWith("\\\\?\\")) {
    return path.slice("\\\\?\\".length);
  }
  if (path.startsWith("//?/UNC/")) {
    return `//${path.slice("//?/UNC/".length)}`;
  }
  if (path.startsWith("//?/")) {
    return path.slice("//?/".length);
  }
  return path;
}

export function isAbsoluteHostPath(path: string): boolean {
  const normalized = normalizeExtendedWindowsPath(path);
  if (normalized.startsWith("/")) {
    return true;
  }
  if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return true;
  }
  if (/^\\\\[^\\]+\\[^\\]+/.test(normalized)) {
    return true;
  }
  if (/^\/\/[^/]+\/[^/]+/.test(normalized)) {
    return true;
  }
  return false;
}

export function toFileUriFromAbsolutePath(path: string): string {
  const normalized = normalizeExtendedWindowsPath(path).replace(/\\/g, "/");
  const encodedPath = encodeURI(normalized);
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodedPath}`;
  }
  if (normalized.startsWith("//")) {
    return `file:${encodedPath}`;
  }
  return `file://${encodedPath}`;
}

function classifySpecProbeError(errorMessage: string): SessionSpecProbeStatus {
  if (/(permission denied|operation not permitted|eacces|eperm)/i.test(errorMessage)) {
    return "permissionDenied";
  }
  return "invalid";
}

function hasOpenSpecStructure(
  directories: string[],
  files: string[],
): { ok: boolean; reason: string | null } {
  const hasChangesDir = directories.includes("openspec/changes");
  const hasSpecsDir = directories.includes("openspec/specs");
  if (!hasChangesDir || !hasSpecsDir) {
    return {
      ok: false,
      reason: "Missing required openspec/changes or openspec/specs directory.",
    };
  }
  const hasChangeArtifact = files.some(
    (entry) =>
      entry.startsWith("openspec/changes/") &&
      (entry.endsWith("/proposal.md") || entry.endsWith("/tasks.md") || entry.endsWith("/design.md")),
  );
  if (!hasChangeArtifact) {
    return {
      ok: false,
      reason: "Missing expected change artifacts under openspec/changes.",
    };
  }
  return { ok: true, reason: null };
}

export async function probeSessionSpecLink(
  workspaceId: string,
  workspacePath: string,
  source: SessionSpecLinkSource,
  rootPath: string,
): Promise<SessionSpecLinkContext> {
  try {
    const snapshot =
      source === "custom"
        ? await listExternalSpecTreeService(workspaceId, rootPath)
        : await getWorkspaceFilesService(workspaceId);
    const structure = hasOpenSpecStructure(snapshot.directories, snapshot.files);
    if (!structure.ok) {
      return {
        source,
        rootPath,
        status: "malformed",
        reason: structure.reason,
        checkedAt: Date.now(),
      };
    }
    return {
      source,
      rootPath: source === "custom" ? rootPath : buildDefaultSpecRootPath(workspacePath),
      status: "visible",
      reason: null,
      checkedAt: Date.now(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source,
      rootPath,
      status: classifySpecProbeError(message),
      reason: message,
      checkedAt: Date.now(),
    };
  }
}

export async function probeSessionSpecLinkWithTimeout(
  workspaceId: string,
  workspacePath: string,
  source: SessionSpecLinkSource,
  rootPath: string,
): Promise<SessionSpecLinkContext> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<SessionSpecLinkContext>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          source,
          rootPath,
          status: "invalid",
          reason: `Spec root probe timed out after ${SESSION_SPEC_PROBE_TIMEOUT_MS}ms`,
          checkedAt: Date.now(),
        });
      }, SESSION_SPEC_PROBE_TIMEOUT_MS);
    });
    return await Promise.race([
      probeSessionSpecLink(workspaceId, workspacePath, source, rootPath),
      timeoutPromise,
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export function buildCodexTextWithSpecRootPriority(
  text: string,
  sessionSpecLink: SessionSpecLinkContext,
): string {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return text;
  }
  if (trimmedText.includes(SPEC_ROOT_PRIORITY_MARKER) || trimmedText.includes(SPEC_ROOT_SESSION_MARKER)) {
    return text;
  }
  const statusHint = `${SPEC_ROOT_SESSION_MARKER} source=${sessionSpecLink.source}; status=${sessionSpecLink.status}; root=${sessionSpecLink.rootPath}.`;
  const policyHint =
    sessionSpecLink.status === "visible"
      ? `${SPEC_ROOT_PRIORITY_MARKER} Active external OpenSpec root: ${sessionSpecLink.rootPath}. When checking spec visibility or reading specs, verify and prioritize this root first, then fallback to workspace/openspec and sibling conventions. Do not conclude 'missing spec' before checking this external root.`
      : `${SPEC_ROOT_PRIORITY_MARKER} Explicit session spec link is currently unusable (status=${sessionSpecLink.status}, root=${sessionSpecLink.rootPath}). Do not silently fallback to inferred paths for visibility verdicts. First report this link status and provide remediation (rebind or restore default), then continue after repair.`;
  const reasonHint = sessionSpecLink.reason ? `Probe reason: ${sessionSpecLink.reason}` : "";
  const systemHint = [statusHint, policyHint, reasonHint].filter(Boolean).join(" ");
  if (/\[User Input\]\s*/.test(trimmedText)) {
    return `[System] ${systemHint}\n${trimmedText}`;
  }
  return `[System] ${systemHint}\n[User Input] ${trimmedText}`;
}

export type SessionSpecSendContext = {
  sessionSpecLinkByThreadRef: MutableRefObject<
    Map<string, SessionSpecLinkContext>
  >;
  onDebug: UseThreadMessagingOptions["onDebug"];
  dispatch: UseThreadMessagingOptions["dispatch"];
  getCustomName: UseThreadMessagingOptions["getCustomName"];
  t: TFunction;
};

export async function probeSessionSpecLinkForSend(
  ctx: SessionSpecSendContext,
  args: {
    workspace: WorkspaceInfo;
    threadId: string;
    resolvedEngine: EngineType;
    threadItems: ConversationItem[];
    customSpecRoot: string | null;
    finalText: string;
  },
): Promise<{
  sessionSpecLink: SessionSpecLinkContext | null;
  codexEffectiveText: string;
}> {
  const { sessionSpecLinkByThreadRef, onDebug, dispatch, getCustomName, t } =
    ctx;
  const {
    workspace,
    threadId,
    resolvedEngine,
    threadItems,
    customSpecRoot,
    finalText,
  } = args;
  const sessionSpecKey = `${workspace.id}:${threadId}`;
  let sessionSpecLink =
    sessionSpecLinkByThreadRef.current.get(sessionSpecKey) ?? null;
  const shouldProbeSessionSpecLink =
    shouldProbeSessionSpecForEngine(resolvedEngine) &&
    Boolean(customSpecRoot) &&
    (threadItems.length === 0 || !sessionSpecLink);
  if (shouldProbeSessionSpecLink && customSpecRoot) {
    const probeStartAt = Date.now();
    sessionSpecLink = await probeSessionSpecLinkWithTimeout(
      workspace.id,
      workspace.path,
      "custom",
      customSpecRoot,
    );
    const probeDurationMs = Date.now() - probeStartAt;
    sessionSpecLinkByThreadRef.current.set(
      sessionSpecKey,
      sessionSpecLink,
    );
    onDebug?.({
      id: `${Date.now()}-spec-root-probe`,
      timestamp: Date.now(),
      source: "client",
      label: "specRoot/probe",
      payload: {
        workspaceId: workspace.id,
        threadId,
        engine: resolvedEngine,
        source: "custom",
        rootPath: customSpecRoot,
        status: sessionSpecLink.status,
        reason: sessionSpecLink.reason,
        durationMs: probeDurationMs,
      },
    });
  }
  const shouldInjectSpecRootHintInPrompt =
    resolvedEngine === "codex" &&
    Boolean(sessionSpecLink) &&
    threadItems.length === 0;
  const codexEffectiveText =
    shouldInjectSpecRootHintInPrompt && sessionSpecLink
      ? buildCodexTextWithSpecRootPriority(finalText, sessionSpecLink)
      : finalText;
  const shouldInjectSpecRootCard =
    resolvedEngine === "codex" &&
    Boolean(sessionSpecLink) &&
    threadItems.length === 0;
  if (shouldInjectSpecRootCard && sessionSpecLink) {
    const statusLabel = sessionSpecLink.status;
    const priorityDetail =
      sessionSpecLink.status === "visible"
        ? t("threads.specRootContext.priorityDetail")
        : "Linked root is not usable. Resolve link before relying on fallback inference.";
    const entries: {
      kind: "read" | "search" | "list" | "run";
      label: string;
      detail?: string;
    }[] = [
      {
        kind: "list",
        label: t("threads.specRootContext.activeRoot"),
        detail: sessionSpecLink.rootPath,
      },
      {
        kind: "list",
        label: "Probe status",
        detail: statusLabel,
      },
      {
        kind: "read",
        label: t("threads.specRootContext.priorityLabel"),
        detail: priorityDetail,
      },
    ];
    if (sessionSpecLink.reason) {
      entries.push({
        kind: "read",
        label: "Failure reason",
        detail: sessionSpecLink.reason,
      });
    }
    if (sessionSpecLink.status !== "visible") {
      entries.push(
        {
          kind: "run",
          label: "/spec-root rebind",
          detail: "Rebind to latest Spec Hub path and re-probe.",
        },
        {
          kind: "run",
          label: "/spec-root default",
          detail:
            "Restore workspace default openspec path and re-probe.",
        },
      );
    }
    dispatch({
      type: "upsertItem",
      workspaceId: workspace.id,
      threadId,
      item: {
        id: `spec-root-context-${threadId}`,
        kind: "explore",
        status: "explored",
        title: t("threads.specRootContext.title"),
        collapsible: true,
        mergeKey: "spec-root-context",
        entries,
      },
      hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
    });
  }
  return { sessionSpecLink, codexEffectiveText };
}
