import { createGovernanceEvidence } from "./governanceEvidence";
import { hasGovernancePath } from "./pathUtils";
import type { ProjectGovernanceProfile } from "./projectGovernanceProfile";
import type { GovernanceEvidence, WorkspaceGovernanceSnapshot } from "./types";

const GOVERNANCE_WORKFLOWS = [
  ".github/workflows/large-file-governance.yml",
  ".github/workflows/heavy-test-noise-sentry.yml",
] as const;

export function readWorkflowEvidence(
  snapshot: Pick<WorkspaceGovernanceSnapshot, "files">,
  profile?: Pick<ProjectGovernanceProfile, "workflows">,
): GovernanceEvidence[] {
  const workflowPaths = profile?.workflows ?? GOVERNANCE_WORKFLOWS;
  const present = workflowPaths.filter((workflowPath) =>
    hasGovernancePath(snapshot.files, workflowPath),
  );

  if (workflowPaths.length === 0) {
    return [];
  }

  return [
    createGovernanceEvidence({
      id: "workflow:governance",
      source: "workflow",
      status: present.length === workflowPaths.length ? "pass" : "warn",
      title: "Governance workflows",
      summary: `${present.length}/${workflowPaths.length} detected workflow(s) present.`,
      provenance: {
        sourceType: "workspace",
        sourceId: ".github/workflows",
        observedAt: "1970-01-01T00:00:00.000Z",
        qualifier: "profile-scoped-workflows",
      },
    }),
  ];
}


