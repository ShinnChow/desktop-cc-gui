import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";

import { determineHardDebtStatus, isBlockingLargeFileFinding, loadPolicyConfig, resolvePolicy, scanLargeFiles } from "./check-large-files.mjs";

async function withTempDir(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "large-file-governance-"));
  try {
    await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeLines(filePath, lineCount) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = Array.from({ length: lineCount }, (_, index) => `line-${index + 1}`).join("\n");
  await fs.writeFile(filePath, `${content}\n`, "utf8");
}

async function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  return filePath;
}

function defaultPolicyConfig(overrides = {}) {
  return {
    version: "test-policy",
    policies: [],
    defaultPolicy: {
      id: "default-source",
      priority: "P1",
      warnThreshold: 10,
      failThreshold: 12,
    },
    ...overrides,
  };
}

function baselineConfig({ scope = "fail", entries = [] } = {}) {
  return {
    generatedAt: "2026-07-06T00:00:00.000Z",
    scope,
    policyVersion: "test-policy",
    entries,
  };
}

function criticalPolicyConfig(match) {
  return defaultPolicyConfig({
    policies: [
      {
        id: "critical",
        priority: "P0",
        warnThreshold: 5,
        failThreshold: 8,
        match,
      },
    ],
  });
}

function criticalBaselineEntry(filePath) {
  return {
    path: filePath,
    lines: 9,
    policyId: "critical",
    priority: "P0",
    warnThreshold: 5,
    failThreshold: 8,
  };
}

test("determineHardDebtStatus distinguishes baseline growth states", () => {
  assert.equal(determineHardDebtStatus(2601, null, false), "captured");
  assert.equal(determineHardDebtStatus(2601, null, true), "new");
  assert.equal(determineHardDebtStatus(2602, { lines: 2601 }, true), "regressed");
  assert.equal(determineHardDebtStatus(2601, { lines: 2601 }, true), "retained");
  assert.equal(determineHardDebtStatus(2600, { lines: 2601 }, true), "reduced");
});

test("determineHardDebtStatus tolerates growth within the configured allowance", () => {
  assert.equal(determineHardDebtStatus(2602, { lines: 2601 }, true, 50), "within-allowance");
  assert.equal(determineHardDebtStatus(2651, { lines: 2601 }, true, 50), "within-allowance");
  assert.equal(determineHardDebtStatus(2652, { lines: 2601 }, true, 50), "regressed");
  assert.equal(determineHardDebtStatus(2601, { lines: 2601 }, true, 50), "retained");
  assert.equal(determineHardDebtStatus(2600, { lines: 2601 }, true, 50), "reduced");
});

test("resolvePolicy prefers exact and prefix matches before default fallback", async () => {
  const root = process.cwd();
  const policy = await loadPolicyConfig(root, "scripts/check-large-files.policy.json");
  assert.ok(policy);
  assert.equal(resolvePolicy("src/services/tauri.ts", policy)?.id, "bridge-runtime-critical");
  assert.equal(resolvePolicy("src\\services\\tauri.ts", policy)?.id, "bridge-runtime-critical");
  assert.equal(resolvePolicy("src/features/messages/components/Messages.tsx", policy)?.id, "feature-hotpath");
  assert.equal(
    resolvePolicy("src\\features\\messages\\components\\Messages.tsx", policy)?.id,
    "feature-hotpath",
  );
  assert.equal(resolvePolicy("src/other/random.ts", policy)?.id, "default-source");
});

test("scanLargeFiles reports baseline-aware regressions for policy fail scope", async () => {
  await withTempDir(async (root) => {
    await writeJson(root, "policy.json", criticalPolicyConfig({ exactPaths: ["src/services/tauri.ts"] }));
    await writeJson(
      root,
      "baseline.json",
      baselineConfig({ entries: [criticalBaselineEntry("src/services/tauri.ts")] }),
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 10);
    await writeLines(path.join(root, "src/features/messages/components/Messages.tsx"), 7);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.path, "src/services/tauri.ts");
    assert.equal(scan.results[0]?.status, "regressed");
    assert.equal(scan.results[0]?.delta, 1);
  });
});

