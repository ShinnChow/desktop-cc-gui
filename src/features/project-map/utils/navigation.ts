import type {
  ProjectMapActivityProjection,
  ProjectMapAssociationExplanation,
  ProjectMapAssociationExplanationReason,
  ProjectMapDataset,
  ProjectMapGroupedQueryResults,
  ProjectMapNode,
  ProjectMapQueryGroup,
  ProjectMapQueryResult,
  ProjectMapRelation,
} from "../types";
import type { ProjectMapEvidenceFileIndex } from "./evidenceFileIndex";
import {
  buildProjectMapNodeIndex,
  compareProjectMapNodes,
  normalizeProjectMapProjectionNodes,
} from "./interactiveLayout";
import { buildProjectMapBoundedPreview, capProjectMapProjectionItems, normalizeProjectMapProjectionPath, uniqueProjectMapStrings } from "./projectionGuards";

export type ProjectMapSearchResult = {
  node: ProjectMapNode;
  score: number;
  matchedFields: string[];
};

export type ProjectMapPathStep = {
  node: ProjectMapNode;
  via: "hierarchy" | "relation" | "self";
  relation?: ProjectMapRelation;
};

export type ProjectMapPathResult =
  | {
      status: "idle";
      steps: [];
      edgeKeys: Set<string>;
      message: string;
    }
  | {
      status: "found";
      steps: ProjectMapPathStep[];
      edgeKeys: Set<string>;
      message: string;
    }
  | {
      status: "not-found";
      steps: [];
      edgeKeys: Set<string>;
      message: string;
    };

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

