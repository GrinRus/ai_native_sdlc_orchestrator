import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SUPPORTED_STEP_CLASSES,
  resolveRouteForStep,
  resolveRouteMatrix,
} from "../src/route-resolution.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../..");

/**
 * @param {(repoRoot: string) => void} callback
 */
function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-w2-s01-"));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.cpSync(path.join(workspaceRoot, "examples"), path.join(repoRoot, "examples"), { recursive: true });

  try {
    callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("resolveRouteMatrix resolves all supported step classes using project defaults", () => {
  withTempRepo((repoRoot) => {
    const resolved = resolveRouteMatrix({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
    });

    assert.equal(resolved.length, SUPPORTED_STEP_CLASSES.length);
    assert.deepEqual(
      resolved.map((item) => item.step_class),
      SUPPORTED_STEP_CLASSES,
    );
    assert.ok(resolved.every((item) => item.resolution_source.kind === "project-default"));
  });
});

test("resolveRouteForStep applies step-level override deterministically", () => {
  withTempRepo((repoRoot) => {
    const resolved = resolveRouteForStep({
      projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
      routesRoot: path.join(repoRoot, "examples/routes"),
      stepClass: "planning",
      stepOverrides: {
        planning: "route.plan.default",
      },
    });

    assert.equal(resolved.resolution_source.kind, "step-override");
    assert.equal(resolved.resolution_source.field, "step_overrides.planning");
    assert.equal(resolved.resolved_route_id, "route.plan.default");
  });
});

test("resolveRouteForStep fails cleanly when project default route source is missing", () => {
  withTempRepo((repoRoot) => {
    const profilePath = path.join(repoRoot, "examples/project.aor.yaml");
    const content = fs.readFileSync(profilePath, "utf8");
    fs.writeFileSync(profilePath, content.replace("qa: route.qa.default", "qa: ''"), "utf8");

    assert.throws(
      () =>
        resolveRouteForStep({
          projectProfilePath: profilePath,
          routesRoot: path.join(repoRoot, "examples/routes"),
          stepClass: "qa",
        }),
      /missing source in step override and default_route_profiles\.qa/i,
    );
  });
});

test("resolveRouteForStep fails on conflicting route source", () => {
  withTempRepo((repoRoot) => {
    assert.throws(
      () =>
        resolveRouteForStep({
          projectProfilePath: path.join(repoRoot, "examples/project.aor.yaml"),
          routesRoot: path.join(repoRoot, "examples/routes"),
          stepClass: "qa",
          stepOverrides: {
            qa: "route.review.default",
          },
        }),
      /Route resolution conflict for step 'qa'/i,
    );
  });
});
