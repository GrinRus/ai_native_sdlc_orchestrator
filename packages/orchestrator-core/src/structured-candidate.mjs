/**
 * Runner-neutral extraction for model-authored structured candidates.
 *
 * This module deliberately does not walk arbitrary provider output. A consumer
 * must name the accepted envelope/candidate keys and provide a shape predicate;
 * everything else is classified as missing, malformed, ambiguous, or
 * unsupported. Raw provider output never appears in the returned diagnostics.
 */

const PARSE_STATUSES = Object.freeze(["valid", "missing", "malformed", "ambiguous", "unsupported"]);
const REPAIR_KINDS = Object.freeze(["output-contract", "evidence-reconciliation", "work-product"]);
const MAX_CANDIDATE_BYTES = 65_536;
const MAX_ISSUES = 64;

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function isNonEmptyRecord(value) {
  return Object.keys(asRecord(value)).length > 0;
}

function boundedField(value) {
  if (typeof value !== "string" || value.trim().length === 0) return "candidate";
  return value.trim().slice(0, 160);
}

function issue({ code, field = "candidate", summary, retryable = true, repairKind = "output-contract", evidenceRefs = [] }) {
  return {
    code,
    field: boundedField(field),
    summary: String(summary).slice(0, 320),
    retryable: retryable === true,
    suggested_repair_kind: REPAIR_KINDS.includes(repairKind) ? repairKind : "output-contract",
    evidence_refs: Array.isArray(evidenceRefs)
      ? evidenceRefs.filter((entry) => typeof entry === "string" && entry.startsWith("evidence://")).slice(0, 8)
      : [],
  };
}

