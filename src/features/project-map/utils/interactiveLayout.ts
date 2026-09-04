import type {
  ProjectMapDataset,
  ProjectMapLens,
  ProjectMapLayoutPreset,
  ProjectMapNode,
  ProjectMapViewState,
} from "../types";
import {
  canProjectMapNodeAttachToRoot,
  normalizeProjectMapNodeTopology,
  PROJECT_MAP_UNASSIGNED_DISCOVERIES_NODE_ID,
} from "./incrementalGeneration";

export type ProjectMapGraphNodePosition = {
  id: string;
  x: number;
  y: number;
  pinned?: boolean;
};

export type ProjectMapGraphEdge = {
  id: string;
  source: ProjectMapGraphNodePosition;
  target: ProjectMapGraphNodePosition;
};

export type ProjectMapGraphViewport = {
  zoom: number;
  pan: {
    x: number;
    y: number;
  };
};

export type ProjectMapGraphBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type ProjectMapMiniMapProjection = {
  bounds: ProjectMapGraphBounds;
  dots: Array<{
    id: string;
    x: number;
    y: number;
    pinned: boolean;
  }>;
  viewport: ProjectMapGraphBounds;
  projectPoint: (point: { x: number; y: number }) => { x: number; y: number };
  unprojectPoint: (point: { x: number; y: number }) => { x: number; y: number };
};

export type ProjectMapInteractiveLayout = {
  positions: ProjectMapGraphNodePosition[];
  edges: ProjectMapGraphEdge[];
  bounds: ProjectMapGraphBounds | null;
  rootNodeId: string | null;
};

export const PROJECT_MAP_GRAPH_WIDTH = 2400;
export const PROJECT_MAP_GRAPH_HEIGHT = 1600;
export const PROJECT_MAP_DEFAULT_OVERVIEW_ZOOM = 0.52;
export const PROJECT_MAP_DEFAULT_FOCUS_ZOOM = 0.56;
export const PROJECT_MAP_MIN_ZOOM = 0.36;
export const PROJECT_MAP_MAX_ZOOM = 1.08;

const PROJECT_CORE_NODE_ID = "project-core";
const GRAPH_NODE_GAP = 26;
const GRAPH_NODE_CANVAS_PADDING = 110;
const GRAPH_FIT_PADDING = 56;
const GRAPH_NODE_FOOTPRINT = {
  default: { width: 176, height: 106 },
  hub: { width: 188, height: 112 },
  core: { width: 208, height: 126 },
};
const CONFIDENCE_ORDER: Record<ProjectMapNode["confidence"], number> = {
  high: 4,
  medium: 3,
  low: 2,
  unknown: 1,
};

export function buildProjectMapNodeIndex(nodes: ProjectMapNode[]): Map<string, ProjectMapNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function normalizeProjectMapProjectionNodes(nodes: ProjectMapNode[]): ProjectMapNode[] {
  return normalizeProjectMapNodeTopology(nodes, { attachOrphansToRoot: true });
}

function getProjectMapCoreNodeFromNodes(nodes: ProjectMapNode[]): ProjectMapNode | null {
  return (
    nodes.find((node) => node.id === PROJECT_CORE_NODE_ID) ??
    nodes.find((node) => !node.parentId) ??
    nodes[0] ??
    null
  );
}

export function getProjectMapCoreNode(dataset: ProjectMapDataset): ProjectMapNode | null {
  return getProjectMapCoreNodeFromNodes(normalizeProjectMapProjectionNodes(dataset.nodes));
}

export function compareProjectMapNodes(left: ProjectMapNode, right: ProjectMapNode): number {
  const leftSignal =
    Number(left.stale) * 8 +
    Number(left.candidate) * 4 +
    (5 - CONFIDENCE_ORDER[left.confidence]);
  const rightSignal =
    Number(right.stale) * 8 +
    Number(right.candidate) * 4 +
    (5 - CONFIDENCE_ORDER[right.confidence]);

  return rightSignal - leftSignal || left.title.localeCompare(right.title);
}

