#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { listControlPlaneRoutes } from "../packages/orchestrator-core/src/control-plane/http/http-router.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultProofFixturePath = path.posix.join(
  "scripts",
  "production-readiness",
  "fixtures",
  "w25-s03-production-proof.json",
);
const defaultOpenApiPath = "docs/contracts/control-plane-api.openapi.json";
const defaultStoryMatrixPath = "docs/product/user-story-coverage-matrix.md";
const defaultAuditLedgerPath = "docs/research/07-codebase-audit-remediation-ledger-2026-07.json";
const CLOSED_AUDIT_STATES = new Set(["resolved", "superseded"]);
const ALLOWED_AUDIT_STATES = new Set(["open", "in-progress", "resolved", "accepted-risk", "superseded"]);

function resolvePath(rootDir, file) {
  return path.isAbsolute(file) ? file : path.join(rootDir, file);
}

function readText(rootDir, file) {
  return fs.readFileSync(resolvePath(rootDir, file), "utf8");
}

function readJson(rootDir, file) {
  return JSON.parse(readText(rootDir, file));
}

function fileExists(rootDir, file) {
  return fs.existsSync(resolvePath(rootDir, file));
}

function pass(id, summary, evidence = []) {
  return {
    id,
    status: "pass",
    summary,
    evidence,
  };
}

function fail(id, summary, findings, evidence = []) {
  return {
    id,
    status: "fail",
    summary,
    findings,
    evidence,
  };
}

function checkAuditRemediationLedger(rootDir, auditLedgerPath = defaultAuditLedgerPath) {
  const findings = [];
  if (!fileExists(rootDir, auditLedgerPath)) {
    return fail("audit-remediation-ledger", "Audit remediation ledger is missing.", [`${auditLedgerPath} is missing.`], [
      auditLedgerPath,
    ]);
  }

  let ledger;
  try {
    ledger = readJson(rootDir, auditLedgerPath);
  } catch (error) {
    return fail(
      "audit-remediation-ledger",
      "Audit remediation ledger is invalid.",
      [`${auditLedgerPath} is not valid JSON: ${error.message}`],
      [auditLedgerPath],
    );
  }

  const entries = Array.isArray(ledger.findings) ? ledger.findings : [];
  const byId = new Map();
  for (const entry of entries) {
    const id = typeof entry?.finding_id === "string" ? entry.finding_id.trim() : "";
    if (!id) {
      findings.push("Every audit ledger entry must have a non-empty finding_id.");
      continue;
    }
    if (byId.has(id)) findings.push(`Audit finding '${id}' is duplicated.`);
    byId.set(id, entry);
    if (!ALLOWED_AUDIT_STATES.has(entry.state)) findings.push(`Audit finding '${id}' has invalid state '${entry.state}'.`);
    if (!Array.isArray(entry.owner_slices) || entry.owner_slices.length === 0) {
      findings.push(`Audit finding '${id}' must declare owner_slices.`);
    }
    if (typeof entry.release_blocking !== "boolean") {
      findings.push(`Audit finding '${id}' must declare release_blocking as a boolean.`);
    }
    const evidenceRefs = Array.isArray(entry.evidence_refs) ? entry.evidence_refs : [];
    if (!Array.isArray(entry.evidence_refs) || !Array.isArray(entry.limitations)) {
      findings.push(`Audit finding '${id}' must declare evidence_refs and limitations arrays.`);
    }
    if (entry.state === "resolved" && evidenceRefs.length === 0) {
      findings.push(`Resolved audit finding '${id}' must cite evidence_refs.`);
    }
  }

  for (let sequence = 1; sequence <= 55; sequence += 1) {
    const id = `AUD-${String(sequence).padStart(3, "0")}`;
    if (!byId.has(id)) findings.push(`Audit ledger must include ${id}.`);
  }
  if (!byId.has("project-context-cwd-divergence")) {
    findings.push("Audit ledger must include project-context-cwd-divergence.");
  }

  if (findings.length > 0) {
    return fail("audit-remediation-ledger", "Audit remediation ledger is incomplete or invalid.", findings, [auditLedgerPath]);
  }

  const blockingInvariants = entries
    .filter((entry) => entry.release_blocking === true && !CLOSED_AUDIT_STATES.has(entry.state))
    .map((entry) => ({
      finding_id: entry.finding_id,
      state: entry.state,
      owner_slices: entry.owner_slices,
      summary: entry.summary,
    }))
    .sort((left, right) => left.finding_id.localeCompare(right.finding_id));

  return {
    ...pass(
      "audit-remediation-ledger",
      blockingInvariants.length > 0
        ? `Audit ledger is valid with ${blockingInvariants.length} open release-blocking invariants.`
        : "Audit ledger is valid and has no open release-blocking invariants.",
      [auditLedgerPath],
    ),
    blocking_invariants: blockingInvariants,
  };
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = [];
  let current = "";
  let escaped = false;
  let inCodeSpan = false;

  for (const char of inner) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "`") {
      inCodeSpan = !inCodeSpan;
      current += char;
      continue;
    }
    if (char === "|" && !inCodeSpan) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseDelimitedMarkdownList(value) {
  const normalized = value.trim();
  if (!normalized || normalized === "none") return [];
  return normalized
    .split(",")
    .map((item) => item.trim().replace(/^`|`$/gu, ""))
    .filter(Boolean);
}

