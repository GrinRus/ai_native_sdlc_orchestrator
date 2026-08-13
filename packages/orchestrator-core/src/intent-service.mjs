import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { derivePublicId, validateContractDocument } from "../../contracts/src/index.mjs";
import { initializeProjectRuntime, previewProjectRuntime } from "./project-init.mjs";
import { executeRoutedStep } from "./step-execution-engine.mjs";
import { runLifecycleCommand } from "./control-plane/lifecycle-command.mjs";
import { resolveNextAction } from "./next-action.mjs";
import { inspectGitIdentity } from "./aor-home.mjs";
import { buildCorrectionGuidance, extractStructuredCandidate } from "./structured-candidate.mjs";

const EXTENSIONS = new Map([
  [".txt", "text/plain"], [".md", "text/markdown"], [".json", "application/json"],
  [".yaml", "application/yaml"], [".yml", "application/yaml"],
]);
const MAX_FILES = 10;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_NORMALIZATION_BYTES = 128 * 1024;
const MAX_NORMALIZATION_ITEMS = 50;
const MAX_NORMALIZATION_ITEM_CHARS = 4_000;
const WORK_TYPES = new Set(["analyze", "explain", "review", "document-change", "code-change"]);
const DEFAULT_INTENT_CONSTRAINT = "Respect the approved scope and AOR safety policy; no upstream writes before explicit delivery approval.";
const READ_ONLY_PATH = Object.freeze([
  { id: "discovery", label: "Discover" },
  { id: "review", label: "Verify" },
  { id: "learning", label: "Learn" },
]);
const CHANGE_PATH = Object.freeze([
  { id: "discovery", label: "Discover" },
  { id: "spec", label: "Define" },
  { id: "planning", label: "Plan" },
  { id: "implement", label: "Execute" },
  { id: "review", label: "Verify" },
  { id: "delivery", label: "Deliver" },
  { id: "learning", label: "Learn" },
]);

export class IntentServiceError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = "IntentServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function now() { return new Date().toISOString(); }
function asStrings(value) { return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : []; }
function asRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}; }

function atomicJson(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function resolveProject(registry, projectId, { initialize = true } = {}) {
  const context = registry.getContext(projectId);
  if (!context) throw new IntentServiceError("project.not_found", `Project '${projectId}' was not found.`, 404);
  const init = initialize
    ? initializeProjectRuntime(context.runtimeOptions)
    : {
        projectId: context.runtimeProjectId,
        runtimeLayout: previewProjectRuntime(context.runtimeOptions).runtimeLayout,
      };
  return { context, init };
}

function submissionFile(init, submissionId) {
  return path.join(init.runtimeLayout.inputsRoot, submissionId, "submission.json");
}

function loadSubmission(registry, projectId, submissionId, { initialize = false } = {}) {
  const { context, init } = resolveProject(registry, projectId, { initialize });
  const file = submissionFile(init, submissionId);
  if (!fs.existsSync(file)) throw new IntentServiceError("intent_submission.not_found", `Intent submission '${submissionId}' was not found.`, 404);
  return { context, init, file, submission: JSON.parse(fs.readFileSync(file, "utf8")) };
}

function attachmentRecords(init, submissionId, attachments) {
  if (!Array.isArray(attachments)) return [];
  if (attachments.length > MAX_FILES) throw new IntentServiceError("intent_attachment.count_exceeded", `At most ${MAX_FILES} attachments are allowed.`);
  let total = 0;
  const directory = path.join(init.runtimeLayout.inputsRoot, submissionId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return attachments.map((attachment, index) => {
    const originalName = String(attachment?.name ?? "").split(/[\\/]/u).at(-1) ?? "";
    const extension = path.extname(originalName).toLowerCase();
    const mediaType = EXTENSIONS.get(extension);
    if (!originalName || !mediaType) throw new IntentServiceError("intent_attachment.unsupported", `Attachment '${originalName || index + 1}' must be .txt, .md, .json, .yaml, or .yml.`);
    const content = String(attachment?.content ?? "").normalize("NFC");
    if (content.includes("\0") || content.includes("\uFFFD")) throw new IntentServiceError("intent_attachment.invalid_utf8", `Attachment '${originalName}' contains invalid UTF-8 text.`);
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > MAX_FILE_BYTES) throw new IntentServiceError("intent_attachment.too_large", `Attachment '${originalName}' exceeds 1 MiB.`);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new IntentServiceError("intent_attachment.total_too_large", "Intent attachments exceed 5 MiB total.");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const attachmentId = `attachment.${index + 1}.${sha256.slice(0, 12)}`;
    const generatedName = `${attachmentId}${extension}`;
    fs.writeFileSync(path.join(directory, generatedName), bytes, { mode: 0o600, flag: "wx" });
    return {
      attachment_id: attachmentId,
      original_name: originalName,
      media_type: mediaType,
      byte_length: bytes.length,
      sha256,
      storage_ref: `inputs/${submissionId}/${generatedName}`,
    };
  });
}

function sanitizeMarkdownPreview(value) {
  const input = String(value ?? "");
  let output = "";
  let index = 0;
  while (index < input.length) {
    if (input[index] !== "<") {
      output += input[index];
      index += 1;
      continue;
    }
    const remainder = input.slice(index).toLowerCase();
    if (remainder.startsWith("<script")) {
      const closingStart = remainder.indexOf("</script");
      if (closingStart < 0) break;
      const closingEnd = input.indexOf(">", index + closingStart + 2);
      index = closingEnd < 0 ? input.length : closingEnd + 1;
      continue;
    }
    const tagEnd = input.indexOf(">", index + 1);
    if (tagEnd < 0) break;
    index = tagEnd + 1;
  }
  return output.replace(/!\[[^\]]*\]\(https?:\/\/[^)]+\)/giu, "[remote embed omitted]");
}

