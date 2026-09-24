import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { derivePublicId, validateContractDocument, validatePublicId } from "../../contracts/src/index.mjs";
import { readJsonState, withFileLock, writeJsonAtomic } from "../../observability/src/index.mjs";
import { initializeProjectRuntime, previewProjectRuntime } from "./project-init.mjs";
import { readCanonicalContainedFile } from "./shared/canonical-paths.mjs";
import { executeRoutedStep } from "./step-execution-engine.mjs";
import { runLifecycleCommand } from "./control-plane/lifecycle-command.mjs";
import { resolveNextAction } from "./next-action.mjs";
import { inspectGitIdentity } from "./aor-home.mjs";
import { buildCorrectionGuidance, extractStructuredCandidate } from "./structured-candidate.mjs";
import { readExecutionProfile, resolvePreparationRunner } from "./control-plane/execution-profile.mjs";

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
const WORK_TYPE_TO_STEP = Object.freeze({
  analyze: "discovery",
  explain: "research",
  review: "review",
  "document-change": "implement",
  "code-change": "implement",
});

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

function atomicJson(file, document) { writeJsonAtomic(file, document); }

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function preparationKey(normalization, preparationRouteId = null) {
  return normalization
    ? `operator-${crypto.createHash("sha256").update(stableJson(normalization)).digest("hex")}`
    : `provider-intake-normalize-${crypto.createHash("sha256").update(preparationRouteId ?? "automatic").digest("hex")}`;
}

function latestNormalizationReport(loaded) {
  const latestRef = loaded.submission.normalization_refs?.at(-1);
  const reportName = latestRef?.split("/").at(-1);
  const reportFile = reportName ? path.join(loaded.init.runtimeLayout.reportsRoot, reportName) : null;
  return reportFile && fs.existsSync(reportFile)
    ? { reportFile, report: readJsonState(reportFile) }
    : { reportFile: null, report: null };
}

function withSubmissionLock(registry, projectId, submissionId, callback) {
  // Resolve the lock path without reading the JSON state first. A concurrent
  // atomic writer may briefly replace the state file; pre-lock parsing would
  // turn that normal race into a false corruption/recovery event.
  const { init } = resolveProject(registry, projectId, { initialize: false });
  const file = submissionFile(init, submissionId);
  if (!fs.existsSync(file)) throw new IntentServiceError("intent_submission.not_found", `Intent submission '${submissionId}' was not found.`, 404);
  return withFileLock(`${file}.lock`, callback, { staleAfterMs: 30 * 60 * 1000, timeoutMs: 30 * 60 * 1000 });
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
  return { context, init, file, submission: readJsonState(file) };
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
    if (content.includes("\0")) throw new IntentServiceError("intent_attachment.invalid_utf8", `Attachment '${originalName}' contains NUL bytes.`);
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
    const read = readCanonicalContainedFile({ root: context.projectRoot, relativePath, base: "project-relative", maxBytes: MAX_FILE_BYTES });
    if (!read.ok) {
      const invalidPathReasons = new Set(["lexical-escape", "symlink-escape", "canonical-escape", "final-symlink", "non-regular-file"]);
      const code = invalidPathReasons.has(read.reason) ? "intent_source.invalid_path" : "intent_source.not_found";
      throw new IntentServiceError(code, `Repository Markdown source '${relativePath}' could not be read inside the connected project (${read.reason}).`);
    }
    const content = read.bytes;
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new IntentServiceError("intent_source.invalid_utf8", `Repository Markdown source '${relativePath}' is not valid UTF-8.`);
    }
    const digest = crypto.createHash("sha256").update(content).digest("hex");
    const pinnedRevision = String(source?.pinned_base_revision ?? head ?? "").trim();
    if (pinnedRevision && !/^[0-9a-f]{40}$/iu.test(pinnedRevision)) {
      throw new IntentServiceError("intent_source.invalid_revision", "Pinned Markdown base revision must be a full Git commit id.");
    }
    if (pinnedRevision && pinnedRevision !== String(head ?? "").trim()) {
      throw new IntentServiceError("intent_source.revision_mismatch", "Pinned Markdown base revision must match the connected checkout's current HEAD.", 409);
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
    const read = relativePath
      ? readCanonicalContainedFile({ root: context.projectRoot, relativePath, base: "project-relative", maxBytes: MAX_FILE_BYTES })
      : { ok: false, reason: "missing" };
    let currentDigest = null;
    if (read.ok) {
      currentDigest = `sha256:${crypto.createHash("sha256").update(read.bytes).digest("hex")}`;
    }
    return {
      ...source,
      stale: source.stale === true || !read.ok || currentDigest !== source.digest || (source.pinned_base_revision && head !== source.pinned_base_revision),
    };
  });
}

