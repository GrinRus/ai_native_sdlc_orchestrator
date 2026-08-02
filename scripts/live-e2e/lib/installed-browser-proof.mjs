import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REQUIRED_ARTIFACT_KINDS = new Set([
  "installed-app-smoke",
  "installed-scenario-report",
  "browser-task-proof",
  "dom-snapshot",
  "accessibility-summary",
  "finding-ledger",
]);
const REQUIRED_VIEWPORTS = new Set(["desktop", "tablet", "mobile", "zoom-200"]);
const REQUIRED_ACCESSIBILITY = new Set([
  "keyboard-only",
  "dialog-focus",
  "focus-restoration",
  "semantic-tree",
  "contrast-aa",
  "touch-targets",
  "reduced-motion",
]);
const REQUIRED_RECOVERY = new Set([
  "reload",
  "reconnect",
  "partial-read",
  "offline-read",
  "injected-error",
  "multi-item-attention",
  "project-switch",
  "terminal-read-only",
]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function portableRelative(root, file) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`Browser evidence '${file}' is outside its reports root.`);
  }
  return relative;
}

function writeExclusiveOrVerify(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, bytes, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST" || !fs.readFileSync(file).equals(bytes)) throw error;
  }
}

export function materializeBrowserEvidenceIndex(options) {
  const objectsRoot = path.join(options.reportsRoot, "browser-evidence", "objects");
  const artifacts = options.artifacts.map((artifact) => {
    if (!artifact.kind || !fs.existsSync(artifact.file)) throw new Error(`Browser evidence kind/file is missing for '${artifact.kind ?? "unknown"}'.`);
    const bytes = fs.readFileSync(artifact.file);
    const digest = sha256(bytes);
    const extension = path.extname(artifact.file).toLowerCase() || ".bin";
    const objectFile = path.join(objectsRoot, `${digest}${extension}`);
    writeExclusiveOrVerify(objectFile, bytes);
    return {
      kind: artifact.kind,
      sha256: digest,
      bytes: bytes.length,
      object_ref: portableRelative(options.reportsRoot, objectFile),
      run_id: options.runId,
      scenario_id: options.scenarioId,
      owner: options.owner ?? "installed-browser-proof",
      created_at: options.createdAt ?? new Date().toISOString(),
    };
  }).sort((left, right) => left.kind.localeCompare(right.kind));
  const index = {
    schema_version: 1,
    kind: "content-addressed-browser-evidence-index",
    run_id: options.runId,
    scenario_id: options.scenarioId,
    owner: options.owner ?? "installed-browser-proof",
    created_at: options.createdAt ?? new Date().toISOString(),
    artifacts,
  };
  const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  const digest = sha256(bytes);
  const indexFile = path.join(options.reportsRoot, "browser-evidence", "indexes", `${digest}.json`);
  writeExclusiveOrVerify(indexFile, bytes);
  return { index, indexFile, digest };
}

function validateEvidenceIndex(options, issues) {
  const index = options.index;
  if (index.kind !== "content-addressed-browser-evidence-index") issues.push("browser evidence index kind is invalid");
  if (index.run_id !== options.runId) issues.push("browser evidence index belongs to another run");
  if (index.scenario_id !== options.scenarioId) issues.push("browser evidence index belongs to another scenario");
  const createdAt = Date.parse(index.created_at);
  if (!Number.isFinite(createdAt) || createdAt < options.notBefore || createdAt > options.now + 300_000) {
    issues.push("browser evidence index is stale or has invalid freshness");
  }
  const kinds = new Set();
  for (const artifact of Array.isArray(index.artifacts) ? index.artifacts : []) {
    kinds.add(artifact.kind);
    if (artifact.run_id !== options.runId || artifact.scenario_id !== options.scenarioId) {
      issues.push(`browser artifact '${artifact.kind}' has cross-run ownership`);
    }
    const objectFile = path.resolve(options.reportsRoot, artifact.object_ref ?? "");
    const relative = path.relative(options.reportsRoot, objectFile);
    if (!artifact.object_ref || path.isAbsolute(artifact.object_ref) || relative.startsWith("..") || !fs.existsSync(objectFile)) {
      issues.push(`browser artifact '${artifact.kind}' has an invalid object ref`);
      continue;
    }
    const bytes = fs.readFileSync(objectFile);
    if (sha256(bytes) !== artifact.sha256 || bytes.length !== artifact.bytes) {
      issues.push(`browser artifact '${artifact.kind}' was overwritten or has the wrong digest`);
    }
  }
  for (const kind of REQUIRED_ARTIFACT_KINDS) if (!kinds.has(kind)) issues.push(`browser evidence kind '${kind}' is missing`);
}

