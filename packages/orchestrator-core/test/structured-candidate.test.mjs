import assert from "node:assert/strict";
import test from "node:test";

import { buildCorrectionGuidance, extractStructuredCandidate } from "../src/structured-candidate.mjs";
import { selectPlannerCandidate } from "../src/planner-decomposition.mjs";

const candidate = { title: "Bounded task", outcome: "Produce one reviewed preview.", acceptance: ["Preview is reviewable."], work_type: "review", confidence: 0.9 };

test("structured extraction accepts one explicitly named candidate and never walks arbitrary nesting", () => {
  const accepted = extractStructuredCandidate({
    value: { intent_normalization: candidate },
    candidateKeys: ["intent_normalization"],
    isCandidate: (value) => "title" in value,
  });
  assert.equal(accepted.status, "valid");
  assert.deepEqual(accepted.candidate, candidate);
  const providerWrapped = extractStructuredCandidate({
    value: { result: JSON.stringify({ intent_normalization: candidate }) },
    candidateKeys: ["intent_normalization", "result"],
    isCandidate: (value) => "title" in value,
  });
  assert.equal(providerWrapped.status, "valid");
  assert.deepEqual(providerWrapped.candidate, candidate);

  const nested = extractStructuredCandidate({
    value: { wrapper: { intent_normalization: candidate } },
    candidateKeys: ["intent_normalization"],
    isCandidate: (value) => "title" in value,
  });
  assert.equal(nested.status, "unsupported");
  assert.equal(nested.candidate, null);
});

test("structured extraction classifies prose, malformed, and ambiguous output without raw content", () => {
  const prose = extractStructuredCandidate({ value: "Here is the answer: {\"title\":\"secret\"}", candidateKeys: ["intent_normalization"] });
  assert.equal(prose.status, "missing");
  assert.doesNotMatch(JSON.stringify(prose), /secret/u);

  const malformed = extractStructuredCandidate({ value: "{not-json", candidateKeys: ["intent_normalization"] });
  assert.equal(malformed.status, "malformed");

  const ambiguous = extractStructuredCandidate({
    value: { intent_normalization: candidate, candidate: candidate },
    candidateKeys: ["intent_normalization", "candidate"],
    isCandidate: (value) => "title" in value,
  });
  assert.equal(ambiguous.status, "ambiguous");
});

test("planner candidate selection is schema-bound and exposes bounded correction guidance", () => {
  const selection = selectPlannerCandidate({
    adapterOutput: { wrapper: { structured_plan: { local_tasks: [{ task_id: "accidental" }] } } },
  });
  assert.equal(selection.normalization.status, "missing");
  assert.deepEqual(selection.candidate, {});

  const invalid = selectPlannerCandidate({
    adapterOutput: {
      structured_plan: { local_tasks: [{ task_id: "one" }] },
      wave_ticket_candidate: { local_tasks: [{ task_id: "two" }] },
    },
  });
  assert.equal(invalid.normalization.status, "ambiguous");
  assert.equal(invalid.correction_guidance[0].suggested_repair_kind, "output-contract");
});

test("correction guidance is field-level, retryable, bounded, and query-safe", () => {
  const guidance = buildCorrectionGuidance([
    { code: "missing-acceptance", field: "acceptance", summary: "Acceptance is required.", evidence_refs: ["file:///private/path"] },
  ]);
  assert.deepEqual(guidance, [{
    code: "missing-acceptance",
    field: "acceptance",
    summary: "Acceptance is required.",
    retryable: true,
    suggested_repair_kind: "output-contract",
    evidence_refs: [],
  }]);
});