function parseJsonText(value) {
  if (typeof value !== "string" || value.trim().length === 0) return { status: "missing", value: null };
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const text = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(text);
    return { status: "valid", value: parsed, explicitlyDelimited: Boolean(fenced) };
  } catch {
    const jsonLike = /^[\[{]/u.test(text) || Boolean(fenced);
    return { status: jsonLike ? "malformed" : "missing", value: null };
  }
}

function parseExplicitValue(value) {
  if (typeof value === "string") return parseJsonText(value);
  if (Array.isArray(value)) {
    return value.length === 1 ? { status: "valid", value: value[0] } : { status: "ambiguous", value: null };
  }
  return { status: isNonEmptyRecord(value) ? "valid" : "missing", value };
}

function candidateBytes(candidate) {
  try {
    return Buffer.byteLength(JSON.stringify(candidate), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * @param {{
 *   value: unknown,
 *   candidateKeys?: string[],
 *   isCandidate?: (value: Record<string, unknown>) => boolean,
 *   requestedSchemaRef?: string | null,
 *   rawEvidenceRef?: string | null,
 * }} options
 * @returns {{ status: string, candidate: Record<string, unknown> | null, source: string | null, issues: Array<Record<string, unknown>>, repaired: boolean }}
 */
export function extractStructuredCandidate(options) {
  const candidateKeys = Array.isArray(options.candidateKeys)
    ? [...new Set(options.candidateKeys.filter((entry) => typeof entry === "string" && entry.trim().length > 0))]
    : [];
  const isCandidate = typeof options.isCandidate === "function" ? options.isCandidate : isNonEmptyRecord;
  const evidenceRefs = options.rawEvidenceRef?.startsWith("evidence://") ? [options.rawEvidenceRef] : [];
  const rootParsed = typeof options.value === "string" ? parseJsonText(options.value) : { status: "valid", value: options.value };
  if (rootParsed.status !== "valid") {
    const code = rootParsed.status === "malformed" ? "structured-output-malformed" : "structured-output-missing";
    return {
      status: rootParsed.status,
      candidate: null,
      source: null,
      repaired: false,
      issues: [issue({ code, summary: rootParsed.status === "malformed" ? "Structured output is not valid JSON." : "No explicitly delimited structured candidate was emitted.", evidenceRefs })],
    };
  }

  const root = rootParsed.value;
  const record = asRecord(root);
  if (!isNonEmptyRecord(record)) {
    return {
      status: "missing",
      candidate: null,
      source: null,
      repaired: false,
      issues: [issue({ code: "structured-output-missing", summary: "Structured output did not contain a candidate object.", evidenceRefs })],
    };
  }

  if (record.schema_version === 1 && typeof record.requested_schema_ref === "string" && "candidate" in record) {
    if (options.requestedSchemaRef && record.requested_schema_ref !== options.requestedSchemaRef) {
      return {
        status: "unsupported",
        candidate: null,
        source: "normalized-envelope",
        repaired: false,
        issues: [issue({ code: "structured-output-unsupported", field: "requested_schema_ref", summary: "Candidate envelope requested an unsupported schema.", evidenceRefs })],
      };
    }
    if (record.parse_status !== "valid") {
      const parseStatus = PARSE_STATUSES.includes(record.parse_status) ? record.parse_status : "unsupported";
      return {
        status: parseStatus,
        candidate: null,
        source: "normalized-envelope",
        repaired: false,
        issues: [issue({ code: `structured-output-${parseStatus}`, field: "parse_status", summary: `Normalized envelope is '${parseStatus}' and cannot be accepted.`, evidenceRefs })],
      };
    }
    const envelopeCandidate = asRecord(record.candidate);
    if (!isCandidate(envelopeCandidate)) {
      return {
        status: "unsupported",
        candidate: null,
        source: "normalized-envelope",
        repaired: false,
        issues: [issue({ code: "structured-output-unsupported", field: "candidate", summary: "Normalized candidate does not satisfy the requested consumer shape.", evidenceRefs })],
      };
    }
    return acceptCandidate(envelopeCandidate, "normalized-envelope", isCandidate, evidenceRefs);
  }

  const matches = [];
  for (const key of candidateKeys) {
    if (!(key in record)) continue;
    const parsed = parseExplicitValue(record[key]);
    if (parsed.status !== "valid") {
      matches.push({ key, ...parsed });
      continue;
    }
    const parsedRecord = asRecord(parsed.value);
    const nestedKeys = candidateKeys.filter((nestedKey) => nestedKey !== key && nestedKey in parsedRecord);
    if (nestedKeys.length > 1) {
      matches.push({ key, status: "ambiguous", value: null });
      continue;
    }
    const nestedKey = nestedKeys[0];
    const nested = nestedKey ? parseExplicitValue(parsedRecord[nestedKey]) : { status: "valid", value: parsed.value };
    const candidate = asRecord(nested.value);
    matches.push({ key: nestedKey ? `${key}.${nestedKey}` : key, status: nested.status === "valid" && isCandidate(candidate) ? "valid" : nested.status, value: candidate });
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      candidate: null,
      source: null,
      repaired: false,
      issues: [issue({ code: "structured-output-ambiguous", summary: "More than one explicitly named structured candidate was emitted.", evidenceRefs })],
    };
  }
  if (matches.length === 1) {
    const match = matches[0];
    if (match.status !== "valid") {
      const status = match.status === "malformed" ? "malformed" : match.status === "ambiguous" ? "ambiguous" : "unsupported";
      return {
        status,
        candidate: null,
        source: match.key,
        repaired: false,
        issues: [issue({ code: `structured-output-${status}`, field: match.key, summary: `Explicit candidate '${match.key}' is ${status} or unsupported.`, evidenceRefs })],
      };
    }
    return acceptCandidate(match.value, match.key, isCandidate, evidenceRefs);
  }

  if (isCandidate(record)) return acceptCandidate(record, "direct-candidate", isCandidate, evidenceRefs);

  return {
    status: "unsupported",
    candidate: null,
    source: null,
    repaired: false,
    issues: [issue({ code: "structured-output-unsupported", summary: "Output contained objects, but none matched an explicitly accepted candidate shape.", evidenceRefs })],
  };
}

function acceptCandidate(candidate, source, isCandidate, evidenceRefs) {
  if (!isCandidate(candidate)) {
    return {
      status: "unsupported",
      candidate: null,
      source,
      repaired: false,
      issues: [issue({ code: "structured-output-unsupported", field: source, summary: "Candidate does not satisfy the requested consumer shape.", evidenceRefs })],
    };
  }
  const bytes = candidateBytes(candidate);
  if (bytes > MAX_CANDIDATE_BYTES) {
    return {
      status: "unsupported",
      candidate: null,
      source,
      repaired: false,
      issues: [issue({ code: "structured-output-size-limit", field: source, summary: "Structured candidate exceeds the bounded 65,536-byte limit.", evidenceRefs })],
    };
  }
  return { status: "valid", candidate, source, issues: [], repaired: false };
}

/**
 * Convert extractor findings into one shared, bounded correction surface.
 * @param {Array<Record<string, unknown>>} issues
 * @param {{ repairKind?: string, evidenceRefs?: string[] }} options
 */
export function buildCorrectionGuidance(issues, options = {}) {
  const repairKind = REPAIR_KINDS.includes(options.repairKind) ? options.repairKind : "output-contract";
  return (Array.isArray(issues) ? issues : []).slice(0, MAX_ISSUES).map((entry) => ({
    code: String(entry.code ?? "structured-output-invalid"),
    field: boundedField(entry.field),
    summary: String(entry.summary ?? "Structured output requires correction.").slice(0, 320),
    retryable: entry.retryable !== false,
    suggested_repair_kind: REPAIR_KINDS.includes(entry.suggested_repair_kind) ? entry.suggested_repair_kind : repairKind,
    evidence_refs: Array.isArray(options.evidenceRefs)
      ? options.evidenceRefs.filter((ref) => typeof ref === "string" && ref.startsWith("evidence://")).slice(0, 8)
      : Array.isArray(entry.evidence_refs)
        ? entry.evidence_refs.filter((ref) => typeof ref === "string" && ref.startsWith("evidence://")).slice(0, 8)
        : [],
  }));
}

export const STRUCTURED_CANDIDATE_LIMIT_BYTES = MAX_CANDIDATE_BYTES;