function parseStoryCoverageMatrix(rootDir, storyMatrixPath = defaultStoryMatrixPath) {
  const matrix = readText(rootDir, storyMatrixPath);
  const rows = new Map();

  for (const line of matrix.split(/\r?\n/u)) {
    if (!line.startsWith("| ") || line.includes("|---")) continue;
    if (line.startsWith("| Story ID ")) continue;
    const cells = splitMarkdownTableRow(line);
    if (cells.length !== 7) continue;
    const [storyId, roleCluster, tier, outcome, coverageStatus, evidence, gapSliceCell] = cells.map((cell) =>
      cell.trim(),
    );
    rows.set(storyId, {
      storyId,
      roleCluster,
      tier,
      outcome,
      coverageStatus,
      evidence,
      gapSlices: parseDelimitedMarkdownList(gapSliceCell),
    });
  }

  const countsMatch = /Current (?:W\d+-S\d+|planning) status counts: `baseline-covered=(\d+)`, `proof-covered=(\d+)`, `partial=(\d+)`, `blocked=(\d+)`/u.exec(
    matrix,
  );
  const documentedCounts = countsMatch
    ? {
        "baseline-covered": Number(countsMatch[1]),
        "proof-covered": Number(countsMatch[2]),
        partial: Number(countsMatch[3]),
        blocked: Number(countsMatch[4]),
      }
    : null;

  return {
    rows,
    documentedCounts,
  };
}

