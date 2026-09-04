export const CLIENT_UI_VISIBILITY_STORE = "app";
export const CLIENT_UI_VISIBILITY_KEY = "clientUiVisibility";
export const CLIENT_UI_VISIBILITY_CHANGED_EVENT =
  "app:client-ui-visibility-changed";

export const CLIENT_UI_PANEL_IDS = [
  "topSessionTabs",
  "topRunControls",
  "topToolControls",
  "rightActivityToolbar",
  "bottomActivityPanel",
  "cornerStatusIndicator",
  "globalRuntimeNoticeDock",
] as const;

export type ClientUiPanelId = (typeof CLIENT_UI_PANEL_IDS)[number];

export const CLIENT_UI_CONTROL_IDS = [
  "topRun.start",
  "topTool.openWorkspace",
  "topTool.runtimeConsole",
  "topTool.terminal",
  "topTool.focus",
  "topTool.browserDock",
  "topTool.rightPanel",
  "topTool.clientDocumentation",
  "rightToolbar.activity",
  "rightToolbar.projectMap",
  "rightToolbar.radar",
  "rightToolbar.git",
  "rightToolbar.files",
  "rightToolbar.search",
  "rightToolbar.notes",
  "bottomActivity.tasks",
  "bottomActivity.agents",
  "bottomActivity.checkpoint",
  "bottomActivity.checkpointDetails",
  "bottomActivity.governanceEvidence",
  "cornerStatus.messageAnchors",
] as const;

export type ClientUiControlId = (typeof CLIENT_UI_CONTROL_IDS)[number];

export type ClientUiVisibilityPreference = {
  panels: Partial<Record<ClientUiPanelId, boolean>>;
  controls: Partial<Record<ClientUiControlId, boolean>>;
};

export type ClientUiVisibilityIconKey =
  | "activity"
  | "appWindow"
  | "bot"
  | "bookOpen"
  | "construction"
  | "fileEdit"
  | "focus"
  | "folder"
  | "gitBranch"
  | "globe"
  | "info"
  | "layoutList"
  | "listChecks"
  | "messageSquareQuote"
  | "messageSquareText"
  | "panelBottom"
  | "panelRightOpen"
  | "panelTop"
  | "play"
  | "search"
  | "terminal"
  | "notebookPen";

export type ClientUiPanelDefinition = {
  id: ClientUiPanelId;
  labelKey: string;
  descriptionKey: string;
  iconKey: ClientUiVisibilityIconKey;
  controls: readonly ClientUiControlId[];
};

export type ClientUiControlDefinition = {
  id: ClientUiControlId;
  parentPanelId: ClientUiPanelId;
  labelKey: string;
  descriptionKey: string;
  iconKey: ClientUiVisibilityIconKey;
};

export type ClientUiVisibilityQueries = {
  preference: ClientUiVisibilityPreference;
  isPanelVisible: (panelId: ClientUiPanelId) => boolean;
  isControlVisible: (controlId: ClientUiControlId) => boolean;
  isControlPreferenceVisible: (controlId: ClientUiControlId) => boolean;
};

/**
 * Core chrome that must stay visible. Some Windows clients persisted
 * topToolControls/rightActivityToolbar as false and "lost" the top-right menu
 * and right toolbar; product default is always on.
 *
 * topSessionTabs is not essential: hide/show is a user appearance preference.
 */
export const ESSENTIAL_CLIENT_UI_PANELS: readonly ClientUiPanelId[] = [
  "topToolControls",
  "rightActivityToolbar",
] as const;

export const DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE: ClientUiVisibilityPreference = {
  panels: {
    topToolControls: true,
    rightActivityToolbar: true,
  },
  controls: {
    "topTool.clientDocumentation": false,
    "bottomActivity.checkpointDetails": false,
    "bottomActivity.governanceEvidence": false,
  },
};

