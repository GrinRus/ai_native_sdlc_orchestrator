import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";
import { scoreEvaluationSuite } from "../../harness/src/scorer-interface.mjs";

import { createProjectContext, resolveProjectContextReference } from "./control-plane/project-context.mjs";
import { loadEvaluationRegistry, resolveSuiteWithDataset } from "./evaluation-registry.mjs";
import { initializeProjectRuntime, resolveProjectRegistryRoots } from "./project-init.mjs";

const SUPPORTED_SUBJECT_TYPES = new Set(["run", "wrapper", "route", "adapter"]);
const SUBJECT_FAMILIES = { wrapper: "wrapper-profile", route: "provider-route-profile", adapter: "adapter-capability-profile" };
const SUBJECT_ID_FIELDS = { wrapper: "wrapper_id", route: "route_id", adapter: "adapter_id" };
const SUBJECT_ROOT_FIELDS = { wrapper: "wrappers", route: "routes", adapter: "adapters" };
const MAX_SUBJECT_FILES = 100;
const MAX_RUN_EVIDENCE_SCAN_FILES = 10_000;
const MAX_SUBJECT_FILE_BYTES = 1024 * 1024;

function hashBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sanitizeForFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function inferSubjectType(subjectRef) {
  const markerIndex = subjectRef.indexOf("://");
  const subjectType = markerIndex > 0 ? subjectRef.slice(0, markerIndex) : "";
  if (!SUPPORTED_SUBJECT_TYPES.has(subjectType)) throw new Error(`Unsupported subject_ref '${subjectRef}'. Expected run|wrapper|route|adapter.`);
  return subjectType;
}

function resolveDefaultSuiteRef(profile) {
  const evalPolicy = typeof profile.eval_policy === "object" && profile.eval_policy !== null ? profile.eval_policy : {};
  return typeof evalPolicy.default_release_suite_ref === "string" ? evalPolicy.default_release_suite_ref : null;
}

function listFilesRecursive(root, extensionPattern = /\.(?:json|ya?ml)$/iu, maxFiles = MAX_SUBJECT_FILES) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length > 0 && files.length < maxFiles) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile() && extensionPattern.test(entry.name) && fs.statSync(child).size <= MAX_SUBJECT_FILE_BYTES) files.push(child);
    }
  }
  return files.sort();
}

function readJsonObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function resolveRunSubject(context, subjectRef, subjectVersion) {
  const runId = subjectRef.slice("run://".length);
  const documents = [];
  const sourceRefs = [];
  const candidateFiles = listFilesRecursive(
    context.projectRuntimeRoot,
    /\.json$/u,
    MAX_RUN_EVIDENCE_SCAN_FILES,
  );
  for (const filePath of candidateFiles) {
    const document = readJsonObject(filePath);
    if (document?.run_id !== runId) continue;
    if (documents.length >= MAX_SUBJECT_FILES) {
      throw new Error(`Run subject '${subjectRef}' exceeds the ${MAX_SUBJECT_FILES}-document evidence limit.`);
    }
    documents.push(document);
    sourceRefs.push(filePath);
  }
  if (documents.length === 0) throw new Error(`Run subject '${subjectRef}' has no immutable run-owned evidence.`);
  const content = { run_id: runId, documents };
  return { reference: subjectRef, family: "run", version: subjectVersion ?? null, digest: hashBytes(stableJson(content)), source_refs: sourceRefs, content };
}

function parseAssetRef(subjectRef, subjectType) {
  const match = new RegExp(`^${subjectType}:\\/\\/([^@]+)@v(\\d+)$`, "u").exec(subjectRef);
  if (!match) throw new Error(`Asset subject_ref '${subjectRef}' must pin an explicit @v<number> version.`);
  return { id: match[1], version: Number(match[2]) };
}

function resolveAssetSubject(registryRoots, subjectRef, subjectType) {
  const canonicalSubjectRef = subjectRef.endsWith("::without-context") ? subjectRef.slice(0, -"::without-context".length) : subjectRef;
  const parsed = parseAssetRef(canonicalSubjectRef, subjectType);
  const family = SUBJECT_FAMILIES[subjectType];
  const idField = SUBJECT_ID_FIELDS[subjectType];
  const root = registryRoots[SUBJECT_ROOT_FIELDS[subjectType]];
  for (const filePath of listFilesRecursive(root)) {
    const loaded = loadContractFile({ filePath, family });
    if (!loaded.ok) continue;
    const document = loaded.document;
    if (document[idField] !== parsed.id || document.version !== parsed.version) continue;
    const bytes = fs.readFileSync(filePath);
    return { reference: subjectRef, family, version: parsed.version, digest: hashBytes(bytes), source_refs: [filePath], content: document };
  }
  throw new Error(`Subject '${subjectRef}' was not found in the canonical ${subjectType} registry.`);
}

