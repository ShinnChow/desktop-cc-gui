import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-policy guard for the Session Index-only sidebar reload.
 */

const source = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "useAppShellLayoutNodesSection.tsx",
  ),
  "utf8",
);

function extractHandler(name: string, endMarker: string): string {
  const start = source.indexOf(`const ${name} = useEventCallback`);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`${name} was not found`);
  }
  return source.slice(start, end);
}

describe("reload workspace threads force index sync policy", () => {
  it("declares shared user-reload options for forced index-only sync", () => {
    expect(source).toContain("const USER_RELOAD_THREAD_LIST_OPTIONS = {");
    expect(source).toContain("forceSessionIndexSync: true,");
    expect(source).toContain("sessionIndexOnly: true,");
  });

  it("quick reload passes the force-sync options to the tracked loader", () => {
    const handler = extractHandler(
      "handleQuickReloadWorkspaceThreads",
      "const handleReloadWorkspaceThreads",
    );
    expect(handler).toContain("listThreadsForWorkspaceTracked(");
    expect(handler).toContain("USER_RELOAD_THREAD_LIST_OPTIONS");
  });

  it("confirmed reload passes the force-sync options to the tracked loader", () => {
    const handler = extractHandler(
      "handleReloadWorkspaceThreads",
      "const handleToggleLiveEditPreview",
    );
    expect(handler).toContain("handleQuickReloadWorkspaceThreads(workspaceId)");
    expect(handler).not.toContain("ask(");
  });
});
