import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { derivePublicId, validateContractDocument, validatePublicId } from "../../contracts/src/index.mjs";
import { previewProjectRuntime } from "./project-init.mjs";
import { readCanonicalContainedFile, removeCanonicalContainedPath, resolveCanonicalContainedPath } from "./shared/canonical-paths.mjs";

export class ProjectWritebackError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = "ProjectWritebackError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function atomicText(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, contents, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
}

function portableValue(value) {
  if (typeof value === "string") return path.isAbsolute(value) ? undefined : value;
  if (Array.isArray(value)) return value.map(portableValue).filter((entry) => entry !== undefined);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/runtime[_-]?root|local[_-]?path|resolved[_-]?identity|auth|credential|password|secret|token/iu.test(key)) continue;
    const portable = portableValue(child);
    if (portable !== undefined) result[key] = portable;
  }
  return result;
}

function loadPortableProfile(context) {
  const preview = previewProjectRuntime(context.runtimeOptions);
  if (preview.projectProfileRef !== "<generated-bundled-profile>") {
    const source = path.isAbsolute(preview.projectProfileRef)
      ? preview.projectProfileRef
      : path.join(context.projectRoot, preview.projectProfileRef);
    if (fs.existsSync(source)) return portableValue(parseYaml(fs.readFileSync(source, "utf8")));
  }
  return {
    project_id: context.runtimeProjectId,
    display_name: context.label,
    repo_topology: "single-repo",
    repos: [{ repo_id: "main", name: "main", source: { kind: "local", root: "." }, role: "application", workspace_mount: "repos/main" }],
    repo_graph: [],
    components: [],
    component_graph: [],
    allowed_providers: ["openai", "anthropic", "open-code"],
    allowed_adapters: ["codex-cli", "claude-code", "qwen-code"],
    registry_roots: {},
    default_route_profiles: {},
    default_step_policies: {},
    default_wrapper_profiles: {},
    default_prompt_bundles: {},
    default_context_bundles: {},
    default_skill_profiles: {},
    skill_overrides: {},
    budget_policy: {},
    approval_policy: { required_for_execution: true },
    security_policy: { redact_secrets: true },
    writeback_policy: { default_delivery_mode: "patch-only", allow_direct_write: false },
  };
}

function ignoredWarning(projectRoot, target) {
  const result = spawnSync("git", ["-C", projectRoot, "check-ignore", "-q", target], { stdio: "ignore", timeout: 5_000 });
  return result.status === 0 ? ".aor is ignored by Git; the materialized file will remain local unless the ignore rule changes." : null;
}

export function materializeProjectConfig({ registry, projectId }) {
  const context = registry.getContext(projectId);
  if (!context) throw new ProjectWritebackError("project.not_found", `Project '${projectId}' was not found.`, 404);
  const directory = path.join(context.projectRoot, ".aor");
  const target = path.join(directory, "project.yaml");
  if (fs.existsSync(directory) && !fs.statSync(directory).isDirectory()) {
    throw new ProjectWritebackError("project_config.legacy_conflict", `Cannot create '${target}' because the legacy '.aor' path is not a directory. Existing data was left unchanged.`);
  }
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
    throw new ProjectWritebackError("project_config.legacy_conflict", `Cannot create '${target}' because '.aor' is a symbolic link. Existing data was left unchanged.`);
  }
  if (fs.existsSync(target) && !fs.statSync(target).isFile()) {
    throw new ProjectWritebackError("project_config.legacy_conflict", `Cannot replace '${target}' because it is not a regular file. Existing data was left unchanged.`);
  }
  const profile = loadPortableProfile(context);
  const validation = validateContractDocument({ family: "project-profile", document: profile, source: "writeback://project.yaml" });
  if (!validation.ok) throw new ProjectWritebackError("project_config.invalid", validation.issues.map((issue) => issue.message).join("; "));
  atomicText(target, stringifyYaml(profile));
  return { project_id: projectId, project_profile_ref: ".aor/project.yaml", file: target, warning: ignoredWarning(context.projectRoot, ".aor/project.yaml") };
}