export function getSortedProjectMapChildren(
  node: ProjectMapNode,
  nodeIndex: Map<string, ProjectMapNode>,
): ProjectMapNode[] {
  return node.children
    .map((childId) => nodeIndex.get(childId))
    .filter((child): child is ProjectMapNode => Boolean(child))
    .sort(compareProjectMapNodes);
}

export function getVisibleProjectMapLenses(dataset: ProjectMapDataset): ProjectMapLens[] {
  return dataset.lenses.filter((lens) => lens.status !== "notApplicable");
}

export function resolveVisibleProjectMapNodes(
  dataset: ProjectMapDataset,
  focusNodeId: string | null,
): ProjectMapNode[] {
  const nodes = normalizeProjectMapProjectionNodes(dataset.nodes);
  const rootNode = getProjectMapCoreNodeFromNodes(nodes);
  if (!focusNodeId && rootNode) {
    const nodeIndex = buildProjectMapNodeIndex(nodes);
    const overviewChildren = getSortedProjectMapChildren(rootNode, nodeIndex).filter(
      (node) =>
        node.id === PROJECT_MAP_UNASSIGNED_DISCOVERIES_NODE_ID ||
        canProjectMapNodeAttachToRoot(node),
    );
    return [rootNode, ...overviewChildren];
  }

  if (!focusNodeId) {
    return nodes;
  }

  const nodeIndex = buildProjectMapNodeIndex(nodes);
  const focusNode = nodeIndex.get(focusNodeId);
  if (!focusNode) {
    return nodes;
  }

  const visibleIds = new Set<string>([
    focusNode.id,
    focusNode.parentId ?? "",
    ...focusNode.children,
    ...nodes
      .filter((node) => node.children.includes(focusNode.id))
      .map((node) => node.id),
  ].filter(Boolean));

  return nodes
    .filter((node) => visibleIds.has(node.id))
    .sort((left, right) => {
      if (left.id === focusNode.id) {
        return -1;
      }
      if (right.id === focusNode.id) {
        return 1;
      }
      return compareProjectMapNodes(left, right);
    });
}

export function clampProjectMapGraphZoom(value: number): number {
  return Math.min(PROJECT_MAP_MAX_ZOOM, Math.max(PROJECT_MAP_MIN_ZOOM, Number(value.toFixed(2))));
}

export function calculateProjectMapFitViewport(
  bounds: ProjectMapGraphBounds,
  canvasSize: {
    width: number;
    height: number;
  },
  fallbackZoom: number,
): ProjectMapGraphViewport {
  const boundsWidth = Math.max(1, bounds.right - bounds.left);
  const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
  const availableWidth = Math.max(1, canvasSize.width - GRAPH_FIT_PADDING * 2);
  const availableHeight = Math.max(1, canvasSize.height - GRAPH_FIT_PADDING * 2);
  const fitZoom = clampProjectMapGraphZoom(Math.min(
    fallbackZoom,
    availableWidth / boundsWidth,
    availableHeight / boundsHeight,
  ));
  const boundsCenter = {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  };
  const graphCenter = {
    x: PROJECT_MAP_GRAPH_WIDTH / 2,
    y: PROJECT_MAP_GRAPH_HEIGHT / 2,
  };

  return {
    zoom: fitZoom,
    pan: {
      x: Number((-(boundsCenter.x - graphCenter.x) * fitZoom).toFixed(2)),
      y: Number((-(boundsCenter.y - graphCenter.y) * fitZoom).toFixed(2)),
    },
  };
}

export function buildProjectMapViewState(input: {
  current: ProjectMapViewState | undefined;
  preset?: ProjectMapLayoutPreset;
  positions: ProjectMapGraphNodePosition[];
  pinnedNodeIds: Set<string>;
  updatedAt: string;
}): ProjectMapViewState {
  const nodeLayouts: ProjectMapViewState["nodeLayouts"] = {
    ...(input.current?.nodeLayouts ?? {}),
  };

  for (const position of input.positions) {
    nodeLayouts[position.id] = {
      x: Number(position.x.toFixed(2)),
      y: Number(position.y.toFixed(2)),
      pinned: input.pinnedNodeIds.has(position.id) || position.pinned === true,
      updatedAt: input.updatedAt,
    };
  }

  return {
    layoutPreset: input.preset ?? input.current?.layoutPreset ?? "radial",
    nodeLayouts,
    updatedAt: input.updatedAt,
  };
}

