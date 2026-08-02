import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveAssetBundleForStep,
  resolveAssetBundleMatrix,
} from "../src/asset-loader.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w2-s02-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("resolveAssetBundleMatrix materializes route/wrapper/prompt/context bundles for all step classes", () => {
  withTempRepo((repoRoot) => {
    const matrix = resolveAssetBundleMatrix({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      wrappersRoot: path.join(repoRoot, "examples/wrappers"),
      promptsRoot: path.join(repoRoot, "examples/prompts"),
    });

    assert.equal(matrix.length, 10);
    const implementBundle = matrix.find((entry) => entry.step_class === "implement");
    assert.ok(implementBundle);
    assert.equal(implementBundle.route.resolved_route_id, "route.implement.default");
    assert.equal(implementBundle.wrapper.wrapper_ref, "wrapper.runner.default@v3");
    assert.equal(implementBundle.prompt_bundle.prompt_bundle_ref, "prompt-bundle://runner-default@v3");
    assert.deepEqual(implementBundle.context_bundles.bundle_refs, [
      "context-bundle://context.bundle.runner.foundation@v1",
    ]);
    assert.deepEqual(implementBundle.context_bundles.expanded_refs.context_doc_refs, [
      "context-doc://context.doc.repo-map.core@v1",
    ]);

    const artifactPromptRefs = new Map(
      ["discovery", "research", "spec"].map((step) => {
        const bundle = matrix.find((entry) => entry.step_class === step);
        assert.ok(bundle, `expected ${step} asset bundle`);
        assert.equal(bundle.wrapper.wrapper_ref, "wrapper.artifact.default@v1");
        assert.deepEqual(bundle.context_bundles.bundle_refs, [
          "context-bundle://context.bundle.artifact.foundation@v1",
        ]);
        assert.equal(bundle.prompt_bundle.profile.step_class, "artifact");
        return [step, bundle.prompt_bundle.prompt_bundle_ref];
      }),
    );
    assert.deepEqual(Object.fromEntries(artifactPromptRefs), {
      discovery: "prompt-bundle://discovery-default@v1",
      research: "prompt-bundle://research-default@v1",
      spec: "prompt-bundle://spec-default@v1",
    });
  });
});

test("resolveAssetBundleForStep applies wrapper/prompt/context overrides deterministically", () => {
  withTempRepo((repoRoot) => {
    const resolved = resolveAssetBundleForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      wrappersRoot: path.join(repoRoot, "examples/wrappers"),
      promptsRoot: path.join(repoRoot, "examples/prompts"),
      stepClass: "planning",
      wrapperOverrides: {
        planning: "wrapper.planner.default@v1",
      },
      promptBundleOverrides: {
        planning: "prompt-bundle://planner-default@v1",
      },
      contextBundleOverrides: {
        planning: ["context-bundle://context.bundle.planner.foundation@v1"],
      },
    });

    assert.equal(resolved.wrapper.resolution_source.kind, "step-override");
    assert.equal(resolved.prompt_bundle.resolution_source.kind, "step-override");
    assert.equal(resolved.context_bundles.resolution_source.kind, "step-override");
  });
});

test("resolveAssetBundleForStep preserves artifact-default prompt fallback compatibility", () => {
  withTempRepo((repoRoot) => {
    const projectProfilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const projectProfileContent = fs.readFileSync(projectProfilePath, "utf8");
    fs.writeFileSync(
      projectProfilePath,
      projectProfileContent
        .replace(
          "discovery: prompt-bundle://discovery-default@v1",
          "discovery: prompt-bundle://artifact-default@v1",
        )
        .replace(
          "research: prompt-bundle://research-default@v1",
          "research: prompt-bundle://artifact-default@v1",
        )
        .replace("spec: prompt-bundle://spec-default@v1", "spec: prompt-bundle://artifact-default@v1"),
      "utf8",
    );

    for (const stepClass of ["discovery", "research", "spec"]) {
      const resolved = resolveAssetBundleForStep({
        projectProfilePath,
        routesRoot: path.join(repoRoot, "examples/routes"),
        wrappersRoot: path.join(repoRoot, "examples/wrappers"),
        promptsRoot: path.join(repoRoot, "examples/prompts"),
        stepClass,
      });

      assert.equal(resolved.prompt_bundle.prompt_bundle_ref, "prompt-bundle://artifact-default@v1");
      assert.equal(resolved.prompt_bundle.profile.step_class, "artifact");
      assert.equal(resolved.wrapper.wrapper_ref, "wrapper.artifact.default@v1");
    }
  });
});

