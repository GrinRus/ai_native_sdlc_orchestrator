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