function repositoryMarkdownRecords(context, markdownSources) {
  if (!Array.isArray(markdownSources) || markdownSources.length === 0) return [];
  if (markdownSources.length > MAX_FILES) throw new IntentServiceError("intent_source.count_exceeded", `At most ${MAX_FILES} Markdown sources are allowed.`);
  const head = awaitableSpawn("git", ["-C", context.projectRoot, "rev-parse", "HEAD"]);
  return markdownSources.map((source, index) => {
    const relativePath = String(source?.project_relative_path ?? source?.path ?? "").trim().replaceAll("\\", "/");
    if (!relativePath || path.posix.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
      throw new IntentServiceError("intent_source.invalid_path", "Repository Markdown paths must be project-relative and cannot traverse outside the project.");
    }
    if (path.extname(relativePath).toLowerCase() !== ".md") {
      throw new IntentServiceError("intent_source.unsupported", `Repository source '${relativePath}' must be a Markdown file.`);
    }
    const absolutePath = path.resolve(context.projectRoot, relativePath);
    const projectRoot = path.resolve(context.projectRoot);
    if (absolutePath !== projectRoot && !absolutePath.startsWith(`${projectRoot}${path.sep}`)) {
      throw new IntentServiceError("intent_source.invalid_path", "Repository Markdown paths must stay inside the connected project.");
    }
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new IntentServiceError("intent_source.not_found", `Repository Markdown source '${relativePath}' was not found.`);
    }
    const content = fs.readFileSync(absolutePath);
    if (content.length > MAX_FILE_BYTES) throw new IntentServiceError("intent_source.too_large", `Repository Markdown source '${relativePath}' exceeds 1 MiB.`);
    const text = content.toString("utf8");
    if (text.includes("\uFFFD")) throw new IntentServiceError("intent_source.invalid_utf8", `Repository Markdown source '${relativePath}' is not valid UTF-8.`);
    const digest = crypto.createHash("sha256").update(content).digest("hex");
    const pinnedRevision = String(source?.pinned_base_revision ?? head ?? "").trim();
    if (pinnedRevision && !/^[0-9a-f]{40}$/iu.test(pinnedRevision)) {
      throw new IntentServiceError("intent_source.invalid_revision", "Pinned Markdown base revision must be a full Git commit id.");
    }
    return {
      source_id: `source.${index + 1}.${digest.slice(0, 12)}`,
      project_relative_path: relativePath,
      pinned_base_revision: pinnedRevision || null,
      digest: `sha256:${digest}`,
      media_type: "text/markdown",
      byte_length: content.length,
      stale: false,
      preview: {
        project_relative_path: relativePath,
        pinned_base_revision: pinnedRevision || null,
        media_type: "text/markdown",
        byte_length: content.length,
        sanitized_markdown: sanitizeMarkdownPreview(text).slice(0, MAX_NORMALIZATION_BYTES),
      },
    };
  });
}

