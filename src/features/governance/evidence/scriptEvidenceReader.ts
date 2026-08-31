import { createGovernanceEvidence } from "./governanceEvidence";
import type { ProjectGovernanceProfile } from "./projectGovernanceProfile";
import { parsePackageScripts } from "./projectGovernanceProfile";
import type { GovernanceEvidence, WorkspaceGovernanceSnapshot } from "./types";

const KNOWN_HARNESS_SCRIPTS = [
  "check:engine-capability-matrix",
  "check:capability-aware-policy-router",
  "check:context-ledger-cost-budget",
  "check:checkpoint-policy-chain",
  "check:agent-domain-event-schema",
  "check:heavy-test-noise",
  "check:large-files:near-threshold",
  "check:large-files:gate",
] as const;

const VERIFICATION_SCRIPT_PATTERNS: readonly {
  readonly id: string;
  readonly title: string;
  readonly pattern: RegExp;
}[] = [
  {
    id: "lint",
    title: "Lint script",
    pattern: /(^|:)(lint|eslint|check:lint)$/i,
  },
  {
    id: "typecheck",
    title: "Typecheck script",
    pattern: /(typecheck|tsc|check:types?)/i,
  },
  { id: "test", title: "Test script", pattern: /(^|:)(test|vitest|jest)$/i },
  { id: "build", title: "Build script", pattern: /(^|:)(build|compile)$/i },
  { id: "check", title: "Check script", pattern: /(^|:)check$/i },
];

function selectVerificationScripts(scripts: Readonly<Record<string, string>>) {
  return VERIFICATION_SCRIPT_PATTERNS.flatMap((pattern) => {
    const matches = Object.entries(scripts)
      .filter(([name]) => pattern.pattern.test(name))
      .sort(([left], [right]) => left.localeCompare(right, "en"));
    const first = matches[0];
    return first
      ? [
          {
            id: pattern.id,
            title: pattern.title,
            scriptName: first[0],
            command: first[1],
          },
        ]
      : [];
  });
}

export async function readScriptEvidence(
  snapshot: WorkspaceGovernanceSnapshot,
  profile?: Pick<ProjectGovernanceProfile, "scripts">,
): Promise<GovernanceEvidence[]> {
  const packageJson = profile ? null : await snapshot.readFile("package.json");
  const scripts =
    profile?.scripts ?? (packageJson ? parsePackageScripts(packageJson) : {});
  if (!scripts) {
    return [
      createGovernanceEvidence({
        id: "script:package-json",
        source: "script",
        status: "unknown",
        degraded: true,
        degradationReason: "package-json-malformed",
        title: "Package scripts",
        summary: "package.json scripts could not be parsed.",
      }),
    ];
  }

  const evidence: GovernanceEvidence[] = [];
  const verificationScripts = selectVerificationScripts(scripts);
  if (verificationScripts.length > 0) {
    evidence.push(
      createGovernanceEvidence({
        id: "script:verification",
        source: "script",
        status: "pass",
        title: "Package verification scripts",
        summary: `${verificationScripts.length} verification script(s) detected: ${verificationScripts
          .map((entry) => entry.scriptName)
          .join(", ")}.`,
        provenance: {
          sourceType: "workspace",
          sourceId: "package.json",
          observedAt: "1970-01-01T00:00:00.000Z",
          artifactPath: "package.json",
          qualifier: "package-scripts",
        },
      }),
    );
  }

  const present = KNOWN_HARNESS_SCRIPTS.filter((scriptName) =>
    Boolean(scripts[scriptName]),
  );
  if (present.length > 0) {
    evidence.push(
      createGovernanceEvidence({
        id: "script:harness",
        source: "script",
        status:
          present.length === KNOWN_HARNESS_SCRIPTS.length ? "pass" : "warn",
        title: "Harness check scripts",
        summary: `${present.length}/${KNOWN_HARNESS_SCRIPTS.length} known governance script(s) configured.`,
        provenance: {
          sourceType: "workspace",
          sourceId: "package.json",
          observedAt: "1970-01-01T00:00:00.000Z",
          artifactPath: "package.json",
          qualifier: "harness-scripts-detected",
        },
      }),
    );
  }

  return evidence;
}