function resolveSubjectSnapshot({ context, registryRoots, subjectRef, subjectType, subjectVersion }) {
  return subjectType === "run"
    ? resolveRunSubject(context, subjectRef, subjectVersion)
    : resolveAssetSubject(registryRoots, subjectRef, subjectType);
}

function hasContradictoryAssertions(expected) {
  const values = new Map();
  for (const assertion of expected.assertions ?? []) {
    if (assertion.operator !== "equals") continue;
    const key = `${assertion.target}:${assertion.path}`;
    const value = stableJson(assertion.value);
    if (values.has(key) && values.get(key) !== value) return true;
    values.set(key, value);
  }
  return false;
}

function resolveRegistryFixturePath(registryRoot, reference) {
  if (typeof registryRoot !== "string" || !registryRoot) return null;
  const segments = reference.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const relativeSegments = segments[0] === "examples" ? segments.slice(1) : segments;
  const canonicalRoot = fs.realpathSync.native(registryRoot);
  const candidate = path.join(canonicalRoot, ...relativeSegments);
  if (!fs.existsSync(candidate)) return null;
  const canonicalCandidate = fs.realpathSync.native(candidate);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return canonicalCandidate;
}

function resolveCaseArtifact({ context, reference, family, registryRoot }) {
  if (typeof reference !== "string") throw new Error(`Missing ${family} reference.`);
  const base = reference.startsWith("evidence://") ? "evidence-relative" : "repository-bound";
  const projectFilePath = resolveProjectContextReference(context, reference, base);
  const filePath = fs.existsSync(projectFilePath) || base === "evidence-relative"
    ? projectFilePath
    : resolveRegistryFixturePath(registryRoot, reference) ?? projectFilePath;
  if (!fs.existsSync(filePath)) throw new Error(`${family} artifact '${reference}' was not found.`);
  const loaded = loadContractFile({ filePath, family });
  if (!loaded.ok) throw new Error(`${family} artifact '${reference}' failed contract validation.`);
  const bytes = fs.readFileSync(filePath);
  return { document: loaded.document, filePath, digest: hashBytes(bytes) };
}

function resolveCases({ context, dataset, subjectType, registryRoot }) {
  const cases = Array.isArray(dataset.cases) ? dataset.cases : [];
  return cases.map((testCase) => {
    const caseId = typeof testCase.case_id === "string" ? testCase.case_id : "unknown-case";
    try {
      const input = resolveCaseArtifact({ context, reference: testCase.input_ref, family: "evaluation-case-input", registryRoot });
      const expected = resolveCaseArtifact({ context, reference: testCase.expected_ref, family: "evaluation-case-expected", registryRoot });
      for (const artifact of [input.document, expected.document]) {
        if (artifact.case_id !== caseId) throw new Error(`Case identity mismatch for '${caseId}'.`);
        if (artifact.subject_type !== subjectType) throw new Error(`Case '${caseId}' has wrong subject family '${artifact.subject_type}'.`);
      }
      if (hasContradictoryAssertions(expected.document)) throw new Error(`Case '${caseId}' contains contradictory equals assertions.`);
      return { status: "resolved", testCase, input: input.document, expected: expected.document, input_file: input.filePath, expected_file: expected.filePath, input_digest: input.digest, expected_digest: expected.digest };
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.message : "case_resolution_failed", testCase, input: null, expected: null, input_file: null, expected_file: null, input_digest: null, expected_digest: null };
    }
  });
}

function loadSuiteDatasetDocuments(projectRoot, suiteSource, datasetSource) {
  const suitePath = path.resolve(projectRoot, suiteSource);
  const datasetPath = path.resolve(projectRoot, datasetSource);
  const loadedSuite = loadContractFile({ filePath: suitePath, family: "evaluation-suite" });
  const loadedDataset = loadContractFile({ filePath: datasetPath, family: "dataset" });
  if (!loadedSuite.ok || !loadedDataset.ok) throw new Error("Evaluation suite or dataset failed contract validation.");
  return { suite: loadedSuite.document, dataset: loadedDataset.document, suitePath, datasetPath };
}