function validateProductionProofFixture(rootDir, proofFixturePath = defaultProofFixturePath) {
  const findings = [];
  if (!fileExists(rootDir, proofFixturePath)) {
    findings.push(`${proofFixturePath} is missing.`);
    return findings;
  }

  let proof;
  try {
    proof = readJson(rootDir, proofFixturePath);
  } catch (error) {
    findings.push(`${proofFixturePath} is not valid JSON: ${error.message}`);
    return findings;
  }

  const externalRunnerMode = String(proof.proof_method?.external_runner_mode ?? "");
  const changedPaths = [
    ...(Array.isArray(proof.changed_paths) ? proof.changed_paths : []),
    ...(Array.isArray(proof.no_upstream_write_assertion?.changed_paths)
      ? proof.no_upstream_write_assertion.changed_paths
      : []),
    ...(Array.isArray(proof.evidence?.runtime_harness?.meaningful_changed_paths)
      ? proof.evidence.runtime_harness.meaningful_changed_paths
      : []),
  ];

  if (proof.proof_scope !== "full_code_changing_runtime") {
    findings.push(`${proofFixturePath} must use proof_scope=full_code_changing_runtime.`);
  }
  if (proof.real_code_change_proof_complete !== true) {
    findings.push(`${proofFixturePath} must set real_code_change_proof_complete=true.`);
  }
  if (externalRunnerMode !== "real-external-process") {
    findings.push(`${proofFixturePath} must use external_runner_mode=real-external-process.`);
  }
  if (externalRunnerMode.includes("mock") || proof.proof_method?.mock_runner_allowed === true) {
    findings.push(`${proofFixturePath} must not be mock-backed.`);
  }
  if (proof.proof_method?.examples_root_override || proof.source_run?.examples_root_override) {
    findings.push(`${proofFixturePath} must not use examples_root_override.`);
  }

  const noUpstreamWrite = proof.no_upstream_write_assertion ?? {};
  if (noUpstreamWrite.status !== "pass") {
    findings.push(`${proofFixturePath} must record no_upstream_write_assertion.status=pass.`);
  }
  if (noUpstreamWrite.write_back_to_remote !== false) {
    findings.push(`${proofFixturePath} must record write_back_to_remote=false.`);
  }
  if (noUpstreamWrite.delivery_mode !== "patch-only") {
    findings.push(`${proofFixturePath} must record delivery_mode=patch-only.`);
  }
  if (noUpstreamWrite.target_head_unchanged !== true) {
    findings.push(`${proofFixturePath} must record target_head_unchanged=true.`);
  }
  if (Array.isArray(noUpstreamWrite.commit_refs) && noUpstreamWrite.commit_refs.length > 0) {
    findings.push(`${proofFixturePath} must not record upstream commit refs.`);
  }
  if (changedPaths.length === 0) {
    findings.push(`${proofFixturePath} must record meaningful implementation changed paths.`);
  }
  for (const changedPath of changedPaths) {
    if (path.isAbsolute(changedPath) || changedPath.startsWith(".aor/") || changedPath.includes("/.aor/")) {
      findings.push(`${proofFixturePath} changed path is not sanitized: ${changedPath}`);
    }
  }

  const serializedProof = JSON.stringify(proof);
  const forbiddenPatterns = [
    { pattern: /\/Users\//u, label: "local absolute path" },
    { pattern: /\.aor\/projects/u, label: "runtime project path" },
    { pattern: /target-checkouts/u, label: "target checkout path" },
    { pattern: /ctx7sk-[A-Za-z0-9_-]+/u, label: "Context7 token" },
    { pattern: /sk-[A-Za-z0-9_-]{10,}/u, label: "API secret" },
  ];
  for (const { pattern, label } of forbiddenPatterns) {
    if (pattern.test(serializedProof)) {
      findings.push(`${proofFixturePath} contains ${label}; proof fixtures must be sanitized.`);
    }
  }

  return findings;
}

function checkBaselineBoundary(rootDir) {
  const packageJson = readJson(rootDir, "package.json");
  const findings = [];
  if (packageJson.scripts?.check !== "node ./scripts/lint.mjs && node ./scripts/test.mjs && node ./scripts/build.mjs") {
    findings.push("package.json scripts.check must remain the repository-integrity gate.");
  }
  if (packageJson.scripts?.["production:ready"] !== "node ./scripts/production-readiness.mjs") {
    findings.push("package.json must expose production:ready as the separate production-readiness gate.");
  }
  if (String(packageJson.scripts?.check ?? "").includes("production-readiness")) {
    findings.push("pnpm check must not invoke the production-readiness gate.");
  }

  if (findings.length > 0) {
    return fail("baseline-boundary", "Baseline and production gates are not separated.", findings, ["package.json"]);
  }
  return pass("baseline-boundary", "`pnpm check` remains baseline integrity; `pnpm production:ready` is separate.", [
    "package.json",
  ]);
}

function checkProductionProof(rootDir, proofFixturePath) {
  const findings = validateProductionProofFixture(rootDir, proofFixturePath);
  if (findings.length > 0) {
    return fail("w25-real-proof-fixture", "W25 real production proof evidence is missing or unsafe.", findings, [
      proofFixturePath,
    ]);
  }
  return pass("w25-real-proof-fixture", "W25 proof fixture is real, code-changing, pass, and no-upstream-write.", [
    proofFixturePath,
  ]);
}

function checkStoryHonesty(rootDir, storyMatrixPath = defaultStoryMatrixPath) {
  const { rows, documentedCounts } = parseStoryCoverageMatrix(rootDir, storyMatrixPath);
  const findings = [];
  if (rows.size !== 116) {
    findings.push(`Expected 116 user-story rows, found ${rows.size}.`);
  }

  const actualCounts = {
    "baseline-covered": 0,
    "proof-covered": 0,
    partial: 0,
    blocked: 0,
  };
  for (const row of rows.values()) {
    if (Object.hasOwn(actualCounts, row.coverageStatus)) actualCounts[row.coverageStatus] += 1;
    if (row.gapSlices.includes("W26-S01")) {
      findings.push(`${row.storyId} still points at W26-S01 as a future gap after the production gate exists.`);
    }
    if (row.gapSlices.includes("W26-S03")) {
      findings.push(`${row.storyId} still points at W26-S03 as a future gap after release documentation exists.`);
    }
  }
  if (!documentedCounts) {
    findings.push("Story matrix status count line is missing.");
  } else {
    for (const [status, count] of Object.entries(actualCounts)) {
      if (documentedCounts[status] !== count) {
        findings.push(`Story matrix count for ${status} is ${documentedCounts[status]}, expected ${count}.`);
      }
    }
  }

  const requiredProofRows = ["OPS-07", "DTX-01", "DTX-04"];
  for (const storyId of requiredProofRows) {
    const row = rows.get(storyId);
    if (!row) {
      findings.push(`${storyId} is missing from the story matrix.`);
      continue;
    }
    if (row.coverageStatus !== "proof-covered") {
      findings.push(`${storyId} must be proof-covered after the W25-S03 proof fixture lands.`);
    }
    const evidence = row.evidence;
    for (const requiredEvidence of [
      defaultProofFixturePath,
      "proof_scope=full_code_changing_runtime",
      "real_code_change_proof_complete=true",
      "external_runner_mode=real-external-process",
    ]) {
      if (!evidence.includes(requiredEvidence)) {
        findings.push(`${storyId} proof-covered evidence must cite ${requiredEvidence}.`);
      }
    }
  }

  const auditInvalidatedRows = new Map([
    ["EMP-05", ["W58-S05"]],
    ["DEV-07", ["W58-S02"]],
    ["AIP-06", ["W58-S04"]],
    ["OPS-02", ["W58-S05"]],
    ["SEC-04", ["W57-S05", "W58-S04"]],
    ["DTX-05", ["W57-S03"]],
    ["FIN-03", ["W57-S07", "W59-S07"]],
  ]);
  for (const [storyId, requiredGaps] of auditInvalidatedRows) {
    const row = rows.get(storyId);
    if (!row) {
      findings.push(`${storyId} is missing from the story matrix.`);
      continue;
    }
    if (row.coverageStatus !== "partial") findings.push(`${storyId} must remain partial while its audit gap is open.`);
    for (const gap of requiredGaps) {
      if (!row.gapSlices.includes(gap)) findings.push(`${storyId} must retain audit gap ${gap}.`);
    }
  }

  for (const storyId of ["DEV-04", "AIP-12"]) {
    const row = rows.get(storyId);
    if (!row) {
      findings.push(`${storyId} is missing from the story matrix.`);
      continue;
    }
    if (row.coverageStatus !== "blocked") {
      findings.push(`${storyId} must remain blocked until OpenCode has real live-baseline certification.`);
    }
    if (!/OpenCode/u.test(row.evidence) || !/does not certify|requires future OpenCode/u.test(row.evidence)) {
      findings.push(`${storyId} must explain that W25/W26 production proof does not certify OpenCode.`);
    }
  }

  if (findings.length > 0) {
    return fail("story-status-honesty", "Story matrix production evidence is not honest or reviewable.", findings, [
      storyMatrixPath,
    ]);
  }
  return pass("story-status-honesty", "Story statuses distinguish proof-covered rows from baseline and external blocked rows.", [
    storyMatrixPath,
  ]);
}

function checkSourceOfTruth(rootDir) {
  const findings = [];
  const readme = readText(rootDir, "README.md");
  const readiness = readText(rootDir, "docs/backlog/self-hosted-production-readiness.md");
  const opsRunbook = readText(rootDir, "docs/ops/production-readiness-gate.md");
  const releaseRunbook = readText(rootDir, "docs/ops/self-hosted-release.md");

  if (!readme.includes("audit release hold")) {
    findings.push("README.md must state the current audit release hold.");
  }
  if (!readme.includes("pnpm production:ready")) {
    findings.push("README.md must document the separate production-readiness gate command.");
  }
  if (!readme.includes("docs/ops/self-hosted-release.md")) {
    findings.push("README.md must link the self-hosted release runbook.");
  }
  if (!readme.includes("hosted SaaS") || !readme.includes("enterprise identity")) {
    findings.push("README.md must keep hosted SaaS and enterprise identity out of the supported mode.");
  }
  if (!readiness.includes("audit release hold")) {
    findings.push("self-hosted production readiness doc must state the audit release hold.");
  }
  if (!readiness.includes("pnpm production:ready")) {
    findings.push("self-hosted production readiness doc must document the production gate command.");
  }
  if (!/sanitized production proof fixture/u.test(readiness)) {
    findings.push("self-hosted production readiness doc must cite the sanitized production proof fixture.");
  }
  if (!opsRunbook.includes("pnpm production:ready") || !/sanitized (?:production )?proof fixture/u.test(opsRunbook)) {
    findings.push("production-readiness runbook must document command usage and proof evidence.");
  }
  for (const required of [
    "audit release hold",
    "pnpm production:ready",
    "sanitized production proof fixture",
    "hosted SaaS",
    "enterprise identity",
    "no-upstream-write",
  ]) {
    if (!releaseRunbook.includes(required)) {
      findings.push(`self-hosted release runbook must mention '${required}'.`);
    }
  }

  if (findings.length > 0) {
    return fail("source-of-truth-alignment", "Production readiness source-of-truth docs are inconsistent.", findings, [
      "README.md",
      "docs/backlog/self-hosted-production-readiness.md",
      "docs/ops/production-readiness-gate.md",
      "docs/ops/self-hosted-release.md",
    ]);
  }
  return pass("source-of-truth-alignment", "README, readiness source-of-truth, production gate, and release runbook align.", [
    "README.md",
    "docs/backlog/self-hosted-production-readiness.md",
    "docs/ops/production-readiness-gate.md",
    "docs/ops/self-hosted-release.md",
  ]);
}

function checkAuthHardening(rootDir) {
  const contract = readText(rootDir, "docs/contracts/control-plane-api.md");
  const runbook = readText(rootDir, "docs/ops/control-plane-production-hardening.md");
  const apiTests = readText(rootDir, "apps/api/test/http-transport.test.mjs");
  const findings = [];

  for (const required of [
    "production-hardened",
    "permissions",
    "missing, empty, or invalid-only",
    "auth.insufficient_permission",
  ]) {
    if (!contract.includes(required)) {
      findings.push(`docs/contracts/control-plane-api.md must mention '${required}'.`);
    }
  }
  for (const required of ["missing-permissions-prod-token", "empty-permissions-prod-token", "wrongProjectResponse", "auth.forbidden_project"]) {
    if (!apiTests.includes(required)) {
      findings.push(`apps/api/test/http-transport.test.mjs must cover '${required}'.`);
    }
  }
  if (!runbook.includes("production-hardened") || !/redact|redaction|redacted/u.test(runbook)) {
    findings.push("control-plane production hardening runbook must document production-hardened mode and redaction.");
  }

  if (findings.length > 0) {
    return fail("production-auth-hardening", "Production auth hardening evidence is incomplete.", findings, [
      "docs/contracts/control-plane-api.md",
      "docs/ops/control-plane-production-hardening.md",
      "apps/api/test/http-transport.test.mjs",
    ]);
  }
  return pass("production-auth-hardening", "Production-hardened auth scope and redaction evidence is present.", [
    "docs/contracts/control-plane-api.md",
    "apps/api/test/http-transport.test.mjs",
  ]);
}

function checkContractAndHarnessEvidence(rootDir) {
  const findings = [];
  const contractCoverage = readText(rootDir, "docs/contracts/contract-loader-coverage.md");
  const runtimeHarnessContract = readText(rootDir, "docs/contracts/runtime-harness-report.md");
  const runtimeHarnessExample = readText(rootDir, "examples/reports/runtime-harness-report-strict-delivery-pass.yaml");
  const controllerTests = readText(rootDir, "packages/orchestrator-core/test/runtime-harness-controller.test.mjs");

  for (const family of [
    "step-result",
    "validation-report",
    "review-report",
    "live-run-event",
    "artifact-packet",
    "incident-report",
    "learning-loop-scorecard",
    "learning-loop-handoff",
  ]) {
    if (!contractCoverage.includes(family) || !contractCoverage.includes("nested")) {
      findings.push(`contract loader coverage must document nested validation for ${family}.`);
    }
  }
  for (const required of ["run_controller", "run_transitions", "run_decision"]) {
    if (!runtimeHarnessContract.includes(required) || !runtimeHarnessExample.includes(required)) {
      findings.push(`Runtime Harness contract and strict-delivery example must include ${required}.`);
    }
  }
  for (const required of [
    "overall_decision, \"pass\"",
    "overall_decision, \"block\"",
    "does not fail run-level closure by path alone",
    "repair_status, \"exhausted\"",
  ]) {
    if (!controllerTests.includes(required)) {
      findings.push(`Runtime Harness controller tests must cover ${required}.`);
    }
  }

  if (findings.length > 0) {
    return fail("contract-and-harness-evidence", "Nested contract or run-level harness evidence is incomplete.", findings, [
      "docs/contracts/contract-loader-coverage.md",
      "docs/contracts/runtime-harness-report.md",
      "examples/reports/runtime-harness-report-strict-delivery-pass.yaml",
      "packages/orchestrator-core/test/runtime-harness-controller.test.mjs",
    ]);
  }
  return pass("contract-and-harness-evidence", "Nested contract and run-level Runtime Harness evidence is present.", [
    "docs/contracts/contract-loader-coverage.md",
    "examples/reports/runtime-harness-report-strict-delivery-pass.yaml",
    "packages/orchestrator-core/test/runtime-harness-controller.test.mjs",
  ]);
}

function collectOpenApiOperations(openApiDocument) {
  const operations = new Map();
  const paths = openApiDocument?.paths && typeof openApiDocument.paths === "object" ? openApiDocument.paths : {};

  for (const [routePath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object") continue;
      const routeId = operation["x-aor-route-id"];
      if (typeof routeId !== "string" || routeId.length === 0) continue;
      operations.set(routeId, {
        routeId,
        method: method.toUpperCase(),
        path: routePath,
        permission: operation["x-aor-permission"],
        kind: operation["x-aor-kind"],
      });
    }
  }

  return operations;
}

function checkAlphaHardening(rootDir, openApiPath = defaultOpenApiPath) {
  const findings = [];
  const requiredFiles = [
    "docs/backlog/wave-30-implementation-slices.md",
    "docs/architecture/adr/0000-index.md",
    "docs/architecture/adr/0001-alpha-filesystem-runtime-sor.md",
    "docs/architecture/adr/0002-alpha-hybrid-api-transport.md",
    "docs/architecture/adr/0003-alpha-detachable-web-console.md",
    openApiPath,
    "docs/ops/self-hosted-environment-matrix.md",
    "docs/ops/self-hosted-secrets-and-redaction.md",
    "docs/ops/self-hosted-backup-restore.md",
    "docs/ops/self-hosted-incident-runbook.md",
  ];

  for (const file of requiredFiles) {
    if (!fileExists(rootDir, file)) {
      findings.push(`${file} is required for W30 alpha hardening.`);
    }
  }

  let openApiDocument = null;
  if (fileExists(rootDir, openApiPath)) {
    try {
      openApiDocument = readJson(rootDir, openApiPath);
    } catch (error) {
      findings.push(`${openApiPath} is not valid JSON: ${error.message}`);
    }
  }

  if (openApiDocument) {
    if (openApiDocument.openapi !== "3.1.0") {
      findings.push(`${openApiPath} must use openapi=3.1.0.`);
    }
    if (!openApiDocument.info?.title || !openApiDocument.paths) {
      findings.push(`${openApiPath} must include info.title and paths.`);
    }

    const openApiOperations = collectOpenApiOperations(openApiDocument);
    const routerRoutes = listControlPlaneRoutes();
    const routeIds = new Set(routerRoutes.map((route) => route.id));

    for (const route of routerRoutes) {
      if (!route.path) {
        findings.push(`Router route ${route.id} is missing OpenAPI path metadata.`);
        continue;
      }
      const operation = openApiOperations.get(route.id);
      if (!operation) {
        findings.push(`${openApiPath} is missing route id ${route.id}.`);
        continue;
      }
      if (operation.method !== route.method) {
        findings.push(`${openApiPath} route ${route.id} uses ${operation.method}, expected ${route.method}.`);
      }
      if (operation.path !== route.path) {
        findings.push(`${openApiPath} route ${route.id} path is ${operation.path}, expected ${route.path}.`);
      }
      if (operation.permission !== route.permission) {
        findings.push(`${openApiPath} route ${route.id} permission is ${operation.permission}, expected ${route.permission}.`);
      }
      if (operation.kind !== route.kind) {
        findings.push(`${openApiPath} route ${route.id} kind is ${operation.kind}, expected ${route.kind}.`);
      }
    }

    for (const routeId of openApiOperations.keys()) {
      if (!routeIds.has(routeId)) {
        findings.push(`${openApiPath} documents unknown route id ${routeId}.`);
      }
    }

    for (const required of ["auth.missing_credentials", "auth.invalid_token", "auth.forbidden_project", "auth.insufficient_permission"]) {
      if (!JSON.stringify(openApiDocument).includes(required)) {
        findings.push(`${openApiPath} must document auth error code ${required}.`);
      }
    }
    if (!JSON.stringify(openApiDocument).includes("text/event-stream")) {
      findings.push(`${openApiPath} must document the SSE event stream response.`);
    }
  }

  const readme = readText(rootDir, "README.md");
  for (const required of [
    "There is no Docker or GHCR version channel yet",
    "Hosted SaaS",
    "enterprise identity/SSO",
    "Default upstream write-back automation",
    "W30",
  ]) {
    if (!readme.includes(required)) {
      findings.push(`README.md must preserve alpha boundary wording '${required}'.`);
    }
  }

  const releaseRunbook = readText(rootDir, "docs/ops/npm-cli-alpha-release.md");
  for (const required of [
    "W30",
    "pnpm production:ready --json",
    "aor app --help",
    "No Docker",
  ]) {
    if (!releaseRunbook.includes(required)) {
      findings.push(`docs/ops/npm-cli-alpha-release.md must mention '${required}'.`);
    }
  }

  const packageJson = readJson(rootDir, "package.json");
  const currentClaimFiles = ["README.md", "docs/ops/self-hosted-environment-matrix.md"];
  for (const file of currentClaimFiles) {
    const text = readText(rootDir, file);
    const pinnedAlphaClaims = text.match(/@(?:grinrus\/aor@)?0\.1\.0-alpha\.\d+/gu) ?? [];
    if (pinnedAlphaClaims.length > 0) {
      findings.push(
        `${file} must derive current npm alpha examples from package metadata or the registry tag; found ${pinnedAlphaClaims.join(", ")}.`,
      );
    }
  }
  if (!readText(rootDir, "README.md").includes("package.json")) {
    findings.push(`README.md must identify package.json as the source of the source-channel version.`);
  }
  if (!readText(rootDir, "docs/ops/self-hosted-environment-matrix.md").includes("npm view @grinrus/aor dist-tags.alpha")) {
    findings.push("self-hosted environment matrix must derive the install version from the npm alpha dist-tag.");
  }
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    findings.push("package.json must declare the current source-channel version.");
  }

  if (findings.length > 0) {
    return fail("w30-alpha-hardening", "W30 alpha hardening evidence is incomplete or drifting.", findings, [
      "docs/backlog/wave-30-implementation-slices.md",
      "docs/architecture/adr/0000-index.md",
      openApiPath,
      "docs/ops/self-hosted-environment-matrix.md",
      "docs/ops/npm-cli-alpha-release.md",
    ]);
  }
  return pass("w30-alpha-hardening", "W30 ADR, OpenAPI, ops, release, and alpha-boundary evidence is present.", [
    "docs/backlog/wave-30-implementation-slices.md",
    "docs/architecture/adr/0000-index.md",
    openApiPath,
    "docs/ops/self-hosted-environment-matrix.md",
    "docs/ops/self-hosted-secrets-and-redaction.md",
    "docs/ops/self-hosted-backup-restore.md",
    "docs/ops/self-hosted-incident-runbook.md",
  ]);
}

