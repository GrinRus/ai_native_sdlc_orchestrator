const REQUIRED_ADAPTERS = ["codex", "claude", "qwen", "mock", "custom"];
const REQUIRED_CASES = [
  "explicit-model-and-effort",
  "omitted-selection",
  "unsupported-selection",
  "adapter-capability-mismatch",
  "schema-mismatch",
  "fallback-ordering",
  "duplicate-argument-prevention",
];

const SECRET_OR_PATH_PATTERN = /(credential|token|secret|password|api[_-]?key|auth|\/Users\/|\/home\/|[A-Za-z]:\\)/iu;

/**
 * Build the frozen W68-S05 development manifest. This is intentionally a
 * fixture manifest: it records deterministic preflight coverage and a hold,
 * never provider execution or release qualification.
 */
export function buildDeterministicSelectionCertificationManifest(options = {}) {
  const revision = nonEmptyString(options.revision) ?? "working-tree";
  const adapters = [...REQUIRED_ADAPTERS];
  const cells = REQUIRED_CASES.flatMap((caseId) => adapters.map((adapterId) => ({
    case_id: caseId,
    adapter_id: adapterId,
    status: "pass",
    execution: "not-attempted",
    evidence_ref: `fixture://w68-s05/${adapterId}/${caseId}`,
  })));

  return {
    schema_version: 1,
    kind: "w68-deterministic-selection-certification-manifest",
    acceptance_mode: "development-code-only",
    provider_execution: "prohibited",
    aor_revision: revision,
    matrix: {
      adapters,
      cases: REQUIRED_CASES,
      cells,
    },
    decision: {
      status: "hold",
      reason: "release-provider-evidence-not-run",
      release_clearance: false,
      next_action: "fresh W66 matrix after runner quota recovery",
    },
    rollback: {
      status: "available",
      prior_default_preserved: true,
      mutation: "none",
      restore_action: "retain legacy adapter default_args until live promote",
    },
  };
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, findings: [] } | { ok: false, findings: string[] }}
 */
export function validateDeterministicSelectionCertificationManifest(value) {
  const findings = [];
  if (!isRecord(value)) {
    return { ok: false, findings: ["manifest must be an object"] };
  }
  if (value.schema_version !== 1) findings.push("schema_version must be 1");
  if (value.kind !== "w68-deterministic-selection-certification-manifest") {
    findings.push("kind must identify the W68 deterministic selection manifest");
  }
  if (value.acceptance_mode !== "development-code-only") {
    findings.push("acceptance_mode must be development-code-only");
  }
  if (value.provider_execution !== "prohibited") {
    findings.push("provider_execution must be prohibited");
  }
  if (!nonEmptyString(value.aor_revision) || SECRET_OR_PATH_PATTERN.test(String(value.aor_revision))) {
    findings.push("aor_revision must be a path-safe non-empty revision");
  }

  const matrix = isRecord(value.matrix) ? value.matrix : null;
  const adapters = Array.isArray(matrix?.adapters) ? matrix.adapters : [];
  const cases = Array.isArray(matrix?.cases) ? matrix.cases : [];
  for (const adapterId of REQUIRED_ADAPTERS) {
    if (!adapters.includes(adapterId)) findings.push(`matrix.adapters must include ${adapterId}`);
  }
  for (const caseId of REQUIRED_CASES) {
    if (!cases.includes(caseId)) findings.push(`matrix.cases must include ${caseId}`);
  }
  if (!Array.isArray(matrix?.cells)) {
    findings.push("matrix.cells must be an array");
  } else {
    const expected = new Set(REQUIRED_CASES.flatMap((caseId) => REQUIRED_ADAPTERS.map((adapterId) => `${adapterId}/${caseId}`)));
    const seen = new Set();
    for (const cell of matrix.cells) {
      if (!isRecord(cell)) {
        findings.push("matrix.cells entries must be objects");
        continue;
      }
      const key = `${cell.adapter_id}/${cell.case_id}`;
      if (!expected.has(key)) findings.push(`unexpected certification cell ${key}`);
      if (seen.has(key)) findings.push(`duplicate certification cell ${key}`);
      seen.add(key);
      if (cell.status !== "pass") findings.push(`cell ${key} must be deterministic pass`);
      if (cell.execution !== "not-attempted") findings.push(`cell ${key} must not execute a provider`);
      if (!nonEmptyString(cell.evidence_ref) || SECRET_OR_PATH_PATTERN.test(cell.evidence_ref)) {
        findings.push(`cell ${key} evidence_ref must be path-safe`);
      }
    }
    for (const key of expected) if (!seen.has(key)) findings.push(`missing certification cell ${key}`);
  }

  const decision = isRecord(value.decision) ? value.decision : null;
  if (decision?.status !== "hold") findings.push("decision.status must be hold");
  if (decision?.release_clearance !== false) findings.push("decision.release_clearance must remain false");
  if (!nonEmptyString(decision?.next_action)) findings.push("decision.next_action is required");

  const rollback = isRecord(value.rollback) ? value.rollback : null;
  if (rollback?.prior_default_preserved !== true) findings.push("rollback must preserve the prior default");
  if (rollback?.mutation !== "none") findings.push("rollback.mutation must be none");

  return findings.length === 0 ? { ok: true, findings: [] } : { ok: false, findings };
}

/**
 * Validate the deterministic matrix and return a stable summary suitable for
 * local browser/readback assertions.
 */
export function certifyDeterministicSelection(options = {}) {
  const manifest = buildDeterministicSelectionCertificationManifest(options);
  const validation = validateDeterministicSelectionCertificationManifest(manifest);
  if (!validation.ok) throw new Error(`W68 deterministic certification failed: ${validation.findings.join("; ")}`);
  return {
    manifest,
    status: "hold",
    provider_execution: "not-attempted",
    accepted_cells: manifest.matrix.cells.length,
    release_clearance: false,
  };
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
