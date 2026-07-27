function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function classifyPlanningRef(ref) {
  const value = String(ref);
  if (value.includes("project-analysis")) return "project-analysis";
  if (value.includes("discovery-research")) return "research";
  if (value.includes("spec")) return "specification";
  if (value.includes("wave-ticket") || value.includes("plan-v")) return "previous-plan";
  return "approved-intake";
}

export function buildPlanningInputManifest(refs) {
  return refs.map((ref, index) => ({
    input_id: `planning-input.${index + 1}`,
    kind: classifyPlanningRef(ref),
    ref,
  }));
}

export function selectPlannerCandidate({ explicitCandidate, adapterOutput }) {
  const explicit = asRecord(explicitCandidate);
  if (Object.keys(explicit).length > 0) return { candidate: explicit, source: "explicit-candidate" };
  const output = asRecord(adapterOutput);
  const waveTicket = asRecord(output.wave_ticket_candidate);
  if (Object.keys(waveTicket).length > 0) return { candidate: waveTicket, source: "runner-wave-ticket" };
  const structuredPlan = asRecord(output.structured_plan);
  if (Object.keys(structuredPlan).length > 0) return { candidate: structuredPlan, source: "runner-structured-plan" };
  return { candidate: {}, source: "mission-derived-fallback" };
}

export function validateMissionSpecificPlannerCandidate({ candidate, featureSize, source }) {
  const normalizedSize = ["small", "medium", "large", "xlarge"].includes(String(featureSize))
    ? String(featureSize)
    : "medium";
  const structured = asRecord(candidate);
  const tasks = Array.isArray(structured.local_tasks)
    ? structured.local_tasks.filter((entry) => Object.keys(asRecord(entry)).length > 0)
    : [];
  if (normalizedSize === "small" && tasks.length === 0) {
    return { ok: true, fallback_allowed: true, blocker: null };
  }
  if (tasks.length === 0) {
    return {
      ok: false,
      fallback_allowed: false,
      blocker: {
        code: "mission-specific-plan-required",
        feature_size: normalizedSize,
        candidate_source: String(source || "missing"),
        message: `Feature size '${normalizedSize}' requires mission-specific structured local_tasks; compact fallback is small-only.`,
      },
    };
  }
  const malformedTaskIndexes = tasks.flatMap((task, index) => {
    const record = asRecord(task);
    const missing = ["task_id", "title", "objective"].filter(
      (field) => typeof record[field] !== "string" || record[field].trim().length === 0,
    );
    return missing.length > 0 ? [{ index, missing_fields: missing }] : [];
  });
  return malformedTaskIndexes.length === 0
    ? { ok: true, fallback_allowed: false, blocker: null }
    : {
        ok: false,
        fallback_allowed: false,
        blocker: {
          code: "mission-specific-plan-malformed",
          feature_size: normalizedSize,
          candidate_source: String(source || "unknown"),
          malformed_tasks: malformedTaskIndexes,
          message: "Mission-specific structured tasks must declare stable task_id, title, and objective fields.",
        },
      };
}

export function resolveMissionSpecificPlannerCandidate({ plannerCandidate, missionCandidate, featureSize }) {
  const explicit = asRecord(plannerCandidate);
  const mission = asRecord(missionCandidate);
  const candidate = Object.keys(explicit).length > 0 ? explicit : mission;
  const source = Object.keys(explicit).length > 0
    ? "planner-candidate"
    : Object.keys(mission).length > 0
      ? "mission-request"
      : "missing";
  const validation = validateMissionSpecificPlannerCandidate({ candidate, featureSize, source });
  if (!validation.ok) {
    const error = new Error(validation.blocker.message);
    error.code = validation.blocker.code;
    error.blocker = validation.blocker;
    throw error;
  }
  return candidate;
}

export function revisionAdviceForValidationIssue(issue) {
  const field = String(issue?.field ?? "plan");
  if (String(issue?.message ?? "").includes("mission-split-required")) {
    return "Split the mission into independently acceptable outcomes with no more than seven tasks each.";
  }
  if (field.includes("depends_on")) return "Correct task dependencies so every reference is known and the task graph is acyclic.";
  if (field.includes("criteria")) return "Assign every Goal, KPI, Definition of Done, and acceptance criterion to at least one task.";
  if (field.includes("verification")) return "Add executable command groups, deterministic validators, or an explicit manual check with success conditions.";
  if (field.includes("scope")) return "Narrow task repository, component, and path scope to the approved mission boundary.";
  if (field.includes("expected_evidence")) return "Assign every required evidence family to at least one task.";
  return `Revise '${field}' to satisfy the deterministic structured-plan contract.`;
}
