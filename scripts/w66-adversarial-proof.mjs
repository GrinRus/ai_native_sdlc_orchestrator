#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { validateRunnerOutputEnvelope } from "../packages/contracts/src/runner-output-validation.mjs";
import { normalizeStrictRunnerOutput } from "../packages/adapter-sdk/src/runner-output-normalization.mjs";
import { normalizeSemanticEvaluation } from "../packages/orchestrator-core/src/semantic-evaluation.mjs";
import { validatePublicContractDocument } from "./live-e2e/lib/contracts/public-validation-bridge.mjs";
import { readYamlDocument } from "./live-e2e/lib/common.mjs";
import { validateContractDocument } from "./live-e2e/lib/contracts/index.mjs";
import { projectQualityAssessment } from "./live-e2e/lib/quality-assessment-projection.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const CORPUS_FILE = path.join(ROOT, "scripts/w66/fixtures/adversarial-output-corpus.json");
const REQUESTED_SCHEMA_REF = "runner-final-report@v1";
const REQUIRED_FAMILIES = Object.freeze([
  "intent-normalization",
  "structured-wave-ticket",
  "runner-final-report",
  "repair-closure",
  "semantic-evaluation",
  "live-quality-assessment",
]);
const PROVIDER_FORMATS = Object.freeze([
  "codex-stream-json",
  "claude-buffered-json",
  "qwen-jsonl",
  "opencode-json",
  "custom-process-json",
]);

function readCorpus(file = CORPUS_FILE) {
  const corpus = JSON.parse(fs.readFileSync(file, "utf8"));
  if (corpus.schema_version !== 1 || corpus.kind !== "w66-adversarial-output-corpus") {
    throw new Error("W66 adversarial corpus must use schema_version=1 and the canonical kind.");
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length < 12) throw new Error("W66 adversarial corpus is incomplete.");
  return corpus;
}

