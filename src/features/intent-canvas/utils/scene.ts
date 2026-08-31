import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import type {
  CanvasSemanticGraph,
  CanvasSemanticNode,
  IntentCanvasAiContext,
  IntentCanvasElementDigest,
  IntentCanvasOpenSource,
  IntentCanvasRelationDigest,
  IntentCanvasScene,
} from "../types";
import { isRecord, toJsonObject } from "./json";

type SeedShape = {
  type: "rectangle" | "text" | "arrow";
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  backgroundColor?: string;
  text?: string;
  fontSize?: number;
  containerId?: string | null;
  boundElementIds?: string[];
  startBindingId?: string | null;
  endBindingId?: string | null;
  strokeWidth?: number;
  roughness?: number;
};

type GraphNodePlacement = {
  node: CanvasSemanticNode;
  elementId: string;
  textElementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const EXCALIDRAW_RUNTIME_APP_STATE_KEYS = new Set(["collaborators"]);
const EXCALIDRAW_OBJECT_MAP_APP_STATE_KEYS = new Set(["selectedElementIds", "selectedGroupIds"]);
const GRAPH_NODE_WIDTH = 260;
const GRAPH_NODE_HEIGHT = 92;
const GRAPH_COLUMN_GAP = 340;
const GRAPH_ROW_GAP = 132;
const GENERATED_ELEMENT_ID_PREFIXES = [
  "intent-node-",
  "intent-node-text-",
  "intent-edge-",
  "intent-edge-label-",
];
const GENERATED_LEGACY_COLOR_REPLACEMENTS: Record<string, string> = {
  "#000": "#334155",
  "#000000": "#334155",
  "#0f172a": "#2563eb",
  "#111827": "#f8fafc",
  "#221a08": "#fff7ed",
  "#05252c": "#ecfeff",
  "#0b1d34": "#eff6ff",
  "#08261d": "#ecfdf5",
  "#082f2c": "#f0fdfa",
  "#1a2607": "#f7fee7",
  "#2b1d05": "#fffbeb",
  "#fef3c7": "#92400e",
  "#a5f3fc": "#0e7490",
  "#bfdbfe": "#1d4ed8",
  "#bbf7d0": "#047857",
  "#ccfbf1": "#0f766e",
  "#ecfccb": "#4d7c0f",
  "#e2e8f0": "#334155",
};

function inferBoundElementType(id: string): "text" | "arrow" {
  return id.startsWith("intent-node-text-") || id.startsWith("intent-edge-label-")
    ? "text"
    : "arrow";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function readElementLabel(element: Record<string, unknown>): string | null {
  const candidates = [element.text, element.originalText, element.label];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function buildSeedSkeleton(source: IntentCanvasOpenSource | null | undefined): SeedShape[] {
  const nodeTitle = source?.nodeTitle?.trim();
  const filePath = source?.filePath?.trim();
  const summary = source?.summary?.trim();
  if (nodeTitle || filePath) {
    const primaryLabel = nodeTitle || filePath || "Intent Node";
    const secondaryLabel = filePath && nodeTitle ? filePath : summary || "Describe the logic here";
    return [
      {
        type: "rectangle",
        x: 120,
        y: 160,
        width: 260,
        height: 92,
        strokeColor: "#2563eb",
        backgroundColor: "#eff6ff",
      },
      {
        type: "text",
        x: 130,
        y: 188,
        width: 230,
        height: 32,
        text: secondaryLabel,
        fontSize: 16,
        strokeColor: "#475569",
      },
      {
        type: "text",
        x: 130,
        y: 166,
        width: 230,
        height: 30,
        text: primaryLabel,
        fontSize: 22,
        strokeColor: "#1d4ed8",
      },
      {
        type: "arrow",
        x: 420,
        y: 205,
        width: 220,
        height: 0,
        strokeColor: "#0f172a",
      },
      {
        type: "rectangle",
        x: 680,
        y: 160,
        width: 260,
        height: 92,
        strokeColor: "#0f766e",
        backgroundColor: "#ecfdf5",
      },
      {
        type: "text",
        x: 700,
        y: 188,
        width: 220,
        height: 32,
        text: "Next Module",
        fontSize: 22,
        strokeColor: "#0f766e",
      },
    ];
  }

  return [
    {
      type: "rectangle",
      x: 120,
      y: 160,
      width: 260,
      height: 92,
      strokeColor: "#2563eb",
      backgroundColor: "#eff6ff",
    },
    {
      type: "text",
      x: 140,
      y: 188,
      width: 220,
      height: 32,
      text: "Auth Service",
      fontSize: 22,
      strokeColor: "#1d4ed8",
    },
    {
      type: "arrow",
      x: 420,
      y: 205,
      width: 220,
      height: 0,
      strokeColor: "#0f172a",
    },
    {
      type: "rectangle",
      x: 680,
      y: 160,
      width: 260,
      height: 92,
      strokeColor: "#0f766e",
      backgroundColor: "#ecfdf5",
    },
    {
      type: "text",
      x: 700,
      y: 188,
      width: 220,
      height: 32,
      text: "User DB",
      fontSize: 22,
      strokeColor: "#0f766e",
    },
  ];
}

function stableSeedHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

function createSeedShapeId(prefix: string, value: string): string {
  const safeValue = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `intent-${prefix}-${safeValue || "node"}-${stableSeedHash(value)}`;
}

function compactCanvasLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 44 ? `${normalized.slice(0, 41)}...` : normalized;
}

function getNodePathLabel(node: CanvasSemanticNode): string {
  const anchor = node.sourceAnchor;
  if (anchor?.kind === "relationship-node" || anchor?.kind === "code-symbol") {
    return compactCanvasLabel(anchor.filePath, node.summary ?? "");
  }
  return compactCanvasLabel(node.summary, "");
}

function getNodeRoleLabel(node: CanvasSemanticNode): string {
  const anchor = node.sourceAnchor;
  if (anchor?.kind === "relationship-node") {
    return compactCanvasLabel(anchor.nodeKind, node.kind);
  }
  if (anchor?.kind === "code-symbol") {
    return compactCanvasLabel(anchor.symbolKind, node.kind);
  }
  const roleMatch = node.summary?.match(/role:([^;]+)/);
  return compactCanvasLabel(roleMatch?.[1], node.kind);
}

function getNodePalette(node: CanvasSemanticNode, isCenterNode: boolean): {
  strokeColor: string;
  backgroundColor: string;
  textColor: string;
} {
  if (node.kind === "group") {
    return { strokeColor: "#d97706", backgroundColor: "#fff7ed", textColor: "#92400e" };
  }
  if (isCenterNode) {
    return { strokeColor: "#0891b2", backgroundColor: "#ecfeff", textColor: "#0e7490" };
  }
  const role = getNodeRoleLabel(node).toLowerCase();
  if (role.includes("controller")) {
    return { strokeColor: "#2563eb", backgroundColor: "#eff6ff", textColor: "#1d4ed8" };
  }
  if (role.includes("service")) {
    return { strokeColor: "#059669", backgroundColor: "#ecfdf5", textColor: "#047857" };
  }
  if (role.includes("hook")) {
    return { strokeColor: "#0d9488", backgroundColor: "#f0fdfa", textColor: "#0f766e" };
  }
  if (role.includes("test")) {
    return { strokeColor: "#65a30d", backgroundColor: "#f7fee7", textColor: "#4d7c0f" };
  }
  if (role.includes("config") || role.includes("manifest")) {
    return { strokeColor: "#d97706", backgroundColor: "#fffbeb", textColor: "#92400e" };
  }
  return { strokeColor: "#64748b", backgroundColor: "#f8fafc", textColor: "#334155" };
}

function getEdgeColor(edge: CanvasSemanticGraph["edges"][number]): string {
  if (edge.relationKind === "omitted") {
    return "#f59e0b";
  }
  if (edge.relationKind === "calls") {
    return "#22d3ee";
  }
  if (edge.relationKind === "imports") {
    return "#2dd4bf";
  }
  if (edge.relationKind === "tested_by") {
    return "#a3e635";
  }
  if (edge.relationKind === "configures") {
    return "#fbbf24";
  }
  return edge.direction === "in" ? "#60a5fa" : "#94a3b8";
}

function getGraphCenterNode(graph: CanvasSemanticGraph): CanvasSemanticNode {
  const centerNodeId = graph.importOptions?.centerNodeId;
  return graph.nodes.find((node) => node.id === centerNodeId)
    ?? graph.nodes.find((node) => node.summary?.includes("depth:0"))
    ?? graph.nodes[0]!;
}

function createGraphNodeShape(
  node: CanvasSemanticNode,
  placement: GraphNodePlacement,
  isCenterNode: boolean,
  boundArrowIds: string[],
): SeedShape[] {
  const palette = getNodePalette(node, isCenterNode);
  const title = compactCanvasLabel(node.label, "Relationship Node");
  const subtitle = getNodePathLabel(node);
  const roleLabel = getNodeRoleLabel(node);
  const summaryLabel = node.kind === "symbol" && node.summary
    ? node.summary.split(/\n|;\s*/).map((line) => line.trim()).filter(Boolean).slice(0, 3).join("\n")
    : null;
  const nodeText = [
    title,
    roleLabel ? `${roleLabel} · ${node.kind}` : node.kind,
    summaryLabel ?? subtitle,
  ].filter(Boolean).join("\n");
  return [
    {
      type: "rectangle",
      id: placement.elementId,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      strokeColor: palette.strokeColor,
      backgroundColor: palette.backgroundColor,
      boundElementIds: [placement.textElementId, ...boundArrowIds],
      strokeWidth: isCenterNode ? 3 : 2,
      roughness: 0,
    },
    {
      type: "text",
      id: placement.textElementId,
      x: placement.x + 14,
      y: placement.y + 16,
      width: placement.width - 28,
      height: placement.height - 28,
      text: nodeText,
      fontSize: isCenterNode ? 16 : 15,
      strokeColor: palette.textColor,
      containerId: placement.elementId,
    },
  ];
}

function createGraphEdgeShapes(
  graph: CanvasSemanticGraph,
  placements: Map<string, GraphNodePlacement>,
): SeedShape[] {
  const shapes: SeedShape[] = [];
  graph.edges.forEach((edge) => {
    const source = placements.get(edge.sourceNodeId);
    const target = placements.get(edge.targetNodeId);
    if (!source || !target) {
      return;
    }
    const sourceCenterX = source.x + source.width / 2;
    const sourceCenterY = source.y + source.height / 2;
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;
    const arrowId = createSeedShapeId("edge", `${graph.graphId}-${edge.id}`);
    const labelId = createSeedShapeId("edge-label", `${graph.graphId}-${edge.id}-${edge.label ?? edge.relationKind}`);
    const edgeColor = getEdgeColor(edge);
    shapes.push({
      type: "arrow",
      id: arrowId,
      x: sourceCenterX,
      y: sourceCenterY,
      width: targetCenterX - sourceCenterX,
      height: targetCenterY - sourceCenterY,
      strokeColor: edgeColor,
      startBindingId: source.elementId,
      endBindingId: target.elementId,
      boundElementIds: [labelId],
      strokeWidth: edge.relationKind === "calls" ? 3 : 2,
      roughness: 0,
    });
    shapes.push({
      type: "text",
      id: labelId,
      x: (sourceCenterX + targetCenterX) / 2 - 90,
      y: (sourceCenterY + targetCenterY) / 2 - 22,
      width: 180,
      height: 22,
      text: compactCanvasLabel(edge.label, edge.relationKind || "relation"),
      fontSize: 12,
      strokeColor: edgeColor,
      containerId: arrowId,
    });
  });
  return shapes;
}

function buildGraphSeedSkeleton(seedSemanticGraphs: CanvasSemanticGraph[] | undefined): SeedShape[] {
  const graph = seedSemanticGraphs?.find((candidate) => candidate.nodes.length > 0);
  if (!graph) {
    return [];
  }
  const centerNode = getGraphCenterNode(graph);
  const incomingIds = new Set(
    graph.edges
      .filter((edge) => edge.targetNodeId === centerNode.id && edge.sourceNodeId !== centerNode.id)
      .map((edge) => edge.sourceNodeId),
  );
  const outgoingIds = new Set(
    graph.edges
      .filter((edge) => edge.sourceNodeId === centerNode.id && edge.targetNodeId !== centerNode.id)
      .map((edge) => edge.targetNodeId),
  );
  const incomingNodes = graph.nodes.filter((node) => incomingIds.has(node.id));
  const outgoingNodes = graph.nodes.filter((node) => outgoingIds.has(node.id));
  const secondaryNodes = graph.nodes.filter((node) => (
    node.id !== centerNode.id && !incomingIds.has(node.id) && !outgoingIds.has(node.id)
  ));
  const maxLaneRows = Math.max(incomingNodes.length, outgoingNodes.length, 1);
  const centerY = 170 + Math.max(0, maxLaneRows - 1) * GRAPH_ROW_GAP / 2;
  const placements = new Map<string, GraphNodePlacement>();
  const placeNode = (node: CanvasSemanticNode, x: number, y: number) => {
    placements.set(node.id, {
      node,
      elementId: createSeedShapeId("node", `${graph.graphId}-${node.id}`),
      textElementId: createSeedShapeId("node-text", `${graph.graphId}-${node.id}`),
      x,
      y,
      width: GRAPH_NODE_WIDTH,
      height: node.kind === "symbol" ? 128 : GRAPH_NODE_HEIGHT,
    });
  };
  incomingNodes.forEach((node, index) => placeNode(node, 80, 130 + index * GRAPH_ROW_GAP));
  placeNode(centerNode, 80 + GRAPH_COLUMN_GAP, centerY);
  outgoingNodes.forEach((node, index) => {
    const lane = index % 2;
    const row = Math.floor(index / 2);
    placeNode(node, 80 + GRAPH_COLUMN_GAP * 2 + lane * 300, 130 + row * GRAPH_ROW_GAP);
  });
  secondaryNodes.forEach((node, index) => {
    placeNode(node, 80 + GRAPH_COLUMN_GAP + (index % 2) * GRAPH_COLUMN_GAP, centerY + 190 + Math.floor(index / 2) * GRAPH_ROW_GAP);
  });
  const boundArrowIdsByNodeId = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    const arrowId = createSeedShapeId("edge", `${graph.graphId}-${edge.id}`);
    const sourceArrowIds = boundArrowIdsByNodeId.get(edge.sourceNodeId) ?? [];
    const targetArrowIds = boundArrowIdsByNodeId.get(edge.targetNodeId) ?? [];
    sourceArrowIds.push(arrowId);
    targetArrowIds.push(arrowId);
    boundArrowIdsByNodeId.set(edge.sourceNodeId, sourceArrowIds);
    boundArrowIdsByNodeId.set(edge.targetNodeId, targetArrowIds);
  });
  const nodeShapes = Array.from(placements.values()).flatMap((placement) => (
    createGraphNodeShape(
      placement.node,
      placement,
      placement.node.id === centerNode.id,
      boundArrowIdsByNodeId.get(placement.node.id) ?? [],
    )
  ));
  return [
    ...createGraphEdgeShapes(graph, placements),
    ...nodeShapes,
  ];
}



