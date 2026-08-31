import { useCallback, useState } from "react";
import type { CliInstallEngine, CodexDoctorResult } from "@/types";

export type SettingsDoctorState = {
  status: "idle" | "running" | "done";
  result: CodexDoctorResult | null;
};

export type SettingsDoctorRunner = {
  state: SettingsDoctorState;
  run: () => Promise<void>;
  report: (result: CodexDoctorResult) => void;
};

export type SettingsDoctorSpec = {
  resolveBin: () => string | null;
  runDoctor: ((bin: string | null) => Promise<CodexDoctorResult>) | null;
  unavailableMessage: string;
};

// 各引擎 doctor 回调原先在 SettingsView 内同构重复 8 份（state + try/catch
// 包装），这里收敛为单一泛型 runner；错误结果形状与原逐引擎实现逐字段一致。
export function useDoctorRunner(
  spec: SettingsDoctorSpec,
): SettingsDoctorRunner {
  const { resolveBin, runDoctor, unavailableMessage } = spec;
  const [state, setState] = useState<SettingsDoctorState>({
    status: "idle",
    result: null,
  });
  const run = useCallback(async () => {
    const bin = resolveBin();
    setState({ status: "running", result: null });
    try {
      if (!runDoctor) {
        throw new Error(unavailableMessage);
      }
      const result = await runDoctor(bin);
      setState({ status: "done", result });
    } catch (error) {
      setState({
        status: "done",
        result: {
          ok: false,
          codexBin: bin,
          version: null,
          appServerOk: false,
          details: error instanceof Error ? error.message : String(error),
          path: null,
          nodeOk: false,
          nodeVersion: null,
          nodeDetails: null,
        },
      });
    }
  }, [resolveBin, runDoctor, unavailableMessage]);
  const report = useCallback((result: CodexDoctorResult) => {
    setState({ status: "done", result });
  }, []);
  return { state, run, report };
}

export type SettingsDoctorEngine =
  | "codex"
  | "claude"
  | "kimi"
  | "grok"
  | "opencode"
  | "dsh"
  | "pi"
  | "qoder";

export type SettingsDoctorRunners = Record<
  SettingsDoctorEngine,
  SettingsDoctorRunner
>;

// 注册表：8 个引擎的 runner 按固定顺序实例化，调用方按键取用；
// reportInstallerResult 保留原 onInstallerDoctorResult 的「未知引擎落 claude」兜底。
export function useSettingsDoctorRunners(
  specs: Record<SettingsDoctorEngine, SettingsDoctorSpec>,
): {
  runners: SettingsDoctorRunners;
  reportInstallerResult: (
    engine: CliInstallEngine,
    result: CodexDoctorResult | null,
  ) => void;
} {
  const codex = useDoctorRunner(specs.codex);
  const claude = useDoctorRunner(specs.claude);
  const kimi = useDoctorRunner(specs.kimi);
  const grok = useDoctorRunner(specs.grok);
  const opencode = useDoctorRunner(specs.opencode);
  const dsh = useDoctorRunner(specs.dsh);
  const pi = useDoctorRunner(specs.pi);
  const qoder = useDoctorRunner(specs.qoder);
  const runners: SettingsDoctorRunners = {
    codex,
    claude,
    kimi,
    grok,
    opencode,
    dsh,
    pi,
    qoder,
  };
  const reportInstallerResult = (
    engine: CliInstallEngine,
    result: CodexDoctorResult | null,
  ) => {
    if (!result) {
      return;
    }
    (runners[engine as SettingsDoctorEngine] ?? runners.claude).report(result);
  };
  return { runners, reportInstallerResult };
}
