import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { discoverVerificationCommandGroups } from "../stack-discovery.mjs";

function gitValue(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function inspectRepositoryBinding(localPath, expectedRef) {
  const root = path.resolve(localPath);
  try {
    if (!fs.statSync(root).isDirectory()) return { status: "unavailable", local_path: root };
    const identity = gitValue(root, ["config", "--get", "remote.origin.url"]);
    const commit = gitValue(root, ["rev-parse", "HEAD"]);
    if (!commit) return { status: "not-git", local_path: root };
    const currentRef = gitValue(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
    return {
      status: expectedRef && currentRef && expectedRef !== currentRef ? "ref-drift" : "available",
      local_path: root,
      resolved_identity: identity,
      resolved_commit: commit,
      resolved_ref: currentRef,
      credential_readiness: { status: "unknown", mechanism: "external" },
    };
  } catch (error) {
    return {
      status: /** @type {NodeJS.ErrnoException} */ (error).code === "EACCES" ? "permission-denied" : "unavailable",
      local_path: root,
    };
  }
}

export function discoverTopologyProposals(options) {
  const discovery = discoverVerificationCommandGroups({
    projectRoot: options.projectRoot,
    repoId: options.repoId ?? "main",
  });
  const components = discovery.package_boundaries.map((boundary) => ({
    proposal_id: `component.${boundary.repo_id}.${boundary.working_dir === "." ? "root" : boundary.working_dir.replaceAll("/", "-")}`,
    kind: "component",
    repo_id: boundary.repo_id,
    root: boundary.working_dir,
    role: boundary.working_dir.startsWith("apps/") ? "application" : "package",
    confidence: "high",
    source_refs: boundary.source_refs,
    approval_status: "proposed",
  }));
  return {
    project_root: discovery.project_root,
    generated_at: new Date(0).toISOString(),
    components,
    command_groups: discovery.command_group_candidates.map((candidate) => ({
      ...candidate,
      approval_status: "proposed",
    })),
    dependencies: [],
    outcomes: discovery.outcomes,
  };
}
