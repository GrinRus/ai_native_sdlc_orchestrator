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

test("resolveAssetBundleMatrix materializes route/wrapper/prompt bundles for all step classes", () => {
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
  });
});

test("resolveAssetBundleForStep applies wrapper and prompt overrides deterministically", () => {
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
    });

    assert.equal(resolved.wrapper.resolution_source.kind, "step-override");
    assert.equal(resolved.prompt_bundle.resolution_source.kind, "step-override");
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