export function runProductionReadinessGate(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? defaultRoot);
  const proofFixturePath = options.proofFixturePath ?? defaultProofFixturePath;
  const openApiPath = options.openApiPath ?? defaultOpenApiPath;
  const storyMatrixPath = options.storyMatrixPath ?? defaultStoryMatrixPath;
  const auditLedgerPath = options.auditLedgerPath ?? defaultAuditLedgerPath;
  const auditLedgerCheck = checkAuditRemediationLedger(rootDir, auditLedgerPath);
  const checks = [
    auditLedgerCheck,
    checkBaselineBoundary(rootDir),
    checkProductionProof(rootDir, proofFixturePath),
    checkStoryHonesty(rootDir, storyMatrixPath),
    checkSourceOfTruth(rootDir),
    checkAuthHardening(rootDir),
    checkContractAndHarnessEvidence(rootDir),
    checkAlphaHardening(rootDir, openApiPath),
  ];
  const gateExecutionStatus = checks.every((check) => check.status === "pass") ? "pass" : "fail";
  const blockingInvariants = auditLedgerCheck.blocking_invariants ?? [];
  const releaseDisposition = gateExecutionStatus === "fail" ? "unknown" : blockingInvariants.length > 0 ? "audit-hold" : "cleared";
  const status = gateExecutionStatus === "fail" ? "fail" : releaseDisposition === "audit-hold" ? "blocked" : "pass";
  return {
    status,
    gate_execution_status: gateExecutionStatus,
    release_disposition: releaseDisposition,
    release_clearance: status === "pass",
    blocking_invariants: blockingInvariants,
    root_dir: rootDir,
    proof_fixture_path: proofFixturePath,
    openapi_path: openApiPath,
    remediation_ledger_path: auditLedgerPath,
    checks,
  };
}

