import { createGateGovernanceEvidence } from "./harnessEvidenceAdapters";
import { normalizeGovernanceEvidenceId } from "./governanceEvidence";
import type {
  GovernanceGateProfile,
  ProjectGovernanceProfile,
} from "./projectGovernanceProfile";
import type {
  GovernanceEvidence,
  GovernanceEvidenceStatus,
  WorkspaceGovernanceSnapshot,
} from "./types";

const LARGE_FILE_GATE_ARTIFACT = ".artifacts/large-files-gate.json";
const LARGE_FILE_NEAR_THRESHOLD_ARTIFACT =
  ".artifacts/large-files-near-threshold.json";
const HEAVY_TEST_NOISE_ARTIFACT = ".artifacts/heavy-test-noise.json";
const GATE_ARTIFACT_ADAPTER_ID = "gate-artifact-evidence-reader@1";
const LARGE_FILE_REPORT_PARSER_ID = "large-file-json-report@1";
const HEAVY_TEST_NOISE_REPORT_PARSER_ID = "heavy-test-noise-json-report@1";
const ARTIFACT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

type LargeFileReport = {
  readonly schemaVersion?: unknown;
  readonly gate?: unknown;
  readonly generatedAt?: unknown;
  readonly status?: unknown;
  readonly scope?: unknown;
  readonly findingCount?: unknown;
  readonly blockingCount?: unknown;
};

type HeavyTestNoiseReport = {
  readonly schemaVersion?: unknown;
  readonly gate?: unknown;
  readonly generatedAt?: unknown;
  readonly status?: unknown;
  readonly breachCount?: unknown;
};

