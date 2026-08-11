import { validateContractDocument } from "../../contracts/src/index.mjs";

const REQUIRED_FINAL_REPORT_FIELDS = [
  "status",
  "summary",
  "changed_files",
  "command_result_claims",
  "verification",
  "risks",
  "repair_closure",
];

const FAILURE_CLASS_BY_KIND = Object.freeze({
  "runner-output-missing": "schema-mismatch",
  "runner-output-malformed": "schema-mismatch",
  "runner-output-ambiguous": "schema-mismatch",
  "runner-output-unsupported": "schema-mismatch",
  "runner-result-partial": "incomplete-result",
});

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asOptionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isCandidateShape(value) {
  const record = asRecord(value);
  const present = REQUIRED_FINAL_REPORT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(record, field));
  return present.length === REQUIRED_FINAL_REPORT_FIELDS.length;
}

function parseCandidateText(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const trimmed = value.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/iu.exec(trimmed);
  if (fenced) candidates.unshift(fenced[1].trim());
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isCandidateShape(parsed)) return asRecord(parsed);
    } catch {
      // Try the next provider representation.
    }
  }
  return null;
}

function collectCandidates(value, requestedSchemaRef, output) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectCandidates(entry, requestedSchemaRef, output));
    return;
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return;

  if (record.schema_version === 1 && typeof record.requested_schema_ref === "string" && "candidate" in record) {
    if (record.requested_schema_ref !== requestedSchemaRef) {
      output.unsupported = true;
      return;
    }
    if (record.parse_status !== "valid") {
      output.parseStatus = asOptionalString(record.parse_status) ?? "unsupported";
      return;
    }
    if (asRecord(record.candidate) && Object.keys(asRecord(record.candidate)).length > 0) {
      output.candidates.push(asRecord(record.candidate));
    } else {
      output.unsupported = true;
    }
    return;
  }

  if (isCandidateShape(record)) output.candidates.push(record);
  for (const field of ["candidate", "final_report", "report", "output"]) {
    const nested = record[field];
    if (isCandidateShape(nested)) output.candidates.push(asRecord(nested));
  }
  const parsedResult = parseCandidateText(record.result);
  if (parsedResult) output.candidates.push(parsedResult);
  if (Array.isArray(record.json_events)) collectCandidates(record.json_events, requestedSchemaRef, output);
}

function issueRecord(kind, summary, field = "candidate") {
  return {
    issue_code: kind,
    failure_kind: kind,
    failure_class: FAILURE_CLASS_BY_KIND[kind],
    summary,
    field,
  };
}

function normalizeParseStatus(status) {
  return ["valid", "missing", "malformed", "ambiguous", "unsupported"].includes(status) ? status : "unsupported";
}

/**
 * Extract and accept one strict candidate without exposing provider-native
 * output to the query-safe adapter response.
 *
 * @param {{ stdout: string, requestedSchemaRef: string, rawEvidenceRef: string, outputMode?: string | null }} options
 * @returns {{ envelope: Record<string, unknown>, accepted: boolean, failureKind: string | null, failureClass: string | null, candidate: Record<string, unknown> | null }}
 */
