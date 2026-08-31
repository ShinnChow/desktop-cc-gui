import { useEffect, useState } from "react";
import type { ExecutionTarget } from "../../../../shared-session/target/types";
import { useAgentProjection } from "../../../../multi-agent/store/agentStore";
import { useCollabUiState } from "../../../../multi-agent/store/collabUiStore";
import { isTerminalAgentStatus } from "../../../../multi-agent/types";
import { isMultiAgentTargetSupported } from "../../../../multi-agent/components/ComposerToggle";

export interface UseComposerCollabGateOptions {
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  disabled: boolean;
  selectedAtomicTarget: ExecutionTarget | null | undefined;
}

export function useComposerCollabGate({
  activeWorkspaceId,
  activeThreadId,
  disabled,
  selectedAtomicTarget,
}: UseComposerCollabGateOptions) {
  const [agentArmed, setAgentArmed] = useState(false);
  const agentProjection = useAgentProjection(activeWorkspaceId, activeThreadId);
  const agentTargetSupported = isMultiAgentTargetSupported(
    selectedAtomicTarget?.engine,
  );
  const hasActiveAgentRun = Boolean(
    agentProjection && !isTerminalAgentStatus(agentProjection.status),
  );
  const collabUi = useCollabUiState(activeWorkspaceId, activeThreadId);
  // 协作运行中（含启动/汇总空窗）pill 显示进行中，避免「未开启」误导
  const collabRunActive =
    hasActiveAgentRun ||
    Boolean(
      collabUi &&
        collabUi.phase !== "idle" &&
        collabUi.phase !== "done",
    );
  // 编排执行中锁定主输入区；终态后 collabRunActive 变 false 自动恢复
  const collabLocksComposer = collabRunActive;
  const composerInteractionDisabled = disabled || collabLocksComposer;
  useEffect(() => {
    setAgentArmed(false);
  }, [activeThreadId, activeWorkspaceId]);
  useEffect(() => {
    if (!agentTargetSupported) {
      setAgentArmed(false);
    }
  }, [agentTargetSupported]);
  return {
    agentArmed,
    setAgentArmed,
    collabRunActive,
    collabLocksComposer,
    composerInteractionDisabled,
  };
}