function createElementId(index: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `intent-seed-${Date.now().toString(36)}-${index}`;
}

function createSeedElement(shape: SeedShape, index: number): OrderedExcalidrawElement {
  const baseElement = {
    id: shape.id ?? createElementId(index),
    type: shape.type,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    angle: 0,
    strokeColor: shape.strokeColor,
    backgroundColor: shape.backgroundColor ?? "transparent",
    fillStyle: "solid",
    strokeWidth: shape.strokeWidth ?? 2,
    strokeStyle: "solid",
    roughness: shape.roughness ?? 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: shape.type === "rectangle" ? { type: 3 } : null,
    seed: index + 1,
    version: 1,
    versionNonce: index + 100,
    isDeleted: false,
    boundElements: shape.boundElementIds?.length
      ? shape.boundElementIds.map((id) => ({
          id,
          type: inferBoundElementType(id),
        }))
      : null,
    updated: Date.now(),
    link: null,
    locked: false,
  };

  if (shape.type === "text") {
    return {
      ...baseElement,
      text: shape.text ?? "",
      originalText: shape.text ?? "",
      fontSize: shape.fontSize ?? 18,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      baseline: shape.fontSize ?? 18,
      containerId: shape.containerId ?? null,
      lineHeight: 1.25,
    } as unknown as OrderedExcalidrawElement;
  }

  if (shape.type === "arrow") {
    return {
      ...baseElement,
      points: [
        [0, 0],
        [shape.width, shape.height],
      ],
      startBinding: shape.startBindingId
        ? {
            elementId: shape.startBindingId,
            focus: 0,
            gap: 6,
          }
        : null,
      endBinding: shape.endBindingId
        ? {
            elementId: shape.endBindingId,
            focus: 0,
            gap: 6,
          }
        : null,
      startArrowhead: null,
      endArrowhead: "arrow",
      lastCommittedPoint: null,
      elbowed: false,
    } as unknown as OrderedExcalidrawElement;
  }

  return baseElement as unknown as OrderedExcalidrawElement;
}

