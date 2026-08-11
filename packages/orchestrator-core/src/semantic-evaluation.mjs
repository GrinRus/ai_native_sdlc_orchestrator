import { buildCorrectionGuidance, extractStructuredCandidate } from "./structured-candidate.mjs";

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * Normalize a semantic evaluator candidate after structural plan validation.
 * Transport status is never sufficient to produce pass.
 */
export function normalizeSemanticEvaluation({ semanticRunStatus, suppliedSemantic, adapterOutput }) {
  const supplied = asRecord(suppliedSemantic);
  const output = asRecord(adapterOutput);
  const candidateKeys = ["semantic_evaluation", "evaluator_output", "evaluation", "candidate", "result"];
  const raw = Object.keys(supplied).length > 0
    ? extractStructuredCandidate({
        value: supplied,
        isCandidate: (candidate) => ["status", "findings", "warnings", "decision"].some((field) => field in candidate),
      })
    : extractStructuredCandidate({
        value: output,
        candidateKeys,
        requestedSchemaRef: "semantic-evaluation@v1",
        isCandidate: (candidate) => ["status", "findings", "warnings", "decision"].some((field) => field in candidate),
      });
  const extraction = raw.status === "unsupported"
    && Object.keys(supplied).length === 0
    && !candidateKeys.some((key) => key in output)
    ? { ...raw, status: "missing", issues: [] }
    : raw;
  const semantic = asRecord(extraction.candidate);
  const warnings = asStringArray(semantic.warnings);
  const findings = Array.isArray(semantic.findings) ? semantic.findings : [];
  const requestedStatus = String(semantic.status ?? "").toLowerCase();
  let status;
  if (semanticRunStatus !== "passed") status = "fail";
  else if (extraction.status === "missing") status = "not_evaluated";
  else if (extraction.status !== "valid") status = "fail";
  else if (["fail", "failed"].includes(requestedStatus)) status = "fail";
  else if (["block", "blocked", "not_evaluated"].includes(requestedStatus)) status = requestedStatus === "not_evaluated" ? "not_evaluated" : "blocked";
  else if (["warn", "warning"].includes(requestedStatus) || warnings.length > 0 || findings.length > 0) status = "warn";
  else if (requestedStatus === "pass") status = "pass";
  else status = "fail";
  const correctionGuidance = buildCorrectionGuidance([
    ...extraction.issues,
    ...findings.map((entry, index) => ({
      code: typeof entry?.code === "string" ? entry.code : "semantic-finding",
      field: typeof entry?.field === "string" ? entry.field : `findings[${index}]`,
      summary: typeof entry?.summary === "string" ? entry.summary : String(entry),
      suggested_repair_kind: "work-product",
    })),
  ]);
  return { semantic, warnings, findings, status, correctionGuidance, extraction };
}