test("scanLargeFiles keeps hard-debt growth within the growth allowance non-blocking", async () => {
  await withTempDir(async (root) => {
    const policyConfig = criticalPolicyConfig({ exactPaths: ["src/services/tauri.ts"] });
    policyConfig.growthAllowanceLines = 2;
    await writeJson(root, "policy.json", policyConfig);
    await writeJson(
      root,
      "baseline.json",
      baselineConfig({ entries: [criticalBaselineEntry("src/services/tauri.ts")] }),
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 11);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.status, "within-allowance");
    assert.equal(scan.results[0]?.delta, 2);
    assert.equal(scan.results[0]?.growthAllowanceLines, 2);
  });
});

test("scanLargeFiles flags hard-debt growth beyond the growth allowance as regressed", async () => {
  await withTempDir(async (root) => {
    const policyConfig = criticalPolicyConfig({ exactPaths: ["src/services/tauri.ts"] });
    policyConfig.growthAllowanceLines = 2;
    await writeJson(root, "policy.json", policyConfig);
    await writeJson(
      root,
      "baseline.json",
      baselineConfig({ entries: [criticalBaselineEntry("src/services/tauri.ts")] }),
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 12);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.status, "regressed");
    assert.equal(scan.results[0]?.delta, 3);
  });
});

test("scanLargeFiles lets per-policy growthAllowanceLines override the top-level allowance", async () => {
  await withTempDir(async (root) => {
    const policyConfig = criticalPolicyConfig({ exactPaths: ["src/services/tauri.ts"] });
    policyConfig.growthAllowanceLines = 50;
    policyConfig.policies[0].growthAllowanceLines = 0;
    await writeJson(root, "policy.json", policyConfig);
    await writeJson(
      root,
      "baseline.json",
      baselineConfig({ entries: [criticalBaselineEntry("src/services/tauri.ts")] }),
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 10);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.status, "regressed");
    assert.equal(scan.results[0]?.growthAllowanceLines, 0);
  });
});

test("scanLargeFiles rejects invalid growthAllowanceLines before scanning", async () => {
  await withTempDir(async (root) => {
    const policyConfig = defaultPolicyConfig({ growthAllowanceLines: -1 });
    await writeJson(root, "policy.json", policyConfig);
    await writeLines(path.join(root, "src/visible-large.ts"), 13);

    await assert.rejects(
      () =>
        scanLargeFiles({
          root,
          policyFile: "policy.json",
          baselineFile: null,
          threshold: 3000,
          mode: "report",
          markdownOutput: null,
          baselineOutput: null,
          scope: "fail",
        }),
      /Invalid growthAllowanceLines in large-file policy/,
    );
  });
});

test("scanLargeFiles blocks files above the new-file ratchet that are missing from the ratchet baseline", async () => {
  await withTempDir(async (root) => {
    await writeJson(root, "policy.json", defaultPolicyConfig({ newFileFailThreshold: 5 }));
    await writeJson(root, "hard-baseline.json", baselineConfig());
    await writeJson(
      root,
      "new-file-baseline.json",
      baselineConfig({
        scope: "new-file",
        entries: [
          {
            path: "src/existing-ratchet-debt.ts",
            lines: 6,
            policyId: "default-source",
            priority: "P1",
            warnThreshold: 10,
            failThreshold: 5,
          },
        ],
      }),
    );

    await writeLines(path.join(root, "src/existing-ratchet-debt.ts"), 6);
    await writeLines(path.join(root, "src/new-ratchet-debt.ts"), 6);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "hard-baseline.json",
      newFileBaselineFile: "new-file-baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.path, "src/new-ratchet-debt.ts");
    assert.equal(scan.results[0]?.status, "new");
    assert.equal(scan.results[0]?.failThreshold, 5);
    assert.equal(scan.results[0]?.thresholdSource, "new-file-ratchet");
    assert.equal(scan.results[0]?.baselineLines, null);
  });
});