export function resetProjectMapViewState(
  current: ProjectMapViewState | undefined,
  updatedAt: string,
): ProjectMapViewState {
  return {
    layoutPreset: current?.layoutPreset ?? "radial",
    nodeLayouts: {},
    updatedAt,
  };
}

export function buildInteractiveProjectMapLayout(input: {
  dataset: ProjectMapDataset;
  visibleNodes: ProjectMapNode[];
  focusNodeId: string | null;
  preset?: ProjectMapLayoutPreset;
  settle?: boolean;
}): ProjectMapInteractiveLayout {
  const projectionNodes = normalizeProjectMapProjectionNodes(input.dataset.nodes);
  const requestedVisibleIds = new Set(input.visibleNodes.map((node) => node.id));
  const visibleNodes = projectionNodes.filter((node) => requestedVisibleIds.has(node.id));
  const nodeIndex = buildProjectMapNodeIndex(projectionNodes);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const rootNode = getProjectMapCoreNodeFromNodes(projectionNodes);
  const focusNode = input.focusNodeId ? nodeIndex.get(input.focusNodeId) ?? null : null;
  const visibleLenses = getVisibleProjectMapLenses(input.dataset);
  const preset = input.preset ?? input.dataset.viewState?.layoutPreset ?? "radial";
  const rootNodeId = (focusNode && visibleIds.has(focusNode.id) ? focusNode.id : rootNode?.id) ?? null;
  const generatedPositions =
    focusNode && visibleIds.has(focusNode.id)
      ? buildFocusPositions(visibleNodes, focusNode, preset)
      : rootNode
        ? buildOverviewPositions(visibleNodes, rootNode, nodeIndex, visibleLenses, preset)
        : [];
  const positionsWithPinned = applyPersistedPositions(
    generatedPositions,
    input.dataset.viewState,
    new Set(visibleNodes.map((node) => node.id)),
    input.dataset.viewState?.layoutPreset === preset,
  );
  const positions =
    rootNodeId && input.settle !== false
      ? settleProjectMapLayout({
          positions: positionsWithPinned,
          nodes: visibleNodes,
          rootNodeId,
          preservePinned: true,
        })
      : positionsWithPinned;
  const positionById = new Map(positions.map((position) => [position.id, position]));
  const edges = visibleNodes.flatMap((node) => {
    const source = positionById.get(node.id);
    if (!source) {
      return [];
    }
    return node.children.flatMap((childId) => {
      const target = positionById.get(childId);
      if (!target || !visibleIds.has(childId)) {
        return [];
      }
      return [{ id: `${node.id}-${childId}`, source, target }];
    });
  });
  const bounds = rootNodeId
    ? buildProjectMapGraphBounds(positions, visibleNodes, rootNodeId)
    : null;

  return { positions, edges, bounds, rootNodeId };
}