function currentMarkdownSourceStatus(context, sources) {
  if (!Array.isArray(sources) || sources.length === 0) return [];
  const head = awaitableSpawn("git", ["-C", context.projectRoot, "rev-parse", "HEAD"]);
  return sources.map((source) => {
    const relativePath = String(source?.project_relative_path ?? "").trim().replaceAll("\\", "/");
    const absolutePath = relativePath ? path.resolve(context.projectRoot, relativePath) : null;
    const projectRoot = path.resolve(context.projectRoot);
    const safe = absolutePath && (absolutePath === projectRoot || absolutePath.startsWith(`${projectRoot}${path.sep}`));
    let currentDigest = null;
    if (safe && fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      currentDigest = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex")}`;
    }
    return {
      ...source,
      stale: source.stale === true || !safe || currentDigest !== source.digest || (source.pinned_base_revision && head !== source.pinned_base_revision),
    };
  });
}

function repositorySnapshot(context) {
  const commit = String((awaitableSpawn("git", ["-C", context.projectRoot, "rev-parse", "HEAD"]) ?? ""));
  return [{
    repo_id: "main",
    resolved_identity: inspectGitIdentity(context.projectRoot) || `workspace-project://${context.projectId}/repositories/main`,
    resolved_commit: commit || null,
  }];
}

function awaitableSpawn(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function validateNormalization(value, base, extraction = null) {
  const input = asRecord(value);
  const workType = String(input.work_type ?? "");
  const constraints = asStrings(input.constraints);
  const deliveryMode = ["analyze", "explain", "review"].includes(workType) ? "no-write" : "patch-only";
  const report = {
    report_id: `${base.submission_id}.normalization.v${base.revision}`,
    submission_id: base.submission_id,
    workspace_project_id: base.workspace_project_id,
    project_id: base.project_id,
    revision: base.revision,
    status: asStrings(input.open_questions).length ? "needs-input" : "prepared",
    title: String(input.title ?? "").trim(),
    outcome: String(input.outcome ?? "").trim(),
    constraints: constraints.length > 0 ? constraints : [DEFAULT_INTENT_CONSTRAINT],
    acceptance: asStrings(input.acceptance),
    scope: asStrings(input.scope),
    work_type: workType,
    delivery_mode: deliveryMode,
    planned_path: {
      path_id: ["analyze", "explain", "review"].includes(workType) ? "read-only" : "change",
      steps: (["analyze", "explain", "review"].includes(workType) ? READ_ONLY_PATH : CHANGE_PATH).map((step) => ({ ...step })),
      reason: "Derived from work_type; runtime evidence may mark a step skipped with a durable reason.",
    },
    assumptions: asStrings(input.assumptions),
    open_questions: asStrings(input.open_questions),
    confidence: Number(input.confidence),
    provider: asRecord(base.provider),
    input_refs: [`intent-submission://${base.submission_id}`],
    previous_revision_ref: base.previous_revision_ref ?? null,
    validation: { status: "pass", findings: [], correction_guidance: [] },
    created_at: now(),
  };
  const findings = [];
  if (extraction && extraction.status !== "valid") {
    findings.push(...(extraction.issues ?? []).map((entry) => String(entry.summary ?? "Structured candidate was not accepted.")));
  }
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_NORMALIZATION_BYTES) findings.push("structured output exceeds 128 KiB");
  if (!report.title) findings.push("title is required");
  if (!report.outcome) findings.push("outcome is required");
  if (!report.acceptance.length) findings.push("acceptance requires at least one item");
  if (!WORK_TYPES.has(report.work_type)) findings.push("work_type is unsupported");
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) findings.push("confidence must be between 0 and 1");
  if (report.title.length > 200) findings.push("title exceeds 200 characters");
  if (report.outcome.length > 8_000) findings.push("outcome exceeds 8000 characters");
  for (const [field, entries] of [["constraints", report.constraints], ["acceptance", report.acceptance], ["scope", report.scope], ["assumptions", report.assumptions], ["open_questions", report.open_questions]]) {
    if (entries.length > MAX_NORMALIZATION_ITEMS) findings.push(`${field} exceeds ${MAX_NORMALIZATION_ITEMS} items`);
    if (entries.some((entry) => entry.length > MAX_NORMALIZATION_ITEM_CHARS)) findings.push(`${field} contains an item longer than ${MAX_NORMALIZATION_ITEM_CHARS} characters`);
  }
  if (findings.length) {
    report.status = "invalid";
    report.validation = {
      status: "fail",
      findings,
      correction_guidance: buildCorrectionGuidance(extraction?.issues ?? [], { repairKind: "output-contract" }),
    };
  }
  const contract = validateContractDocument({ family: "intent-normalization-report", document: report, source: "runtime://intent-normalization-report" });
  if (!contract.ok) {
    report.status = "invalid";
    const contractFindings = contract.issues.map((issue) => issue.message);
    report.validation = {
      status: "fail",
      findings: [...findings, ...contractFindings],
      correction_guidance: buildCorrectionGuidance([
        ...(extraction?.issues ?? []),
        ...contract.issues.map((entry) => ({
          code: entry.code,
          field: entry.field,
          summary: entry.message,
          retryable: true,
          suggested_repair_kind: "output-contract",
        })),
      ]),
    };
  }
  return report;
}