function parseArgs(argv) {
  const args = {
    rootDir: defaultRoot,
    proofFixturePath: defaultProofFixturePath,
    openApiPath: defaultOpenApiPath,
    auditLedgerPath: defaultAuditLedgerPath,
    expectAuditHold: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      args.rootDir = argv[index + 1];
      index += 1;
    } else if (arg === "--proof-fixture") {
      args.proofFixturePath = argv[index + 1];
      index += 1;
    } else if (arg === "--openapi") {
      args.openApiPath = argv[index + 1];
      index += 1;
    } else if (arg === "--audit-ledger") {
      args.auditLedgerPath = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--expect-audit-hold") {
      args.expectAuditHold = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printTextReport(result) {
  console.log(`Production readiness gate: ${result.status}`);
  console.log(`Gate execution: ${result.gate_execution_status}; release disposition: ${result.release_disposition}`);
  for (const check of result.checks) {
    console.log(`[${check.status}] ${check.id}: ${check.summary}`);
    if (check.status === "fail") {
      for (const finding of check.findings ?? []) {
        console.log(`  - ${finding}`);
      }
    }
  }
}

const invokedAsMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runProductionReadinessGate(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printTextReport(result);
    }
    const expectedAuditHold = args.expectAuditHold && result.status === "blocked" && result.gate_execution_status === "pass";
    if (result.status !== "pass" && !expectedAuditHold) process.exit(1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