export function settleProjectMapLayout(input: {
  positions: ProjectMapGraphNodePosition[];
  nodes: ProjectMapNode[];
  rootNodeId: string;
  preservePinned?: boolean;
}): ProjectMapGraphNodePosition[] {
  const center = { x: PROJECT_MAP_GRAPH_WIDTH / 2, y: PROJECT_MAP_GRAPH_HEIGHT / 2 };
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const positions = input.positions.map((position) => {
    const node = nodeById.get(position.id);
    return node
      ? clampGraphPosition(position, getGraphNodeFootprint(node, input.rootNodeId))
      : position;
  });

  for (let passIndex = 0; passIndex < 90; passIndex += 1) {
    let didMoveNode = false;

    for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
        const leftNode = nodeById.get(positions[leftIndex]?.id ?? "");
        const rightNode = nodeById.get(positions[rightIndex]?.id ?? "");
        const leftPosition = positions[leftIndex];
        const rightPosition = positions[rightIndex];

        if (!leftNode || !rightNode || !leftPosition || !rightPosition) {
          continue;
        }

        const leftFootprint = getGraphNodeFootprint(leftNode, input.rootNodeId);
        const rightFootprint = getGraphNodeFootprint(rightNode, input.rootNodeId);
        const minimumDeltaX = (leftFootprint.width + rightFootprint.width) / 2 + GRAPH_NODE_GAP;
        const minimumDeltaY = (leftFootprint.height + rightFootprint.height) / 2 + GRAPH_NODE_GAP;
        const deltaX = rightPosition.x - leftPosition.x;
        const deltaY = rightPosition.y - leftPosition.y;
        const overlapX = minimumDeltaX - Math.abs(deltaX);
        const overlapY = minimumDeltaY - Math.abs(deltaY);

        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        const leftPinned = input.preservePinned && leftPosition.pinned === true;
        const rightPinned = input.preservePinned && rightPosition.pinned === true;
        if (leftPinned && rightPinned) {
          continue;
        }

        const leftIsRoot = leftNode.id === input.rootNodeId;
        const rightIsRoot = rightNode.id === input.rootNodeId;
        const shouldMoveOnX = overlapX <= overlapY;
        const leftRadialSign = shouldMoveOnX
          ? Math.sign(leftPosition.x - center.x) || -1
          : Math.sign(leftPosition.y - center.y) || -1;
        const rightRadialSign = shouldMoveOnX
          ? Math.sign(rightPosition.x - center.x) || 1
          : Math.sign(rightPosition.y - center.y) || 1;
        const pairSign = shouldMoveOnX
          ? Math.sign(deltaX) || rightRadialSign
          : Math.sign(deltaY) || rightRadialSign;
        const pushDistance = (shouldMoveOnX ? overlapX : overlapY) + 2;
        const leftShare = leftPinned || leftIsRoot ? 0 : rightPinned || rightIsRoot ? 1 : 0.5;
        const rightShare = rightPinned || rightIsRoot ? 0 : leftPinned || leftIsRoot ? 1 : 0.5;

        if (shouldMoveOnX) {
          const nextLeftX = leftPosition.x - pairSign * pushDistance * leftShare;
          positions[leftIndex] = clampGraphPosition(
            {
              ...leftPosition,
              x: Number.isFinite(nextLeftX) ? nextLeftX : leftPosition.x + leftRadialSign,
            },
            leftFootprint,
          );
          positions[rightIndex] = clampGraphPosition(
            {
              ...rightPosition,
              x: rightPosition.x + pairSign * pushDistance * rightShare,
            },
            rightFootprint,
          );
        } else {
          const nextLeftY = leftPosition.y - pairSign * pushDistance * leftShare;
          positions[leftIndex] = clampGraphPosition(
            {
              ...leftPosition,
              y: Number.isFinite(nextLeftY) ? nextLeftY : leftPosition.y + leftRadialSign,
            },
            leftFootprint,
          );
          positions[rightIndex] = clampGraphPosition(
            {
              ...rightPosition,
              y: rightPosition.y + pairSign * pushDistance * rightShare,
            },
            rightFootprint,
          );
        }

        didMoveNode = true;
      }
    }

    if (!didMoveNode) {
      break;
    }
  }

  return positions;
}

