import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, "src/features/governance/evidence");
const STATUS_PANEL_COMPONENT = path.join(
  ROOT,
  "src/features/status-panel/components/StatusPanel.tsx",
);
const CHECKPOINT_PANEL_COMPONENT = path.join(
  ROOT,
  "src/features/status-panel/components/CheckpointPanel.tsx",
);
const POLICY_DIR = path.join(ROOT, "src/features/status-panel/utils/policies");

const requiredFiles = [
  STATUS_PANEL_COMPONENT,
  CHECKPOINT_PANEL_COMPONENT,
  path.join(EVIDENCE_DIR, "types.ts"),
  path.join(EVIDENCE_DIR, "governanceEvidence.ts"),
  path.join(EVIDENCE_DIR, "governanceEvidenceBridge.ts"),
  path.join(EVIDENCE_DIR, "harnessEvidenceAdapters.ts"),
  path.join(EVIDENCE_DIR, "collectGovernanceEvidence.ts"),
  path.join(EVIDENCE_DIR, "projectGovernanceProfile.ts"),
  path.join(EVIDENCE_DIR, "evidenceAdapters.ts"),
  path.join(POLICY_DIR, "bridgeGovernancePolicies.ts"),
  path.join(POLICY_DIR, "policyTypes.ts"),
].map((filePath) => path.normalize(filePath));