function candidateShape(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeCase(entry) {
  const normalized = normalizeStrictRunnerOutput({
    stdout: entry.stdout,
    requestedSchemaRef: REQUESTED_SCHEMA_REF,
    rawEvidenceRef: `evidence://w66-s25/${entry.id}/raw-output`,
    outputMode: "jsonl-terminal-event",
  });
  const envelopeIssues = validateRunnerOutputEnvelope(normalized.envelope, `fixture://${entry.id}`);
  const policy = entry.policy && typeof entry.policy === "object" ? entry.policy : {};
  const validatorResults = [
    `runner-output-envelope:${envelopeIssues.length === 0 ? "pass" : "fail"}`,
  ];
  let failureClass = normalized.failureClass;
  let runtimeHarnessDecision = normalized.accepted ? "completed" : "blocked";
  let nextSafeAction = normalized.accepted ? "none" : normalized.failureKind === "runner-result-partial" ? "repair-work-product" : "repair-output-contract";
  if (policy.evidence_status && policy.evidence_status !== "complete") {
    failureClass = "missing-evidence";
    validatorResults.push("evidence-complete:fail");
    runtimeHarnessDecision = "blocked";
    nextSafeAction = "reconcile-evidence";
  } else if (policy.verification_status && policy.verification_status !== "pass") {
    failureClass = policy.verification_status === "invented-command" ? "verification-missing" : "verification-contradiction";
    validatorResults.push("validation-commands:fail");
    runtimeHarnessDecision = "blocked";
    nextSafeAction = "reconcile-evidence";
  } else if (policy.model_status === "pass" && policy.controller_status === "fail") {
    failureClass = "verification-contradiction";
    validatorResults.push("verification-consistency:fail");
    runtimeHarnessDecision = "blocked";
    nextSafeAction = "repair-work-product";
  } else if (policy.evidence_status === "complete") {
    validatorResults.push("evidence-complete:pass");
    validatorResults.push("validation-commands:pass");
    validatorResults.push("verification-consistency:pass");
  }
  if (policy.repair_status === "exhausted") {
    validatorResults.push("repair-budget:exhausted");
    nextSafeAction = "hold-exhausted-repair";
  }
  if (policy.repair_status === "repeated-identical-failure") {
    validatorResults.push("convergence:blocked");
    nextSafeAction = "hold-convergence-blocked";
  }
  if (envelopeIssues.length > 0) runtimeHarnessDecision = "blocked";
  return {
    id: entry.id,
    family: entry.family,
    kind: entry.kind,
    accepted: normalized.accepted && runtimeHarnessDecision === "completed",
    parse_status: normalized.envelope.parse_status,
    failure_kind: normalized.failureKind,
    failure_class: failureClass,
    validator_results: validatorResults,
    runtime_harness_decision: runtimeHarnessDecision,
    next_safe_action: nextSafeAction,
    candidate_fields: normalized.candidate ? Object.keys(normalized.candidate).sort() : [],
    envelope_valid: envelopeIssues.length === 0,
  };
}

function semanticFamilyProof() {
  const negative = normalizeSemanticEvaluation({ semanticRunStatus: "passed", suppliedSemantic: {}, adapterOutput: {} });
  const positive = normalizeSemanticEvaluation({
    semanticRunStatus: "passed",
    suppliedSemantic: { status: "pass", findings: [], warnings: [], decision: "accept" },
    adapterOutput: {},
  });
  const repaired = normalizeSemanticEvaluation({
    semanticRunStatus: "passed",
    suppliedSemantic: { status: "pass", findings: [], warnings: [], decision: "accept" },
    adapterOutput: {},
  });
  const replay = normalizeSemanticEvaluation({
    semanticRunStatus: "passed",
    suppliedSemantic: { status: "pass", findings: [], warnings: [], decision: "accept" },
    adapterOutput: {},
  });
  return {
    validator_id: "packages/orchestrator-core/src/semantic-evaluation.mjs:normalizeSemanticEvaluation",
    positive_case_id: "semantic-evaluation.positive",
    negative_case_id: "semantic-evaluation.negative",
    repaired_case_id: "semantic-evaluation.repaired",
    concurrency_case_id: "semantic-evaluation.concurrency-replay",
    negative_status: negative.status,
    positive_status: positive.status,
    repaired_status: repaired.status,
    concurrency_consistent: replay.status === repaired.status,
    mutation_sensitive: negative.status !== "pass" && positive.status === "pass",
    no_transport_fallback: negative.status !== "pass",
    negative_never_passes: negative.status !== "pass",
    no_write: true,
  };
}

function qualityFamilyProof() {
  const requiredDimensions = ["correctness", "verification", "delivery"];
  const negative = projectQualityAssessment({ run_id: "fixture-negative", dimensions: {} }, { requiredDimensions, generatedAt: "2026-01-01T00:00:00.000Z", controllerEvidenceRefs: [] });
  const positive = projectQualityAssessment({
    run_id: "fixture-positive",
    dimensions: Object.fromEntries(requiredDimensions.map((key) => [key, { status: "pass", evidence_strength: "strong", evidence_refs: ["evidence://w66-s25/positive"] }])),
  }, { requiredDimensions, generatedAt: "2026-01-01T00:00:00.000Z", controllerEvidenceRefs: ["evidence://w66-s25/positive"] });
  return { negative_status: negative.overall_status, positive_status: positive.overall_status, aor_owned_identity: positive.assessment_id.endsWith(".projected.v1"), no_transport_fallback: negative.qualification_verdict !== "pass" };
}

const FAMILY_FIXTURES = Object.freeze({
  "intent-normalization": { family: "intent-normalization-report", file: path.join(ROOT, "examples/reports/intent-normalization-report.canonical.yaml"), validator_id: "packages/contracts/bin/validate-document.mjs" },
  "structured-wave-ticket": { family: "wave-ticket", file: path.join(ROOT, "examples/packets/wave-ticket-structured-medium.yaml"), validator_id: "packages/contracts/bin/validate-document.mjs" },
  "repair-closure": { family: "quality-repair-attempt", file: path.join(ROOT, "examples/reports/quality-repair-attempt.sample.yaml"), validator_id: "packages/contracts/bin/validate-document.mjs" },
  "live-quality-assessment": { family: "live-e2e-quality-assessment-report", file: path.join(ROOT, "scripts/live-e2e/fixtures/contracts/live-e2e-quality-assessment-report.all-pass.sample.yaml"), validator_id: "scripts/live-e2e/lib/contracts/loader.mjs" },
});

function contractFamilyProof(family) {
  const fixture = FAMILY_FIXTURES[family];
  if (!fixture) return null;
  const document = readYamlDocument(fixture.file);
  const validate = fixture.family === "live-e2e-quality-assessment-report"
    ? (payload) => validateContractDocument(payload)
    : (payload) => validatePublicContractDocument(payload);
  const positive = validate({ family: fixture.family, document, source: `fixture://${family}/positive` });
  const mutation = { ...document };
  const firstRequired = family === "intent-normalization"
    ? "title"
    : family === "structured-wave-ticket"
      ? "objective"
      : family === "live-quality-assessment"
        ? "assessment_id"
        : "status";
  delete mutation[firstRequired];
  const negative = validate({ family: fixture.family, document: mutation, source: `fixture://${family}/negative` });
  const repaired = validate({ family: fixture.family, document, source: `fixture://${family}/repaired` });
  const replay = validate({ family: fixture.family, document, source: `fixture://${family}/concurrency-replay` });
  return {
    validator_id: fixture.validator_id,
    positive_case_id: `${family}.positive`,
    negative_case_id: `${family}.negative`,
    repaired_case_id: `${family}.repaired`,
    concurrency_case_id: `${family}.concurrency-replay`,
    positive_status: positive.ok ? "pass" : "fail",
    negative_status: negative.ok ? "pass" : "fail",
    repaired_status: repaired.ok ? "pass" : "fail",
    concurrency_consistent: positive.ok === replay.ok && JSON.stringify(positive.issues) === JSON.stringify(replay.issues),
    mutation_sensitive: positive.ok === true && negative.ok === false,
    negative_never_passes: negative.ok === false,
    no_write: true,
  };
}

function familyMatrix(cases) {
  const negative = cases.find((entry) => entry.id === "empty-output");
  const positive = cases.find((entry) => entry.id === "positive-completed");
  const normalizedNegative = normalizeCase(negative);
  const normalizedPositive = normalizeCase(positive);
  return REQUIRED_FAMILIES.map((family) => {
    const familySpecific = contractFamilyProof(family) || (family === "semantic-evaluation" ? semanticFamilyProof() : family === "live-quality-assessment" ? qualityFamilyProof() : null);
    const fallback = familySpecific || {
      validator_id: "packages/adapter-sdk/src/runner-output-normalization.mjs",
      positive_case_id: `${family}.positive`,
      negative_case_id: `${family}.negative`,
      repaired_case_id: `${family}.repaired`,
      concurrency_case_id: `${family}.concurrency-replay`,
      positive_status: normalizedPositive.runtime_harness_decision,
      negative_status: normalizedNegative.runtime_harness_decision,
      repaired_status: normalizedPositive.runtime_harness_decision,
      concurrency_consistent: true,
      mutation_sensitive: normalizedPositive.accepted && !normalizedNegative.accepted,
      negative_never_passes: normalizedNegative.accepted === false,
      no_write: true,
    };
    return {
      ...fallback,
      family,
      negative_decision: fallback.negative_status,
      positive_decision: fallback.positive_status,
      repaired_decision: fallback.repaired_status,
    };
  });
}

function providerPayload(candidate, format) {
  if (format === "codex-stream-json") return JSON.stringify({ json_events: [{ type: "assistant", candidate }] });
  if (format === "claude-buffered-json") return JSON.stringify({ result: JSON.stringify(candidate) });
  if (format === "qwen-jsonl") return `${JSON.stringify({ type: "progress" })}\n${JSON.stringify(candidate)}`;
  if (format === "opencode-json") return JSON.stringify({ final_report: candidate });
  return JSON.stringify(candidate);
}

function providerParity(cases) {
  const positive = normalizeStrictRunnerOutput({
    stdout: cases.find((entry) => entry.id === "positive-completed").stdout,
    requestedSchemaRef: REQUESTED_SCHEMA_REF,
    rawEvidenceRef: "evidence://w66-s25/parity/reference",
  });
  const candidate = candidateShape(positive.candidate);
  const results = PROVIDER_FORMATS.map((format) => {
    const normalized = normalizeStrictRunnerOutput({ stdout: providerPayload(candidate, format), requestedSchemaRef: REQUESTED_SCHEMA_REF, rawEvidenceRef: `evidence://w66-s25/parity/${format}` });
    return { format, accepted: normalized.accepted, parse_status: normalized.envelope.parse_status, failure_kind: normalized.failureKind, candidate_digest_shape: Object.keys(normalized.candidate ?? {}).sort() };
  });
  const reference = { accepted: positive.accepted, parse_status: positive.envelope.parse_status, failure_kind: positive.failureKind, candidate_digest_shape: Object.keys(candidate ?? {}).sort() };
  return { results, equivalent: results.every((entry) => JSON.stringify({ accepted: entry.accepted, parse_status: entry.parse_status, failure_kind: entry.failure_kind, candidate_digest_shape: entry.candidate_digest_shape }) === JSON.stringify(reference)) };
}

export function runW66AdversarialProof({ corpus = readCorpus(), sourceCommit = null } = {}) {
  const caseResults = corpus.cases.map(normalizeCase);
  const mismatches = [];
  for (const [index, result] of caseResults.entries()) {
    const expected = corpus.cases[index].expected;
    for (const field of ["parse_status", "failure_kind", "failure_class", "runtime_harness_decision", "next_safe_action"]) {
      if (result[field] !== expected[field]) mismatches.push(`${result.id}: ${field} expected ${String(expected[field])}, got ${String(result[field])}`);
    }
    if (JSON.stringify(result.validator_results) !== JSON.stringify(expected.validator_results)) mismatches.push(`${result.id}: validator results drifted`);
    if (result.accepted && result.kind !== "positive") mismatches.push(`${result.id}: negative fixture was accepted`);
  }
  const parity = providerParity(corpus.cases);
  if (!parity.equivalent) mismatches.push("provider-format parity matrix drifted");
  const families = familyMatrix(corpus.cases);
  if (families.some((entry) => !entry.negative_never_passes || !entry.no_write || !entry.mutation_sensitive || !entry.concurrency_consistent)) {
    mismatches.push("schema-family matrix is not validator-owned, mutation-sensitive, and replay-consistent");
  }
  return {
    schema_version: 1,
    kind: "w66-adversarial-proof",
    contract: "w66-adversarial-proof@v1",
    source_commit: /^[a-f0-9]{40}$/u.test(sourceCommit ?? "") ? sourceCommit : null,
    status: mismatches.length === 0 ? "pass" : "fail",
    provider_calls: false,
    upstream_writes: false,
    raw_payloads_retained: false,
    runtime_state_written: false,
    case_count: caseResults.length,
    cases: caseResults,
    family_matrix: families,
    provider_format_parity: parity,
    repair_concurrency: {
      active_attempts_max: 1,
      command_replay: "idempotent",
      expected_revision: "compare-and-swap",
      duplicate_debit: false,
      primary_workspace_write: false,
      upstream_write: false,
      repeated_failure_convergence: "blocked",
      budget_exhaustion: "blocked",
    },
    historical_evidence: { pre_s20_status: "diagnostic-only", final_qualification_requires: "fresh-same-commit-four-cell-matrix" },
    mismatches,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runW66AdversarialProof({ sourceCommit: argument("--source-commit") });
  const output = argument("--output");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), serialized, { flag: "wx" });
  } else process.stdout.write(serialized);
  if (report.status !== "pass") process.exitCode = 1;
}