export function buildProjectMapMiniMapProjection(input: {
  positions: ProjectMapGraphNodePosition[];
  nodes: ProjectMapNode[];
  rootNodeId: string;
  viewport: ProjectMapGraphViewport;
  canvasSize: {
    width: number;
    height: number;
  };
  miniMapSize: {
    width: number;
    height: number;
  };
}): ProjectMapMiniMapProjection | null {
  const bounds = buildProjectMapGraphBounds(input.positions, input.nodes, input.rootNodeId);
  if (!bounds) {
    return null;
  }

  const paddedBounds = {
    left: bounds.left - 80,
    right: bounds.right + 80,
    top: bounds.top - 80,
    bottom: bounds.bottom + 80,
  };
  const scale = Math.min(
    input.miniMapSize.width / Math.max(1, paddedBounds.right - paddedBounds.left),
    input.miniMapSize.height / Math.max(1, paddedBounds.bottom - paddedBounds.top),
  );
  const projectPoint = (point: { x: number; y: number }) => ({
    x: Number(((point.x - paddedBounds.left) * scale).toFixed(2)),
    y: Number(((point.y - paddedBounds.top) * scale).toFixed(2)),
  });
  const unprojectPoint = (point: { x: number; y: number }) => ({
    x: Number((point.x / scale + paddedBounds.left).toFixed(2)),
    y: Number((point.y / scale + paddedBounds.top).toFixed(2)),
  });
  const graphCenter = {
    x: PROJECT_MAP_GRAPH_WIDTH / 2,
    y: PROJECT_MAP_GRAPH_HEIGHT / 2,
  };
  const visibleLeft =
    graphCenter.x + (-input.canvasSize.width / 2 - input.viewport.pan.x) / input.viewport.zoom;
  const visibleRight =
    graphCenter.x + (input.canvasSize.width / 2 - input.viewport.pan.x) / input.viewport.zoom;
  const visibleTop =
    graphCenter.y + (-input.canvasSize.height / 2 - input.viewport.pan.y) / input.viewport.zoom;
  const visibleBottom =
    graphCenter.y + (input.canvasSize.height / 2 - input.viewport.pan.y) / input.viewport.zoom;
  const viewportTopLeft = projectPoint({ x: visibleLeft, y: visibleTop });
  const viewportBottomRight = projectPoint({ x: visibleRight, y: visibleBottom });

  return {
    bounds: paddedBounds,
    dots: input.positions.map((position) => {
      const point = projectPoint(position);
      return {
        id: position.id,
        x: point.x,
        y: point.y,
        pinned: position.pinned === true,
      };
    }),
    viewport: {
      left: viewportTopLeft.x,
      right: viewportBottomRight.x,
      top: viewportTopLeft.y,
      bottom: viewportBottomRight.y,
    },
    projectPoint,
    unprojectPoint,
  };
}



function buildOverviewPositions(
  nodes: ProjectMapNode[],
  rootNode: ProjectMapNode,
  nodeIndex: Map<string, ProjectMapNode>,
  visibleLenses: ProjectMapLens[],
  preset: ProjectMapLayoutPreset,
): ProjectMapGraphNodePosition[] {
  if (preset === "tree") {
    return buildTreePositions(nodes, rootNode, nodeIndex);
  }
  if (preset === "force") {
    return buildForceSeedPositions(nodes, rootNode);
  }

  const center = { x: PROJECT_MAP_GRAPH_WIDTH / 2, y: PROJECT_MAP_GRAPH_HEIGHT / 2 };
  const positions: ProjectMapGraphNodePosition[] = [
    { id: rootNode.id, x: center.x, y: center.y },
  ];
  const directChildren = getSortedProjectMapChildren(rootNode, nodeIndex);
  if (directChildren.length > 10) {
    const expandedSlots = buildExpandedGraphSlots(directChildren.length);
    for (const [index, hub] of directChildren.entries()) {
      const slot = expandedSlots[index];
      if (!slot) {
        continue;
      }
      positions.push({ id: hub.id, x: slot.x, y: slot.y });
    }
    return positions.filter((position) => nodes.some((node) => node.id === position.id));
  }

  const hubRadiusX = 560;
  const hubRadiusY = 360;
  const shouldUseUniformHubAngles = directChildren.length > visibleLenses.length + 1;
  const childCountByLensId = new Map<string, number>();
  const placedCountByLensId = new Map<string, number>();

  for (const hub of directChildren) {
    childCountByLensId.set(hub.lensId, (childCountByLensId.get(hub.lensId) ?? 0) + 1);
  }

  for (const [index, hub] of directChildren.entries()) {
    const lensChildCount = childCountByLensId.get(hub.lensId) ?? 1;
    const lensChildIndex = placedCountByLensId.get(hub.lensId) ?? 0;
    placedCountByLensId.set(hub.lensId, lensChildIndex + 1);
    const lensFanOffset = shouldUseUniformHubAngles
      ? 0
      : (lensChildIndex - (lensChildCount - 1) / 2) * 24;
    const baseAngle = shouldUseUniformHubAngles
      ? -90 + index * (360 / Math.max(directChildren.length, 1))
      : visibleLenses.some((lens) => lens.id === hub.lensId)
        ? getLensAngle(hub.lensId, visibleLenses)
        : index * 52 - 90;
    const angle = toRadians(baseAngle + lensFanOffset);
    positions.push({
      id: hub.id,
      x: center.x + Math.cos(angle) * hubRadiusX,
      y: center.y + Math.sin(angle) * hubRadiusY,
    });
  }

  return positions.filter((position) => nodes.some((node) => node.id === position.id));
}

