import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const registryPath = path.join(root, "src/features/engine/engineIds.json");
const frontendRegistryPath = path.join(root, "src/features/engine/engineRegistry.ts");
const rustRegistryPath = path.join(root, "src-tauri/src/engine/adapter_registry.rs");
const scannerPath = path.join(root, "scripts/scan-engine-name-branches.mjs");
const expectedBuiltins = ["claude", "codex", "gemini", "grok", "kimi", "opencode", "pi", "omp", "dsh", "qoder"];

function fail(message) {
  throw new Error(`[engine-adapter-registry] ${message}`);
}

try {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const ids = registry.engineIds ?? [];
  if (JSON.stringify(ids) !== JSON.stringify(expectedBuiltins)) {
    fail(`built-in parity drift: ${JSON.stringify(ids)}`);
  }
  if (!Array.isArray(registry.engines) || registry.engines.length !== ids.length) {
    fail("registry entries must cover every built-in exactly once");
  }
  const entryIds = registry.engines.map((entry) => entry.id);
  if (JSON.stringify(entryIds) !== JSON.stringify(ids)) {
    fail(`entry ordering/id parity drift: ${JSON.stringify(entryIds)}`);
  }
  for (const [index, entry] of registry.engines.entries()) {
    for (const key of [
      "id",
      "displayName",
      "adapterId",
      "protocolFamily",
      "executionModel",
      "capabilityProfile",
    ]) {
      if (typeof entry[key] !== "string" || !entry[key].trim()) {
        fail(`engines[${index}].${key} is missing`);
      }
    }
  }

  const frontendSource = fs.readFileSync(frontendRegistryPath, "utf8");
  const rustSource = fs.readFileSync(rustRegistryPath, "utf8");
  const scannerSource = fs.readFileSync(scannerPath, "utf8");
  for (const token of [
    "BUILTIN_ENGINE_REGISTRY",
    "registerExternalEngine",
    "createEngineAvailabilityRegistry",
  ]) {
    if (!frontendSource.includes(token)) {
      fail(`frontend registry missing ${token}`);
    }
  }
  for (const token of [
    "EngineAdapterRegistry",
    "EngineProtocol",
    "EngineAdapter",
    "EngineId::external",
  ]) {
    if (!rustSource.includes(token)) {
      fail(`Rust registry missing ${token}`);
    }
  }
  if (!scannerSource.includes("engineIds.json")) {
    fail("engine branch scanner is not registry-backed");
  }
  console.log(`[engine-adapter-registry] ok (${ids.length} built-ins)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
