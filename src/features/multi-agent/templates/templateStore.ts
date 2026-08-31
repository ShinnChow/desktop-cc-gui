import { useSyncExternalStore } from "react";

import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import {
  BUILTIN_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  LEGACY_BUILTIN_TEMPLATE_IDS,
} from "./builtin";
import type {
  CollaborationTemplate,
  CollaborationTemplateStage,
  TemplateCatalog,
} from "./types";
import { emptyTarget } from "./types";

const STORE = "composer" as const;
const KEY = "multiAgentTemplateCatalog";

type PersistedCatalog = {
  selectedId?: string;
  defaultId?: string;
  custom?: CollaborationTemplate[];
};

const listeners = new Set<() => void>();

let memory: TemplateCatalog = {
  selectedId: DEFAULT_TEMPLATE_ID,
  defaultId: DEFAULT_TEMPLATE_ID,
  custom: [],
};

type CatalogSnapshot = {
  selectedId: string;
  defaultId: string;
  templates: CollaborationTemplate[];
};

/** 快照缓存：useSyncExternalStore 要求无变更时引用稳定 */
let catalogSnapshot: CatalogSnapshot | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function migrateStage(raw: unknown): CollaborationTemplateStage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : null;
  const title = typeof row.title === "string" ? row.title : null;
  if (!id || !title) return null;
  // 新形态：target 对象
  if (row.target && typeof row.target === "object") {
    const target = row.target as Record<string, unknown>;
    return {
      id,
      title,
      rolePrompt: typeof row.rolePrompt === "string" ? row.rolePrompt : "",
      accessMode: row.accessMode === "read-only" ? "read-only" : "current",
      requiresApproval: row.requiresApproval === true,
      upstreamFeedMode:
        row.upstreamFeedMode === "full" ? "full" : "summary",
      personaAgentId:
        typeof row.personaAgentId === "string" ? row.personaAgentId : null,
      personaAgentName:
        typeof row.personaAgentName === "string" ? row.personaAgentName : null,
      personaAgentIcon:
        typeof row.personaAgentIcon === "string" ? row.personaAgentIcon : null,
      personaAgentPrompt:
        typeof row.personaAgentPrompt === "string"
          ? row.personaAgentPrompt
          : typeof row.personaPrompt === "string"
            ? row.personaPrompt
            : null,
      target: {
        engine: (typeof target.engine === "string"
          ? target.engine
          : "claude") as CollaborationTemplateStage["target"]["engine"],
        providerProfileId:
          typeof target.providerProfileId === "string"
            ? target.providerProfileId
            : null,
        modelCatalogEntryId:
          typeof target.modelCatalogEntryId === "string"
            ? target.modelCatalogEntryId
            : null,
        model: typeof target.model === "string" ? target.model : null,
        reasoningEffort:
          typeof target.reasoningEffort === "string"
            ? target.reasoningEffort
            : null,
        providerProfileNameSnapshot:
          typeof target.providerProfileNameSnapshot === "string"
            ? target.providerProfileNameSnapshot
            : null,
        providerProfileSource:
          typeof target.providerProfileSource === "string"
            ? target.providerProfileSource
            : null,
        runtimeCapabilityFingerprint:
          typeof target.runtimeCapabilityFingerprint === "string"
            ? target.runtimeCapabilityFingerprint
            : null,
      },
    };
  }
  // 旧形态：engine/model/reasoningEffort 平铺 → 升到 target
  const engine = (
    typeof row.engine === "string" ? row.engine : "claude"
  ) as CollaborationTemplateStage["target"]["engine"];
  return {
    id,
    title,
    rolePrompt: typeof row.rolePrompt === "string" ? row.rolePrompt : "",
    accessMode: row.accessMode === "read-only" ? "read-only" : "current",
    requiresApproval: row.requiresApproval === true,
    upstreamFeedMode: row.upstreamFeedMode === "full" ? "full" : "summary",
    personaAgentId:
      typeof row.personaAgentId === "string" ? row.personaAgentId : null,
    personaAgentName:
      typeof row.personaAgentName === "string" ? row.personaAgentName : null,
    personaAgentIcon:
      typeof row.personaAgentIcon === "string" ? row.personaAgentIcon : null,
    personaAgentPrompt:
      typeof row.personaAgentPrompt === "string"
        ? row.personaAgentPrompt
        : typeof row.personaPrompt === "string"
          ? row.personaPrompt
          : null,
    target: {
      ...emptyTarget(engine),
      engine,
      model: typeof row.model === "string" ? row.model : null,
      modelCatalogEntryId:
        typeof row.modelCatalogEntryId === "string"
          ? row.modelCatalogEntryId
          : null,
      reasoningEffort:
        typeof row.reasoningEffort === "string" ? row.reasoningEffort : null,
    },
  };
}