function findNormalization(value) {
  const record = asRecord(value);
  const runnerEnvelope = asRecord(record.runner_output);
  const input = Object.keys(runnerEnvelope).length > 0 ? runnerEnvelope : value;
  return extractStructuredCandidate({
    value: input,
    candidateKeys: ["intent_normalization", "result"],
    requestedSchemaRef: "intent-normalization-report@v1",
    isCandidate: (candidate) => Object.keys(candidate).some((key) => [
      "title", "outcome", "constraints", "acceptance", "scope", "work_type", "confidence",
    ].includes(key)),
  });
}

export function normalizeIntentProviderOutput(value) {
  return findNormalization(value);
}

function providerReadiness(registry, projectId) {
  const input = registry.getProjectInput(projectId) ?? {};
  const readiness = input.runnerReadiness ?? {};
  const candidates = [
    ["codex-cli", "AOR_AUTH_READY_CODEX_CLI"],
    ["claude-code", "AOR_AUTH_READY_CLAUDE_CODE"],
    ["qwen-code", "AOR_AUTH_READY_QWEN_CODE"],
  ];
  const preferred = input.latestExecutionReadiness?.step_results
    ?.find((entry) => entry?.step === "discovery" && entry?.status === "ready")?.adapter;
  const ordered = preferred
    ? [...candidates.filter(([adapter]) => adapter === preferred), ...candidates.filter(([adapter]) => adapter !== preferred)]
    : candidates;
  const ready = ordered.find(([adapter, env]) => process.env[env] === "true" || readiness[adapter]?.auth_ready === true);
  return ready?.[0] ?? null;
}

