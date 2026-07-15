import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout ?? "";
}

function canonicalPath(value) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//u, "");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Delivery diff contains invalid repository path '${value}'.`);
  }
  return normalized;
}

function uniqueSorted(values) {
  return [...new Set(values.map(canonicalPath))]
    .filter((repoPath) => repoPath !== ".aor" && !repoPath.startsWith(".aor/"))
    .sort((left, right) => left.localeCompare(right));
}

export function captureDeliveryDiff(executionRoot) {
  const root = fs.realpathSync(executionRoot);
  const head_sha = git(root, ["rev-parse", "HEAD"]).trim();
  const tokens = git(root, ["diff", "--name-status", "-z", "--find-renames", "HEAD"]).split("\0");
  const additions = [];
  const modifications = [];
  const deletions = [];
  const renames = [];

  for (let index = 0; index < tokens.length - 1;) {
    const status = tokens[index++];
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = canonicalPath(tokens[index++]);
      const to = canonicalPath(tokens[index++]);
      renames.push({ from, to });
    } else {
      const repoPath = canonicalPath(tokens[index++]);
      if (status === "A") additions.push(repoPath);
      else if (status === "D") deletions.push(repoPath);
      else modifications.push(repoPath);
    }
  }

  additions.push(...git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0").filter(Boolean).map(canonicalPath));

  const changes = {
    additions: uniqueSorted(additions),
    modifications: uniqueSorted(modifications),
    deletions: uniqueSorted(deletions),
    renames: renames
      .map((entry) => ({ from: canonicalPath(entry.from), to: canonicalPath(entry.to) }))
      .sort((left, right) => `${left.from}\0${left.to}`.localeCompare(`${right.from}\0${right.to}`)),
  };
  const allPaths = uniqueSorted([
    ...changes.additions,
    ...changes.modifications,
    ...changes.deletions,
    ...changes.renames.flatMap((entry) => [entry.from, entry.to]),
  ]);

  for (const repoPath of allPaths) {
    const absolute = path.resolve(root, repoPath);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Delivery path '${repoPath}' escapes the execution root.`);
    }
    if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) {
      throw new Error(`Delivery path '${repoPath}' is a symbolic link and cannot be authorized.`);
    }
  }

  return { baseline: { head_sha }, changes: { ...changes, all_paths: allPaths } };
}

export function assertExactDeliveryDiff(executionRoot, authorization) {
  const current = captureDeliveryDiff(executionRoot);
  const expectedBaseline = authorization?.baseline?.head_sha;
  if (typeof expectedBaseline !== "string" || expectedBaseline !== current.baseline.head_sha) {
    throw new Error(`Delivery baseline mismatch: expected '${String(expectedBaseline)}', got '${current.baseline.head_sha}'.`);
  }
  const expected = JSON.stringify(authorization?.changes ?? null);
  const actual = JSON.stringify(current.changes);
  if (expected !== actual) {
    throw new Error("Delivery current diff does not exactly match the authorized add/edit/delete/rename set.");
  }
  return current;
}