function inheritedSubmissionSources({ registry, projectId, sourceSubmissionId, sourceIds }) {
  const selectedIds = Array.isArray(sourceIds) ? sourceIds.map((value) => String(value).trim()) : [];
  if (!sourceSubmissionId) {
    if (selectedIds.length) throw new IntentServiceError("intent_source.lineage_required", "source_ids require a source_submission_id.");
    return { attachments: [], markdownSources: [], sourceIds: [] };
  }
  if (!validatePublicId(sourceSubmissionId).ok) {
    throw new IntentServiceError("intent_source.invalid_submission_id", "source_submission_id must be a canonical AOR submission ID.");
  }
  if (!Array.isArray(sourceIds) || selectedIds.some((value) => !value) || new Set(selectedIds).size !== selectedIds.length) {
    throw new IntentServiceError("intent_source.invalid_selection", "Source selections must be non-empty unique IDs.");
  }
  if (selectedIds.length > MAX_FILES) throw new IntentServiceError("intent_source.count_exceeded", `At most ${MAX_FILES} inherited sources can be selected.`);
  const loaded = loadSubmission(registry, projectId, sourceSubmissionId);
  const previous = loaded.submission;
  const attachmentById = new Map((Array.isArray(previous.attachments) ? previous.attachments : [])
    .map((attachment, index) => [`${sourceSubmissionId}.source.${index + 1}`, attachment]));
  const repositoryById = new Map((Array.isArray(previous.markdown_sources) ? previous.markdown_sources : [])
    .map((source) => [String(source?.source_id ?? ""), source]));
  const availableIds = new Set([...attachmentById.keys(), ...repositoryById.keys()].filter(Boolean));
  const unknownIds = selectedIds.filter((sourceId) => !availableIds.has(sourceId));
  if (unknownIds.length) throw new IntentServiceError("intent_source.unknown_selection", `Source selection is not present in submission '${sourceSubmissionId}'.`);

  const inheritedAttachments = selectedIds.flatMap((sourceId) => {
    const attachment = attachmentById.get(sourceId);
    if (!attachment) return [];
    const storageRef = String(attachment.storage_ref ?? "").replaceAll("\\", "/");
    if (!storageRef.startsWith(`inputs/${sourceSubmissionId}/`) || storageRef.split("/").includes("..")) {
      throw new IntentServiceError("intent_source.corrupt_attachment", `Attachment source '${sourceId}' has an invalid runtime reference.`, 409);
    }
    const read = readCanonicalContainedFile({ root: loaded.init.runtimeLayout.projectRuntimeRoot, relativePath: storageRef, base: "runtime-relative", maxBytes: MAX_FILE_BYTES });
    if (!read.ok) throw new IntentServiceError("intent_source.missing_attachment", `Attachment source '${sourceId}' could not be read from its immutable snapshot (${read.reason}).`, 409);
    const digest = crypto.createHash("sha256").update(read.bytes).digest("hex");
    if (digest !== attachment.sha256 || read.bytes.length !== attachment.byte_length) {
      throw new IntentServiceError("intent_source.corrupt_attachment", `Attachment source '${sourceId}' no longer matches its recorded digest.`, 409);
    }
    let content;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes); }
    catch { throw new IntentServiceError("intent_source.invalid_utf8", `Attachment source '${sourceId}' is not valid UTF-8.`, 409); }
    return [{ name: attachment.original_name, content }];
  });

  const selectedRepositorySources = selectedIds.map((sourceId) => repositoryById.get(sourceId)).filter(Boolean);
  const currentRepositorySources = new Map(currentMarkdownSourceStatus(loaded.context, selectedRepositorySources).map((source) => [source.source_id, source]));
  const inheritedMarkdownSources = selectedRepositorySources.map((source, index) => {
    const current = currentRepositorySources.get(source.source_id);
    if (!current || current.stale === true) {
      throw new IntentServiceError("intent_source.stale_inherited", `Repository source '${source.project_relative_path}' changed after its snapshot. Remove it and add the current file before preparing a new Task.`, 409);
    }
    const digest = String(source.digest ?? "").replace(/^sha256:/u, "");
    return { ...source, source_id: `source.${index + 1}.${digest.slice(0, 12)}`, stale: false };
  });
  return { attachments: inheritedAttachments, markdownSources: inheritedMarkdownSources, sourceIds: selectedIds };
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

