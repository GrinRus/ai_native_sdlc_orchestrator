import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveAssetBundleForStep } from "../src/asset-loader.mjs";
import { compileStepContext } from "../src/context-compiler.mjs";
import { resolveStepPolicyForStep } from "../src/policy-resolution.mjs";
import { resolveRouteForStep } from "../../provider-routing/src/route-resolution.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-context-compiler-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} repoRoot
 * @param {string} stepClass
 */
function resolveExecutionArtifacts(repoRoot, stepClass) {
  const projectProfilePath = path.join(repoRoot, "examples/project.aor.yaml");
  const routesRoot = path.join(repoRoot, "examples/routes");
  const wrappersRoot = path.join(repoRoot, "examples/wrappers");
  const promptsRoot = path.join(repoRoot, "examples/prompts");
  const policiesRoot = path.join(repoRoot, "examples/policies");

  const routeResolution = resolveRouteForStep({
    projectProfilePath,
    routesRoot,
    stepClass,
  });
  const assetResolution = resolveAssetBundleForStep({
    projectProfilePath,
    routesRoot,
    wrappersRoot,
    promptsRoot,
    stepClass,
  });
  const policyResolution = resolveStepPolicyForStep({
    projectProfilePath,
    routesRoot,
    policiesRoot,
    stepClass,
  });

  return {
    projectProfilePath,
    routeResolution,
    assetResolution,
    policyResolution,
  };
}

test("compileStepContext produces compiled context and diagnostics for adapter injection", () => {
  withTempRepo((repoRoot) => {
    const resolved = resolveExecutionArtifacts(repoRoot, "implement");
    const compiled = compileStepContext({
      projectRoot: repoRoot,
      projectProfilePath: resolved.projectProfilePath,
      stepClass: "implement",
      routeResolution: resolved.routeResolution,
      assetResolution: resolved.assetResolution,
      policyResolution: resolved.policyResolution,
      inputPacketRefs: ["packet://handoff"],
      runtimeEvidenceRefs: ["packet://spec"],
      skillsRoot: path.join(repoRoot, "examples/skills"),
    });

    assert.equal(typeof compiled.compiled_context.compiled_context_fingerprint, "string");
    assert.equal(compiled.compiled_context.compiled_context_fingerprint.length, 64);
    assert.equal(compiled.compiled_context.instruction_set.instructions.priorities.length > 0, true);
    assert.deepEqual(compiled.compiled_context.session_bootstrap.include_packets, []);
    assert.deepEqual(compiled.compiled_context.skill_refs, ["skill.runner.implement@v1"]);
    assert.deepEqual(compiled.compiled_context.context_refs.context_bundle_refs, [
      "context-bundle://context.bundle.runner.foundation@v1",
    ]);
    assert.deepEqual(compiled.compiled_context.context_refs.context_doc_refs, [
      "context-doc://context.doc.repo-map.core@v1",
    ]);
    assert.deepEqual(compiled.compiled_context.context_refs.context_rule_refs, [
      "context-rule://context.rule.public-repo-safety@v1",
    ]);
    assert.deepEqual(compiled.compiled_context.context_refs.context_skill_refs, [
      "context-skill://context.skill.runner-verification.default@v1",
    ]);
    assert.equal(compiled.context_compilation.required_inputs_status, "ready");
    assert.ok(compiled.context_compilation.resolved_input_packet_refs.includes("packet://handoff"));
    assert.ok(compiled.context_compilation.resolved_input_packet_refs.includes("packet://spec"));
  });
});

test("compileStepContext preserves explicit packet refs beyond prompt required_inputs", () => {
  withTempRepo((repoRoot) => {
    const resolved = resolveExecutionArtifacts(repoRoot, "implement");
    const compiled = compileStepContext({
      projectRoot: repoRoot,
      projectProfilePath: resolved.projectProfilePath,
      stepClass: "implement",
      routeResolution: resolved.routeResolution,
      assetResolution: resolved.assetResolution,
      policyResolution: resolved.policyResolution,
      inputPacketRefs: ["packet://handoff", "packet://spec", "packet://custom-extra"],
      runtimeEvidenceRefs: [],
      skillsRoot: path.join(repoRoot, "examples/skills"),
    });

    assert.ok(compiled.context_compilation.resolved_input_packet_refs.includes("packet://custom-extra"));
  });
});