export const CLIENT_UI_CONTROL_REGISTRY: readonly ClientUiControlDefinition[] = [
  {
    id: "topRun.start",
    parentPanelId: "topRunControls",
    labelKey: "settings.clientUiVisibility.controls.topRunStart",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topRunStart",
    iconKey: "play",
  },
  {
    id: "topTool.openWorkspace",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolOpenWorkspace",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolOpenWorkspace",
    iconKey: "appWindow",
  },
  {
    id: "topTool.runtimeConsole",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolRuntimeConsole",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolRuntimeConsole",
    iconKey: "construction",
  },
  {
    id: "topTool.terminal",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolTerminal",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolTerminal",
    iconKey: "terminal",
  },
  {
    id: "topTool.focus",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolFocus",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolFocus",
    iconKey: "focus",
  },
  {
    id: "topTool.browserDock",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolBrowserDock",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolBrowserDock",
    iconKey: "globe",
  },
  {
    id: "topTool.rightPanel",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolRightPanel",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolRightPanel",
    iconKey: "panelRightOpen",
  },
  {
    id: "topTool.clientDocumentation",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolClientDocumentation",
    descriptionKey:
      "settings.clientUiVisibility.controlDescriptions.topToolClientDocumentation",
    iconKey: "bookOpen",
  },
  {
    id: "rightToolbar.activity",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarActivity",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarActivity",
    iconKey: "activity",
  },
  {
    id: "rightToolbar.projectMap",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarProjectMap",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarProjectMap",
    iconKey: "globe",
  },
  {
    id: "rightToolbar.radar",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarRadar",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarRadar",
    iconKey: "layoutList",
  },
  {
    id: "rightToolbar.git",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarGit",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarGit",
    iconKey: "gitBranch",
  },
  {
    id: "rightToolbar.files",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarFiles",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarFiles",
    iconKey: "folder",
  },
  {
    id: "rightToolbar.search",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarSearch",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarSearch",
    iconKey: "search",
  },
  {
    id: "rightToolbar.notes",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarNotes",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarNotes",
    iconKey: "notebookPen",
  },
  {
    id: "bottomActivity.tasks",
    parentPanelId: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.controls.bottomActivityTasks",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.bottomActivityTasks",
    iconKey: "listChecks",
  },
  {
    id: "bottomActivity.agents",
    parentPanelId: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.controls.bottomActivityAgents",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.bottomActivityAgents",
    iconKey: "bot",
  },
  {
    id: "bottomActivity.checkpoint",
    parentPanelId: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.controls.bottomActivityCheckpoint",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.bottomActivityCheckpoint",
    iconKey: "fileEdit",
  },
  {
    id: "bottomActivity.governanceEvidence",
    parentPanelId: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.controls.bottomActivityGovernanceEvidence",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.bottomActivityGovernanceEvidence",
    iconKey: "construction",
  },
  {
    id: "bottomActivity.checkpointDetails",
    parentPanelId: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.controls.bottomActivityCheckpointDetails",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.bottomActivityCheckpointDetails",
    iconKey: "layoutList",
  },
  {
    id: "cornerStatus.messageAnchors",
    parentPanelId: "cornerStatusIndicator",
    labelKey: "settings.clientUiVisibility.controls.cornerStatusMessageAnchors",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.cornerStatusMessageAnchors",
    iconKey: "messageSquareQuote",
  },
] as const;

const controlDefinitionById = new Map<ClientUiControlId, ClientUiControlDefinition>(
  CLIENT_UI_CONTROL_REGISTRY.map((definition) => [definition.id, definition]),
);

const LEGACY_CLIENT_UI_CONTROL_ALIASES: Record<string, ClientUiControlId> = {
  "bottomActivity.edits": "bottomActivity.checkpoint",
};

export const CLIENT_UI_PANEL_REGISTRY: readonly ClientUiPanelDefinition[] = [
  {
    id: "topSessionTabs",
    labelKey: "settings.clientUiVisibility.panels.topSessionTabs",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.topSessionTabs",
    iconKey: "panelTop",
    controls: [],
  },
  {
    id: "topRunControls",
    labelKey: "settings.clientUiVisibility.panels.topRunControls",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.topRunControls",
    iconKey: "play",
    controls: ["topRun.start"],
  },
  {
    id: "topToolControls",
    labelKey: "settings.clientUiVisibility.panels.topToolControls",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.topToolControls",
    iconKey: "terminal",
    controls: [
      "topTool.openWorkspace",
      "topTool.runtimeConsole",
      "topTool.terminal",
      "topTool.focus",
      "topTool.browserDock",
      "topTool.rightPanel",
      "topTool.clientDocumentation",
    ],
  },
  {
    id: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.panels.rightActivityToolbar",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.rightActivityToolbar",
    iconKey: "activity",
    controls: [
      "rightToolbar.activity",
      "rightToolbar.projectMap",
      "rightToolbar.radar",
      "rightToolbar.git",
      "rightToolbar.files",
      "rightToolbar.search",
      "rightToolbar.notes",
    ],
  },
  {
    id: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.panels.bottomActivityPanel",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.bottomActivityPanel",
    iconKey: "panelBottom",
    controls: [
      "bottomActivity.tasks",
      "bottomActivity.agents",
      "bottomActivity.checkpoint",
      "bottomActivity.checkpointDetails",
      "bottomActivity.governanceEvidence",
    ],
  },
  {
    id: "cornerStatusIndicator",
    labelKey: "settings.clientUiVisibility.panels.cornerStatusIndicator",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.cornerStatusIndicator",
    iconKey: "messageSquareText",
    controls: [
      "cornerStatus.messageAnchors",
    ],
  },
  {
    id: "globalRuntimeNoticeDock",
    labelKey: "settings.clientUiVisibility.panels.globalRuntimeNoticeDock",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.globalRuntimeNoticeDock",
    iconKey: "info",
    controls: [],
  },
] as const;