function buildFocusPositions(
  nodes: ProjectMapNode[],
  focusNode: ProjectMapNode,
  preset: ProjectMapLayoutPreset,
): ProjectMapGraphNodePosition[] {
  if (preset === "tree") {
    return buildTreePositions(nodes, focusNode, buildProjectMapNodeIndex(nodes));
  }
  if (preset === "force") {
    return buildForceSeedPositions(nodes, focusNode);
  }

  const center = { x: PROJECT_MAP_GRAPH_WIDTH / 2, y: PROJECT_MAP_GRAPH_HEIGHT / 2 };
  const contextNodes = nodes.filter((node) => node.id !== focusNode.id);
  const positions: ProjectMapGraphNodePosition[] = [
    { id: focusNode.id, x: center.x, y: center.y },
  ];
  const expandedSlots = contextNodes.length > 9 ? buildExpandedGraphSlots(contextNodes.length) : [];

  contextNodes.forEach((node, index) => {
    const expandedSlot = expandedSlots[index];
    if (expandedSlot) {
      positions.push({ id: node.id, x: expandedSlot.x, y: expandedSlot.y });
      return;
    }

    const angle = toRadians(index * (360 / Math.max(contextNodes.length, 1)) - 90);
    const childRadius = 430;
    const contextRadius = 305;
    const radius = node.parentId === focusNode.id ? childRadius : contextRadius;
    positions.push({
      id: node.id,
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * (radius * 0.72),
    });
  });

  return positions;
}

function buildTreePositions(
  nodes: ProjectMapNode[],
  rootNode: ProjectMapNode,
  nodeIndex: Map<string, ProjectMapNode>,
): ProjectMapGraphNodePosition[] {
  const visibleIds = new Set(nodes.map((node) => node.id));
  const children = getSortedProjectMapChildren(rootNode, nodeIndex).filter((node) =>
    visibleIds.has(node.id),
  );
  const contextNodes = nodes.filter((node) => node.id !== rootNode.id && !children.includes(node));
  const slots = [...children, ...contextNodes];
  const centerX = PROJECT_MAP_GRAPH_WIDTH / 2;
  const startY = 300;
  const rowGap = 210;
  const positions: ProjectMapGraphNodePosition[] = [
    { id: rootNode.id, x: centerX, y: startY },
  ];

  slots.forEach((node, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    positions.push({
      id: node.id,
      x: centerX + (column - 1) * 430,
      y: startY + rowGap * (row + 1),
    });
  });

  return positions;
}

function buildForceSeedPositions(
  nodes: ProjectMapNode[],
  rootNode: ProjectMapNode,
): ProjectMapGraphNodePosition[] {
  const center = { x: PROJECT_MAP_GRAPH_WIDTH / 2, y: PROJECT_MAP_GRAPH_HEIGHT / 2 };
  return nodes.map((node, index) => {
    if (node.id === rootNode.id) {
      return { id: node.id, x: center.x, y: center.y };
    }
    const angle = toRadians(index * 137.5 - 90);
    const radius = 245 + (index % 5) * 78;
    return {
      id: node.id,
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius * 0.74,
    };
  });
}