function isIntentCanvasElement(value: unknown): value is OrderedExcalidrawElement {
  return isRecord(value) && typeof value.id === "string" && typeof value.type === "string";
}

function isGeneratedElementId(value: unknown): value is string {
  return typeof value === "string" && GENERATED_ELEMENT_ID_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isGeneratedNodeElement(value: Record<string, unknown>): boolean {
  return value.type === "rectangle" && typeof value.id === "string" && value.id.startsWith("intent-node-");
}

function isGeneratedNodeTextElement(value: Record<string, unknown>): boolean {
  return value.type === "text" && typeof value.id === "string" && value.id.startsWith("intent-node-text-");
}

function isGeneratedEdgeElement(value: Record<string, unknown>): boolean {
  return value.type === "arrow" && typeof value.id === "string" && value.id.startsWith("intent-edge-");
}

function isGeneratedEdgeLabelElement(value: Record<string, unknown>): boolean {
  return value.type === "text" && typeof value.id === "string" && value.id.startsWith("intent-edge-label-");
}

function repairGeneratedColor(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return GENERATED_LEGACY_COLOR_REPLACEMENTS[value.toLowerCase()] ?? value;
}

function getRecordNumber(value: Record<string, unknown>, key: string): number | null {
  const rawValue = value[key];
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

function getGeneratedElementText(value: Record<string, unknown> | null | undefined): string {
  const text = typeof value?.text === "string" ? value.text : "";
  const originalText = typeof value?.originalText === "string" ? value.originalText : "";
  return (text || originalText).trim();
}

function getBoundElementIds(value: Record<string, unknown>): string[] {
  if (!Array.isArray(value.boundElements)) {
    return [];
  }
  return value.boundElements.flatMap((element) => (
    isRecord(element) && typeof element.id === "string" ? [element.id] : []
  ));
}

function remapBindingElementId(value: unknown, idByOriginalId: ReadonlyMap<string, string>): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const elementId = typeof value.elementId === "string"
    ? idByOriginalId.get(value.elementId) ?? value.elementId
    : value.elementId;
  return {
    ...value,
    elementId,
  };
}

function remapBoundElements(value: unknown, idByOriginalId: ReadonlyMap<string, string>): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((element) => {
    if (!isRecord(element)) {
      return element;
    }
    const id = typeof element.id === "string"
      ? idByOriginalId.get(element.id) ?? element.id
      : element.id;
    return {
      ...element,
      id,
    };
  });
}