function requirePassingMatrix(entries, required, label, issues) {
  const byId = new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.id, entry]));
  for (const id of required) {
    const entry = byId.get(id);
    if (!entry || entry.status !== "pass") issues.push(`${label} '${id}' did not pass`);
  }
}

export function validateInstalledBrowserProof(options) {
  const issues = [];
  const proof = options.proof ?? {};
  const request = options.request ?? {};
  const now = options.now ?? Date.now();
  if (proof.schema_version !== 2 || proof.kind !== "installed-browser-proof") issues.push("installed browser proof must use schema_version 2 and the expected kind");
  if (proof.run_id !== options.runId || request.run_id !== options.runId) issues.push("installed browser proof/request run identity mismatch");
  if (proof.scenario_id !== options.scenarioId || request.scenario_id !== options.scenarioId) issues.push("installed browser proof/request scenario identity mismatch");
  const requestAt = Date.parse(request.created_at);
  if (!Number.isFinite(requestAt)) issues.push("browser proof request freshness is missing");
  validateEvidenceIndex({
    index: options.index ?? {},
    reportsRoot: options.reportsRoot,
    runId: options.runId,
    scenarioId: options.scenarioId,
    notBefore: Number.isFinite(requestAt) ? requestAt : now,
    now,
  }, issues);
  const scenarios = Array.isArray(proof.scenarios) ? proof.scenarios : [];
  if (scenarios.length === 0) issues.push("installed browser proof has no authoritative readiness scenarios");
  for (const scenario of scenarios) {
    if (scenario.status !== "pass") {
      issues.push(`scenario '${scenario.id ?? "unknown"}' did not reach its authoritative ready state`);
    }
    if (["loading", "syncing", "partial", "offline", "timeout"].includes(scenario.observed_state)) {
      issues.push(`scenario '${scenario.id}' ended in non-terminal state '${scenario.observed_state}'`);
    }
    if (scenario.status === "pass" && (!scenario.expected_state || !scenario.durable_precondition_ref)) {
      issues.push(`scenario '${scenario.id}' lacks authoritative readiness evidence`);
    }
  }
  const actions = Array.isArray(proof.actions) ? proof.actions : [];
  if (actions.length === 0) issues.push("installed browser proof has no action-to-readback evidence");
  for (const action of actions) {
    if (
      action.status !== "pass"
      || !action.visible_label
      || !action.canonical_mutation?.method
      || !action.canonical_mutation?.route
      || !action.response_id
      || !Array.isArray(action.evidence_refs)
      || action.evidence_refs.length === 0
      || action.reload_verified !== true
      || action.durable_readback?.status !== "pass"
    ) {
      issues.push(`action '${action.id ?? "unknown"}' lacks label, mutation, response, evidence, reload, or durable readback`);
    }
  }
  requirePassingMatrix(proof.viewport_matrix, REQUIRED_VIEWPORTS, "viewport check", issues);
  requirePassingMatrix(proof.accessibility_matrix, REQUIRED_ACCESSIBILITY, "accessibility check", issues);
  requirePassingMatrix(proof.recovery_matrix, REQUIRED_RECOVERY, "recovery check", issues);
  if (!proof.recovery_matrix?.some((entry) => entry.id === "injected-error" && entry.injected === true)) {
    issues.push("error feedback was not tested through an injected error");
  }
  if ((proof.findings ?? []).some((finding) => finding.priority === "P1" && finding.status !== "resolved")) {
    issues.push("installed browser proof has an unresolved P1 finding");
  }
  if ((proof.console_errors ?? []).length > 0 || (proof.external_requests ?? []).length > 0) {
    issues.push("installed browser proof observed console errors or external requests");
  }
  return { ok: issues.length === 0, issues };
}