const panelIdSet = new Set<string>(CLIENT_UI_PANEL_IDS);
const controlIdSet = new Set<string>(CLIENT_UI_CONTROL_IDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeBooleanMap<TId extends string>(
  value: unknown,
  knownIds: ReadonlySet<string>,
): Partial<Record<TId, boolean>> {
  if (!isRecord(value)) {
    return {};
  }
  const normalized: Partial<Record<TId, boolean>> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!knownIds.has(key) || typeof rawValue !== "boolean") {
      continue;
    }
    normalized[key as TId] = rawValue;
  }
  return normalized;
}

function normalizeControlBooleanMap(
  value: unknown,
): Partial<Record<ClientUiControlId, boolean>> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized = normalizeBooleanMap<ClientUiControlId>(value, controlIdSet);

  for (const [legacyId, canonicalId] of Object.entries(LEGACY_CLIENT_UI_CONTROL_ALIASES)) {
    if (typeof value[legacyId] !== "boolean" || canonicalId in normalized) {
      continue;
    }
    normalized[canonicalId] = value[legacyId] as boolean;
  }

  return normalized;
}

export function normalizeClientUiVisibilityPreference(
  value: unknown,
): ClientUiVisibilityPreference {
  if (!isRecord(value)) {
    return {
      panels: { ...DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE.panels },
      controls: { ...DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE.controls },
    };
  }
  const panels: Partial<Record<ClientUiPanelId, boolean>> = {
    ...DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE.panels,
    ...normalizeBooleanMap<ClientUiPanelId>(value.panels, panelIdSet),
  };
  // Essential chrome cannot stay off after normalize (repair bad persisted prefs).
  for (const panelId of ESSENTIAL_CLIENT_UI_PANELS) {
    panels[panelId] = true;
  }
  return {
    panels,
    controls: {
      ...DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE.controls,
      ...normalizeControlBooleanMap(value.controls),
    },
  };
}

export function isClientUiPanelVisible(
  preference: ClientUiVisibilityPreference,
  panelId: ClientUiPanelId,
): boolean {
  if ((ESSENTIAL_CLIENT_UI_PANELS as readonly string[]).includes(panelId)) {
    return true;
  }
  return preference.panels[panelId] !== false;
}

export function isClientUiControlPreferenceVisible(
  preference: ClientUiVisibilityPreference,
  controlId: ClientUiControlId,
): boolean {
  return preference.controls[controlId] !== false;
}

export function isClientUiControlVisible(
  preference: ClientUiVisibilityPreference,
  controlId: ClientUiControlId,
): boolean {
  const definition = controlDefinitionById.get(controlId);
  if (!definition) {
    return true;
  }
  return (
    isClientUiPanelVisible(preference, definition.parentPanelId) &&
    isClientUiControlPreferenceVisible(preference, controlId)
  );
}

export function setClientUiPanelVisibility(
  preference: ClientUiVisibilityPreference,
  panelId: ClientUiPanelId,
  visible: boolean,
): ClientUiVisibilityPreference {
  return normalizeClientUiVisibilityPreference({
    ...preference,
    panels: {
      ...preference.panels,
      [panelId]: visible,
    },
  });
}

export function setClientUiControlVisibility(
  preference: ClientUiVisibilityPreference,
  controlId: ClientUiControlId,
  visible: boolean,
): ClientUiVisibilityPreference {
  return normalizeClientUiVisibilityPreference({
    ...preference,
    controls: {
      ...preference.controls,
      [controlId]: visible,
    },
  });
}

export function createClientUiVisibilityQueries(
  preference: ClientUiVisibilityPreference,
): ClientUiVisibilityQueries {
  const normalizedPreference = normalizeClientUiVisibilityPreference(preference);
  return {
    preference: normalizedPreference,
    isPanelVisible: (panelId) =>
      isClientUiPanelVisible(normalizedPreference, panelId),
    isControlVisible: (controlId) =>
      isClientUiControlVisible(normalizedPreference, controlId),
    isControlPreferenceVisible: (controlId) =>
      isClientUiControlPreferenceVisible(normalizedPreference, controlId),
  };
}



export function getClientUiControlDefinition(
  controlId: ClientUiControlId,
): ClientUiControlDefinition {
  return controlDefinitionById.get(controlId)!;
}