test("resolveAssetBundleForStep fails cleanly when project default prompt bundle source is missing", () => {
  withTempRepo((repoRoot) => {
    const projectProfilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const projectProfileContent = fs.readFileSync(projectProfilePath, "utf8");
    fs.writeFileSync(
      projectProfilePath,
      projectProfileContent.replace(
        "planning: prompt-bundle://planner-default@v1",
        "planning: prompt-bundle://does-not-exist@v1",
      ),
      "utf8",
    );

    assert.throws(
      () =>
        resolveAssetBundleForStep({
          projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
          routesRoot: path.join(repoRoot, "examples/routes"),
          wrappersRoot: path.join(repoRoot, "examples/wrappers"),
          promptsRoot: path.join(repoRoot, "examples/prompts"),
          stepClass: "planning",
        }),
      /prompt bundle 'prompt-bundle:\/\/does-not-exist@v1' is not present/i,
    );
  });
});

test("resolveAssetBundleForStep fails cleanly when project default context bundle source is missing", () => {
  withTempRepo((repoRoot) => {
    const projectProfilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const projectProfileContent = fs.readFileSync(projectProfilePath, "utf8");
    fs.writeFileSync(
      projectProfilePath,
      projectProfileContent.replace(
        "    - context-bundle://context.bundle.planner.foundation@v1",
        "    - context-bundle://context.bundle.planner.missing@v1",
      ),
      "utf8",
    );

    assert.throws(
      () =>
        resolveAssetBundleForStep({
          projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
          routesRoot: path.join(repoRoot, "examples/routes"),
          wrappersRoot: path.join(repoRoot, "examples/wrappers"),
          promptsRoot: path.join(repoRoot, "examples/prompts"),
          stepClass: "planning",
        }),
      /context bundle 'context-bundle:\/\/context\.bundle\.planner\.missing@v1' is not present/i,
    );
  });
});

test("effective context registries deduplicate identical layered assets and reject identity conflicts", () => {
  withTempRepo((repoRoot) => {
    const primaryRules = path.join(repoRoot, "examples/context/rules");
    const layeredRules = path.join(repoRoot, "layered-rules");
    fs.mkdirSync(layeredRules, { recursive: true });
    const primaryRule = path.join(primaryRules, "public-repo-safety.yaml");
    const layeredRule = path.join(layeredRules, "z-public-repo-safety.yaml");
    fs.copyFileSync(primaryRule, layeredRule);
    const resolve = () => resolveAssetBundleForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      wrappersRoot: path.join(repoRoot, "examples/wrappers"),
      promptsRoot: path.join(repoRoot, "examples/prompts"),
      contextRulesRoot: [primaryRules, layeredRules],
      stepClass: "implement",
    });

    const deduplicated = resolve().context_bundles.effective_assets.find(
      (entry) => entry.reference === "context-rule://context.rule.public-repo-safety@v1",
    );
    assert.equal(deduplicated.deduplicated_provenance.length, 1);
    fs.writeFileSync(layeredRule, fs.readFileSync(layeredRule, "utf8").replace("evidence-first", "conflicting"));
    assert.throws(resolve, /Duplicate canonical asset identity.*public-repo-safety/u);
  });
});