function normalizeArtifactStatus(value: unknown): GovernanceEvidenceStatus {
  if (
    value === "pass" ||
    value === "warn" ||
    value === "fail" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

async function createSha256Digest(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) {
    return null;
  }
  const encoded = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseJsonArtifact<T>(text: string): T | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function isLargeFileReport(
  report: LargeFileReport | null,
  expectedScope: "fail" | "warn",
): report is LargeFileReport {
  return (
    report?.schemaVersion === 1 &&
    report.gate === "large-files" &&
    report.scope === expectedScope
  );
}

function isHeavyTestNoiseReport(
  report: HeavyTestNoiseReport | null,
): report is HeavyTestNoiseReport {
  return report?.schemaVersion === 1 && report.gate === "heavy-test-noise";
}

function resolveArtifactFreshness(generatedAt: string | undefined): {
  readonly degraded: boolean;
  readonly degradationReason?: string;
  readonly staleAt?: string;
} {
  if (!generatedAt) {
    return {
      degraded: true,
      degradationReason: "governance-artifact-observed-at-missing",
    };
  }
  const generatedTime = Date.parse(generatedAt);
  if (!Number.isFinite(generatedTime)) {
    return {
      degraded: true,
      degradationReason: "governance-artifact-observed-at-invalid",
    };
  }
  const staleAt = new Date(
    generatedTime + ARTIFACT_STALE_AFTER_MS,
  ).toISOString();
  if (Date.now() > Date.parse(staleAt)) {
    return {
      degraded: true,
      degradationReason: "governance-artifact-stale",
      staleAt,
    };
  }
  return { degraded: false, staleAt };
}

function createMissingArtifactEvidence(input: {
  id: string;
  source: "large-file" | "heavy-test-noise";
  title: string;
  artifactPath: string;
  command?: string;
}): GovernanceEvidence {
  return createGateGovernanceEvidence({
    id: input.id,
    source: input.source,
    status: "unknown",
    title: input.title,
    summary: `${input.artifactPath} is missing; ${
      input.command
        ? `run \`${input.command}\``
        : "run the corresponding governance check"
    } to produce result evidence.`,
    sourcePath: input.artifactPath,
    degraded: true,
    degradationReason: "governance-artifact-missing",
    provenance: {
      sourceType: "artifact",
      sourceId: normalizeGovernanceEvidenceId(
        `${input.source}:${input.artifactPath}`,
      ),
      observedAt: "1970-01-01T00:00:00.000Z",
      adapterId: GATE_ARTIFACT_ADAPTER_ID,
      artifactPath: input.artifactPath,
      qualifier: "artifact-missing",
    },
  });
}

function createMalformedArtifactEvidence(input: {
  id: string;
  source: "large-file" | "heavy-test-noise";
  title: string;
  artifactPath: string;
}): GovernanceEvidence {
  return createGateGovernanceEvidence({
    id: input.id,
    source: input.source,
    status: "unknown",
    title: input.title,
    summary: `${input.artifactPath} is malformed or uses an unsupported schema.`,
    sourcePath: input.artifactPath,
    degraded: true,
    degradationReason: "governance-artifact-malformed",
    provenance: {
      sourceType: "artifact",
      sourceId: normalizeGovernanceEvidenceId(
        `${input.source}:${input.artifactPath}`,
      ),
      observedAt: "1970-01-01T00:00:00.000Z",
      adapterId: GATE_ARTIFACT_ADAPTER_ID,
      artifactPath: input.artifactPath,
      qualifier: "artifact-malformed",
    },
  });
}

async function readLargeFileArtifactEvidence(
  snapshot: WorkspaceGovernanceSnapshot,
  artifactPath: string,
  expectedScope: "fail" | "warn",
  gate?: GovernanceGateProfile,
): Promise<GovernanceEvidence> {
  const artifactText = await snapshot.readFile(artifactPath);
  const title =
    gate?.name ??
    (expectedScope === "fail"
      ? "Large-file hard gate"
      : "Large-file near-threshold watch");
  const id = `large-file:${artifactPath}`;
  if (!artifactText) {
    return createMissingArtifactEvidence({
      id,
      source: "large-file",
      title,
      artifactPath,
      command: gate?.command,
    });
  }

  const report = parseJsonArtifact<LargeFileReport>(artifactText);
  const artifactHash = await createSha256Digest(artifactText);
  if (!isLargeFileReport(report, expectedScope)) {
    return createMalformedArtifactEvidence({
      id,
      source: "large-file",
      title,
      artifactPath,
    });
  }

  const status = normalizeArtifactStatus(report.status);
  const findingCount =
    typeof report.findingCount === "number" ? report.findingCount : 0;
  const blockingCount =
    typeof report.blockingCount === "number" ? report.blockingCount : 0;
  const observedAt =
    typeof report.generatedAt === "string" ? report.generatedAt : undefined;
  const freshness = resolveArtifactFreshness(observedAt);
  return createGateGovernanceEvidence({
    id,
    source: "large-file",
    status,
    title,
    summary:
      expectedScope === "fail"
        ? `${blockingCount} blocking large-file finding(s) across ${findingCount} result(s).`
        : `${findingCount} near-threshold large-file finding(s).`,
    sourcePath: artifactPath,
    updatedAt: observedAt,
    staleAt: freshness.staleAt,
    degraded: freshness.degraded,
    degradationReason: freshness.degradationReason,
    payload: {
      kind: "large-file",
      scope: expectedScope,
      sourcePath: artifactPath,
    },
    provenance: {
      sourceType: "artifact",
      sourceId: id,
      observedAt: observedAt ?? "1970-01-01T00:00:00.000Z",
      parserId: LARGE_FILE_REPORT_PARSER_ID,
      adapterId: GATE_ARTIFACT_ADAPTER_ID,
      artifactPath,
      artifactHash: artifactHash ?? undefined,
      qualifier: artifactHash ? undefined : "artifact-hash-unavailable",
    },
  });
}

async function readHeavyTestNoiseArtifactEvidence(
  snapshot: WorkspaceGovernanceSnapshot,
  artifactPath = HEAVY_TEST_NOISE_ARTIFACT,
  gate?: GovernanceGateProfile,
): Promise<GovernanceEvidence> {
  const artifactText = await snapshot.readFile(artifactPath);
  if (!artifactText) {
    return createMissingArtifactEvidence({
      id: `heavy-test-noise:${artifactPath}`,
      source: "heavy-test-noise",
      title: gate?.name ?? "Heavy test noise sentry",
      artifactPath,
      command: gate?.command,
    });
  }

  const report = parseJsonArtifact<HeavyTestNoiseReport>(artifactText);
  const artifactHash = await createSha256Digest(artifactText);
  if (!isHeavyTestNoiseReport(report)) {
    return createMalformedArtifactEvidence({
      id: `heavy-test-noise:${artifactPath}`,
      source: "heavy-test-noise",
      title: gate?.name ?? "Heavy test noise sentry",
      artifactPath,
    });
  }

  const breachCount =
    typeof report.breachCount === "number" ? report.breachCount : 0;
  const observedAt =
    typeof report.generatedAt === "string" ? report.generatedAt : undefined;
  const freshness = resolveArtifactFreshness(observedAt);
  return createGateGovernanceEvidence({
    id: `heavy-test-noise:${artifactPath}`,
    source: "heavy-test-noise",
    status: normalizeArtifactStatus(report.status),
    title: gate?.name ?? "Heavy test noise sentry",
    summary: `${breachCount} noisy heavy-test breach(es) detected.`,
    sourcePath: artifactPath,
    updatedAt: observedAt,
    staleAt: freshness.staleAt,
    degraded: freshness.degraded,
    degradationReason: freshness.degradationReason,
    payload: {
      kind: "heavy-test-noise",
      breachCount,
      sourcePath: artifactPath,
    },
    provenance: {
      sourceType: "artifact",
      sourceId: `heavy-test-noise:${artifactPath}`,
      observedAt: observedAt ?? "1970-01-01T00:00:00.000Z",
      parserId: HEAVY_TEST_NOISE_REPORT_PARSER_ID,
      adapterId: GATE_ARTIFACT_ADAPTER_ID,
      artifactPath,
      artifactHash: artifactHash ?? undefined,
      qualifier: artifactHash ? undefined : "artifact-hash-unavailable",
    },
  });
}

export async function readGateArtifactEvidence(
  snapshot: WorkspaceGovernanceSnapshot,
  profile?: Pick<ProjectGovernanceProfile, "gates">,
): Promise<GovernanceEvidence[]> {
  const gates = profile?.gates ?? [
    {
      name: "Large-file hard gate",
      artifactPath: LARGE_FILE_GATE_ARTIFACT,
      source: "large-file" as const,
      severity: "fail" as const,
    },
    {
      name: "Large-file near-threshold watch",
      artifactPath: LARGE_FILE_NEAR_THRESHOLD_ARTIFACT,
      source: "large-file" as const,
      severity: "warn" as const,
    },
    {
      name: "Heavy test noise sentry",
      artifactPath: HEAVY_TEST_NOISE_ARTIFACT,
      source: "heavy-test-noise" as const,
      severity: "warn" as const,
    },
  ];

  const evidence = await Promise.all(
    gates.map((gate) => {
      if (gate.source === "heavy-test-noise") {
        return readHeavyTestNoiseArtifactEvidence(
          snapshot,
          gate.artifactPath,
          gate,
        );
      }
      if (gate.source === "large-file") {
        return readLargeFileArtifactEvidence(
          snapshot,
          gate.artifactPath,
          gate.severity === "warn" ? "warn" : "fail",
          gate,
        );
      }
      return Promise.resolve(
        createMissingArtifactEvidence({
          id: `script:${gate.artifactPath}`,
          source: "large-file",
          title: gate.name,
          artifactPath: gate.artifactPath,
          command: gate.command,
        }),
      );
    }),
  );

  return evidence;
}


