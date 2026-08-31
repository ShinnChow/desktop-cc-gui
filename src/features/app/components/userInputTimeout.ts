import type {
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../../types";
import {
  getUserInputOptionValue,
} from "./UserInputQuestionCard";

/** Ask / request-user-input card countdown and MCP wait bound (30 minutes). */
export const USER_INPUT_TIMEOUT_SECONDS = 30 * 60;
/** Warning window near the end of the countdown. */
export const USER_INPUT_TIMEOUT_WARNING_SECONDS = 60;
/** Milliseconds form for CLI MCP_TOOL_TIMEOUT env (must stay ≥ server wait). */


/**
 * First option of each question is the recommended default (tool schema /
 * product convention: put recommended first).
 */
export function buildRecommendedDefaultAnswers(
  questions: RequestUserInputRequest["params"]["questions"],
): RequestUserInputResponse["answers"] {
  const answers: RequestUserInputResponse["answers"] = {};
  for (const question of questions) {
    if (!question.id) {
      continue;
    }
    const options = question.options ?? [];
    if (options.length === 0) {
      answers[question.id] = { answers: [] };
      continue;
    }
    answers[question.id] = {
      answers: [getUserInputOptionValue(options[0], 0)],
    };
  }
  return answers;
}

export function hasRecommendedDefaultAnswers(
  answers: RequestUserInputResponse["answers"],
): boolean {
  return Object.values(answers).some((entry) =>
    (entry?.answers ?? []).some((value) => String(value ?? "").trim().length > 0),
  );
}