test("scanLargeFiles keeps tracked ratchet files silent while within the growth allowance", async () => {
  await withTempDir(async (root) => {
    await writeJson(
      root,
      "policy.json",
      defaultPolicyConfig({ newFileFailThreshold: 5, growthAllowanceLines: 1 }),
    );
    await writeJson(root, "hard-baseline.json", baselineConfig());
    await writeJson(
      root,
      "new-file-baseline.json",
      baselineConfig({
        scope: "new-file",
        entries: [
          {
            path: "src/existing-ratchet-debt.ts",
            lines: 6,
            policyId: "default-source",
            priority: "P1",
            warnThreshold: 10,
            failThreshold: 5,
          },
        ],
      }),
    );

    await writeLines(path.join(root, "src/existing-ratchet-debt.ts"), 7);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "hard-baseline.json",
      newFileBaselineFile: "new-file-baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 0);
  });
});

test("scanLargeFiles flags tracked ratchet files growing beyond the allowance as regressed", async () => {
  await withTempDir(async (root) => {
    await writeJson(
      root,
      "policy.json",
      defaultPolicyConfig({ newFileFailThreshold: 5, growthAllowanceLines: 1 }),
    );
    await writeJson(root, "hard-baseline.json", baselineConfig());
    await writeJson(
      root,
      "new-file-baseline.json",
      baselineConfig({
        scope: "new-file",
        entries: [
          {
            path: "src/existing-ratchet-debt.ts",
            lines: 6,
            policyId: "default-source",
            priority: "P1",
            warnThreshold: 10,
            failThreshold: 5,
          },
        ],
      }),
    );

    await writeLines(path.join(root, "src/existing-ratchet-debt.ts"), 8);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "hard-baseline.json",
      newFileBaselineFile: "new-file-baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.path, "src/existing-ratchet-debt.ts");
    assert.equal(scan.results[0]?.status, "regressed");
    assert.equal(scan.results[0]?.severity, "fail");
    assert.equal(scan.results[0]?.thresholdSource, "new-file-ratchet");
    assert.equal(scan.results[0]?.baselineLines, 6);
    assert.equal(scan.results[0]?.delta, 2);
  });
});

test("cli fails in fail mode when a tracked ratchet file grows beyond the allowance", async () => {
  await withTempDir(async (root) => {
    await writeJson(
      root,
      "policy.json",
      defaultPolicyConfig({ newFileFailThreshold: 5, growthAllowanceLines: 1 }),
    );
    await writeJson(root, "hard-baseline.json", baselineConfig());
    await writeJson(
      root,
      "new-file-baseline.json",
      baselineConfig({
        scope: "new-file",
        entries: [
          {
            path: "src/existing-ratchet-debt.ts",
            lines: 6,
            policyId: "default-source",
            priority: "P1",
            warnThreshold: 10,
            failThreshold: 5,
          },
        ],
      }),
    );
    await writeLines(path.join(root, "src/existing-ratchet-debt.ts"), 8);

    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-large-files.mjs",
        "--root",
        root,
        "--policy-file",
        "policy.json",
        "--baseline-file",
        "hard-baseline.json",
        "--new-file-baseline-file",
        "new-file-baseline.json",
        "--scope",
        "fail",
        "--mode",
        "fail",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /status=regressed/);
    assert.match(result.stdout, /threshold=new-file-ratchet/);
    assert.match(result.stdout, /allowance=1/);
  });
});

test("scanLargeFiles can generate a policy-aware new-file ratchet baseline", async () => {
  await withTempDir(async (root) => {
    await writeJson(
      root,
      "policy.json",
      defaultPolicyConfig({
        newFileFailThreshold: 5,
        policies: [
          {
            id: "critical",
            priority: "P0",
            warnThreshold: 8,
            failThreshold: 12,
            match: {
              prefixes: ["src/critical/"],
            },
          },
        ],
      }),
    );

    await writeLines(path.join(root, "src/critical/current.ts"), 6);
    await writeLines(path.join(root, "src/small.ts"), 5);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: null,
      newFileBaselineFile: null,
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "new-file",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.path, "src/critical/current.ts");
    assert.equal(scan.results[0]?.policyId, "critical");
    assert.equal(scan.results[0]?.failThreshold, 5);
    assert.equal(scan.results[0]?.status, "captured");
    assert.equal(scan.results[0]?.thresholdSource, "new-file-ratchet");
  });
});

