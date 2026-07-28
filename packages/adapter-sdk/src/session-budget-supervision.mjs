export const SESSION_BUDGET_SUPERVISION_SOURCE = String.raw`
const sessionBudgetInput = asObject(options.session_budget);
const sessionBudgetConfigured =
  sessionBudgetInput.schema_version === 1 &&
  asPositiveInteger(sessionBudgetInput.warn_after_assistant_turns) !== null &&
  asPositiveInteger(sessionBudgetInput.max_assistant_turns) !== null &&
  asPositiveInteger(sessionBudgetInput.max_tool_calls) !== null &&
  asPositiveInteger(sessionBudgetInput.termination_grace_ms) !== null &&
  sessionBudgetInput.warn_after_assistant_turns < sessionBudgetInput.max_assistant_turns;
const sessionBudgetConfig = sessionBudgetConfigured
  ? {
      warn_after_assistant_turns: sessionBudgetInput.warn_after_assistant_turns,
      max_assistant_turns: sessionBudgetInput.max_assistant_turns,
      max_tool_calls: sessionBudgetInput.max_tool_calls,
      termination_grace_ms: sessionBudgetInput.termination_grace_ms,
    }
  : null;
let sessionBudgetExceeded = false;
let sessionBudgetExhaustedDimension = null;
let sessionBudgetForcedSignal = null;
let sessionBudgetKillTimer = null;
let observedAssistantTurns = 0;
let observedToolCalls = 0;

function countToolCalls(record, event) {
  const raw = asObject(record);
  const message = asObject(raw.message);
  const content = Array.isArray(message.content)
    ? message.content
    : Array.isArray(raw.content)
      ? raw.content
      : [];
  const messageToolCalls = content.filter((entry) => asString(asObject(entry).type) === "tool_use").length;
  return messageToolCalls > 0 ? messageToolCalls : event.kind === "tool_call" ? 1 : 0;
}

function buildSessionBudgetReport() {
  if (!sessionBudgetConfig) return null;
  const warningReached = observedAssistantTurns >= sessionBudgetConfig.warn_after_assistant_turns;
  return {
    schema_version: 1,
    configured: sessionBudgetConfig,
    observed: {
      assistant_turns: observedAssistantTurns,
      tool_calls: observedToolCalls,
      progress_events: providerProgressEventCount,
    },
    status: sessionBudgetExceeded ? "exceeded" : warningReached ? "warn" : "pass",
    exhausted_dimension: sessionBudgetExhaustedDimension,
    termination: {
      requested: sessionBudgetExceeded,
      graceful_signal: sessionBudgetExceeded ? "SIGTERM" : null,
      forced_signal: sessionBudgetForcedSignal,
    },
  };
}

function triggerSessionBudgetExceeded(dimension) {
  if (sessionBudgetExceeded || interrupted || timedOut || !sessionBudgetConfig) return;
  sessionBudgetExceeded = true;
  sessionBudgetExhaustedDimension = dimension;
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
  writeProviderStepStatus({
    ...latestProviderProgressPatch(),
    status: "failed",
    session_budget: buildSessionBudgetReport(),
    recommended_action:
      "Provider session budget was exceeded; preserve partial evidence and retry only with a fresh isolated run.",
    finished_at: new Date().toISOString(),
  });
  killProcessTree(child, "SIGTERM");
  sessionBudgetKillTimer = setTimeout(() => {
    sessionBudgetForcedSignal = "SIGKILL";
    writeProviderStepStatus({
      ...latestProviderProgressPatch(),
      status: "failed",
      session_budget: buildSessionBudgetReport(),
      recommended_action:
        "Provider ignored graceful session-budget termination; the process tree was force-stopped.",
      finished_at: new Date().toISOString(),
    });
    killProcessTree(child, "SIGKILL");
  }, sessionBudgetConfig.termination_grace_ms);
}
`;