export function createIntentSubmission({ registry, projectId, requestText = "", attachments = [], markdownSources = [], autoPrepare = true, normalization }) {
  const { context, init } = resolveProject(registry, projectId);
  const text = String(requestText ?? "").trim();
  if (!text && (!Array.isArray(attachments) || attachments.length === 0) && (!Array.isArray(markdownSources) || markdownSources.length === 0)) {
    throw new IntentServiceError("intent_submission.empty", "Enter request text or attach at least one text file.");
  }
  if (Array.isArray(attachments) && attachments.length > MAX_FILES) throw new IntentServiceError("intent_attachment.count_exceeded", `At most ${MAX_FILES} attachments are allowed.`);
  const repositorySources = repositoryMarkdownRecords(context, markdownSources);
  if (attachments.length + repositorySources.length > MAX_FILES) throw new IntentServiceError("intent_source.count_exceeded", `At most ${MAX_FILES} total Markdown sources and attachments are allowed.`);
  const seed = crypto.createHash("sha256").update(`${text}\0${JSON.stringify(attachments.map((entry) => entry?.name))}\0${JSON.stringify(repositorySources.map((entry) => entry.digest))}\0${Date.now()}`).digest("hex").slice(0, 16);
  const submissionId = derivePublicId(["intent-submission", init.projectId, seed], "intent-submission");
  const createdAt = now();
  const submission = {
    submission_id: submissionId,
    workspace_project_id: context.projectId,
    project_id: init.projectId,
    revision: 1,
    status: "submitted",
    request_text: text,
    attachments: attachmentRecords(init, submissionId, attachments),
    markdown_sources: repositorySources,
    repository_snapshot: repositorySnapshot(context),
    normalization_refs: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
  const validation = validateContractDocument({ family: "intent-submission", document: submission, source: "runtime://intent-submission" });
  if (!validation.ok) throw new IntentServiceError("intent_submission.invalid", validation.issues.map((issue) => issue.message).join("; "));
  const file = submissionFile(init, submissionId);
  atomicJson(file, submission);
  if (autoPrepare) setImmediate(() => {
    try { prepareIntentSubmission({ registry, projectId, submissionId, normalization }); } catch { /* durable blocked state is written below */ }
  });
  return { submission, submission_file: file };
}

export function prepareIntentSubmission({ registry, projectId, submissionId, normalization }) {
  const loaded = loadSubmission(registry, projectId, submissionId, { initialize: true });
  const { submission, init, context, file } = loaded;
  if (["confirmed", "canceled"].includes(submission.status)) throw new IntentServiceError("intent_submission.terminal", "Terminal intent submissions cannot be prepared again.", 409);
  const previousNormalization = normalization && submission.normalization_refs.length > 0
    ? readIntentSubmission({ registry, projectId, submissionId }).normalization
    : null;
  submission.status = "preparing";
  submission.updated_at = now();
  atomicJson(file, submission);
  let provider = normalization
    ? previousNormalization?.provider?.adapter_id ?? "operator-revision"
    : providerReadiness(registry, projectId);
  let selectedRouteId = normalization
    ? previousNormalization?.provider?.route_id ?? "route.intake-normalize.default"
    : "route.intake-normalize.default";
  let candidate = normalization ? asRecord(normalization) : {};
  let extraction = null;
  try {
    if (!normalization) {
      if (!provider) throw new IntentServiceError("intent_provider.not_ready", "Configure and authenticate Codex, Claude, or Qwen before preparing this task.", 409);
      selectedRouteId = provider === "claude-code" ? "route.intake-normalize.claude" : provider === "qwen-code" ? "route.intake-normalize.qwen" : "route.intake-normalize.default";
      const routed = executeRoutedStep({
        ...context.runtimeOptions,
        stepClass: "discovery",
        dryRun: false,
        runId: derivePublicId(["intent-normalize", submissionId], "intent-normalize-run"),
        stepId: "intent.normalize",
        requireDiscoveryCompleteness: false,
        routeOverrides: { discovery: selectedRouteId },
        promptBundleOverrides: { discovery: "intake-normalize" },
        forceReadOnly: true,
        runtimeEvidenceRefs: [file, ...submission.attachments.map((entry) => path.join(init.runtimeLayout.projectRuntimeRoot, entry.storage_ref))],
      });
      extraction = findNormalization(routed.stepResult?.routed_execution?.adapter_response?.output);
      candidate = extraction.candidate ?? {};
      provider = routed.stepResult?.routed_execution?.adapter_resolution?.selected?.adapter ?? provider;
    }
    const revision = submission.normalization_refs.length + 1;
    const report = validateNormalization(candidate, {
      submission_id: submissionId,
      workspace_project_id: context.projectId,
      project_id: init.projectId,
      revision,
      previous_revision_ref: submission.normalization_refs.at(-1) ?? null,
      provider: { route_id: selectedRouteId, adapter_id: provider },
    }, normalization ? null : extraction);
    const reportFile = path.join(init.runtimeLayout.reportsRoot, `intent-normalization-report-${submissionId}-v${revision}.json`);
    atomicJson(reportFile, report);
    submission.normalization_refs.push(`evidence://projects/${context.projectId}/reports/${path.basename(reportFile)}`);
    submission.status = report.status === "prepared" ? "prepared" : "blocked";
    submission.updated_at = now();
    atomicJson(file, submission);
    return { submission, report, report_file: reportFile };
  } catch (error) {
    submission.status = "blocked";
    submission.updated_at = now();
    submission.blocker = { code: error?.code ?? "intent_prepare.failed", message: error instanceof Error ? error.message : String(error) };
    atomicJson(file, submission);
    throw error;
  }
}

export function readIntentSubmission({ registry, projectId, submissionId }) {
  const loaded = loadSubmission(registry, projectId, submissionId);
  const latestRef = loaded.submission.normalization_refs.at(-1);
  const reportName = latestRef?.split("/").at(-1);
  const reportFile = reportName ? path.join(loaded.init.runtimeLayout.reportsRoot, reportName) : null;
  return {
    submission: { ...loaded.submission, markdown_sources: currentMarkdownSourceStatus(loaded.context, loaded.submission.markdown_sources) },
    normalization: reportFile && fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : null,
  };
}

export function listIntentSubmissions({ registry, projectId }) {
  const { context, init } = resolveProject(registry, projectId, { initialize: false });
  const root = init.runtimeLayout.inputsRoot;
  if (!fs.existsSync(root)) {
    return { project_id: context.projectId, submissions: [], read_only: true };
  }
  const submissions = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(root, entry.name, "submission.json");
      if (!fs.existsSync(file)) return null;
      try {
        const submission = JSON.parse(fs.readFileSync(file, "utf8"));
        const latestRef = submission.normalization_refs?.at(-1);
        const reportName = latestRef?.split("/").at(-1);
        const reportFile = reportName ? path.join(init.runtimeLayout.reportsRoot, reportName) : null;
        const normalization = reportFile && fs.existsSync(reportFile)
          ? JSON.parse(fs.readFileSync(reportFile, "utf8"))
          : null;
        return { submission: { ...submission, markdown_sources: currentMarkdownSourceStatus(context, submission.markdown_sources) }, normalization };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(right.submission.updated_at ?? "").localeCompare(String(left.submission.updated_at ?? "")));
  return { project_id: context.projectId, submissions, read_only: true };
}

export function findIntentSubmissionProject({ registry, submissionId }) {
  for (const context of registry.listContexts()) {
    const preview = previewProjectRuntime(context.runtimeOptions);
    const file = path.join(preview.runtimeLayout.inputsRoot, submissionId, "submission.json");
    if (fs.existsSync(file)) return context.projectId;
  }
  throw new IntentServiceError("intent_submission.not_found", `Intent submission '${submissionId}' was not found in the connected workspace.`, 404);
}

export function reviseIntentSubmission({ registry, projectId, submissionId, normalization }) {
  return prepareIntentSubmission({ registry, projectId, submissionId, normalization });
}

export function answerIntentQuestions({ registry, projectId, submissionId, answers }) {
  const current = readIntentSubmission({ registry, projectId, submissionId });
  const questions = asStrings(current.normalization?.open_questions);
  if (questions.length === 0) {
    throw new IntentServiceError("intent_submission.no_open_questions", "This intent submission has no open questions to answer.", 409);
  }
  const answerMap = asRecord(answers);
  const missing = questions.filter((question) => !String(answerMap[question] ?? "").trim());
  if (missing.length > 0) {
    throw new IntentServiceError(
      "intent_submission.answers_incomplete",
      `Provide a non-empty answer for every open question. Missing: ${missing.join("; ")}`,
      409,
    );
  }
  return reviseIntentSubmission({
    registry,
    projectId,
    submissionId,
    normalization: {
      ...current.normalization,
      assumptions: [
        ...(current.normalization?.assumptions ?? []),
        ...questions.map((question) => `${question}: ${String(answerMap[question]).trim()}`),
      ],
      open_questions: [],
    },
  });
}

export function cancelIntentSubmission({ registry, projectId, submissionId }) {
  const loaded = loadSubmission(registry, projectId, submissionId);
  if (loaded.submission.status === "confirmed") throw new IntentServiceError("intent_submission.confirmed", "Confirmed submissions cannot be canceled.", 409);
  loaded.submission.status = "canceled";
  loaded.submission.updated_at = now();
  atomicJson(loaded.file, loaded.submission);
  return { submission: loaded.submission };
}

function startConfirmedIntent({ registry, projectId, loaded }) {
  const discovery = runLifecycleCommand({
    cwd: loaded.context.projectRoot,
    projectRef: loaded.context.projectRoot,
    runtimeRoot: loaded.context.runtimeRoot,
    command: "discovery run",
    flags: {},
  });
  loaded.submission.confirmation = {
    ...loaded.submission.confirmation,
    discovery,
    last_start_attempt_at: now(),
    retryable_start: discovery.ok !== true,
  };
  loaded.submission.updated_at = now();
  atomicJson(loaded.file, loaded.submission);
  return loaded.submission.confirmation;
}

export function retryIntentStart({ registry, projectId, submissionId }) {
  const loaded = loadSubmission(registry, projectId, submissionId, { initialize: true });
  if (!loaded.submission.confirmation) {
    throw new IntentServiceError("intent_submission.not_confirmed", "Confirm the prepared task before retrying its start.", 409);
  }
  if (loaded.submission.confirmation.retryable_start !== true) return loaded.submission.confirmation;
  return startConfirmedIntent({ registry, projectId, loaded });
}

function confirmIntentRecord({ registry, projectId, submissionId, expectedRevision }) {
  const loaded = loadSubmission(registry, projectId, submissionId, { initialize: true });
  if (loaded.submission.confirmation) {
    if (loaded.submission.confirmation.next_action) return { confirmation: loaded.submission.confirmation, loaded };
    const next = resolveNextAction({
      cwd: loaded.context.projectRoot,
      projectRef: loaded.context.projectRoot,
      runtimeRoot: loaded.context.runtimeRoot,
    });
    const confirmation = {
      ...loaded.submission.confirmation,
      next_action: next.nextActionReport.primary_action,
      next_action_report_ref: `evidence://projects/${loaded.init.workspaceProjectId}/reports/${path.basename(next.nextActionReportFile)}`,
    };
    loaded.submission.confirmation = confirmation;
    loaded.submission.updated_at = now();
    atomicJson(loaded.file, loaded.submission);
    return { confirmation, loaded };
  }
  const current = readIntentSubmission({ registry, projectId, submissionId });
  const report = current.normalization;
  if (!report || report.status !== "prepared") throw new IntentServiceError("intent_submission.not_prepared", "Prepare and resolve the task preview before confirmation.", 409);
  if (expectedRevision !== undefined && report.revision !== expectedRevision) {
    throw new IntentServiceError(
      "intent_submission.stale_revision",
      `Prepared task revision ${expectedRevision} is stale; the server currently has revision ${report.revision}. Refresh before confirming.`,
      409,
      {
        current_revision: report.revision,
        recovery_actions: [{
          action: "refresh",
          payload: {
            resource: `intent-submission://${submissionId}`,
            current_revision: report.revision,
          },
        }],
      },
    );
  }
  const missionId = derivePublicId(["mission", submissionId], "mission");
  const mission = runLifecycleCommand({
    cwd: loaded.context.projectRoot,
    projectRef: loaded.context.projectRoot,
    runtimeRoot: loaded.context.runtimeRoot,
    command: "mission create",
    flags: {
      "mission-id": missionId,
      title: report.title,
      brief: report.outcome,
      goal: [report.outcome],
      ...(report.constraints.length > 0 ? { constraint: report.constraints } : {}),
      kpi: report.acceptance.map((item, index) => `acceptance-${index + 1}:${item}:pass:status`),
      dod: report.acceptance,
      "delivery-mode": report.delivery_mode,
      "work-type": report.work_type,
      ...(report.scope.length > 0 ? { "allowed-path": report.scope } : {}),
      "source-kind": "local-note",
      "source-ref": `intent-submission://${submissionId}`,
    },
  });
  if (!mission.ok) throw new IntentServiceError("intent_confirmation.failed", mission.error?.detail ?? "Mission creation failed.", mission.statusCode ?? 409);
  const flowId = `flow.${loaded.init.projectId}.${String(missionId).replace(/[^a-zA-Z0-9._-]/gu, "-")}`;
  const next = resolveNextAction({
    cwd: loaded.context.projectRoot,
    projectRef: loaded.context.projectRoot,
    runtimeRoot: loaded.context.runtimeRoot,
  });
  const confirmation = {
    mission,
    flow_id: flowId,
    discovery: null,
    normalization_revision: report.revision,
    next_action: next.nextActionReport.primary_action,
    next_action_report_ref: `evidence://projects/${loaded.init.workspaceProjectId}/reports/${path.basename(next.nextActionReportFile)}`,
    confirmed_at: now(),
    retryable_start: false,
  };
  loaded.submission.status = "confirmed";
  loaded.submission.confirmation = confirmation;
  loaded.submission.updated_at = now();
  atomicJson(loaded.file, loaded.submission);
  return { confirmation, loaded };
}

export function confirmIntent({ registry, projectId, submissionId, expectedRevision }) {
  return confirmIntentRecord({ registry, projectId, submissionId, expectedRevision }).confirmation;
}

export function confirmAndStartIntent({ registry, projectId, submissionId }) {
  const loaded = loadSubmission(registry, projectId, submissionId, { initialize: true });
  if (loaded.submission.confirmation?.discovery) return loaded.submission.confirmation;
  const record = loaded.submission.confirmation
    ? { confirmation: loaded.submission.confirmation, loaded }
    : confirmIntentRecord({ registry, projectId, submissionId });
  return startConfirmedIntent({ registry, projectId, loaded: record.loaded });
}
