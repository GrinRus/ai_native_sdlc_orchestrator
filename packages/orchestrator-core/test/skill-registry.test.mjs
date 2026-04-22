import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSkillRegistry, resolveSkillsForStep } from "../src/skill-registry.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-context-skills-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("buildSkillRegistry loads versioned skill profiles from examples/skills", () => {
  withTempRepo((repoRoot) => {
    const registry = buildSkillRegistry({
      skillsRoot: path.join(repoRoot, "examples/skills"),
    });

    assert.ok(registry.size >= 6);
    assert.equal(registry.has("skill.runner.default@v1"), true);
    assert.equal(registry.has("skill.runner.implement@v1"), true);
  });
});

test("resolveSkillsForStep applies step override before project defaults", () => {
  withTempRepo((repoRoot) => {
    const resolved = resolveSkillsForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      stepClass: "implement",
      routeClass: "runner",
      skillsRoot: path.join(repoRoot, "examples/skills"),
    });

    assert.deepEqual(resolved.skill_refs, ["skill.runner.implement@v1"]);
    assert.equal(resolved.resolution_source.kind, "step-override");
    assert.equal(resolved.resolution_source.field, "skill_overrides.implement");
  });
});

test("resolveSkillsForStep uses project default when step override is missing", () => {
  withTempRepo((repoRoot) => {
    const resolved = resolveSkillsForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      stepClass: "repair",
      routeClass: "repair",
      skillsRoot: path.join(repoRoot, "examples/skills"),
    });

    assert.deepEqual(resolved.skill_refs, ["skill.repair.default@v1"]);
    assert.equal(resolved.resolution_source.kind, "project-default");
    assert.equal(resolved.resolution_source.field, "default_skill_profiles.repair");
  });
});

test("resolveSkillsForStep fails deterministically when selected skill ref is missing", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const content = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      content.replace("- skill.runner.implement@v1", "- skill.runner.missing@v1"),
      "utf8",
    );

    assert.throws(
      () =>
        resolveSkillsForStep({
          projectProfilePath: profilePath,
          stepClass: "implement",
          routeClass: "runner",
          skillsRoot: path.join(repoRoot, "examples/skills"),
        }),
      /skill 'skill\.runner\.missing@v1'.*not present in skill registry/i,
    );
  });
});

test("resolveSkillsForStep fails deterministically on incompatible skill step_class", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const content = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      content.replace("- skill.runner.implement@v1", "- skill.eval.default@v1"),
      "utf8",
    );

    assert.throws(
      () =>
        resolveSkillsForStep({
          projectProfilePath: profilePath,
          stepClass: "implement",
          routeClass: "runner",
          skillsRoot: path.join(repoRoot, "examples/skills"),
        }),
      /Skill resolution conflict for step 'implement'/i,
    );
  });
});