test("scanLargeFiles matches Windows-style baseline paths against canonical repo paths", async () => {
  await withTempDir(async (root) => {
    await writeJson(root, "policy.json", criticalPolicyConfig({ exactPaths: ["src\\services\\tauri.ts"] }));
    await writeJson(
      root,
      "baseline.json",
      baselineConfig({ entries: [criticalBaselineEntry("src\\services\\tauri.ts")] }),
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 10);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.path, "src/services/tauri.ts");
    assert.equal(scan.results[0]?.policyId, "critical");
    assert.equal(scan.results[0]?.baselineLines, 9);
    assert.equal(scan.results[0]?.status, "regressed");
  });
});

test("scanLargeFiles includes mjs scripts and yaml workflows in governance", async () => {
  await withTempDir(async (root) => {
    await writeJson(
      root,
      "policy.json",
      defaultPolicyConfig({
        defaultPolicy: {
          id: "default-source",
          priority: "P1",
          warnThreshold: 8,
          failThreshold: 12,
        },
      }),
    );

    await writeLines(path.join(root, "scripts", "check-heavy-test-noise.mjs"), 13);
    await writeLines(
      path.join(root, ".github", "workflows", "large-file-governance.yml"),
      9,
    );

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: null,
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "warn",
    });

    expectPaths(scan.results.map((item) => item.path));
  });
});

test("scanLargeFiles skips local runtime artifact directories", async () => {
  await withTempDir(async (root) => {
    await writeJson(
      root,
      "policy.json",
      defaultPolicyConfig({
        defaultPolicy: {
          id: "default-source",
          priority: "P1",
          warnThreshold: 8,
          failThreshold: 12,
        },
      }),
    );

    await writeLines(path.join(root, "src", "visible-large.ts"), 13);
    await writeLines(
      path.join(root, ".artifacts", "manual-codex-launch-home", ".cargo", "registry", "huge.rs"),
      200,
    );
    await writeLines(path.join(root, ".omx", "runtime", "huge.ts"), 200);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: null,
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.deepEqual(
      scan.results.map((item) => item.path),
      ["src/visible-large.ts"],
    );
  });
});

test("cli fails in fail mode for legacy oversized files without a policy baseline", async () => {
  await withTempDir(async (root) => {
    await writeLines(path.join(root, "src", "oversized.ts"), 6);

    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-large-files.mjs",
        "--root",
        root,
        "--threshold",
        "5",
        "--mode",
        "fail",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /status=oversized/);
  });
});