function findGeneratedNodeTextIndex(input: {
  records: Record<string, unknown>[];
  nodeIndex: number;
  pairedTextIndexes: ReadonlySet<number>;
}): number | null {
  const node = input.records[input.nodeIndex];
  if (!node) {
    return null;
  }
  const boundTextIndex = getBoundElementIds(node)
    .map((id) => input.records.findIndex((record, index) => (
      index !== input.nodeIndex
      && !input.pairedTextIndexes.has(index)
      && record.id === id
      && isGeneratedNodeTextElement(record)
    )))
    .find((index) => index >= 0);
  if (boundTextIndex !== undefined) {
    return boundTextIndex;
  }
  const nodeId = typeof node.id === "string" ? node.id : "";
  const containerTextIndex = input.records.findIndex((record, index) => (
    index !== input.nodeIndex
    && !input.pairedTextIndexes.has(index)
    && isGeneratedNodeTextElement(record)
    && record.containerId === nodeId
  ));
  if (containerTextIndex >= 0) {
    return containerTextIndex;
  }
  const nextRecord = input.records[input.nodeIndex + 1];
  if (
    nextRecord
    && !input.pairedTextIndexes.has(input.nodeIndex + 1)
    && isGeneratedNodeTextElement(nextRecord)
  ) {
    return input.nodeIndex + 1;
  }
  const nodeX = getRecordNumber(node, "x");
  const nodeY = getRecordNumber(node, "y");
  if (nodeX === null || nodeY === null) {
    return null;
  }
  let closestIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  input.records.forEach((record, index) => {
    if (index === input.nodeIndex || input.pairedTextIndexes.has(index) || !isGeneratedNodeTextElement(record)) {
      return;
    }
    const textX = getRecordNumber(record, "x");
    const textY = getRecordNumber(record, "y");
    if (textX === null || textY === null) {
      return;
    }
    const distance = Math.abs(textX - nodeX) + Math.abs(textY - nodeY);
    if (distance < closestDistance && distance <= 96) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
}

function repairGeneratedNodeTextPosition(input: {
  node: Record<string, unknown>;
  text: Record<string, unknown>;
}): void {
  const nodeX = getRecordNumber(input.node, "x");
  const nodeY = getRecordNumber(input.node, "y");
  const nodeWidth = getRecordNumber(input.node, "width");
  const nodeHeight = getRecordNumber(input.node, "height");
  if (nodeX !== null) {
    input.text.x = nodeX + 14;
  }
  if (nodeY !== null) {
    input.text.y = nodeY + 16;
  }
  if (nodeWidth !== null) {
    input.text.width = Math.max(40, nodeWidth - 28);
  }
  if (nodeHeight !== null) {
    input.text.height = Math.max(24, nodeHeight - 28);
  }
}

export function repairIntentCanvasGeneratedElements(
  elements: readonly OrderedExcalidrawElement[],
): OrderedExcalidrawElement[] {
  const usedIds = new Set<string>();
  const idByOriginalId = new Map<string, string>();
  const records = elements.map((element, index) => {
    const record = { ...(element as unknown as Record<string, unknown>) };
    const originalId = typeof record.id === "string" ? record.id : "";
    if (isGeneratedElementId(originalId)) {
      let nextId = originalId;
      if (usedIds.has(nextId)) {
        const suffix = stableSeedHash(`${originalId}:${index}`);
        nextId = `${originalId}-repair-${suffix}`;
        let attempt = 1;
        while (usedIds.has(nextId)) {
          attempt += 1;
          nextId = `${originalId}-repair-${suffix}-${attempt}`;
        }
      }
      record.id = nextId;
      if (!idByOriginalId.has(originalId)) {
        idByOriginalId.set(originalId, nextId);
      }
    }
    if (typeof record.id === "string") {
      usedIds.add(record.id);
    }
    return record;
  });

  records.forEach((record) => {
    if (!isGeneratedElementId(record.id)) {
      return;
    }
    record.strokeColor = repairGeneratedColor(record.strokeColor);
    record.backgroundColor = repairGeneratedColor(record.backgroundColor);
    record.containerId = typeof record.containerId === "string"
      ? idByOriginalId.get(record.containerId) ?? record.containerId
      : record.containerId;
    record.startBinding = remapBindingElementId(record.startBinding, idByOriginalId);
    record.endBinding = remapBindingElementId(record.endBinding, idByOriginalId);
    record.boundElements = remapBoundElements(record.boundElements, idByOriginalId);
  });

  const pairedTextIndexes = new Set<number>();
  const droppedNodeIds = new Set<string>();
  const droppedIndexes = new Set<number>();
  records.forEach((node, nodeIndex) => {
    if (!isGeneratedNodeElement(node)) {
      return;
    }
    const textIndex = findGeneratedNodeTextIndex({ records, nodeIndex, pairedTextIndexes });
    const text = textIndex === null ? null : records[textIndex];
    if (textIndex === null || !text || !getGeneratedElementText(text)) {
      if (typeof node.id === "string") {
        droppedNodeIds.add(node.id);
      }
      droppedIndexes.add(nodeIndex);
      return;
    }
    pairedTextIndexes.add(textIndex);
    text.containerId = node.id;
    text.strokeColor = repairGeneratedColor(text.strokeColor);
    repairGeneratedNodeTextPosition({ node, text });
    const existingArrowBindings = Array.isArray(node.boundElements)
      ? node.boundElements.filter((binding) => (
          isRecord(binding)
          && typeof binding.id === "string"
          && binding.type !== "text"
        ))
      : [];
    node.boundElements = [
      { id: text.id, type: "text" },
      ...existingArrowBindings,
    ];
  });

  const droppedEdgeIds = new Set<string>();
  records.forEach((record, index) => {
    if (!isGeneratedEdgeElement(record)) {
      return;
    }
    const startBinding = isRecord(record.startBinding) ? record.startBinding : null;
    const endBinding = isRecord(record.endBinding) ? record.endBinding : null;
    const startElementId = typeof startBinding?.elementId === "string" ? startBinding.elementId : null;
    const endElementId = typeof endBinding?.elementId === "string" ? endBinding.elementId : null;
    if (
      (startElementId && droppedNodeIds.has(startElementId))
      || (endElementId && droppedNodeIds.has(endElementId))
    ) {
      if (typeof record.id === "string") {
        droppedEdgeIds.add(record.id);
      }
      droppedIndexes.add(index);
    }
  });

  records.forEach((record, index) => {
    if (!isGeneratedEdgeLabelElement(record)) {
      return;
    }
    const containerId = typeof record.containerId === "string" ? record.containerId : null;
    if (containerId && droppedEdgeIds.has(containerId)) {
      droppedIndexes.add(index);
    }
  });

  return records
    .filter((_, index) => !droppedIndexes.has(index))
    .map((record) => record as unknown as OrderedExcalidrawElement);
}

function sanitizeIntentCanvasAppState(appState: Partial<AppState> | unknown): Partial<AppState> {
  if (!isRecord(appState)) {
    return {};
  }
  const safeAppState = Object.entries(appState).reduce<Record<string, unknown>>(
    (current, [key, value]) => {
      if (!EXCALIDRAW_RUNTIME_APP_STATE_KEYS.has(key)) {
        current[key] = EXCALIDRAW_OBJECT_MAP_APP_STATE_KEYS.has(key) && !isRecord(value)
          ? {}
          : value === appState
            ? null
            : value;
      }
      return current;
    },
    {},
  );
  return toJsonObject(safeAppState) as Partial<AppState>;
}

export function sanitizeIntentCanvasScene(
  elements: readonly OrderedExcalidrawElement[] | readonly unknown[],
  appState: Partial<AppState> | unknown,
  files: BinaryFiles | unknown,
): IntentCanvasScene {
  const safeElements: OrderedExcalidrawElement[] = [];
  elements.forEach((element) => {
    if (isIntentCanvasElement(element)) {
      safeElements.push(element);
    }
  });
  return {
    elements: repairIntentCanvasGeneratedElements(safeElements),
    appState: sanitizeIntentCanvasAppState(appState),
    files: toJsonObject(files) as BinaryFiles,
  };
}

export function createInitialIntentCanvasScene(
  source?: IntentCanvasOpenSource | null,
  seedSemanticGraphs?: CanvasSemanticGraph[],
): IntentCanvasScene {
  const graphSeedSkeleton = buildGraphSeedSkeleton(seedSemanticGraphs);
  const elements = (graphSeedSkeleton.length ? graphSeedSkeleton : buildSeedSkeleton(source)).map(createSeedElement);
  return sanitizeIntentCanvasScene(
    elements,
    {
      viewBackgroundColor: "#fbfaf7",
      gridSize: 20,
      zoom: { value: 1 },
      scrollX: 0,
      scrollY: 0,
    },
    {},
  );
}

export function buildIntentCanvasAiContext(
  scene: IntentCanvasScene,
  summary: string,
): IntentCanvasAiContext {
  const elementDigest: IntentCanvasElementDigest[] = [];
  const relationDigest: IntentCanvasRelationDigest[] = [];

  scene.elements.forEach((element) => {
    const rawElement = element as unknown as Record<string, unknown>;
    if (rawElement.isDeleted === true) {
      return;
    }
    const type = typeof rawElement.type === "string" ? rawElement.type : "unknown";
    const id = typeof rawElement.id === "string" ? rawElement.id : `${type}-${elementDigest.length + 1}`;
    const label = readElementLabel(rawElement);
    if (type === "arrow" || type === "line") {
      const startBinding = isRecord(rawElement.startBinding) ? rawElement.startBinding : null;
      const endBinding = isRecord(rawElement.endBinding) ? rawElement.endBinding : null;
      relationDigest.push({
        id,
        type,
        label,
        startBindingId: typeof startBinding?.elementId === "string" ? startBinding.elementId : null,
        endBindingId: typeof endBinding?.elementId === "string" ? endBinding.elementId : null,
      });
    }
    elementDigest.push({
      id,
      type,
      label,
      x: finiteNumber(rawElement.x),
      y: finiteNumber(rawElement.y),
      width: finiteNumber(rawElement.width),
      height: finiteNumber(rawElement.height),
    });
  });

  return {
    elementDigest: elementDigest.slice(0, 80),
    relationDigest: relationDigest.slice(0, 80),
    lastContextSnapshot: JSON.stringify(
      {
        summary: summary.trim(),
        elements: elementDigest.slice(0, 40),
        relations: relationDigest.slice(0, 40),
      },
      null,
      2,
    ),
  };
}
