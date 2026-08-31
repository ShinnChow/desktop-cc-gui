import type { DomainEvent } from "./eventTypes";
import type { DomainEventRuntime } from "./eventRuntime";

export type DomainEventGovernanceSnapshot = {
  readonly terminalTurnEvents: readonly Extract<
    DomainEvent,
    { type: "turn.completed" | "turn.failed" }
  >[];
};

export type DomainEventGovernanceConsumer = {
  readonly getSnapshot: () => DomainEventGovernanceSnapshot;
  readonly unsubscribe: () => void;
};

function isTerminalTurnEvent(
  event: DomainEvent,
): event is Extract<DomainEvent, { type: "turn.completed" | "turn.failed" }> {
  return event.type === "turn.completed" || event.type === "turn.failed";
}

function buildTerminalTurnKey(
  event: Extract<DomainEvent, { type: "turn.completed" | "turn.failed" }>,
): string {
  return `${event.workspaceId}:${event.sessionId}:${event.turnId}:${event.type}`;
}

export function createDomainEventGovernanceConsumer(
  runtime: DomainEventRuntime,
): DomainEventGovernanceConsumer {
  const terminalTurnEvents = new Map<
    string,
    Extract<DomainEvent, { type: "turn.completed" | "turn.failed" }>
  >();
  const unsubscribe = runtime.subscribe((event) => {
    if (!isTerminalTurnEvent(event)) {
      return;
    }
    terminalTurnEvents.set(buildTerminalTurnKey(event), event);
  });

  return Object.freeze({
    getSnapshot() {
      return Object.freeze({
        terminalTurnEvents: Object.freeze(Array.from(terminalTurnEvents.values())),
      });
    },
    unsubscribe,
  });
}