test("cli fails in fail mode for policy hard debt when no baseline is loaded", async () => {
  await withTempDir(async (root) => {
    const policyPath = path.join(root, "policy.json");
    await fs.writeFile(
      policyPath,
      JSON.stringify(
        {
          version: "test-policy",
          policies: [],
          defaultPolicy: {
            id: "default-source",
            priority: "P1",
            warnThreshold: 4,
            failThreshold: 5,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeLines(path.join(root, "src", "captured.ts"), 6);

    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-large-files.mjs",
        "--root",
        root,
        "--policy-file",
        "policy.json",
        "--scope",
        "fail",
        "--mode",
        "fail",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /status=captured/);
  });
});

test("cli fails in fail mode for files above the new-file ratchet baseline", async () => {
  await withTempDir(async (root) => {
    const policyPath = path.join(root, "policy.json");
    const hardBaselinePath = path.join(root, "hard-baseline.json");
    const newFileBaselinePath = path.join(root, "new-file-baseline.json");
    await fs.writeFile(
      policyPath,
      JSON.stringify(
        {
          version: "test-policy",
          newFileFailThreshold: 5,
          policies: [],
          defaultPolicy: {
            id: "default-source",
            priority: "P1",
            warnThreshold: 10,
            failThreshold: 12,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      hardBaselinePath,
      JSON.stringify(
        {
          generatedAt: "2026-07-06T00:00:00.000Z",
          scope: "fail",
          policyVersion: "test-policy",
          entries: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      newFileBaselinePath,
      JSON.stringify(
        {
          generatedAt: "2026-07-06T00:00:00.000Z",
          scope: "new-file",
          policyVersion: "test-policy",
          entries: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeLines(path.join(root, "src", "new-ratchet-debt.ts"), 6);

    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-large-files.mjs",
        "--root",
        root,
        "--policy-file",
        "policy.json",
        "--baseline-file",
        "hard-baseline.json",
        "--new-file-baseline-file",
        "new-file-baseline.json",
        "--scope",
        "fail",
        "--mode",
        "fail",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /threshold=new-file-ratchet/);
    assert.match(result.stdout, /status=new/);
  });
});

test("scanLargeFiles rejects malformed baseline entries instead of silently dropping baseline protection", async () => {
  await withTempDir(async (root) => {
    const policyPath = path.join(root, "policy.json");
    const baselinePath = path.join(root, "baseline.json");
    await fs.writeFile(
      policyPath,
      JSON.stringify(
        {
          version: "test-policy",
          policies: [],
          defaultPolicy: {
            id: "default-source",
            priority: "P1",
            warnThreshold: 8,
            failThreshold: 12,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      baselinePath,
      JSON.stringify(
        {
          generatedAt: "2026-05-01T00:00:00.000Z",
          scope: "fail",
          policyVersion: "test-policy",
          entries: [{ path: "src/services/tauri.ts", lines: "12" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 13);

    await assert.rejects(
      () =>
        scanLargeFiles({
          root,
          policyFile: "policy.json",
          baselineFile: "baseline.json",
          threshold: 3000,
          mode: "report",
          markdownOutput: null,
          baselineOutput: null,
          scope: "fail",
        }),
      /Invalid large-file baseline entry/,
    );
  });
});

test("scanLargeFiles rejects malformed policy entries before scanning", async () => {
  await withTempDir(async (root) => {
    const policyPath = path.join(root, "policy.json");
    await fs.writeFile(
      policyPath,
      JSON.stringify(
        {
          version: "test-policy",
          policies: [
            {
              id: "critical",
              priority: "P0",
              warnThreshold: 10,
              failThreshold: 8,
              match: {
                prefixes: ["src/"],
              },
            },
          ],
          defaultPolicy: {
            id: "default-source",
            priority: "P1",
            warnThreshold: 10,
            failThreshold: 12,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeLines(path.join(root, "src", "visible-large.ts"), 13);

    await assert.rejects(
      () =>
        scanLargeFiles({
          root,
          policyFile: "policy.json",
          baselineFile: null,
          threshold: 3000,
          mode: "report",
          markdownOutput: null,
          baselineOutput: null,
          scope: "fail",
        }),
      /Invalid threshold order in large-file policy/,
    );
  });
});

test("scanLargeFiles rejects policies without usable matchers", async () => {
  await withTempDir(async (root) => {
    const policyPath = path.join(root, "policy.json");
    await fs.writeFile(
      policyPath,
      JSON.stringify(
        {
          version: "test-policy",
          policies: [
            {
              id: "critical",
              priority: "P0",
              warnThreshold: 8,
              failThreshold: 12,
              match: {
                prefixes: [""],
              },
            },
          ],
          defaultPolicy: {
            id: "default-source",
            priority: "P1",
            warnThreshold: 8,
            failThreshold: 12,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeLines(path.join(root, "src", "visible-large.ts"), 13);

    await assert.rejects(
      () =>
        scanLargeFiles({
          root,
          policyFile: "policy.json",
          baselineFile: null,
          threshold: 3000,
          mode: "report",
          markdownOutput: null,
          baselineOutput: null,
          scope: "fail",
        }),
      /Invalid large-file policy path matcher/,
    );
  });
});

test("scanLargeFiles rejects duplicate baseline paths after Windows normalization", async () => {
  await withTempDir(async (root) => {
    const policyPath = path.join(root, "policy.json");
    const baselinePath = path.join(root, "baseline.json");
    await fs.writeFile(
      policyPath,
      JSON.stringify(
        {
          version: "test-policy",
          policies: [],
          defaultPolicy: {
            id: "default-source",
            priority: "P1",
            warnThreshold: 8,
            failThreshold: 12,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      baselinePath,
      JSON.stringify(
        {
          generatedAt: "2026-05-01T00:00:00.000Z",
          scope: "fail",
          policyVersion: "test-policy",
          entries: [
            { path: "src/services/tauri.ts", lines: 12 },
            { path: "src\\services\\tauri.ts", lines: 13 },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 14);

    await assert.rejects(
      () =>
        scanLargeFiles({
          root,
          policyFile: "policy.json",
          baselineFile: "baseline.json",
          threshold: 3000,
          mode: "report",
          markdownOutput: null,
          baselineOutput: null,
          scope: "fail",
        }),
      /Duplicate large-file baseline entry after path normalization/,
    );
  });
});

test("cli fails fast when --baseline-file is missing a path instead of consuming the next flag", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-large-files.mjs", "--baseline-file", "--scope", "fail"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Missing value for --baseline-file/);
});

test("cli writes structured JSON report for governance evidence consumers", async () => {
  await withTempDir(async (root) => {
    const outputPath = path.join(root, "large-files.json");
    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-large-files.mjs",
        "--root",
        root,
        "--threshold",
        "5",
        "--mode",
        "report",
        "--json-output",
        outputPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0);
    const report = JSON.parse(await fs.readFile(outputPath, "utf8"));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.gate, "large-files");
    assert.equal(report.status, "pass");
    assert.equal(report.findingCount, 0);
    assert.deepEqual(report.results, []);
  });
});

test("cli rejects governance output paths outside the scanned root", async () => {
  await withTempDir(async (root) => {
    const outsidePath = path.join(path.dirname(root), `large-files-outside-${Date.now()}.json`);
    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-large-files.mjs",
        "--root",
        root,
        "--threshold",
        "5",
        "--mode",
        "report",
        "--json-output",
        outsidePath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Output path must stay inside repository root/);
  });
});

function expectPaths(paths) {
  assert.deepEqual(paths.sort(), [
    ".github/workflows/large-file-governance.yml",
    "scripts/check-heavy-test-noise.mjs",
  ]);
}

test("strictReduction reclassifies retained hard debt as blocking", async () => {
  await withTempDir(async (root) => {
    const policyConfig = criticalPolicyConfig({ exactPaths: ["src/services/tauri.ts"] });
    policyConfig.policies[0].strictReduction = true;
    await writeJson(root, "policy.json", policyConfig);
    await writeJson(
      root,
      "baseline.json",
      baselineConfig({ entries: [criticalBaselineEntry("src/services/tauri.ts")] }),
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 9);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.status, "retained");
    assert.equal(scan.results[0]?.strictReduction, true);
    assert.equal(isBlockingLargeFileFinding(scan.results[0]), true);
  });
});

test("retained hard debt stays non-blocking without strictReduction", async () => {
  await withTempDir(async (root) => {
    await writeJson(root, "policy.json", criticalPolicyConfig({ exactPaths: ["src/services/tauri.ts"] }));
    await writeJson(
      root,
      "baseline.json",
      baselineConfig({ entries: [criticalBaselineEntry("src/services/tauri.ts")] }),
    );

    await writeLines(path.join(root, "src/services/tauri.ts"), 9);

    const scan = await scanLargeFiles({
      root,
      policyFile: "policy.json",
      baselineFile: "baseline.json",
      threshold: 3000,
      mode: "report",
      markdownOutput: null,
      baselineOutput: null,
      scope: "fail",
    });

    assert.equal(scan.results.length, 1);
    assert.equal(scan.results[0]?.status, "retained");
    assert.equal(scan.results[0]?.strictReduction, false);
    assert.equal(isBlockingLargeFileFinding(scan.results[0]), false);
  });
});

test("loadPolicyConfig rejects a non-boolean strictReduction", async () => {
  await withTempDir(async (root) => {
    const policyConfig = criticalPolicyConfig({ exactPaths: ["src/services/tauri.ts"] });
    policyConfig.policies[0].strictReduction = "yes";
    await writeJson(root, "policy.json", policyConfig);

    await assert.rejects(() => loadPolicyConfig(root, "policy.json"), /strictReduction/);
  });
});
