const PUBLIC_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
export const SOURCE_KINDS = Object.freeze(["local-issue", "local-prd", "local-rfc", "local-note", "local-mail"]);
export const DELIVERY_MODES = Object.freeze(["no-write", "patch-only", "local-branch", "fork-first-pr"]);
export const SAFE_MISSION_TEMPLATE_ID = "safe-walkthrough";

export const SAFE_MISSION_TEMPLATE = Object.freeze({
  templateId: SAFE_MISSION_TEMPLATE_ID,
  title: "First AOR walkthrough",
  brief: "Inspect this repository and recommend the next safe SDLC step.",
  goals: "Produce bounded next-action evidence for this project.",
  constraints: "No upstream writes, no source file edits, no external runner execution.",
  kpi: "first-run-ready:First run readiness:ready:status",
  dod: "A next-action report exists under .aor and no project files were edited.",
  sourceRefs: [{ sourceKind: "local-note", ref: "README.md" }],
  deliveryMode: "no-write",
  allowedPaths: "",
  forbiddenPaths: "",
  acknowledgeIncomplete: false,
});

export const EMPTY_MISSION_TEMPLATE = Object.freeze({
  ...SAFE_MISSION_TEMPLATE,
  templateId: "blank-mission",
  title: "",
  brief: "",
  goals: "",
  constraints: "",
  kpi: "",
  dod: "",
  sourceRefs: [],
  allowedPaths: "",
  forbiddenPaths: "",
});

export function splitMissionLines(value) {
  return String(value ?? "").split(/[\n,]/u).map((entry) => entry.trim()).filter(Boolean);
}

export function parseKpi(value) {
  const [kpiId = "", name = "", target = "", measurement = ""] = String(value ?? "").split(":").map((entry) => entry.trim());
  return { kpiId, name, target, measurement };
}

function validateScopePattern(value) {
  return value.length > 0
    && !value.startsWith("/")
    && !/^[a-z]:/iu.test(value)
    && !value.includes("\\")
    && !value.split("/").includes("..")
    && !/[?\[\]\u0000-\u001f\u007f]/u.test(value);
}

export function validateMissionDraft(form) {
  const fieldErrors = {};
  const title = String(form?.title ?? "").trim();
  const brief = String(form?.brief ?? "").trim();
  if (!title) fieldErrors.title = "Enter a Mission title.";
  if (!brief) fieldErrors.brief = "Describe the bounded outcome.";

  const kpis = splitMissionLines(form?.kpi);
  kpis.forEach((line, index) => {
    const parsed = parseKpi(line);
    if (!PUBLIC_ID.test(parsed.kpiId) || !parsed.name || !parsed.target) {
      fieldErrors.kpi = `KPI ${index + 1} must use kpi-id:name:target[:measurement] with a lowercase canonical ID.`;
    }
  });

  const sourceRefs = Array.isArray(form?.sourceRefs) ? form.sourceRefs : [];
  sourceRefs.forEach((source, index) => {
    if (!SOURCE_KINDS.includes(source?.sourceKind) || !String(source?.ref ?? "").trim()) {
      fieldErrors.sourceRefs = `Source ${index + 1} requires a supported local kind and a non-empty reference.`;
    }
  });

  for (const [field, values] of [["allowedPaths", splitMissionLines(form?.allowedPaths)], ["forbiddenPaths", splitMissionLines(form?.forbiddenPaths)]]) {
    if (values.some((value) => !validateScopePattern(value))) fieldErrors[field] = "Use project-relative canonical glob paths without absolute roots, '..', backslashes, '?', or character classes.";
  }
  if (!DELIVERY_MODES.includes(form?.deliveryMode)) fieldErrors.deliveryMode = "Select a supported delivery mode.";

  const missingFields = [
    ["goals", splitMissionLines(form?.goals).length],
    ["constraints", splitMissionLines(form?.constraints).length],
    ["kpis", kpis.length],
    ["definition_of_done", splitMissionLines(form?.dod).length],
    ["source_refs", sourceRefs.length],
  ].filter(([, count]) => count === 0).map(([field]) => field);
  const structurallyValid = Object.keys(fieldErrors).length === 0;
  return {
    structurallyValid,
    complete: structurallyValid && missingFields.length === 0,
    missingFields,
    blockedStages: missingFields.length === 0 ? [] : ["discovery", "specification", "planning", "delivery"],
    fieldErrors,
  };
}

export function missionFlagsFromDraft(form, options = {}) {
  const validation = validateMissionDraft(form);
  if (!validation.structurallyValid) throw new Error("Mission draft is structurally invalid.");
  if (!validation.complete && form?.acknowledgeIncomplete !== true) throw new Error("Incomplete Mission requires explicit acknowledgement.");
  const sourceRefs = Array.isArray(form.sourceRefs) ? form.sourceRefs : [];
  const flags = {
    "mission-id": options.missionId,
    title: String(form.title).trim(),
    brief: String(form.brief).trim(),
    goal: splitMissionLines(form.goals),
    constraint: splitMissionLines(form.constraints),
    kpi: splitMissionLines(form.kpi),
    dod: splitMissionLines(form.dod),
    "delivery-mode": form.deliveryMode,
    "source-kind": sourceRefs.map((entry) => entry.sourceKind),
    "source-ref": sourceRefs.map((entry) => String(entry.ref).trim()),
  };
  if (String(form.allowedPaths ?? "").trim()) flags["allowed-path"] = splitMissionLines(form.allowedPaths);
  if (String(form.forbiddenPaths ?? "").trim()) flags["forbidden-path"] = splitMissionLines(form.forbiddenPaths);
  if (options.followUpSourceHandoffRef) flags["follow-up-source-handoff-ref"] = options.followUpSourceHandoffRef;
  return flags;
}

export function createdMissionOperation(payload, previous = null) {
  const command = payload?.lifecycle_command ?? {};
  return {
    phase: "next-pending",
    missionId: command.command_output?.mission_id ?? previous?.missionId ?? null,
    artifactRefs: [...new Set([...(previous?.artifactRefs ?? []), ...(command.artifact_refs ?? [])])],
    evidenceRefs: [...new Set([...(previous?.evidenceRefs ?? []), ...(command.evidence_refs ?? [])])],
    error: null,
  };
}

export function completedMissionOperation(operation, payload, flow = null) {
  return { ...operation, phase: "complete", nextActionRef: payload?.lifecycle_command?.evidence_refs?.[0] ?? flow?.latest_next_action_report_ref ?? null, flowId: flow?.flow_id ?? null, error: null };
}