function resolveTemplateId(id: string | undefined | null): string {
  const raw = typeof id === "string" ? id.trim() : "";
  if (!raw) return DEFAULT_TEMPLATE_ID;
  return LEGACY_BUILTIN_TEMPLATE_IDS[raw] ?? raw;
}

function readPersisted(): TemplateCatalog {
  const raw = getClientStoreSync<PersistedCatalog>(STORE, KEY);
  const custom = Array.isArray(raw?.custom)
    ? raw!
        .custom.map((item) => {
          if (!item || typeof item !== "object" || !item.id || !item.name) {
            return null;
          }
          const stages = Array.isArray(item.stages)
            ? item.stages
                .map(migrateStage)
                .filter((s): s is CollaborationTemplateStage => Boolean(s))
            : [];
          if (stages.length === 0) return null;
          // 历史覆盖的旧内置 id 迁移到新 id，避免与新工厂模板撞车后不可见
          const migratedId = resolveTemplateId(String(item.id));
          return {
            ...item,
            id: migratedId,
            stages,
          } as CollaborationTemplate;
        })
        .filter((item): item is CollaborationTemplate => Boolean(item))
    : [];
  // 同 id 后写覆盖前写
  const byId = new Map<string, CollaborationTemplate>();
  for (const item of custom) byId.set(item.id, item);
  const defaultId = resolveTemplateId(raw?.defaultId);
  const selectedId = resolveTemplateId(
    typeof raw?.selectedId === "string" && raw.selectedId.trim()
      ? raw.selectedId
      : defaultId,
  );
  return {
    selectedId,
    defaultId,
    custom: Array.from(byId.values()),
  };
}

function persist(next: TemplateCatalog): void {
  memory = next;
  catalogSnapshot = null;
  writeClientStoreValue(STORE, KEY, {
    selectedId: next.selectedId,
    defaultId: next.defaultId,
    custom: next.custom,
  });
  emit();
}

// 首次 hydrate
memory = readPersisted();

export function listAllTemplates(): CollaborationTemplate[] {
  const customIds = new Set(memory.custom.map((item) => item.id));
  const builtins = BUILTIN_TEMPLATES.filter((item) => !customIds.has(item.id));
  return [...builtins, ...memory.custom];
}

export function getTemplateById(id: string | null | undefined): CollaborationTemplate {
  const all = listAllTemplates();
  return (
    all.find((item) => item.id === id) ??
    all.find((item) => item.id === memory.defaultId) ??
    BUILTIN_TEMPLATES[0]!
  );
}

export function getSelectedTemplate(): CollaborationTemplate {
  return getTemplateById(memory.selectedId);
}



export function getDefaultTemplateId(): string {
  return memory.defaultId;
}

export function selectTemplate(id: string): void {
  const exists = listAllTemplates().some((item) => item.id === id);
  if (!exists) return;
  persist({ ...memory, selectedId: id });
}

export function setDefaultTemplate(id: string): void {
  const exists = listAllTemplates().some((item) => item.id === id);
  if (!exists) return;
  persist({ ...memory, defaultId: id, selectedId: id });
}

/**
 * 保存用户模板。
 * - 内置 id 也可保存：以同 id 覆盖工厂默认（builtin=false 的本地版），无只读限制。
 * - 删覆盖后 listAllTemplates 会重新露出工厂模板。
 */
export function saveCustomTemplate(
  template: CollaborationTemplate,
): CollaborationTemplate {
  const now = Date.now();
  const nextTemplate: CollaborationTemplate = {
    ...template,
    // 一律按用户副本持久化；是否覆盖内置由 id 是否命中工厂表决定
    builtin: false,
    version: (template.version ?? 0) + 1,
    updatedAt: now,
    stages: template.stages.map((stage) => ({ ...stage })),
  };
  const without = memory.custom.filter((item) => item.id !== nextTemplate.id);
  persist({
    ...memory,
    selectedId: nextTemplate.id,
    custom: [...without, nextTemplate],
  });
  return nextTemplate;
}

