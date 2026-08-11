import assert from "node:assert/strict";
import test from "node:test";

import { createAdapterResponseEnvelope } from "../../adapter-sdk/src/index.mjs";
import { executePostValidators, resolvePostValidatorPlan } from "../src/post-validation.mjs";
import { invokeStepAdapterForStep } from "../src/step-adapter-invocation.mjs";

function request({ strict = true, commands = [] } = {}) {
  return {
    run_id: "run-s22",
    step_id: "step-s22",
    route: strict ? { route_profile: { required_output_schema_ref: "runner-final-report@v1", required_output_mode: "json" } } : {},
    policy_bundle: {
      policy: { profile: { post_validators: ["output-schema", "evidence-complete", "validation-commands"] } },
      resolved_bounds: { command_constraints: { allowed_commands: commands } },
    },
  };
}

function response(output, evidenceRefs = ["evidence://raw/s22.json"]) {
  return createAdapterResponseEnvelope({
    request_id: "request-s22",
    adapter_id: "test-adapter",
    status: "success",
    summary: "provider response",
    output,
    evidence_refs: evidenceRefs,
  });
}

function strictOutput(command = "pnpm test") {
  return {
    runner_output: {
      schema_version: 1,
      parse_status: "valid",
      requested_schema_ref: "runner-final-report@v1",
      candidate: {
        status: "completed",
        summary: "done",
        changed_files: [],
        command_result_claims: [{ command, status: "passed" }],
        verification: { status: "pass" },
        risks: [],
        repair_closure: { status: "not_applicable" },
        raw_evidence_ref: "evidence://raw/s22.json",
      },
      raw_evidence_ref: "evidence://raw/s22.json",
    },
    execution_outcome: {
      parsing: { status: "valid" },
      candidate: { status: "accepted" },
    },
  };
}

test("post-validator registry is closed and preserves declared order", () => {
  assert.deepEqual(resolvePostValidatorPlan(["evidence-complete", "output-schema"]), {
    ok: true,
    validators: ["evidence-complete", "output-schema"],
    blockers: [],
  });
  const invalid = resolvePostValidatorPlan(["output-schema", "output-schema", "greedy-json"]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.blockers.length, 2);
});

test("strict output, evidence, and controller command claims are accepted together", () => {
  const result = executePostValidators({
    adapterRequest: request({ commands: ["pnpm test"] }),
    adapterResponse: response(strictOutput()),
    runId: "run-s22",
    stepId: "step-s22",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "pass");
  assert.equal(result.report.validators.every((entry) => entry.status === "pass"), true);
});

test("strict missing envelope fails closed with output-contract repair", () => {
  const result = executePostValidators({
    adapterRequest: request(),
    adapterResponse: response({ execution_outcome: { parsing: { status: "missing" } } }),
    runId: "run-s22",
    stepId: "step-s22",
  });
  assert.equal(result.accepted, false);
  assert.equal(result.status, "fail");
  assert.equal(result.failureClass, "schema-mismatch");
  assert.equal(result.repairKind, "output-contract");
  assert.ok(result.report.validators[0].details.findings.length > 0);
});

test("partial strict work is classified as work-product repair", () => {
  const partial = strictOutput();
  partial.runner_output.candidate.status = "partial";
  const result = executePostValidators({
    adapterRequest: request(),
    adapterResponse: response(partial),
    runId: "run-s22",
    stepId: "step-s22",
  });
  assert.equal(result.accepted, false);
  assert.equal(result.failureClass, "incomplete-result");
  assert.equal(result.repairKind, "work-product");
});

test("evidence and command validators reject duplicates and unknown claims", () => {
  const result = executePostValidators({
    adapterRequest: request({ commands: ["pnpm test"] }),
    adapterResponse: response(strictOutput("rm -rf target"), ["evidence://raw/s22.json", "evidence://raw/s22.json"]),
    runId: "run-s22",
    stepId: "step-s22",
  });
  assert.equal(result.accepted, false);
  assert.equal(result.failureClass, "missing-evidence");
  assert.equal(result.repairKind, "evidence-reconciliation");
  assert.equal(result.report.validators.find((entry) => entry.validator_id === "validation-commands").status, "fail");
});

test("legacy routes remain compatibility-warning and never gain strict pass semantics", () => {
  const result = executePostValidators({
    adapterRequest: request({ strict: false }),
    adapterResponse: response({ runner_output: { prose: "legacy" } }),
    runId: "run-s22",
    stepId: "step-s22",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, "warn");
  assert.equal(result.report.validators[0].details.compatibility, "legacy-output");
});

test("invalid post-validator policy blocks before provider spawn", () => {
  const adapterRequest = request();
  adapterRequest.policy_bundle.policy.profile.post_validators = ["output-schema", "unknown-validator"];
  const result = invokeStepAdapterForStep({
    dryRun: false,
    requestedStepClass: "runner",
    adapterResolution: {
      adapter: { adapter_id: "must-not-spawn", profile: {} },
      execution_candidates: [{ candidate_index: 0, kind: "primary", adapter_id: "must-not-spawn", profile: {} }],
    },
    adapterRequest,
    deliveryPlan: { status: "ready", execution_allowed: true },
    runtimeEvidenceRoot: "/tmp/aor-s22-evidence",
    projectRoot: "/tmp/aor-s22-project",
    executionRoot: "/tmp/aor-s22-execution",
  });
  assert.equal(result.adapterResponse.status, "blocked");
  assert.equal(result.adapterResponse.output.failure_kind, "validator-policy-invalid");
  assert.equal(result.adapterResponse.output.validation_status, "blocked");
});
