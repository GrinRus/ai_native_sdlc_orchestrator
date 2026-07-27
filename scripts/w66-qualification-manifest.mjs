#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  W66_QUALIFICATION_CELLS,
  sha256File,
  validateW66QualificationManifest,
} from "./readiness/w66-qualification-manifest.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

const outputFile = path.resolve(argument("--output") ?? ".aor/w66/qualification-manifest.json");
const targetCommit = argument("--target-commit");
if (!/^[a-f0-9]{40}$/u.test(targetCommit ?? "")) {
  throw new Error("--target-commit must be the full pinned target commit SHA.");
}
const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
const manifest = {
  schema_version: 1,
  kind: "w66-qualification-manifest",
  aor_commit: git(["rev-parse", "HEAD"]),
  target_repository: "https://github.com/sindresorhus/ky.git",
  target_commit: targetCommit,
  source_tree_clean: status === "",
  release_clearance: "audit-hold",
  network_policy: "provider-calls-prohibited",
  write_policy: "no-upstream-write",
  invalidate_on_source_change: true,
  stop_conditions: [
    "source commit or profile digest changes",
    "target commit changes",
    "primary checkout mutation",
    "upstream write attempt",
    "missing final all-pass assessment",
  ],
  cells: W66_QUALIFICATION_CELLS.map(([cellId, profileRef]) => ({
    cell_id: cellId,
    profile_ref: profileRef,
    profile_sha256: sha256File(path.resolve(profileRef)),
    status: "not-run",
  })),
};
const validation = validateW66QualificationManifest(manifest, { aorCommit: manifest.aor_commit, targetCommit });
if (!validation.ok) {
  process.stderr.write(`W66 qualification manifest was not frozen:\n- ${validation.findings.join("\n- ")}\n`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`W66 qualification manifest frozen at ${outputFile}\n`);
