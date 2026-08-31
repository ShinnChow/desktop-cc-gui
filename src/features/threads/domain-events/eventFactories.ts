
import { assertIsoTimestamp, freezeDomainEvent } from "./events/base";
import type { DomainEvent, DomainEventType } from "./eventTypes";


type FactoryInput<T extends DomainEventType> = Omit<Extract<DomainEvent, { type: T }>, "type">;

function createEvent<T extends DomainEventType>(
  type: T,
  input: FactoryInput<T>,
): Extract<DomainEvent, { type: T }> {
  assertIsoTimestamp(input.occurredAt);
  const event = {
    ...input,
    logicalSessionId: input.logicalSessionId ?? input.sessionId,
    runId:
      input.runId ??
      ("turnId" in input && typeof input.turnId === "string"
        ? input.turnId
        : input.sessionId),
    engineId: input.engineId ?? input.engine,
    provenance: input.provenance ?? {
      source: "legacy-domain-event-adapter",
      rawEventType: type,
    },
    type,
  } as Extract<DomainEvent, { type: T }>;
  return freezeDomainEvent(event) as Extract<DomainEvent, { type: T }>;
}

export const domainEventFactories = {
  sessionStarted(input: FactoryInput<"session.started">) {
    return createEvent("session.started", input);
  },
  sessionEnded(input: FactoryInput<"session.ended">) {
    return createEvent("session.ended", input);
  },
  turnStarted(input: FactoryInput<"turn.started">) {
    return createEvent("turn.started", input);
  },
  turnCompleted(input: FactoryInput<"turn.completed">) {
    return createEvent("turn.completed", input);
  },
  turnFailed(input: FactoryInput<"turn.failed">) {
    return createEvent("turn.failed", input);
  },
  messageDeltaAppended(input: FactoryInput<"message.delta.appended">) {
    return createEvent("message.delta.appended", input);
  },
  messageCompleted(input: FactoryInput<"message.completed">) {
    return createEvent("message.completed", input);
  },
  toolStarted(input: FactoryInput<"tool.started">) {
    return createEvent("tool.started", input);
  },
  toolCompleted(input: FactoryInput<"tool.completed">) {
    return createEvent("tool.completed", input);
  },
  usageUpdated(input: FactoryInput<"usage.updated">) {
    return createEvent("usage.updated", input);
  },
  runSettled(input: FactoryInput<"run.settled">) {
    return createEvent("run.settled", input);
  },
};