test("compileStepContext fails deterministically when required inputs are missing", () => {
  withTempRepo((repoRoot) => {
    const promptPath = path.join(repoRoot, "examples/prompts/runner-default.yaml");
    const promptContent = fs.readFileSync(promptPath, "utf8");
    fs.writeFileSync(promptPath, promptContent.replace("- handoff", "- mandatory-packet"), "utf8");

    const resolved = resolveExecutionArtifacts(repoRoot, "implement");

    assert.throws(
      () =>
        compileStepContext({
          projectRoot: repoRoot,
          projectProfilePath: resolved.projectProfilePath,
          stepClass: "implement",
          routeResolution: resolved.routeResolution,
          assetResolution: resolved.assetResolution,
          policyResolution: resolved.policyResolution,
          inputPacketRefs: [],
          runtimeEvidenceRefs: [],
          skillsRoot: path.join(repoRoot, "examples/skills"),
        }),
      /packet:mandatory-packet/i,
    );
  });
});

test("compileStepContext fails deterministically when skill ref is missing", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      profileContent.replace("- skill.runner.implement@v1", "- skill.runner.missing@v1"),
      "utf8",
    );

    const resolved = resolveExecutionArtifacts(repoRoot, "implement");

    assert.throws(
      () =>
        compileStepContext({
          projectRoot: repoRoot,
          projectProfilePath: resolved.projectProfilePath,
          stepClass: "implement",
          routeResolution: resolved.routeResolution,
          assetResolution: resolved.assetResolution,
          policyResolution: resolved.policyResolution,
          inputPacketRefs: ["packet://handoff", "packet://spec"],
          runtimeEvidenceRefs: [],
          skillsRoot: path.join(repoRoot, "examples/skills"),
        }),
      /skill 'skill\.runner\.missing@v1'.*not present in skill registry/i,
    );
  });
});

test("compileStepContext fails deterministically on incompatible skill step class", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const profileContent = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(
      profilePath,
      profileContent.replace("- skill.runner.implement@v1", "- skill.eval.default@v1"),
      "utf8",
    );

    const resolved = resolveExecutionArtifacts(repoRoot, "implement");

    assert.throws(
      () =>
        compileStepContext({
          projectRoot: repoRoot,
          projectProfilePath: resolved.projectProfilePath,
          stepClass: "implement",
          routeResolution: resolved.routeResolution,
          assetResolution: resolved.assetResolution,
          policyResolution: resolved.policyResolution,
          inputPacketRefs: ["packet://handoff", "packet://spec"],
          runtimeEvidenceRefs: [],
          skillsRoot: path.join(repoRoot, "examples/skills"),
        }),
      /Skill resolution conflict for step 'implement'/i,
    );
  });
});

test("compileStepContext uses project defaults when step override is absent", () => {
  withTempRepo((repoRoot) => {
    const resolved = resolveExecutionArtifacts(repoRoot, "repair");
    const compiled = compileStepContext({
      projectRoot: repoRoot,
      projectProfilePath: resolved.projectProfilePath,
      stepClass: "repair",
      routeResolution: resolved.routeResolution,
      assetResolution: resolved.assetResolution,
      policyResolution: resolved.policyResolution,
      inputPacketRefs: ["packet://handoff", "packet://validation-report"],
      runtimeEvidenceRefs: ["packet://evaluation-report"],
      skillsRoot: path.join(repoRoot, "examples/skills"),
    });

    assert.deepEqual(compiled.compiled_context.skill_refs, ["skill.repair.default@v1"]);
    assert.equal(compiled.compiled_context.provenance.skill_resolution_source.field, "default_skill_profiles.repair");
  });
});