function requireReadyPreparationRunner(registry, projectId, routeId, { requireCurrentCheck = false } = {}) {
  let runner;
  try {
    runner = resolvePreparationRunner({ registry, projectId, routeId, check: true });
  } catch (error) {
    if (error instanceof IntentServiceError) throw error;
    throw new IntentServiceError(error?.code ?? "intent_provider.route_invalid", error instanceof Error ? error.message : String(error), error?.statusCode ?? 409);
  }
  if (runner.readiness !== "ready") {
    const adapter = runner.adapter ?? "selected runner";
    const message = runner.readiness === "runner-missing"
      ? `The selected runner '${adapter}' is not installed or its command is unavailable.`
      : runner.readiness === "auth-missing"
        ? `Authenticate the selected runner '${adapter}', then check its readiness again.`
        : `The selected runner '${adapter}' is not ready (${runner.readiness}).`;
    throw new IntentServiceError("intent_provider.not_ready", message, 409, { route_id: routeId, readiness: runner.readiness });
  }
  if (requireCurrentCheck) {
    const report = registry.getProjectInput(projectId)?.latestExecutionReadiness;
    const checked = report?.revision === registry.revision
      && report.step_results?.some((entry) => entry?.step === "discovery"
        && entry?.route_id === routeId
        && entry?.adapter === runner.adapter
        && entry?.status === "ready");
    if (!checked) {
      throw new IntentServiceError("intent_provider.not_checked", "Check the selected task-preparation runner again before creating this task.", 409, { route_id: routeId });
    }
  }
  if (!["codex-cli", "claude-code", "qwen-code"].includes(runner.adapter)) {
    throw new IntentServiceError("intent_provider.unsupported", `Route '${routeId}' does not select a supported task-preparation runner.`, 409);
  }
  return runner;
}

