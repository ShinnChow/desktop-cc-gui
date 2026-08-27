import { describe, expect, it } from "vitest";
import { pickerRowsForGroup, type PickerModelGroup } from "./pickerGroups";

function makeGroup(
  overrides: Partial<PickerModelGroup> &
    Pick<PickerModelGroup, "providerId" | "models">,
): PickerModelGroup {
  return {
    providerLabel: "Demo",
    enabled: true,
    loading: false,
    reloading: false,
    error: null,
    targetProfileId: null,
    profiles: [],
    ...overrides,
  };
}

describe("pickerRowsForGroup（特征测试，迁移前锁定行为）", () => {
  it("非 slash-catalog 引擎：平铺 model 行，key 为 providerId:modelId，无 heading", () => {
    const rows = pickerRowsForGroup(
      makeGroup({
        providerId: "claude",
        models: [
          { id: "claude-opus-4", label: "Opus" },
          { id: "claude-sonnet-4", label: "Sonnet" },
        ],
      }),
    );
    expect(rows).toEqual([
      {
        kind: "model",
        key: "claude:claude-opus-4",
        model: expect.any(Object),
        disambiguate: undefined,
      },
      {
        kind: "model",
        key: "claude:claude-sonnet-4",
        model: expect.any(Object),
        disambiguate: undefined,
      },
    ]);
  });

  it("dsh：按 vendor 分节插 heading 行；同节内 last-segment 撞名的行标 disambiguate（跨节撞名不算）", () => {
    const rows = pickerRowsForGroup(
      makeGroup({
        providerId: "dsh",
        models: [
          { id: "cpa/cline/x", label: "cpa / x" },
          { id: "cpa/fb2api/x", label: "cpa / x" },
          { id: "cpa/cline/y", label: "cpa / y" },
          { id: "ov/zzz/q", label: "ov / q" },
        ],
      }),
    );
    // labelCounts 按 section 内统计：cpa 节内 x 撞名（cline/fb2api 两条）→ true；
    // y 唯一 → false；ov 节的 q 与 cpa 节的 x 跨节撞名不算。
    expect(rows.map((r) => r.kind)).toEqual([
      "heading",
      "model",
      "model",
      "model",
      "heading",
      "model",
    ]);
    const headingKeys = rows
      .filter(
        (r): r is Extract<typeof r, { kind: "heading" }> =>
          r.kind === "heading",
      )
      .map((r) => r.key);
    expect(headingKeys).toEqual(["dsh-vendor:cpa", "dsh-vendor:ov"]);
    const modelRows = rows
      .filter(
        (r): r is Extract<typeof r, { kind: "model" }> => r.kind === "model",
      )
      .map((r) => ({ key: r.key, disambiguate: r.disambiguate }));
    // key 模板 = `${providerId}:${sectionKey}:${model.id}`，model.id 为完整 id
    expect(modelRows).toEqual([
      { key: "dsh:cpa:cpa/cline/x", disambiguate: true },
      { key: "dsh:cpa:cpa/fb2api/x", disambiguate: true },
      { key: "dsh:cpa:cpa/cline/y", disambiguate: false },
      { key: "dsh:ov:ov/zzz/q", disambiguate: false },
    ]);
  });
});