function resolveEvidence(context, reference) {
  const prefix = `evidence://projects/${context.projectId}/`;
  if (!reference.startsWith(prefix)) throw new ProjectWritebackError("evidence_export.invalid_ref", `Evidence ref '${reference}' does not belong to project '${context.projectId}'.`, 400);
  const relative = reference.slice(prefix.length);
  const segments = relative.split("/");
  const basename = segments.at(-1) ?? "";
  if (!relative || segments.some((segment) => !segment || segment === "." || segment === "..") || segments[0] === "inputs" || segments[0] === "logs" || /(?:provider|runner|adapter).*(?:raw|log|transcript)|(?:raw|transcript).*(?:provider|runner|adapter)/iu.test(basename)) {
    throw new ProjectWritebackError("evidence_export.forbidden_ref", `Evidence ref '${reference}' is not exportable.`, 400);
  }
  const read = readCanonicalContainedFile({
    root: context.projectRuntimeRoot,
    relativePath: segments.join("/"),
    base: "runtime-relative",
    maxBytes: 10 * 1024 * 1024,
  });
  if (!read.ok) {
    const forbidden = new Set(["lexical-escape", "symlink-escape", "canonical-escape", "final-symlink"]);
    throw new ProjectWritebackError(
      forbidden.has(read.reason) ? "evidence_export.forbidden_ref" : "evidence_export.not_found",
      `Evidence ref '${reference}' could not be read inside the project evidence boundary (${read.reason}).`,
      forbidden.has(read.reason) ? 400 : 404,
    );
  }
  return { source: read.canonicalPath, relative, bytes: read.bytes };
}

export function exportEvidence({ registry, projectId, flowId, exportId, evidenceRefs }) {
  const context = registry.getContext(projectId);
  if (!context) throw new ProjectWritebackError("project.not_found", `Project '${projectId}' was not found.`, 404);
  if (!flowId || !Array.isArray(evidenceRefs) || evidenceRefs.length === 0) throw new ProjectWritebackError("evidence_export.invalid", "flowId and at least one selected evidence ref are required.", 400);
  if (!validatePublicId(flowId).ok) throw new ProjectWritebackError("evidence_export.invalid_flow_id", "flowId must be a canonical public identifier.", 400);
  const selectedExportId = exportId || derivePublicId(["evidence-export", flowId, crypto.randomUUID()], "evidence-export");
  if (!validatePublicId(selectedExportId).ok) throw new ProjectWritebackError("evidence_export.invalid_export_id", "exportId must be a canonical public identifier.", 400);
  const relativeDestination = path.posix.join(".aor", "exports", flowId, selectedExportId);
  const destinationResolution = resolveCanonicalContainedPath({ root: context.projectRoot, relativePath: relativeDestination, base: "project-relative", rejectFinalSymlink: true });
  if (!destinationResolution.ok) throw new ProjectWritebackError("evidence_export.invalid_destination", `Evidence export destination is not owned by the project root (${destinationResolution.reason}).`, 400);
  const destination = destinationResolution.canonicalPath;
  if (fs.existsSync(destination)) throw new ProjectWritebackError("evidence_export.exists", `Evidence export '${selectedExportId}' already exists.`);
  const staging = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(staging, { recursive: true });
  try {
    const entries = evidenceRefs.map((reference, index) => {
      const resolved = resolveEvidence(context, reference);
      const bytes = resolved.bytes;
      const exportedPath = `${String(index + 1).padStart(2, "0")}-${path.basename(resolved.relative)}`;
      fs.writeFileSync(path.join(staging, exportedPath), bytes, { mode: 0o600, flag: "wx" });
      return { source_ref: reference, exported_path: exportedPath, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), byte_length: bytes.length, family: path.basename(resolved.relative).replace(/\.[^.]+$/u, "") };
    });
    const manifest = {
      export_id: selectedExportId,
      workspace_project_id: context.projectId,
      project_id: context.runtimeProjectId,
      flow_id: flowId,
      destination: relativeDestination,
      entries,
      excluded_categories: ["credentials", "provider-raw-log", "intent-attachment"],
      created_at: new Date().toISOString(),
    };
    const validation = validateContractDocument({ family: "evidence-export-manifest", document: manifest, source: "writeback://evidence-export-manifest" });
    if (!validation.ok) throw new ProjectWritebackError("evidence_export.invalid_manifest", validation.issues.map((issue) => issue.message).join("; "));
    fs.writeFileSync(path.join(staging, "evidence-export-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(staging, destination);
    return { manifest, directory: destination, warning: ignoredWarning(context.projectRoot, relativeDestination) };
  } catch (error) {
    const removal = removeCanonicalContainedPath({ root: context.projectRoot, target: staging });
    if (!removal.ok) throw new ProjectWritebackError("evidence_export.cleanup_failed", `Evidence export cleanup was refused (${removal.reason}).`, 500);
    throw error;
  }
}
