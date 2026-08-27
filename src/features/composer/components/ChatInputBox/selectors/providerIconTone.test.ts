import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider icon tones", () => {
  it("does not hardcode a purple OpenCode icon in selector components", () => {
    const configSelect = readFileSync(
      resolve(
        process.cwd(),
        "src/features/composer/components/ChatInputBox/selectors/ConfigSelect.tsx",
      ),
      "utf8",
    );

    expect(configSelect).not.toContain("#6366f1");
  });
});