export function normalizeStrictRunnerOutput(options) {
  const stdout = typeof options.stdout === "string" ? options.stdout : "";
  const trimmed = stdout.trim();
  const base = {
    schema_version: 1,
    requested_schema_ref: options.requestedSchemaRef,
    candidate: null,
    normalized_issues: [],
    raw_evidence_ref: options.rawEvidenceRef,
    query_safe: true,
  };
  if (trimmed.length === 0) {
    const kind = "runner-output-missing";
    return { envelope: { ...base, parse_status: "missing", normalized_issues: [issueRecord(kind, "Runner emitted no structured output.")] }, accepted: false, failureKind: kind, failureClass: FAILURE_CLASS_BY_KIND[kind], candidate: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    if (lines.length > 1) {
      const records = [];
      let validJsonl = true;
      for (const line of lines) {
        try { records.push(JSON.parse(line)); } catch { validJsonl = false; break; }
      }
      if (validJsonl) parsed = records;
      else {
        const kind = "runner-output-malformed";
        return { envelope: { ...base, parse_status: "malformed", normalized_issues: [issueRecord(kind, "Runner emitted malformed JSONL.")] }, accepted: false, failureKind: kind, failureClass: FAILURE_CLASS_BY_KIND[kind], candidate: null };
      }
    } else {
      const looksLikeJson = /^[\[{`]/u.test(trimmed);
      const kind = looksLikeJson ? "runner-output-malformed" : "runner-output-missing";
      const parseStatus = looksLikeJson ? "malformed" : "missing";
      const summary = looksLikeJson
        ? "Runner emitted malformed structured output."
        : "Runner emitted prose without a structured candidate.";
      return { envelope: { ...base, parse_status: parseStatus, normalized_issues: [issueRecord(kind, summary)] }, accepted: false, failureKind: kind, failureClass: FAILURE_CLASS_BY_KIND[kind], candidate: null };
    }
  }

  const collected = { candidates: [], unsupported: false, parseStatus: null };
  collectCandidates(parsed, options.requestedSchemaRef, collected);
  if (collected.candidates.length > 1) {
    const kind = "runner-output-ambiguous";
    return { envelope: { ...base, parse_status: "ambiguous", normalized_issues: [issueRecord(kind, "Runner emitted more than one candidate.")] }, accepted: false, failureKind: kind, failureClass: FAILURE_CLASS_BY_KIND[kind], candidate: null };
  }
  if (collected.candidates.length === 0) {
    const kind = collected.unsupported || collected.parseStatus === "unsupported" ? "runner-output-unsupported" : "runner-output-missing";
    const parseStatus = normalizeParseStatus(collected.parseStatus ?? (kind === "runner-output-unsupported" ? "unsupported" : "missing"));
    return { envelope: { ...base, parse_status: parseStatus, normalized_issues: [issueRecord(kind, "Runner output did not contain one requested candidate.")] }, accepted: false, failureKind: kind, failureClass: FAILURE_CLASS_BY_KIND[kind], candidate: null };
  }

  const candidate = collected.candidates[0];
  const validation = validateContractDocument({ family: "runner-final-report", document: candidate, source: "<adapter-runner-output>" });
  if (!validation.ok) {
    const kind = "runner-output-unsupported";
    const normalizedIssues = validation.issues.slice(0, 64).map((entry) => issueRecord(kind, entry.message, entry.field));
    return { envelope: { ...base, parse_status: "unsupported", normalized_issues: normalizedIssues.length > 0 ? normalizedIssues : [issueRecord(kind, "Candidate does not satisfy the requested schema.")] }, accepted: false, failureKind: kind, failureClass: FAILURE_CLASS_BY_KIND[kind], candidate: null };
  }
  if (candidate.status !== "completed") {
    const kind = "runner-result-partial";
    return { envelope: { ...base, parse_status: "valid", candidate, normalized_issues: [issueRecord(kind, `Runner returned non-completed status '${String(candidate.status)}'.`, "status")] }, accepted: false, failureKind: kind, failureClass: FAILURE_CLASS_BY_KIND[kind], candidate };
  }
  return { envelope: { ...base, parse_status: "valid", candidate, normalized_issues: [] }, accepted: true, failureKind: null, failureClass: null, candidate };
}

/**
 * @param {{ route: Record<string, unknown>, adapterProfile: Record<string, unknown> }} options
 * @returns {{ strict: boolean, schemaRef: string | null, outputMode: string | null, supported: boolean, missing: string[] }}
 */
export function resolveStrictOutputCapability(options) {
  const routeProfile = asRecord(options.route.route_profile);
  const schemaRef = asOptionalString(routeProfile.required_output_schema_ref);
  const outputMode = asOptionalString(routeProfile.required_output_mode);
  if (!schemaRef && !outputMode) return { strict: false, schemaRef: null, outputMode: null, supported: true, missing: [] };
  const supportedSchemas = Array.isArray(options.adapterProfile.supported_schema_refs) ? options.adapterProfile.supported_schema_refs : [];
  const supportedModes = Array.isArray(options.adapterProfile.supported_output_modes) ? options.adapterProfile.supported_output_modes : [];
  const missing = [];
  if (schemaRef && !supportedSchemas.includes(schemaRef)) missing.push(`schema ${schemaRef}`);
  if (outputMode && !supportedModes.includes(outputMode)) missing.push(`output mode ${outputMode}`);
  return { strict: true, schemaRef, outputMode, supported: missing.length === 0, missing };
}