function fail(message) {
  console.error(`[governance-evidence-bridge] ${message}`);
  process.exitCode = 1;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

for (const filePath of requiredFiles) {
  if (!fs.existsSync(filePath)) {
    fail(`missing required file: ${path.relative(ROOT, filePath)}`);
  }
}

const typeSource = readText(path.join(EVIDENCE_DIR, "types.ts"));
for (const token of [
  "GovernanceEvidenceSnapshot",
  "LegacyGovernanceEvidenceSource",
  "HarnessGovernanceEvidenceSource",
  "degraded",
  "staleAt",
  "payload",
]) {
  if (!typeSource.includes(token)) {
    fail(`types.ts missing bridge token "${token}"`);
  }
}

const bridgeSource = readText(
  path.join(EVIDENCE_DIR, "governanceEvidenceBridge.ts"),
);
for (const token of [
  "createHarnessGovernanceEvidence",
  "createFrozenGovernanceEvidenceSnapshot",
]) {
  if (!bridgeSource.includes(token)) {
    fail(`governanceEvidenceBridge.ts missing "${token}"`);
  }
}

const adapterSource = readText(
  path.join(EVIDENCE_DIR, "harnessEvidenceAdapters.ts"),
);
for (const token of [
  "createCostBudgetGovernanceEvidence",
  "createCapabilityGovernanceEvidence",
  "createGateGovernanceEvidence",
  "consolidateHarnessGateEvidence",
  "shouldInterruptRuntime: false",
]) {
  if (!adapterSource.includes(token)) {
    fail(`harnessEvidenceAdapters.ts missing "${token}"`);
  }
}

const profileSource = readText(
  path.join(EVIDENCE_DIR, "projectGovernanceProfile.ts"),
);
for (const token of [
  "ProjectGovernanceProfile",
  "deriveProjectGovernanceProfile",
  "governance.config.json",
  "SCRIPT_TO_GATE",
  "WORKFLOW_TO_GATE",
]) {
  if (!profileSource.includes(token)) {
    fail(
      `projectGovernanceProfile.ts missing dynamic profile token "${token}"`,
    );
  }
}

const evidenceAdapterSource = readText(
  path.join(EVIDENCE_DIR, "evidenceAdapters.ts"),
);
for (const token of [
  "EvidenceAdapter",
  "appliesTo(profile",
  "selectEvidenceAdapters",
  "gate-artifact-adapter@1",
  "ecosystem-verification-adapter@1",
]) {
  if (!evidenceAdapterSource.includes(token)) {
    fail(`evidenceAdapters.ts missing applicability token "${token}"`);
  }
}

const collectSource = readText(
  path.join(EVIDENCE_DIR, "collectGovernanceEvidence.ts"),
);
for (const token of [
  "deriveProjectGovernanceProfile(snapshot)",
  "selectEvidenceAdapters(profile)",
]) {
  if (!collectSource.includes(token)) {
    fail(
      `collectGovernanceEvidence.ts must select evidence through profile-aware adapters: missing "${token}"`,
    );
  }
}
for (const forbidden of [
  "readGateArtifactEvidence(snapshot)",
  "readScriptEvidence(snapshot)",
  "readWorkflowEvidence(snapshot)",
  "readTrellisEvidence(snapshot)",
]) {
  if (collectSource.includes(forbidden)) {
    fail(
      `collectGovernanceEvidence.ts must not call fixed global reader directly: ${forbidden}`,
    );
  }
}

const policyTypeSource = readText(path.join(POLICY_DIR, "policyTypes.ts"));
if (
  !policyTypeSource.includes(
    "governanceSnapshot: GovernanceEvidenceSnapshot | null",
  )
) {
  fail("CheckpointPolicyEvidence must carry the injected governance snapshot");
}
if (!policyTypeSource.includes("enforcement: PolicyDecisionEnforcement")) {
  fail(
    "PolicyDecision must carry structured advisory enforcement classification",
  );
}
for (const token of [
  "evidenceObservedAt?: string",
  "evidenceArtifactPath?: string",
  "evidenceArtifactHash?: string",
  "evidenceQualifier?: string",
]) {
  if (!policyTypeSource.includes(token)) {
    fail(`PolicyDecision missing evidence provenance field "${token}"`);
  }
}

const bridgePolicySource = readText(
  path.join(POLICY_DIR, "bridgeGovernancePolicies.ts"),
);
for (const forbidden of [
  "useGovernanceEvidence",
  "getWorkspaceFiles",
  "readWorkspaceFile",
  "child_process",
  "exec(",
  "spawn(",
  "localStorage",
  "indexedDB",
]) {
  if (bridgePolicySource.includes(forbidden)) {
    fail(`bridge-fed policies must not depend on "${forbidden}"`);
  }
}

if (bridgePolicySource.includes('verdictContribution: "blocked"')) {
  fail("bridge-fed policies must not contribute blocked");
}
if (
  !bridgePolicySource.includes('Exclude<PolicyVerdictContribution, "blocked">')
) {
  fail("bridge-fed policies must type-exclude blocked contributions");
}
for (const token of [
  "engineRuntimeGovernancePolicy",
  'source: "engine-runtime-contract"',
  "ADVISORY_CONTRIBUTION_SEVERITY",
  "evidenceObservedAt",
  "evidenceArtifactPath",
  "evidenceArtifactHash",
  "evidenceQualifier",
]) {
  if (!bridgePolicySource.includes(token)) {
    fail(`bridge-fed policies missing provenance or source token "${token}"`);
  }
}

const statusPanelSource = readText(STATUS_PANEL_COMPONENT);
for (const token of [
  "GovernanceEvidenceSection",
  "useGovernanceEvidence(",
  "createFrozenGovernanceEvidenceSnapshot",
  "governanceSnapshot",
  "buildCheckpointViewModel({",
]) {
  if (!statusPanelSource.includes(token)) {
    fail(`StatusPanel.tsx missing live bridge token "${token}"`);
  }
}

if (
  statusPanelSource.indexOf("useGovernanceEvidence(") >
  statusPanelSource.indexOf("buildCheckpointViewModel({")
) {
  fail(
    "StatusPanel must collect governance evidence before checkpoint construction",
  );
}

const checkpointCallIndex = statusPanelSource.indexOf(
  "buildCheckpointViewModel({",
);
const checkpointCallEndIndex = statusPanelSource.indexOf(
  "})",
  checkpointCallIndex,
);
const checkpointCallSource = statusPanelSource.slice(
  checkpointCallIndex,
  checkpointCallEndIndex,
);
if (!checkpointCallSource.includes("governanceSnapshot")) {
  fail(
    "StatusPanel must pass governanceSnapshot into buildCheckpointViewModel",
  );
}

const checkpointPanelSource = readText(CHECKPOINT_PANEL_COMPONENT);
for (const token of [
  "buildCheckpointSectionProjection",
  "checkpointSections.advisorySignals",
  "checkpointSections.suggestedActions",
  "PolicyDecisionAuditPanel",
]) {
  if (!checkpointPanelSource.includes(token)) {
    fail(`CheckpointPanel.tsx missing advisory section token "${token}"`);
  }
}

const packageJson = JSON.parse(readText(path.join(ROOT, "package.json")));
if (
  packageJson.scripts?.["check:governance-evidence-bridge"] !==
  "node scripts/check-governance-evidence-bridge.mjs"
) {
  fail(
    "package.json must expose check:governance-evidence-bridge through a Node entrypoint",
  );
}

if (process.exitCode) {
  process.exit();
}

console.log("[governance-evidence-bridge] ok");