function applyPersistedPositions(
  generatedPositions: ProjectMapGraphNodePosition[],
  viewState: ProjectMapViewState | undefined,
  visibleIds: Set<string>,
  shouldApplyUnpinned: boolean,
): ProjectMapGraphNodePosition[] {
  if (!viewState) {
    return generatedPositions;
  }

  return generatedPositions.map((position) => {
    const layout = viewState.nodeLayouts[position.id];
    if (!layout || !visibleIds.has(position.id) || (!layout.pinned && !shouldApplyUnpinned)) {
      return position;
    }
    return {
      ...position,
      x: layout.x,
      y: layout.y,
      pinned: layout.pinned === true,
    };
  });
}

function buildExpandedGraphSlots(count: number): Array<{ x: number; y: number }> {
  const centerX = PROJECT_MAP_GRAPH_WIDTH / 2;
  const columnOffsets = [540, 330, 760];
  const rowY = [220, 380, 540, 700, 860, 1020, 1180, 1340];
  const slots: Array<{ x: number; y: number }> = [];

  for (const offset of columnOffsets) {
    for (const y of rowY) {
      slots.push({ x: centerX - offset, y });
      slots.push({ x: centerX + offset, y });
    }
  }

  return slots.slice(0, count);
}

function buildProjectMapGraphBounds(
  positions: ProjectMapGraphNodePosition[],
  nodes: ProjectMapNode[],
  rootNodeId: string,
): ProjectMapGraphBounds | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let bounds: ProjectMapGraphBounds | null = null;

  for (const position of positions) {
    const node = nodeById.get(position.id);
    if (!node) {
      continue;
    }

    const nodeBounds = getGraphPositionBounds(position, node, rootNodeId);
    bounds = bounds
      ? {
          left: Math.min(bounds.left, nodeBounds.left),
          right: Math.max(bounds.right, nodeBounds.right),
          top: Math.min(bounds.top, nodeBounds.top),
          bottom: Math.max(bounds.bottom, nodeBounds.bottom),
        }
      : nodeBounds;
  }

  return bounds;
}

function getGraphPositionBounds(
  position: ProjectMapGraphNodePosition,
  node: ProjectMapNode,
  rootNodeId: string,
): ProjectMapGraphBounds {
  const footprint = getGraphNodeFootprint(node, rootNodeId);
  return {
    left: position.x - footprint.width / 2,
    right: position.x + footprint.width / 2,
    top: position.y - footprint.height / 2,
    bottom: position.y + footprint.height / 2,
  };
}

function getGraphNodeFootprint(
  node: ProjectMapNode,
  rootNodeId: string,
): {
  width: number;
  height: number;
} {
  if (node.id === rootNodeId) {
    return GRAPH_NODE_FOOTPRINT.core;
  }

  if (node.parentId === rootNodeId) {
    return GRAPH_NODE_FOOTPRINT.hub;
  }

  return GRAPH_NODE_FOOTPRINT.default;
}

function clampGraphPosition(
  position: ProjectMapGraphNodePosition,
  footprint: {
    width: number;
    height: number;
  },
): ProjectMapGraphNodePosition {
  const halfWidth = footprint.width / 2;
  const halfHeight = footprint.height / 2;
  return {
    ...position,
    x: Math.min(
      PROJECT_MAP_GRAPH_WIDTH - GRAPH_NODE_CANVAS_PADDING - halfWidth,
      Math.max(GRAPH_NODE_CANVAS_PADDING + halfWidth, position.x),
    ),
    y: Math.min(
      PROJECT_MAP_GRAPH_HEIGHT - GRAPH_NODE_CANVAS_PADDING - halfHeight,
      Math.max(GRAPH_NODE_CANVAS_PADDING + halfHeight, position.y),
    ),
  };
}

function getLensAngle(lensId: string, visibleLenses: ProjectMapLens[]): number {
  const lensIndex = Math.max(
    0,
    visibleLenses.findIndex((lens) => lens.id === lensId),
  );
  const lensCount = Math.max(visibleLenses.length, 1);
  return -90 + lensIndex * (360 / lensCount);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