/**
 * 删除用户副本。
 * - 若 id 命中工厂内置：删除覆盖后恢复工厂默认（允许）。
 * - 纯自定义 id：删除条目。
 * - 无本地副本时 no-op（工厂本体不可从磁盘删）。
 */
export function deleteCustomTemplate(id: string): void {
  const hadOverride = memory.custom.some((item) => item.id === id);
  if (!hadOverride) return;
  const custom = memory.custom.filter((item) => item.id !== id);
  const stillExists =
    custom.some((item) => item.id === id) ||
    BUILTIN_TEMPLATES.some((item) => item.id === id);
  const selectedId =
    memory.selectedId === id
      ? stillExists
        ? id
        : memory.defaultId === id
          ? DEFAULT_TEMPLATE_ID
          : memory.defaultId
      : memory.selectedId;
  const defaultId =
    memory.defaultId === id && !stillExists
      ? DEFAULT_TEMPLATE_ID
      : memory.defaultId;
  persist({ selectedId, defaultId, custom });
}

export function createBlankTemplate(): CollaborationTemplate {
  const id = `custom-${Date.now().toString(36)}`;
  return {
    id,
    name: "未命名模板",
    description: "",
    builtin: false,
    version: 0,
    updatedAt: Date.now(),
    stages: [
      {
        id: "plan",
        title: "规划",
        target: { ...emptyTarget("claude"), reasoningEffort: "high" },
        accessMode: "read-only",
        requiresApproval: true,
        rolePrompt: "",
      },
      {
        id: "implement",
        title: "实现",
        target: { ...emptyTarget("codex"), reasoningEffort: "medium" },
        accessMode: "current",
        requiresApproval: false,
        rolePrompt: "",
      },
      {
        id: "review",
        title: "审查",
        target: { ...emptyTarget("claude"), reasoningEffort: "medium" },
        accessMode: "read-only",
        requiresApproval: false,
        rolePrompt: "",
      },
    ],
  };
}

export function cloneStage(
  partial?: Partial<CollaborationTemplateStage>,
): CollaborationTemplateStage {
  return {
    id: partial?.id ?? `stage-${Date.now().toString(36)}`,
    title: partial?.title ?? "新环节",
    target: partial?.target
      ? { ...partial.target }
      : { ...emptyTarget("claude"), reasoningEffort: "medium" },
    accessMode: partial?.accessMode ?? "current",
    requiresApproval: partial?.requiresApproval ?? false,
    upstreamFeedMode: partial?.upstreamFeedMode === "full" ? "full" : "summary",
    rolePrompt: partial?.rolePrompt ?? "",
    personaAgentId: partial?.personaAgentId ?? null,
    personaAgentName: partial?.personaAgentName ?? null,
    personaAgentIcon: partial?.personaAgentIcon ?? null,
    personaAgentPrompt: partial?.personaAgentPrompt ?? null,
  };
}

export function subscribeTemplateCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSelectedTemplate(): CollaborationTemplate {
  return useSyncExternalStore(
    subscribeTemplateCatalog,
    getSelectedTemplate,
    () => BUILTIN_TEMPLATES[0]!,
  );
}

function getCatalogSnapshot(): CatalogSnapshot {
  if (
    catalogSnapshot &&
    catalogSnapshot.selectedId === memory.selectedId &&
    catalogSnapshot.defaultId === memory.defaultId
  ) {
    // custom 数组引用随 persist 替换；比对长度 + 尾 id 足够检测变更
    const live = listAllTemplates();
    if (
      catalogSnapshot.templates.length === live.length &&
      catalogSnapshot.templates.every((item, i) => item === live[i])
    ) {
      return catalogSnapshot;
    }
  }
  catalogSnapshot = {
    selectedId: memory.selectedId,
    defaultId: memory.defaultId,
    templates: listAllTemplates(),
  };
  return catalogSnapshot;
}

const SSR_CATALOG_SNAPSHOT: CatalogSnapshot = {
  selectedId: DEFAULT_TEMPLATE_ID,
  defaultId: DEFAULT_TEMPLATE_ID,
  templates: BUILTIN_TEMPLATES,
};

export function useTemplateCatalogSnapshot(): CatalogSnapshot {
  return useSyncExternalStore(
    subscribeTemplateCatalog,
    getCatalogSnapshot,
    () => SSR_CATALOG_SNAPSHOT,
  );
}