export function createIntentSubmission({ registry, projectId, requestText = "", attachments = [], markdownSources = [], sourceSubmissionId = null, sourceIds = [], autoPrepare = true, preflightPreparation = autoPrepare, normalization, preparationRouteId }) {
  const { context, init } = resolveProject(registry, projectId);
  const text = String(requestText ?? "").trim();
  const sourceId = typeof sourceSubmissionId === "string" ? sourceSubmissionId.trim() : "";
  const inherited = inheritedSubmissionSources({ registry, projectId, sourceSubmissionId: sourceId, sourceIds });
  const allAttachments = [...inherited.attachments, ...(Array.isArray(attachments) ? attachments : [])];
  if (!text && allAttachments.length === 0 && (!Array.isArray(markdownSources) || markdownSources.length === 0) && inherited.markdownSources.length === 0) {
    throw new IntentServiceError("intent_submission.empty", "Enter request text or attach at least one text file.");
  }
  if (allAttachments.length > MAX_FILES) throw new IntentServiceError("intent_attachment.count_exceeded", `At most ${MAX_FILES} attachments are allowed.`);
  const repositorySources = repositoryMarkdownRecords(context, markdownSources);
  const allRepositorySources = [...inherited.markdownSources, ...repositorySources];
  if (allAttachments.length + allRepositorySources.length > MAX_FILES) throw new IntentServiceError("intent_source.count_exceeded", `At most ${MAX_FILES} total Markdown sources and attachments are allowed.`);
  if (new Set(allRepositorySources.map((source) => source.project_relative_path)).size !== allRepositorySources.length) {
    throw new IntentServiceError("intent_source.duplicate", "A repository Markdown path can appear only once in a Task submission.");
  }
  let selectedPreparationRouteId = typeof preparationRouteId === "string" ? preparationRouteId.trim() : "";
  const explicitPreparationRoute = Boolean(selectedPreparationRouteId);
  const preparationRequested = autoPrepare || preflightPreparation;
  if (preparationRequested && !normalization && !selectedPreparationRouteId) {
    const adapter = providerReadiness(registry, projectId);
    selectedPreparationRouteId = adapter === "claude-code" ? "route.intake-normalize.claude"
      : adapter === "qwen-code" ? "route.intake-normalize.qwen"
        : adapter === "codex-cli" ? "route.intake-normalize.default" : "";
  }
  if (selectedPreparationRouteId) {
    requireReadyPreparationRunner(registry, projectId, selectedPreparationRouteId, { requireCurrentCheck: explicitPreparationRoute });
  } else if (preparationRequested && !normalization) {
    throw new IntentServiceError("intent_provider.not_ready", "Check a configured task-preparation runner before creating this task.", 409);
  }
  const seed = crypto.createHash("sha256").update(`${text}\0${JSON.stringify(allAttachments.map((entry) => entry?.name))}\0${JSON.stringify(allRepositorySources.map((entry) => entry.digest))}\0${sourceId}\0${JSON.stringify(inherited.sourceIds)}\0${Date.now()}`).digest("hex").slice(0, 16);
  const submissionId = derivePublicId(["intent-submission", init.projectId, seed], "intent-submission");
  const createdAt = now();
  const submission = {
    submission_id: submissionId,
    workspace_project_id: context.projectId,
    project_id: init.projectId,
    revision: 1,
    status: "submitted",
    request_text: text,
    attachments: attachmentRecords(init, submissionId, allAttachments),
    markdown_sources: allRepositorySources,
    ...(sourceId ? { source_lineage: { source_submission_id: sourceId, source_ids: inherited.sourceIds } } : {}),
    repository_snapshot: repositorySnapshot(context),
    ...(selectedPreparationRouteId ? { preparation_route_id: selectedPreparationRouteId } : {}),
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
  return withSubmissionLock(registry, projectId, submissionId, () => {
    const loaded = loadSubmission(registry, projectId, submissionId, { initialize: true });
    const { submission, init, context, file } = loaded;
    if (["confirmed", "canceled"].includes(submission.status)) throw new IntentServiceError("intent_submission.terminal", "Terminal intent submissions cannot be prepared again.", 409);

    const key = preparationKey(normalization, submission.preparation_route_id);
    const latest = latestNormalizationReport(loaded);
    if (submission.status === "prepared" && submission.preparation_key === key && latest.report) {
      return { submission, report: latest.report, report_file: latest.reportFile, idempotent: true };
    }
    if (submission.status === "preparing") {
      submission.status = "blocked";
      submission.blocker = {
        code: "intent_prepare.interrupted",
        message: "A previous preparation attempt stopped before it committed a result; retrying from the durable submission state.",
      };
    }
    const previousNormalization = normalization ? latest.report : null;
    const attemptId = derivePublicId(["intent-prepare-attempt", submissionId, key], "intent-prepare-attempt");
    submission.status = "preparing";
    submission.preparation_key = key;
    submission.preparation_attempt = { attempt_id: attemptId, preparation_key: key, owner_pid: process.pid, started_at: now() };
    submission.updated_at = now();
    atomicJson(file, submission);
    let candidate = normalization ? asRecord(normalization) : {};
    let extraction = null;
    try {
      let provider = normalization
        ? previousNormalization?.provider?.adapter_id ?? "operator-revision"
        : submission.preparation_route_id
          ? requireReadyPreparationRunner(registry, projectId, submission.preparation_route_id).adapter
          : providerReadiness(registry, projectId);
      let selectedRouteId = normalization
        ? previousNormalization?.provider?.route_id ?? "route.intake-normalize.default"
        : submission.preparation_route_id ?? "route.intake-normalize.default";
      if (!normalization) {
        if (!provider) throw new IntentServiceError("intent_provider.not_ready", "Configure and authenticate Codex, Claude, or Qwen before preparing this task.", 409);
        if (!submission.preparation_route_id) {
          selectedRouteId = provider === "claude-code" ? "route.intake-normalize.claude" : provider === "qwen-code" ? "route.intake-normalize.qwen" : "route.intake-normalize.default";
        }
        const routed = executeRoutedStep({
          ...context.runtimeOptions,
          stepClass: "discovery",
          dryRun: false,
          runId: derivePublicId(["intent-normalize", submissionId], "intent-normalize-run"),
          stepId: "intent.normalize",
          requireDiscoveryCompleteness: false,
          routeOverrides: { discovery: selectedRouteId },
          promptBundleOverrides: { discovery: "prompt-bundle://intake-normalize@v1" },
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
      report.preparation_key = key;
      const reportFile = path.join(init.runtimeLayout.reportsRoot, `intent-normalization-report-${submissionId}-v${revision}.json`);
      atomicJson(reportFile, report);
      submission.normalization_refs.push(`evidence://projects/${context.projectId}/reports/${path.basename(reportFile)}`);
      submission.status = report.status === "prepared" ? "prepared" : "blocked";
      submission.preparation_attempt = { ...submission.preparation_attempt, status: "completed", finished_at: now() };
      submission.updated_at = now();
      atomicJson(file, submission);
      return { submission, report, report_file: reportFile, idempotent: false };
    } catch (error) {
      submission.status = "blocked";
      submission.preparation_attempt = { ...submission.preparation_attempt, status: "failed", finished_at: now() };
      submission.updated_at = now();
      submission.blocker = { code: error?.code ?? "intent_prepare.failed", message: error instanceof Error ? error.message : String(error) };
      atomicJson(file, submission);
      throw error;
    }
  });
}

export function readIntentSubmission({ registry, projectId, submissionId }) {
  const loaded = loadSubmission(registry, projectId, submissionId);
  const latestRef = loaded.submission.normalization_refs.at(-1);
  const reportName = latestRef?.split("/").at(-1);
  const reportFile = reportName ? path.join(loaded.init.runtimeLayout.reportsRoot, reportName) : null;
  return {
    submission: { ...loaded.submission, markdown_sources: currentMarkdownSourceStatus(loaded.context, loaded.submission.markdown_sources) },
    normalization: reportFile && fs.existsSync(reportFile) ? readJsonState(reportFile) : null,
  };
}

export function selectIntentExecutionRoute({ registry, projectId, submissionId, routeId = null, expectedRevision, expectedSelectionRevision }) {
  return withSubmissionLock(registry, projectId, submissionId, () => {
    const loaded = loadSubmission(registry, projectId, submissionId, { initialize: true });
    const { submission, file } = loaded;
    const latest = latestNormalizationReport(loaded);
    const normalization = latest.report;
    if (submission.status !== "prepared" || normalization?.status !== "prepared") {
      throw new IntentServiceError("intent_submission.runner_selection_unavailable", "Choose an execution route only after the Task is prepared.", 409);
    }
    if (expectedRevision !== undefined && normalization.revision !== expectedRevision) {
      throw new IntentServiceError("intent_submission.stale_revision", `Prepared Task revision ${expectedRevision} is stale; the server currently has revision ${normalization.revision}. Refresh before changing its runner.`, 409, {
        current_revision: normalization.revision,
        recovery_actions: [{ action: "refresh", payload: { resource: `intent-submission://${submissionId}`, current_revision: normalization.revision } }],
      });
    }
    const currentSelectionRevision = Number.isInteger(submission.runner_selection_revision) ? submission.runner_selection_revision : 0;
    if (expectedSelectionRevision !== undefined && currentSelectionRevision !== expectedSelectionRevision) {
      throw new IntentServiceError("intent_submission.stale_runner_selection", `Runner selection revision ${expectedSelectionRevision} is stale; the server currently has revision ${currentSelectionRevision}. Refresh before changing the runner.`, 409, {
        current_selection_revision: currentSelectionRevision,
        recovery_actions: [{ action: "refresh", payload: { resource: `intent-submission://${submissionId}`, current_selection_revision: currentSelectionRevision } }],
      });
    }
    const step = WORK_TYPE_TO_STEP[normalization.work_type];
    if (!step) throw new IntentServiceError("intent_submission.runner_step_unavailable", "The prepared Task does not have an approved execution step.", 409);
    let nextOverride = null;
    if (routeId) {
      let executionProfile;
      try {
        executionProfile = readExecutionProfile({ registry, projectId });
      } catch (error) {
        throw new IntentServiceError(error?.code ?? "execution-profile.unavailable", error instanceof Error ? error.message : String(error), error?.statusCode ?? 409);
      }
      const route = executionProfile.routes
        ?.find((entry) => entry?.step === step)
        ?.approved_routes
        ?.find((entry) => entry?.route_id === routeId);
      if (!route || routeId.startsWith("route.intake-normalize.")) {
        throw new IntentServiceError("intent_submission.runner_route_invalid", `Route '${routeId}' is not an approved execution route for step '${step}'.`, 409, { route_id: routeId, step });
      }
      nextOverride = { route_id: routeId, step };
    }
    const currentRouteId = submission.execution_route_override?.route_id ?? null;
    if (currentRouteId === (nextOverride?.route_id ?? null)) {
      return { submission, idempotent: true };
    }
    if (nextOverride) submission.execution_route_override = nextOverride;
    else delete submission.execution_route_override;
    submission.runner_selection_revision = currentSelectionRevision + 1;
    submission.updated_at = now();
    atomicJson(file, submission);
    return { submission, idempotent: false };
  });
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
      const submission = readJsonState(file);
      const latestRef = submission.normalization_refs?.at(-1);
      const reportName = latestRef?.split("/").at(-1);
      const reportFile = reportName ? path.join(init.runtimeLayout.reportsRoot, reportName) : null;
      const normalization = reportFile && fs.existsSync(reportFile)
        ? readJsonState(reportFile)
        : null;
      return { submission: { ...submission, markdown_sources: currentMarkdownSourceStatus(context, submission.markdown_sources) }, normalization };
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
  return withSubmissionLock(registry, projectId, submissionId, () => {
    const loaded = loadSubmission(registry, projectId, submissionId);
    if (loaded.submission.status === "confirmed") throw new IntentServiceError("intent_submission.confirmed", "Confirmed submissions cannot be canceled.", 409);
    loaded.submission.status = "canceled";
    loaded.submission.updated_at = now();
    atomicJson(loaded.file, loaded.submission);
    return { submission: loaded.submission };
  });
}

function assertRunnerSelectionRevision(submission, expectedSelectionRevision) {
  if (expectedSelectionRevision === undefined) return;
  const current = Number.isInteger(submission.runner_selection_revision) ? submission.runner_selection_revision : 0;
  if (current !== expectedSelectionRevision) {
    throw new IntentServiceError("intent_submission.stale_runner_selection", `Runner selection revision ${expectedSelectionRevision} is stale; the server currently has revision ${current}. Refresh before starting this Task.`, 409, {
      current_selection_revision: current,
      recovery_actions: [{ action: "refresh", payload: { resource: `intent-submission://${submission.submission_id}`, current_selection_revision: current } }],
    });
  }
}

function assertPreparedNormalizationRevision({ report, submissionId, expectedRevision }) {
  if (!report || report.status !== "prepared") {
    throw new IntentServiceError("intent_submission.not_prepared", "Prepare and resolve the task preview before confirmation.", 409);
  }
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
}

function assertMarkdownSourcesCurrent(loaded) {
  const sources = currentMarkdownSourceStatus(loaded.context, loaded.submission.markdown_sources);
  const staleSources = sources.filter((source) => source.stale === true);
  if (staleSources.length) {
    throw new IntentServiceError(
      "intent_source.stale",
      `Repository Markdown sources changed after preparation: ${staleSources.map((source) => source.project_relative_path).join(", ")}. Remove them and add the current files before confirming this Task.`,
      409,
      { stale_source_ids: staleSources.map((source) => source.source_id) },
    );
  }
}

function requireReadyExecutionRoute({ registry, projectId, loaded }) {
  const override = loaded.submission.execution_route_override;
  const normalization = latestNormalizationReport(loaded).report;
  const step = override?.step ?? WORK_TYPE_TO_STEP[normalization?.work_type];
  if (!step) throw new IntentServiceError("intent_execution.route_unavailable", "The prepared Task has no approved execution step.", 409);
  let executionProfile;
  try {
    executionProfile = readExecutionProfile({ registry, projectId });
  } catch (error) {
    throw new IntentServiceError(error?.code ?? "execution-profile.unavailable", error instanceof Error ? error.message : String(error), error?.statusCode ?? 409);
  }
  const row = executionProfile.routes?.find((entry) => entry?.step === step);
  const routeId = override?.route_id ?? row?.route_id;
  const selected = override
    ? row?.approved_routes?.find((entry) => entry?.route_id === override.route_id)
    : row;
  if (!routeId || routeId.startsWith("route.intake-normalize.") || !selected) {
    throw new IntentServiceError("intent_execution.route_unavailable", "Task start requires an approved execution route for its selected step.", 409, { route_id: routeId ?? null, step });
  }
  const routeReadinessCurrent = Number.isInteger(selected.readiness_revision)
    && selected.readiness_revision === executionProfile.revision;
  if (selected.readiness !== "ready" || !routeReadinessCurrent) {
    const readiness = selected.readiness ?? "unknown";
    throw new IntentServiceError("intent_execution.route_not_ready", `Execution route '${routeId}' is not ready (${readiness}). Check the exact route before starting this Task.`, 409, {
      route_id: routeId,
      step,
      readiness,
      recovery_actions: [{ action: "refresh", payload: { resource: `task://${loaded.submission.submission_id}` } }],
    });
  }
  return { route_id: routeId, step, source: override ? "task-override" : "project-default" };
}

function startConfirmedIntent({ loaded, registry }) {
  assertMarkdownSourcesCurrent(loaded);
  const executionRoute = requireReadyExecutionRoute({ registry, projectId: loaded.context.projectId, loaded });
  const existingTransaction = loaded.submission.confirmation?.start_transaction;
  if (existingTransaction?.status === "in-progress") {
    throw new IntentServiceError(
      "intent_submission.start_in_progress",
      "Task start is already in progress or was interrupted; refresh the Task before retrying.",
      409,
      {
        transaction_id: existingTransaction.transaction_id,
        recovery_actions: [{ action: "retry", payload: { resource: `intent-submission://${loaded.submission.submission_id}` } }],
      },
    );
  }
  const transaction = {
    transaction_id: existingTransaction?.transaction_id ?? derivePublicId([loaded.init.workspaceProjectId, loaded.submission.submission_id, "start"], "task-start"),
    idempotency_key: existingTransaction?.idempotency_key ?? `task-start:${loaded.init.workspaceProjectId}:${loaded.submission.submission_id}`,
    status: "in-progress",
    started_at: existingTransaction?.started_at ?? now(),
    attempt: Number.isInteger(existingTransaction?.attempt) ? existingTransaction.attempt + 1 : 1,
  };
  loaded.submission.confirmation = {
    ...loaded.submission.confirmation,
    start_transaction: transaction,
  };
  loaded.submission.updated_at = now();
  atomicJson(loaded.file, loaded.submission);
  const discovery = runLifecycleCommand({
    cwd: loaded.context.projectRoot,
    projectRef: loaded.context.projectRoot,
    runtimeRoot: loaded.context.runtimeRoot,
    command: "discovery run",
    flags: executionRoute.source === "task-override"
      ? { "route-overrides": `${executionRoute.step}=${executionRoute.route_id}` }
      : {},
  });
  loaded.submission.confirmation = {
    ...loaded.submission.confirmation,
    discovery,
    start_transaction: {
      ...transaction,
      status: discovery.ok === true ? "completed" : "failed",
      finished_at: now(),
    },
    last_start_attempt_at: now(),
    retryable_start: discovery.ok !== true,
  };
  loaded.submission.updated_at = now();
  atomicJson(loaded.file, loaded.submission);
  return loaded.submission.confirmation;
}

export function retryIntentStart({ registry, projectId, submissionId }) {
  return withSubmissionLock(registry, projectId, submissionId, () => {
    const loaded = loadSubmission(registry, projectId, submissionId, { initialize: true });
    if (!loaded.submission.confirmation) {
      throw new IntentServiceError("intent_submission.not_confirmed", "Confirm the prepared task before retrying its start.", 409);
    }
    if (loaded.submission.confirmation.retryable_start !== true) return loaded.submission.confirmation;
    return startConfirmedIntent({ loaded, registry });
  });
}

function confirmIntentRecordUnlocked({ registry, projectId, submissionId, expectedRevision, expectedSelectionRevision }) {
  const loaded = loadSubmission(registry, projectId, submissionId, { initialize: true });
  assertRunnerSelectionRevision(loaded.submission, expectedSelectionRevision);
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
  assertMarkdownSourcesCurrent({ ...loaded, submission: current.submission });
  const report = current.normalization;
  assertPreparedNormalizationRevision({ report, submissionId, expectedRevision });
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
  // Public Task/Flow lineage is keyed by the Workspace project identity. The
  // runtime profile id is machine-local and must not leak into readback or
  // create a second Flow when the same project is reopened after restart.
  const flowId = `flow.${loaded.init.workspaceProjectId}.${String(missionId).replace(/[^a-zA-Z0-9._-]/gu, "-")}`;
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

export function confirmIntent({ registry, projectId, submissionId, expectedRevision, expectedSelectionRevision }) {
  return withSubmissionLock(registry, projectId, submissionId, () => confirmIntentRecordUnlocked({ registry, projectId, submissionId, expectedRevision, expectedSelectionRevision }).confirmation);
}

export function confirmAndStartIntent({ registry, projectId, submissionId, expectedRevision, expectedSelectionRevision }) {
  return withSubmissionLock(registry, projectId, submissionId, () => {
    const loaded = loadSubmission(registry, projectId, submissionId, { initialize: true });
    assertRunnerSelectionRevision(loaded.submission, expectedSelectionRevision);
    if (!loaded.submission.confirmation) {
      assertPreparedNormalizationRevision({
        report: latestNormalizationReport(loaded).report,
        submissionId,
        expectedRevision,
      });
    }
    requireReadyExecutionRoute({ registry, projectId, loaded });
    if (loaded.submission.confirmation?.discovery) return loaded.submission.confirmation;
    const record = loaded.submission.confirmation
      ? { confirmation: loaded.submission.confirmation, loaded }
      : confirmIntentRecordUnlocked({ registry, projectId, submissionId, expectedRevision, expectedSelectionRevision });
    return startConfirmedIntent({ loaded: record.loaded, registry });
  });
}
