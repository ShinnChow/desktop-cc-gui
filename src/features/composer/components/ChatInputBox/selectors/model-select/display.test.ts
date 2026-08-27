import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../types";
import type { ExecutionTarget } from "../../../../../shared-session/target/types";
import { isSelectedExecutionModel, resolveRuntimeModel } from "./display";

describe("resolveRuntimeModel（特征测试，迁移前锁定行为）", () => {
  it("优先 model 字段并 trim", () => {
    expect(
      resolveRuntimeModel({ id: "id-x", label: "X", model: "  rt-model  " }),
    ).toBe("rt-model");
  });

  it("model 为空时回退 id", () => {
    expect(resolveRuntimeModel({ id: " id-x ", label: "X", model: "" })).toBe(
      "id-x",
    );
  });

  it("两者皆空返回 undefined", () => {
    expect(resolveRuntimeModel({ id: "", label: "X" })).toBeUndefined();
    expect(
      resolveRuntimeModel({ id: "  ", label: "X", model: "   " }),
    ).toBeUndefined();
  });
});

describe("isSelectedExecutionModel（特征测试，迁移前锁定行为）", () => {
  const model: ModelInfo = {
    id: "catalog-entry-1",
    label: "Demo",
    model: "runtime-demo",
  };

  it("target 有 modelCatalogEntryId 时按 catalog id 匹配", () => {
    const target = {
      engine: "codex",
      modelCatalogEntryId: "catalog-entry-1",
      model: "other-runtime",
    } as ExecutionTarget;
    expect(isSelectedExecutionModel(target, model)).toBe(true);

    const miss = {
      engine: "codex",
      modelCatalogEntryId: "catalog-entry-2",
      model: "runtime-demo",
    } as ExecutionTarget;
    // catalog id 优先：即便 runtime model 相同也不算选中
    expect(isSelectedExecutionModel(miss, model)).toBe(false);
  });

  it("无 catalog id 时按 runtime model 匹配（resolveRuntimeModel 语义）", () => {
    const target = {
      engine: "codex",
      model: "runtime-demo",
    } as ExecutionTarget;
    expect(isSelectedExecutionModel(target, model)).toBe(true);

    const miss = { engine: "codex", model: "runtime-other" } as ExecutionTarget;
    expect(isSelectedExecutionModel(miss, model)).toBe(false);
  });

  it("target 为 null/undefined 时恒 false", () => {
    expect(isSelectedExecutionModel(null, model)).toBe(false);
    expect(isSelectedExecutionModel(undefined, model)).toBe(false);
  });
});