export function searchProjectMapNodes(input: {
  dataset: ProjectMapDataset;
  query: string;
  limit?: number;
}): ProjectMapSearchResult[] {
  const query = normalizeSearchText(input.query);
  if (!query) {
    return [];
  }
  const limit = input.limit ?? 8;
  return input.dataset.nodes
    .map((node) => {
      const fields = [
        ["title", node.title],
        ["summary", node.summary],
        ["kind", node.nodeKind],
        ["lens", node.lensId],
        ["source", node.sources.map((source) => `${source.label} ${source.path ?? ""}`).join(" ")],
      ] as const;
      const matchedFields = fields
        .filter(([, value]) => normalizeSearchText(String(value)).includes(query))
        .map(([field]) => field);
      const titleMatch = normalizeSearchText(node.title).includes(query);
      const score = matchedFields.length * 10 + (titleMatch ? 20 : 0) + node.children.length;
      return { node, score, matchedFields };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || compareProjectMapNodes(left.node, right.node))
    .slice(0, limit);
}

const PROJECT_MAP_QUERY_GROUP_TITLES: Record<ProjectMapQueryGroup, string> = {
  nodes: "Nodes",
  "evidence-files": "Evidence files",
  relations: "Relations",
  "artifact-references": "Artifact references",
  "stale-reasons": "Stale reasons",
  activity: "Recent activity",
};

function matchFields(
  query: string,
  fields: Array<readonly [string, string | number | boolean | null | undefined]>,
): string[] {
  return fields
    .filter(([, value]) => normalizeSearchText(String(value ?? "")).includes(query))
    .map(([field]) => field);
}

function queryResult(input: ProjectMapQueryResult): ProjectMapQueryResult {
  return {
    ...input,
    nodeIds: uniqueProjectMapStrings(input.nodeIds),
    relationIds: uniqueProjectMapStrings(input.relationIds),
    filePaths: uniqueProjectMapStrings(input.filePaths),
    matchedFields: uniqueProjectMapStrings(input.matchedFields),
  };
}

function buildNodeQueryResults(dataset: ProjectMapDataset, query: string): ProjectMapQueryResult[] {
  return dataset.nodes.flatMap((node) => {
    const sourceText = node.sources.map((source) => `${source.label} ${source.path ?? ""} ${source.excerpt ?? ""}`).join(" ");
    const artifactText = node.detail.relatedArtifacts.map((artifact) => `${artifact.label} ${artifact.path ?? ""} ${artifact.ref ?? ""}`).join(" ");
    const detailText = [
      node.detail.coreDescription,
      ...node.detail.keyFacts,
      ...node.detail.keyLogic,
      ...node.detail.riskSignals,
    ].join(" ");
    const matchedFields = matchFields(query, [
      ["title", node.title],
      ["summary", node.summary],
      ["kind", node.nodeKind],
      ["lens", node.lensId],
      ["source", sourceText],
      ["artifact", artifactText],
      ["detail", detailText],
    ]);
    if (matchedFields.length === 0) {
      return [];
    }
    const titleMatch = matchedFields.includes("title");
    return [
      queryResult({
        id: `query:node:${node.id}`,
        group: "nodes",
        title: node.title,
        summary: node.summary,
        matchedFields,
        nodeIds: [node.id],
        relationIds: [],
        filePaths: [
          ...node.sources.flatMap((source) => source.path ?? []),
          ...node.detail.relatedArtifacts.flatMap((artifact) => artifact.path ?? []),
        ],
        score: matchedFields.length * 10 + (titleMatch ? 20 : 0) + node.children.length,
        preview: buildProjectMapBoundedPreview(detailText || node.summary),
        degraded: node.confidence === "unknown",
      }),
    ];
  }).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

function buildEvidenceFileQueryResults(
  evidenceFileIndex: ProjectMapEvidenceFileIndex | undefined,
  query: string,
): ProjectMapQueryResult[] {
  return (evidenceFileIndex?.files ?? []).flatMap((file) => {
    const matchedFields = matchFields(query, [
      ["path", file.path],
      ["displayPath", file.displayPath],
      ["sourceTypes", file.sourceTypes.join(" ")],
      ["sourceKinds", file.sourceKinds.join(" ")],
      ["nodeLinks", file.nodeLinks.map((link) => link.title).join(" ")],
      ["relationLinks", file.relationLinks.map((link) => link.type).join(" ")],
      ["governanceLinks", file.governanceLinks.map((link) => link.label).join(" ")],
    ]);
    if (matchedFields.length === 0) {
      return [];
    }
    return [
      queryResult({
        id: `query:evidence-file:${file.path}`,
        group: "evidence-files",
        title: file.displayPath,
        summary: `${file.nodeCount} node(s), ${file.relationCount} relation(s), ${file.evidenceCount} evidence item(s)`,
        matchedFields,
        nodeIds: file.nodeLinks.map((link) => link.nodeId),
        relationIds: file.relationLinks.map((link) => link.relationId),
        filePaths: [file.path],
        score: matchedFields.length * 10 + file.nodeCount + file.relationCount,
        preview: buildProjectMapBoundedPreview(file.lineRefs.map((line) => `${line.line}: ${line.label}`).join(" ")),
        degraded: file.degradedCount > 0,
      }),
    ];
  }).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

function buildRelationQueryResults(dataset: ProjectMapDataset, query: string): ProjectMapQueryResult[] {
  const nodeIndex = new Map(dataset.nodes.map((node) => [node.id, node]));
  return (dataset.relations ?? []).flatMap((relation) => {
    const source = nodeIndex.get(relation.sourceNodeId);
    const target = nodeIndex.get(relation.targetNodeId);
    const evidenceText = relation.evidence.map((record) => `${record.source.label} ${record.source.path ?? ""}`).join(" ");
    const matchedFields = matchFields(query, [
      ["type", relation.type],
      ["label", relation.label],
      ["sourceKind", relation.sourceKind],
      ["confidence", relation.confidence],
      ["sourceNode", source?.title],
      ["targetNode", target?.title],
      ["evidence", evidenceText],
    ]);
    if (matchedFields.length === 0) {
      return [];
    }
    return [
      queryResult({
        id: `query:relation:${relation.id}`,
        group: "relations",
        title: relation.label ?? `${source?.title ?? relation.sourceNodeId} -> ${target?.title ?? relation.targetNodeId}`,
        summary: `${relation.type} (${relation.sourceKind}, ${relation.confidence})`,
        matchedFields,
        nodeIds: [relation.sourceNodeId, relation.targetNodeId],
        relationIds: [relation.id],
        filePaths: relation.evidence.flatMap((record) => record.source.path ?? []),
        score: matchedFields.length * 10 + Math.round((relation.weight ?? 0) * 10),
        preview: buildProjectMapBoundedPreview(evidenceText),
        degraded: !source || !target || relation.stale,
      }),
    ];
  }).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

function buildArtifactReferenceQueryResults(dataset: ProjectMapDataset, query: string): ProjectMapQueryResult[] {
  return dataset.nodes.flatMap((node) =>
    node.detail.relatedArtifacts.flatMap((artifact) => {
      const normalizedPath = normalizeProjectMapProjectionPath(artifact);
      const matchedFields = matchFields(query, [
        ["label", artifact.label],
        ["path", artifact.path],
        ["ref", artifact.ref],
        ["type", artifact.type],
        ["node", node.title],
      ]);
      if (matchedFields.length === 0) {
        return [];
      }
      return [
        queryResult({
          id: `query:artifact:${node.id}:${artifact.type}:${artifact.label}:${artifact.path ?? artifact.ref ?? ""}`,
          group: "artifact-references",
          title: artifact.label,
          summary: `${artifact.type} reference on ${node.title}`,
          matchedFields,
          nodeIds: [node.id],
          relationIds: [],
          filePaths: normalizedPath.workspaceRelativePath ? [normalizedPath.workspaceRelativePath] : [],
          score: matchedFields.length * 10,
          preview: artifact.path ?? artifact.ref,
          degraded: normalizedPath.degraded,
        }),
      ];
    }),
  ).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

function buildStaleReasonQueryResults(dataset: ProjectMapDataset, query: string): ProjectMapQueryResult[] {
  return dataset.nodes.flatMap((node) =>
    (node.staleReasons ?? []).flatMap((reason) => {
      const matchedFields = matchFields(query, [
        ["label", reason.label],
        ["kind", reason.kind],
        ["path", reason.path],
        ["recommendation", reason.recommendation],
        ["node", node.title],
      ]);
      if (matchedFields.length === 0) {
        return [];
      }
      return [
        queryResult({
          id: `query:stale:${reason.id}`,
          group: "stale-reasons",
          title: reason.label,
          summary: `${node.title}: ${reason.recommendation}`,
          matchedFields,
          nodeIds: [node.id],
          relationIds: reason.relationId ? [reason.relationId] : [],
          filePaths: reason.path ? [reason.path] : [],
          score: matchedFields.length * 10 + (node.stale ? 5 : 0),
          preview: buildProjectMapBoundedPreview(reason.label),
          degraded: reason.kind === "unknown",
        }),
      ];
    }),
  ).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

function buildActivityQueryResults(
  activityProjection: ProjectMapActivityProjection | undefined,
  query: string,
): ProjectMapQueryResult[] {
  return (activityProjection?.items ?? []).flatMap((item) => {
    const matchedFields = matchFields(query, [
      ["title", item.title],
      ["summary", item.summary],
      ["kind", item.kind],
      ["sourceCategory", item.sourceCategory],
      ["files", item.filePaths.join(" ")],
    ]);
    if (matchedFields.length === 0) {
      return [];
    }
    return [
      queryResult({
        id: `query:activity:${item.id}`,
        group: "activity",
        title: item.title,
        summary: item.summary,
        matchedFields,
        nodeIds: item.nodeIds,
        relationIds: item.relationIds,
        filePaths: item.filePaths,
        score: matchedFields.length * 10 + item.nodeIds.length + item.relationIds.length,
        preview: buildProjectMapBoundedPreview(item.summary),
        degraded: item.degraded,
      }),
    ];
  }).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

export function searchProjectMapGrouped(input: {
  dataset: ProjectMapDataset;
  query: string;
  evidenceFileIndex?: ProjectMapEvidenceFileIndex;
  activityProjection?: ProjectMapActivityProjection;
  groupLimit?: number;
}): ProjectMapGroupedQueryResults {
  const query = normalizeSearchText(input.query);
  const emptyResult: ProjectMapGroupedQueryResults = {
    query: input.query,
    groups: [],
    nodeIds: new Set(),
    relationIds: new Set(),
    filePaths: new Set(),
  };
  if (!query) {
    return emptyResult;
  }

  const groupEntries: Array<[ProjectMapQueryGroup, ProjectMapQueryResult[]]> = [
    ["nodes", buildNodeQueryResults(input.dataset, query)],
    ["evidence-files", buildEvidenceFileQueryResults(input.evidenceFileIndex, query)],
    ["relations", buildRelationQueryResults(input.dataset, query)],
    ["artifact-references", buildArtifactReferenceQueryResults(input.dataset, query)],
    ["stale-reasons", buildStaleReasonQueryResults(input.dataset, query)],
    ["activity", buildActivityQueryResults(input.activityProjection, query)],
  ];
  const groups = groupEntries.flatMap(([group, results]) => {
    const capped = capProjectMapProjectionItems(results, input.groupLimit ?? 8);
    return capped.totalCount > 0
      ? [{
          group,
          title: PROJECT_MAP_QUERY_GROUP_TITLES[group],
          results: capped.items,
          capped: capped.capped,
          totalCount: capped.totalCount,
        }]
      : [];
  });
  return {
    query: input.query,
    groups,
    nodeIds: new Set(groups.flatMap((group) => group.results.flatMap((result) => result.nodeIds))),
    relationIds: new Set(groups.flatMap((group) => group.results.flatMap((result) => result.relationIds))),
    filePaths: new Set(groups.flatMap((group) => group.results.flatMap((result) => result.filePaths))),
  };
}

function edgeKey(sourceNodeId: string, targetNodeId: string): string {
  return `${sourceNodeId}::${targetNodeId}`;
}

function addPathNeighbor(
  adjacency: Map<string, ProjectMapPathStep[]>,
  fromNode: ProjectMapNode,
  toNode: ProjectMapNode | undefined,
  via: ProjectMapPathStep["via"],
  relation?: ProjectMapRelation,
): void {
  if (!toNode) {
    return;
  }
  const neighbors = adjacency.get(fromNode.id) ?? [];
  neighbors.push({ node: toNode, via, relation });
  adjacency.set(fromNode.id, neighbors);
}

export function buildProjectMapShortestPath(input: {
  dataset: ProjectMapDataset;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  emptyMessage: string;
  foundMessage: string;
  notFoundMessage: string;
}): ProjectMapPathResult {
  const sourceNodeId = input.sourceNodeId?.trim() ?? "";
  const targetNodeId = input.targetNodeId?.trim() ?? "";
  if (!sourceNodeId || !targetNodeId) {
    return { status: "idle", steps: [], edgeKeys: new Set(), message: input.emptyMessage };
  }

  const nodes = normalizeProjectMapProjectionNodes(input.dataset.nodes);
  const nodeIndex = buildProjectMapNodeIndex(nodes);
  const sourceNode = nodeIndex.get(sourceNodeId);
  const targetNode = nodeIndex.get(targetNodeId);
  if (!sourceNode || !targetNode) {
    return { status: "not-found", steps: [], edgeKeys: new Set(), message: input.notFoundMessage };
  }
  if (sourceNode.id === targetNode.id) {
    return {
      status: "found",
      steps: [{ node: sourceNode, via: "self" }],
      edgeKeys: new Set(),
      message: input.foundMessage,
    };
  }

  const adjacency = new Map<string, ProjectMapPathStep[]>();
  for (const node of nodes) {
    addPathNeighbor(adjacency, node, node.parentId ? nodeIndex.get(node.parentId) : undefined, "hierarchy");
    for (const childId of node.children) {
      addPathNeighbor(adjacency, node, nodeIndex.get(childId), "hierarchy");
    }
  }
  for (const relation of input.dataset.relations ?? []) {
    const source = nodeIndex.get(relation.sourceNodeId);
    const target = nodeIndex.get(relation.targetNodeId);
    if (!source || !target) {
      continue;
    }
    if (relation.direction !== "backward") {
      addPathNeighbor(adjacency, source, target, "relation", relation);
    }
    if (relation.direction !== "forward") {
      addPathNeighbor(adjacency, target, source, "relation", relation);
    }
  }

  const queue = [sourceNode.id];
  const previous = new Map<string, { previousNodeId: string; step: ProjectMapPathStep }>();
  const visited = new Set<string>([sourceNode.id]);

  while (queue.length > 0) {
    const currentNodeId = queue.shift()!;
    for (const neighbor of adjacency.get(currentNodeId) ?? []) {
      if (visited.has(neighbor.node.id)) {
        continue;
      }
      visited.add(neighbor.node.id);
      previous.set(neighbor.node.id, { previousNodeId: currentNodeId, step: neighbor });
      if (neighbor.node.id === targetNode.id) {
        queue.length = 0;
        break;
      }
      queue.push(neighbor.node.id);
    }
  }

  if (!previous.has(targetNode.id)) {
    return { status: "not-found", steps: [], edgeKeys: new Set(), message: input.notFoundMessage };
  }

  const reversedSteps: ProjectMapPathStep[] = [];
  let currentNodeId = targetNode.id;
  while (currentNodeId !== sourceNode.id) {
    const previousEntry = previous.get(currentNodeId);
    if (!previousEntry) {
      break;
    }
    reversedSteps.push(previousEntry.step);
    currentNodeId = previousEntry.previousNodeId;
  }
  const steps: ProjectMapPathStep[] = [{ node: sourceNode, via: "self" }, ...reversedSteps.reverse()];
  const edgeKeys = new Set<string>();
  for (let index = 1; index < steps.length; index += 1) {
    const fromNodeId = steps[index - 1]?.node.id;
    const toNodeId = steps[index]?.node.id;
    if (fromNodeId && toNodeId) {
      edgeKeys.add(edgeKey(fromNodeId, toNodeId));
      edgeKeys.add(edgeKey(toNodeId, fromNodeId));
    }
  }

  return { status: "found", steps, edgeKeys, message: input.foundMessage };
}

function relationReason(relation: ProjectMapRelation): ProjectMapAssociationExplanationReason {
  return {
    label: `${relation.type} relation (${relation.sourceKind})`,
    relationId: relation.id,
    sourceKind: relation.sourceKind,
    confidence: relation.confidence,
    stale: Boolean(relation.stale),
    evidenceCount: relation.evidence.length,
    deterministic: relation.sourceKind !== "llm-inferred",
    degraded: relation.confidence === "unknown" || relation.stale,
  };
}

function hierarchyReason(fromNode: ProjectMapNode, toNode: ProjectMapNode): ProjectMapAssociationExplanationReason {
  return {
    label: fromNode.parentId === toNode.id
      ? `${fromNode.title} belongs under ${toNode.title}`
      : `${toNode.title} belongs under ${fromNode.title}`,
    confidence: "high",
    stale: fromNode.stale || toNode.stale,
    evidenceCount: fromNode.sources.length + toNode.sources.length,
    deterministic: true,
    degraded: fromNode.stale || toNode.stale,
  };
}

export function explainProjectMapAssociationPath(input: {
  sourceNodeId: string | null;
  targetNodeId: string | null;
  pathResult: ProjectMapPathResult;
}): ProjectMapAssociationExplanation {
  const sourceNodeId = input.sourceNodeId?.trim() ?? "";
  const targetNodeId = input.targetNodeId?.trim() ?? "";
  if (!sourceNodeId || !targetNodeId || input.pathResult.status === "idle") {
    return { sourceNodeId, targetNodeId, status: "idle", steps: [], reasons: [] };
  }
  if (input.pathResult.status !== "found") {
    return { sourceNodeId, targetNodeId, status: "not-found", steps: [], reasons: [] };
  }
  const steps = input.pathResult.steps.map((step) => ({
    nodeId: step.node.id,
    title: step.node.title,
    via: step.via,
    relationId: step.relation?.id,
  }));
  const reasons = input.pathResult.steps.flatMap((step, index): ProjectMapAssociationExplanationReason[] => {
    if (index === 0) {
      return [];
    }
    if (step.relation) {
      return [relationReason(step.relation)];
    }
    const previousNode = input.pathResult.steps[index - 1]?.node;
    return previousNode && step.via === "hierarchy" ? [hierarchyReason(previousNode, step.node)] : [];
  });
  return {
    sourceNodeId,
    targetNodeId,
    status: "found",
    steps,
    reasons,
  };
}