export function runEvaluationSuite(options) {
  const init = initializeProjectRuntime(options);
  const context = createProjectContext({ ...options, cwd: init.projectRoot, projectRef: init.projectRoot, runtimeRoot: init.runtimeRoot });
  const loadedProfile = loadContractFile({ filePath: init.projectProfilePath, family: "project-profile" });
  if (!loadedProfile.ok) throw new Error(`Project profile '${init.projectProfilePath}' failed contract validation.`);
  const profile = loadedProfile.document;
  const registryResolution = resolveProjectRegistryRoots(profile, { projectRoot: init.projectRoot });
  const suiteRef = options.suiteRef ?? resolveDefaultSuiteRef(profile);
  if (!suiteRef) throw new Error("No suite_ref provided and project profile has no default release suite.");
  const subjectRef = options.subjectRef;
  const subjectType = inferSubjectType(subjectRef);
  const registry = loadEvaluationRegistry({ workspaceRoot: init.projectRoot, examplesRoot: registryResolution.roots.evaluation });
  if (!registry.ok) throw new Error(`Evaluation registry checks failed: ${registry.issues.map((entry) => entry.message).join("; ")}`);
  const resolved = resolveSuiteWithDataset(registry, suiteRef);
  if (!resolved.dataset) throw new Error(`Suite '${suiteRef}' is missing a resolved dataset.`);
  if (resolved.suite.subject_type && resolved.suite.subject_type !== subjectType) throw new Error(`Suite '${suiteRef}' subject_type '${resolved.suite.subject_type}' does not match subject_ref type '${subjectType}'.`);
  const documents = loadSuiteDatasetDocuments(init.projectRoot, resolved.suite.source, resolved.dataset.source);
  const subjectSnapshot = resolveSubjectSnapshot({ context, registryRoots: registryResolution.roots, subjectRef, subjectType, subjectVersion: options.subjectVersion });
  const resolvedCases = resolveCases({
    context,
    dataset: documents.dataset,
    subjectType,
    registryRoot: registry.examplesRoot,
  });
  const scorecard = scoreEvaluationSuite({ suite: documents.suite, dataset: documents.dataset, resolvedCases, subjectSnapshot, subjectRef, subjectType, scorerRegistry: options.scorerRegistry, judge: options.judge });
  const generatedAt = new Date().toISOString();
  const reportId = `${init.projectId}.evaluation.${sanitizeForFileName(suiteRef)}.${Date.now()}`;
  const caseResolution = resolvedCases.map((entry) => ({ case_id: entry.testCase.case_id, status: entry.status, reason: entry.reason ?? null, input_ref: entry.testCase.input_ref ?? null, expected_ref: entry.testCase.expected_ref ?? null, input_version: entry.input?.version ?? null, expected_version: entry.expected?.version ?? null, input_digest: entry.input_digest, expected_digest: entry.expected_digest }));
  const report = {
    report_id: reportId,
    subject_ref: subjectRef,
    subject_type: subjectType,
    subject_fingerprint: subjectSnapshot.digest,
    subject_snapshot: { reference: subjectSnapshot.reference, family: subjectSnapshot.family, version: subjectSnapshot.version, digest: subjectSnapshot.digest, source_refs: subjectSnapshot.source_refs },
    case_resolution: caseResolution,
    suite_ref: suiteRef,
    dataset_ref: resolved.dataset.dataset_ref,
    scorer_metadata: scorecard.scorer_metadata,
    grader_results: scorecard.grader_results,
    summary_metrics: { ...scorecard.summary_metrics, generated_at: generatedAt, suite_version: resolved.suite.version, subject_version: options.subjectVersion ?? subjectSnapshot.version, comparison_key: `${subjectRef}::${suiteRef}` },
    status: scorecard.status,
    evidence_refs: [init.projectProfilePath, documents.suitePath, documents.datasetPath, ...subjectSnapshot.source_refs, ...resolvedCases.flatMap((entry) => [entry.input_file, entry.expected_file]).filter(Boolean), init.stateFile],
  };
  const validation = validateContractDocument({ family: "evaluation-report", document: report, source: "runtime://evaluation-report" });
  if (!validation.ok) throw new Error(`Generated evaluation report failed contract validation: ${validation.issues.map((entry) => entry.message).join("; ")}`);
  const reportPath = path.join(init.runtimeLayout.reportsRoot, `evaluation-report-${sanitizeForFileName(suiteRef)}-${Date.now()}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { ...init, suiteRef, subjectRef, subjectType, evaluationReport: report, evaluationReportPath: reportPath, blocking: report.status !== "pass" };
}
