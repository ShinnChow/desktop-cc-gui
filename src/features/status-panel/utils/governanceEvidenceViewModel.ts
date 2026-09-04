import type { GovernanceEvidence } from "../../governance/evidence";

export type GovernanceEvidenceGroupId = "needs_action" | "watch" | "passed";

export type GroupedGovernanceEvidence = {
  readonly id: GovernanceEvidenceGroupId;
  readonly evidence: readonly GovernanceEvidence[];
};

function groupIdForEvidence(
  entry: GovernanceEvidence,
): GovernanceEvidenceGroupId {
  if (entry.status === "fail") {
    return "needs_action";
  }
  if (entry.status === "unknown" && entry.degraded) {
    return "needs_action";
  }
  if (entry.status === "warn" || entry.degraded || entry.staleAt) {
    return "watch";
  }
  return "passed";
}

function sortEvidence(left: GovernanceEvidence, right: GovernanceEvidence) {
  const statusWeight: Record<GovernanceEvidence["status"], number> = {
    fail: 0,
    unknown: 1,
    warn: 2,
    pass: 3,
  };
  return (
    statusWeight[left.status] - statusWeight[right.status] ||
    Number(right.degraded) - Number(left.degraded) ||
    left.id.localeCompare(right.id, "en")
  );
}

export function groupGovernanceEvidence(
  evidence: readonly GovernanceEvidence[],
): readonly GroupedGovernanceEvidence[] {
  const groups: Record<GovernanceEvidenceGroupId, GovernanceEvidence[]> = {
    needs_action: [],
    watch: [],
    passed: [],
  };
  for (const entry of evidence) {
    groups[groupIdForEvidence(entry)].push(entry);
  }
  return (["needs_action", "watch", "passed"] as const).map((id) => ({
    id,
    evidence: groups[id].sort(sortEvidence),
  }));
}


