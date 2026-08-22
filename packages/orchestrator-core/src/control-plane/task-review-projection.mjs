import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { resolveLogicalEvidenceRef } from "../aor-home.mjs";
import { createProjectReadContext } from "./project-context.mjs";
import { listDeliveryManifests, listStepResults } from "./read-artifact-readers.mjs";
import { readTaskProjection } from "./task-projections.mjs";

const MAX_FILES = 200;
const MAX_DIFF_ROWS = 2_000;
const MAX_PATCH_BYTES = 512 * 1024;
const MAX_RENDERED_BYTES = 64 * 1024;
const MAX_ROW_LENGTH = 4_000;

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeTaskReviewPath(value) {
  const candidate = asString(value);
  if (!candidate || candidate.includes("\0") || candidate.includes("\\") || path.posix.isAbsolute(candidate)) return null;
  const normalized = path.posix.normalize(candidate.replace(/^\.\//u, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function taskRunIds(task) {
  return new Set(asStringArray(task?.run_ids).map((entry) => entry.replace(/^run:\/\//u, "")));
}

function documentRunIds(document) {
  const record = asRecord(document);
  return uniqueStrings([
    asString(record.run_id),
    ...asStringArray(record.run_refs),
    asString(asRecord(record.runtime_harness).run_id),
    asString(asRecord(record.closure_state).run_id),
  ]).map((entry) => entry.replace(/^run:\/\//u, ""));
}

function entryMatchesTask(entry, task) {
  const runs = taskRunIds(task);
  if (runs.size > 0 && documentRunIds(entry.document).some((runId) => runs.has(runId))) return true;
  return asString(asRecord(entry.document).target_flow_id) === asString(task?.flow_id);
}

function missionSemantics(entry) {
  return asRecord(asRecord(entry?.document).mission_semantics);
}

function changedPathsFromStep(entry) {
  const semantics = missionSemantics(entry);
  return uniqueStrings([
    ...asStringArray(semantics.meaningful_changed_paths),
    ...asStringArray(semantics.changed_paths_during_step),
    ...asStringArray(semantics.changed_paths_after_step),
    ...asStringArray(semantics.changed_paths),
  ]).map(normalizeTaskReviewPath).filter(Boolean);
}

function changedPathsFromManifest(entry) {
  const deliveries = Array.isArray(entry?.document?.repo_deliveries) ? entry.document.repo_deliveries : [];
  return uniqueStrings(deliveries.flatMap((delivery) => asStringArray(asRecord(delivery).changed_paths)))
    .map(normalizeTaskReviewPath)
    .filter(Boolean);
}

function deliveryStats(entry) {
  const stats = new Map();
  const deliveries = Array.isArray(entry?.document?.repo_deliveries) ? entry.document.repo_deliveries : [];
  for (const delivery of deliveries) {
    const record = asRecord(delivery);
    const totals = asRecord(record.diff_totals);
    const paths = asStringArray(record.changed_paths).map(normalizeTaskReviewPath).filter(Boolean);
    if (paths.length === 1) {
      stats.set(paths[0], {
        additions: Number.isInteger(totals.additions) ? totals.additions : 0,
        deletions: Number.isInteger(totals.deletions) ? totals.deletions : 0,
      });
    }
  }
  return stats;
}

function resolveEvidencePath(init, reference) {
  if (!reference) return null;
  if (reference.startsWith("evidence://")) {
    return resolveLogicalEvidenceRef({
      projectRoot: init.projectRoot,
      projectRuntimeRoot: init.projectRuntimeRoot,
      workspaceProjectId: init.projectId,
      reference,
    });
  }
  return null;
}

function readPatchEvidence(init, manifests) {
  for (const entry of manifests) {
    const refs = asStringArray(asRecord(asRecord(entry.document).source_refs).delivery_output_refs);
    for (const reference of refs) {
      const filePath = resolveEvidencePath(init, reference);
      if (!filePath || !/\.(?:diff|patch)$/iu.test(filePath) || !fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      const source = fs.readFileSync(filePath, "utf8").slice(0, MAX_PATCH_BYTES);
      return { source, sourceRef: reference, truncated: stat.size > MAX_PATCH_BYTES };
    }
  }
  return null;
}

function readWorkspaceDiff(stepEntries, changedPaths) {
  for (const entry of stepEntries) {
    const root = asString(missionSemantics(entry).git_status_root);
    if (!root || !path.isAbsolute(root) || !fs.existsSync(root)) continue;
    const requestedPaths = changedPaths.slice(0, MAX_FILES);
    if (!requestedPaths.length) continue;
    const run = spawnSync("git", ["diff", "--no-ext-diff", "--no-color", "--unified=3", "HEAD", "--", ...requestedPaths], {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: MAX_PATCH_BYTES + 1,
    });
    if (run.status === 0 && run.stdout) {
      return {
        source: run.stdout.slice(0, MAX_PATCH_BYTES),
        sourceRef: entry.artifact_ref,
        truncated: Buffer.byteLength(run.stdout, "utf8") > MAX_PATCH_BYTES,
      };
    }
  }
  return null;
}

function diffPath(value) {
  const candidate = String(value ?? "").trim().replace(/^(?:a|b)\//u, "");
  return candidate === "/dev/null" ? null : normalizeTaskReviewPath(candidate);
}

function fileKind(filePath, binary = false) {
  if (binary) return "binary";
  return /\.(?:md|markdown)$/iu.test(filePath) ? "markdown" : "text";
}

function emptyParsedFile(filePath) {
  return { path: filePath, kind: fileKind(filePath), additions: 0, deletions: 0, binary: false, truncated: false, hunks: [] };
}

export function parseUnifiedTaskReviewDiff(source, options = {}) {
  const files = [];
  let current = null;
  let hunk = null;
  let oldLine = null;
  let newLine = null;
  let rowCount = 0;
  let truncated = options.truncated === true;

  const ensureFile = (filePath) => {
    if (!filePath) return current;
    if (!current || current.path !== filePath) {
      current = emptyParsedFile(filePath);
      files.push(current);
    }
    return current;
  };

  for (const rawLine of String(source ?? "").split(/\r?\n/u)) {
    if (files.length > MAX_FILES || rowCount >= MAX_DIFF_ROWS) {
      truncated = true;
      if (current) current.truncated = true;
      break;
    }
    if (rawLine.startsWith("diff --git ")) {
      const match = rawLine.match(/^diff --git a\/(.+) b\/(.+)$/u);
      current = match ? emptyParsedFile(diffPath(match[2]) ?? diffPath(match[1])) : null;
      if (current) files.push(current);
      hunk = null;
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      const nextPath = diffPath(rawLine.slice(4).split("\t")[0]);
      if (nextPath) {
        if (current && current.hunks.length === 0 && current.additions === 0 && current.deletions === 0) current.path = nextPath;
        else ensureFile(nextPath);
      }
      continue;
    }
    if (/^(?:Binary files .* differ|GIT binary patch)$/u.test(rawLine)) {
      if (current) {
        current.binary = true;
        current.kind = "binary";
      }
      continue;
    }
    const header = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u);
    if (header && current) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      hunk = {
        old_start: oldLine,
        old_lines: Number(header[2] ?? 1),
        new_start: newLine,
        new_lines: Number(header[4] ?? 1),
        rows: [],
      };
      current.hunks.push(hunk);
      continue;
    }
    if (!current || !hunk || rawLine.startsWith("\\ No newline")) continue;
    const marker = rawLine[0];
    if (![" ", "+", "-"].includes(marker)) continue;
    const text = rawLine.slice(1, MAX_ROW_LENGTH + 1);
    if (marker === "+") {
      hunk.rows.push({ kind: "addition", old_line: null, new_line: newLine, text });
      current.additions += 1;
      newLine += 1;
    } else if (marker === "-") {
      hunk.rows.push({ kind: "deletion", old_line: oldLine, new_line: null, text });
      current.deletions += 1;
      oldLine += 1;
    } else {
      hunk.rows.push({ kind: "context", old_line: oldLine, new_line: newLine, text });
      oldLine += 1;
      newLine += 1;
    }
    rowCount += 1;
  }
  return { files: files.filter((file) => file.path).slice(0, MAX_FILES), truncated };
}

function isHtmlWhitespace(code) {
  return code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20;
}

function isHtmlTagNameCharacter(code) {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || code === 0x3a || code === 0x2d;
}

function findHtmlTagEnd(source, start) {
  let quote = 0;
  for (let index = start; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (quote !== 0) {
      if (code === quote) quote = 0;
      continue;
    }
    if (code === 0x22 || code === 0x27) {
      quote = code;
      continue;
    }
    if (code === 0x3e) return index;
  }
  return -1;
}

function parseHtmlTag(source, start) {
  const end = findHtmlTagEnd(source, start + 1);
  if (end < 0) return null;
  let cursor = start + 1;
  while (cursor < end && isHtmlWhitespace(source.charCodeAt(cursor))) cursor += 1;
  const closing = source.charCodeAt(cursor) === 0x2f;
  if (closing) {
    cursor += 1;
    while (cursor < end && isHtmlWhitespace(source.charCodeAt(cursor))) cursor += 1;
  }
  const nameStart = cursor;
  while (cursor < end && isHtmlTagNameCharacter(source.charCodeAt(cursor))) cursor += 1;
  return { end, closing, name: source.slice(nameStart, cursor).toLowerCase() };
}

function findClosingHtmlTag(source, start, name) {
  let cursor = start;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open < 0) return -1;
    const tag = parseHtmlTag(source, open);
    if (!tag) return -1;
    if (tag.closing && tag.name === name) return tag.end;
    cursor = tag.end + 1;
  }
  return -1;
}

export function sanitizeMarkdownExcerpt(value) {
  const source = String(value ?? "");
  let output = "";
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open < 0) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, open);
    const tag = parseHtmlTag(source, open);
    if (!tag) break;
    if (!tag.closing && (tag.name === "script" || tag.name === "style")) {
      const closingEnd = findClosingHtmlTag(source, tag.end + 1, tag.name);
      if (closingEnd < 0) break;
      cursor = closingEnd + 1;
      continue;
    }
    cursor = tag.end + 1;
  }
  return output.slice(0, MAX_RENDERED_BYTES);
}

function renderedExcerpt(file) {
  if (file.kind !== "markdown") return null;
  const rows = file.hunks.flatMap((hunk) => hunk.rows);
  return {
    before: sanitizeMarkdownExcerpt(rows.filter((row) => row.kind !== "addition").map((row) => row.text).join("\n")),
    after: sanitizeMarkdownExcerpt(rows.filter((row) => row.kind !== "deletion").map((row) => row.text).join("\n")),
    sanitized: true,
    partial: true,
  };
}
function publicFileSummary(file, fallbackStats) {
  return {
    path: file.path,
    kind: file.kind,
    additions: file.additions || fallbackStats?.additions || 0,
    deletions: file.deletions || fallbackStats?.deletions || 0,
    diff_available: file.binary !== true && file.hunks.length > 0,
    truncated: file.truncated === true,
  };
}

function normalizeProvidedReview(reviewDocument, selectedPath) {
  const document = asRecord(reviewDocument);
  const files = Array.isArray(document.files) ? document.files : [];
  const normalizedFiles = files.map((entry) => ({ ...asRecord(entry), path: normalizeTaskReviewPath(asRecord(entry).path) })).filter((entry) => entry.path);
  const requestedPath = selectedPath ?? normalizeTaskReviewPath(document.selected_path) ?? normalizedFiles[0]?.path ?? null;
  if (selectedPath && !normalizedFiles.some((file) => file.path === selectedPath)) {
    return { error: { code: "task.review_path_invalid", detail: `Path '${selectedPath}' is not part of the recorded Task review.` } };
  }
  const selectedFile = asRecord(document.selected_file);
  return {
    ...document,
    files: normalizedFiles,
    selected_path: requestedPath,
    selected_file: selectedFile.path === requestedPath ? selectedFile : normalizedFiles.find((file) => file.path === requestedPath) ?? null,
    read_only: true,
  };
}

export function readTaskReviewProjection(options = {}) {
  const task = readTaskProjection(options);
  if (!task) return null;
  const selectedPath = options.path == null ? null : normalizeTaskReviewPath(options.path);
  if (options.path != null && !selectedPath) {
    return { error: { code: "task.review_path_invalid", detail: "Review path must be a safe project-relative path." } };
  }
  if (options.reviewDocument) return normalizeProvidedReview(options.reviewDocument, selectedPath);

  const init = createProjectReadContext(options);
  const steps = listStepResults({ ...options, limit: 1_000 }).filter((entry) => entryMatchesTask(entry, task));
  const manifests = listDeliveryManifests({ ...options, limit: 1_000 }).filter((entry) => entryMatchesTask(entry, task));
  const declaredPaths = uniqueStrings([
    ...asStringArray(task.review?.changed_paths),
    ...steps.flatMap(changedPathsFromStep),
    ...manifests.flatMap(changedPathsFromManifest),
  ]).map(normalizeTaskReviewPath).filter(Boolean).slice(0, MAX_FILES);
  if (selectedPath && !declaredPaths.includes(selectedPath)) {
    return { error: { code: "task.review_path_invalid", detail: `Path '${selectedPath}' is not part of the recorded Task review.` } };
  }

  const patch = readPatchEvidence(init, manifests) ?? readWorkspaceDiff(steps, declaredPaths);
  const parsed = patch ? parseUnifiedTaskReviewDiff(patch.source, { truncated: patch.truncated }) : { files: [], truncated: false };
  const parsedByPath = new Map(parsed.files.map((file) => [file.path, file]));
  const manifestStats = manifests.length ? deliveryStats(manifests[0]) : new Map();
  const allPaths = uniqueStrings([...declaredPaths, ...parsed.files.map((file) => file.path)]).slice(0, MAX_FILES);
  const internalFiles = allPaths.map((filePath) => parsedByPath.get(filePath) ?? emptyParsedFile(filePath));
  const files = internalFiles.map((file) => publicFileSummary(file, manifestStats.get(file.path)));
  const effectivePath = selectedPath ?? files[0]?.path ?? null;
  const internalSelected = internalFiles.find((file) => file.path === effectivePath) ?? null;
  const selectedFile = internalSelected
    ? {
        ...publicFileSummary(internalSelected, manifestStats.get(internalSelected.path)),
        hunks: internalSelected.hunks,
        rendered: renderedExcerpt(internalSelected),
        source_ref: patch?.sourceRef ?? null,
      }
    : null;
  const availability = files.length === 0
    ? declaredPaths.length === 0 ? "empty" : "unavailable"
    : selectedFile?.kind === "binary"
      ? "binary"
      : parsed.truncated || selectedFile?.truncated
        ? "truncated"
        : selectedFile?.diff_available
          ? "available"
          : "unavailable";
  const evidenceRefs = uniqueStrings([
    patch?.sourceRef,
    ...steps.map((entry) => entry.artifact_ref),
    ...manifests.map((entry) => entry.artifact_ref),
    ...asStringArray(task.review?.evidence_refs),
  ]).slice(0, 50);

  return {
    schema_version: 1,
    task_id: task.task_id,
    project_id: task.project_id,
    availability,
    files,
    selected_path: effectivePath,
    selected_file: selectedFile,
    evidence_refs: evidenceRefs,
    freshness: { status: "current", updated_at: task.updated_at ?? null },
    read_only: true,
  };
}
