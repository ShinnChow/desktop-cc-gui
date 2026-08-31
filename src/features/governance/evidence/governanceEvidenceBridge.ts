import {
  createGovernanceEvidence,
  createGovernanceEvidenceSnapshot,
  normalizeGovernanceEvidenceId,
} from "./governanceEvidence";
import type {
  GovernanceEvidence,
  GovernanceEvidenceSource,
  GovernanceEvidenceSnapshot,
  GovernanceEvidenceStatus,
} from "./types";

export type GovernanceEvidenceAdapterInput = {
  readonly id: string;
  readonly source: GovernanceEvidenceSource;
  readonly status: GovernanceEvidenceStatus;
  readonly title: string;
  readonly summary: string;
  readonly updatedAt?: string;
  readonly staleAt?: string;
  readonly degraded?: boolean;
  readonly degradationReason?: string;
  readonly payload?: GovernanceEvidence["payload"];
  readonly provenance?: GovernanceEvidence["provenance"];
};

export function createHarnessGovernanceEvidence(
  input: GovernanceEvidenceAdapterInput,
): GovernanceEvidence {
  return createGovernanceEvidence({
    ...input,
    id: normalizeGovernanceEvidenceId(input.id),
    degraded: input.degraded ?? false,
  });
}

export function createFrozenGovernanceEvidenceSnapshot(input: {
  evidence: readonly GovernanceEvidence[];
  createdAt?: string;
  id?: string;
}): GovernanceEvidenceSnapshot {
  return createGovernanceEvidenceSnapshot(input);
}


