import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function containedBy(root, candidate) {
  const canonicalRoot = fs.existsSync(root) ? fs.realpathSync.native(root) : path.resolve(root);
  const canonicalCandidate = fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : path.resolve(candidate);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function evidenceError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Resolve an evidence URI and verify containment, ownership bindings, and bytes. */
export function resolveEvidenceReference({ projectRoot, projectRuntimeRoot, workspaceProjectId, reference, expectedDigest, expectedBindings } = {}) {
  if (typeof reference !== "string" || reference.trim().length === 0) throw evidenceError("evidence-reference-invalid", "Evidence reference must be a non-empty string.");
  const value = reference.trim();
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) throw evidenceError("evidence-reference-invalid", `Evidence reference '${reference}' contains unsafe characters.`);
  let candidate;
  const projectMatch = value.match(/^evidence:\/\/projects\/([^/]+)\/(.+)$/u);
  if (projectMatch) {
    if (workspaceProjectId && projectMatch[1] !== workspaceProjectId) throw evidenceError("evidence-project-mismatch", `Evidence reference '${reference}' belongs to project '${projectMatch[1]}'.`);
    candidate = path.resolve(projectRuntimeRoot ?? projectRoot, projectMatch[2]);
  } else if (value.startsWith("evidence://")) {
    const relative = value.slice("evidence://".length);
    if (!relative || path.isAbsolute(relative)) throw evidenceError("evidence-reference-invalid", `Evidence reference '${reference}' is not a relative URI.`);
    const runtimeCandidate = path.resolve(projectRuntimeRoot ?? projectRoot, relative);
    const projectCandidate = path.resolve(projectRoot ?? projectRuntimeRoot ?? process.cwd(), relative);
    if (relative.split("/").includes("..")) {
      if (projectRoot && projectRuntimeRoot && containedBy(projectRuntimeRoot, projectCandidate) && fs.existsSync(projectCandidate)) candidate = projectCandidate;
      else throw evidenceError("evidence-reference-out-of-scope", `Evidence reference '${reference}' contains traversal outside the owning project.`);
    } else candidate = runtimeCandidate;
  } else if (path.isAbsolute(value)) {
    candidate = path.resolve(value);
  } else {
    candidate = path.resolve(projectRoot ?? projectRuntimeRoot ?? process.cwd(), value);
  }
  const roots = [projectRuntimeRoot, projectRoot].filter((root) => typeof root === "string").map((root) => path.resolve(root));
  if (roots.length === 0 || !roots.some((root) => containedBy(root, candidate))) throw evidenceError("evidence-reference-out-of-scope", `Evidence reference '${reference}' resolves outside the owning project.`);
  if (!fs.existsSync(candidate)) throw evidenceError("evidence-not-found", `Evidence reference '${reference}' does not resolve to a file.`);
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw evidenceError("evidence-reference-invalid", `Evidence reference '${reference}' must resolve to a regular file.`);
  const canonical = fs.realpathSync.native(candidate);
  if (!roots.some((root) => containedBy(root, canonical))) throw evidenceError("evidence-reference-out-of-scope", `Evidence reference '${reference}' escapes the owning project through a link.`);
  const bytes = fs.readFileSync(canonical);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (expectedDigest && digest !== expectedDigest) throw evidenceError("evidence-digest-mismatch", `Evidence reference '${reference}' changed after authorization.`);
  if (expectedBindings && typeof expectedBindings === "object") {
    let metadata = null;
    const sidecar = `${canonical}.authority.json`;
    if (fs.existsSync(sidecar)) {
      try { metadata = JSON.parse(fs.readFileSync(sidecar, "utf8")); } catch { throw evidenceError("evidence-binding-invalid", `Evidence authority sidecar for '${reference}' is malformed.`); }
    }
    if (!metadata) throw evidenceError("evidence-binding-missing", `Evidence authority sidecar for '${reference}' is missing.`);
    for (const [key, expected] of Object.entries(expectedBindings)) if (expected !== undefined && expected !== null && metadata[key] !== expected) throw evidenceError("evidence-binding-mismatch", `Evidence '${reference}' does not match binding '${key}'.`);
  }
  return { reference: value, filePath: canonical, bytes, sha256: digest };
}

/** Materialize immutable evidence bytes with a digest-addressed path and sidecar. */
export function storeEvidenceReference({ projectRuntimeRoot, workspaceProjectId, filename = "evidence.bin", bytes, bindings = {}, redaction = null } = {}) {
  if (!projectRuntimeRoot || !workspaceProjectId || (!Buffer.isBuffer(bytes) && typeof bytes !== "string")) throw evidenceError("evidence-store-invalid", "Evidence storage requires runtime root, project id, and bytes.");
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/gu, "-") || "evidence.bin";
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const digest = crypto.createHash("sha256").update(data).digest("hex");
  const directory = path.join(projectRuntimeRoot, "evidence", workspaceProjectId, digest);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, safeName);
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    if (crypto.createHash("sha256").update(existing).digest("hex") !== digest) throw evidenceError("evidence-digest-mismatch", `Evidence path '${filePath}' already contains different bytes.`);
  } else fs.writeFileSync(filePath, data, { mode: 0o600, flag: "wx" });
  const authority = { schema_version: 1, authority_kind: "aor-evidence-materialization", project_id: workspaceProjectId, file: filePath, sha256: digest, ...bindings, redaction };
  const authorityFile = `${filePath}.authority.json`;
  if (!fs.existsSync(authorityFile)) fs.writeFileSync(authorityFile, `${JSON.stringify(authority, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { filePath, authorityFile, reference: `evidence://projects/${workspaceProjectId}/evidence/${workspaceProjectId}/${digest}/${safeName}`, sha256: digest };
}
