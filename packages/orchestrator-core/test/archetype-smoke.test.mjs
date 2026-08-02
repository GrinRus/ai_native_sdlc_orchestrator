import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadContractFile } from "../../contracts/src/index.mjs";
import { initializeProjectRuntime } from "../src/project-init.mjs";
import { planProjectVerification, verifyProjectRuntime } from "../src/project-verify.mjs";
import { discoverVerificationCommandGroups } from "../src/stack-discovery.mjs";

/**
 * @param {string} repoRoot
 * @param {string} relativePath
 * @param {string} content
 */
function writeFile(repoRoot, relativePath, content) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * @param {string} repoRoot
 * @param {string} tool
 */
function writeToolShim(repoRoot, tool) {
  const shimPath = path.join(repoRoot, "bin", tool);
  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  fs.writeFileSync(shimPath, "#!/usr/bin/env sh\necho \"$0 $@\"\nexit 0\n", "utf8");
  fs.chmodSync(shimPath, 0o755);
}

/**
 * @template T
 * @param {string} binDir
 * @param {() => T} callback
 * @returns {T}
 */
function withPathPrefix(binDir, callback) {
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  try {
    return callback();
  } finally {
    if (typeof originalPath === "string") {
      process.env.PATH = originalPath;
    } else {
      delete process.env.PATH;
    }
  }
}

/**
 * @param {string} profilePath
 * @returns {Record<string, unknown>}
 */
function loadGeneratedProfile(profilePath) {
  const loaded = loadContractFile({ filePath: profilePath, family: "project-profile" });
  assert.equal(
    loaded.ok,
    true,
    loaded.ok ? "" : loaded.validation.issues.map((issue) => issue.message).join("; "),
  );
  return /** @type {Record<string, unknown>} */ (loaded.document);
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {Array<Record<string, unknown>>}
 */
function profileCommandGroups(profile) {
  const verification = /** @type {Record<string, unknown>} */ (profile.verification ?? {});
  return Array.isArray(verification.command_groups)
    ? verification.command_groups.map((entry) => /** @type {Record<string, unknown>} */ (entry))
    : [];
}

/**
 * @param {unknown[]} documents
 */
function assertNoPrivateVerificationFields(documents) {
  const privatePattern = new RegExp(
    [
      ["live", "e2e"].join("_"),
      ["live", "e2e"].join("-"),
      ["target", "matrix"].join("_"),
      ["target", "readiness"].join("_"),
      ["diagnostic", "health"].join("_"),
      ["step", "quality"].join("_"),
    ].join("|"),
    "u",
  );
  for (const document of documents) {
    assert.equal(privatePattern.test(JSON.stringify(document)), false);
  }
}

/**
 * @param {{
 *   name: string,
 *   setup: (repoRoot: string) => void,
 *   shims?: string[],
 *   verificationLabel: string,
 *   expectedStatus: "passed" | "failed" | "warn",
 *   assertDiscovery: (discovery: ReturnType<typeof discoverVerificationCommandGroups>) => void,
 *   assertProfile: (profile: Record<string, unknown>) => void,
 *   assertPlan: (plan: Record<string, unknown>) => void,
 *   assertVerify: (verifySummary: Record<string, unknown>, stepResults: Array<Record<string, unknown>>) => void,
 * }} scenario
 */
function runArchetypeScenario(scenario) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `aor-w54-s07-${scenario.name}-`));
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });

  try {
    scenario.setup(repoRoot);
    for (const tool of scenario.shims ?? []) {
      writeToolShim(repoRoot, tool);
    }

    const execute = () => {
      const discovery = discoverVerificationCommandGroups({ projectRoot: repoRoot });
      scenario.assertDiscovery(discovery);

      const init = initializeProjectRuntime({
        cwd: repoRoot,
        projectRef: repoRoot,
        assetMode: "materialized",
      });
      const profile = loadGeneratedProfile(init.projectProfilePath);
      scenario.assertProfile(profile);

      const plan = planProjectVerification({
        cwd: repoRoot,
        projectRef: repoRoot,
        verificationLabel: scenario.verificationLabel,
      });
      scenario.assertPlan(plan.verificationPlan);

      const verify = verifyProjectRuntime({
        cwd: repoRoot,
        projectRef: repoRoot,
        verificationLabel: scenario.verificationLabel,
        verificationCommandTimeoutMs: 5000,
      });
      assert.equal(verify.verifySummary.status, scenario.expectedStatus, scenario.name);
      scenario.assertVerify(verify.verifySummary, verify.stepResults);
      assertNoPrivateVerificationFields([profile, plan.verificationPlan, verify.verifySummary, ...verify.stepResults]);
    };

    if (Array.isArray(scenario.shims) && scenario.shims.length > 0) {
      withPathPrefix(path.join(repoRoot, "bin"), execute);
    } else {
      execute();
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("public archetype smoke matrix covers discovery, init, plan, and targeted verify", () => {
  const passingNodeScript = 'node -e "process.exit(0)"';
  const failingNodeScript = 'node -e "process.exit(1)"';
  const scenarios = [
    {
      name: "node",
      verificationLabel: "post-change-smoke",
      expectedStatus: "passed",
      setup(repoRoot) {
        writeFile(
          repoRoot,
          "package.json",
          JSON.stringify(
            {
              name: "node-smoke",
              scripts: {
                build: passingNodeScript,
                lint: passingNodeScript,
                test: passingNodeScript,
              },
            },
            null,
            2,
          ),
        );
        writeFile(repoRoot, "package-lock.json", "{}\n");
      },
      assertDiscovery(discovery) {
        assert.ok(discovery.detections.some((entry) => entry.stack === "node"));
        assert.ok(discovery.command_group_candidates.length >= 6);
      },
      assertProfile(profile) {
        const groups = profileCommandGroups(profile);
        assert.ok(groups.some((group) => group.role === "build" && group.phase === "post-change"));
        assert.ok(groups.some((group) => group.role === "test" && group.phase === "post-change"));
      },
      assertPlan(plan) {
        assert.ok(Array.isArray(plan.command_groups));
        assert.ok(plan.command_groups.some((group) => group.role === "test" && group.status === "planned"));
      },
      assertVerify(_verifySummary, stepResults) {
        assert.ok(stepResults.some((result) => result.command_group_role === "test" && result.status === "passed"));
      },
    },
    {
      name: "python",
      verificationLabel: "post-change-smoke",
      expectedStatus: "passed",
      shims: ["python", "pytest"],
      setup(repoRoot) {
        writeFile(repoRoot, "pyproject.toml", "[project]\nname = 'python-smoke'\n[tool.pytest.ini_options]\ntestpaths = ['tests']\n");
        writeFile(
          repoRoot,
          "tests/test_smoke.py",
          "import unittest\n\nclass SmokeTest(unittest.TestCase):\n    def test_smoke(self):\n        self.assertTrue(True)\n",
        );
      },
      assertDiscovery(discovery) {
        assert.ok(discovery.detections.some((entry) => entry.stack === "python"));
        assert.ok(
          discovery.command_group_candidates.some((candidate) =>
            candidate.command_group.commands.includes("python -m pytest"),
          ),
        );
      },
      assertProfile(profile) {
        assert.ok(
          profileCommandGroups(profile).some((group) =>
            Array.isArray(group.tool_requirements) &&
            group.tool_requirements.some((requirement) => requirement.tool === "python"),
          ),
        );
      },
      assertPlan(plan) {
        assert.ok(
          plan.command_groups.some((group) =>
            Array.isArray(group.tool_requirements) &&
            group.tool_requirements.some((requirement) => requirement.tool === "python"),
          ),
        );
      },
      assertVerify(_verifySummary, stepResults) {
        assert.ok(stepResults.every((result) => result.status === "passed"));
      },
    },
    {
      name: "compiled",
      verificationLabel: "post-change-smoke",
      expectedStatus: "passed",
      shims: ["go", "cargo"],
      setup(repoRoot) {
        writeFile(repoRoot, "services/api/go.mod", "module example.com/api\n\ngo 1.22\n");
        writeFile(repoRoot, "crates/core/Cargo.toml", "[package]\nname = 'core'\nversion = '0.1.0'\nedition = '2021'\n");
      },
      assertDiscovery(discovery) {
        const groups = discovery.command_group_candidates.map((candidate) => candidate.command_group);
        assert.ok(groups.some((group) => group.working_dir === "services/api" && group.commands.includes("go test ./...")));
        assert.ok(groups.some((group) => group.working_dir === "crates/core" && group.commands.includes("cargo test")));
      },
      assertProfile(profile) {
        const groups = profileCommandGroups(profile);
        assert.ok(
          groups.some((group) =>
            Array.isArray(group.tool_requirements) &&
            group.tool_requirements.some((requirement) => requirement.tool === "go"),
          ),
        );
        assert.ok(
          groups.some((group) =>
            Array.isArray(group.tool_requirements) &&
            group.tool_requirements.some((requirement) => requirement.tool === "cargo"),
          ),
        );
      },
      assertPlan(plan) {
        assert.ok(
          plan.command_groups.some((group) =>
            Array.isArray(group.tool_requirements) &&
            group.tool_requirements.some((requirement) => requirement.tool === "go"),
          ),
        );
        assert.ok(
          plan.command_groups.some((group) =>
            Array.isArray(group.tool_requirements) &&
            group.tool_requirements.some((requirement) => requirement.tool === "cargo"),
          ),
        );
      },
      assertVerify(_verifySummary, stepResults) {
        assert.ok(stepResults.some((result) => result.working_dir === "services/api"));
        assert.ok(stepResults.some((result) => result.working_dir === "crates/core"));
      },
    },
    {
      name: "frontend-browser",
      verificationLabel: "post-change-smoke",
      expectedStatus: "passed",
      setup(repoRoot) {
        writeFile(
          repoRoot,
          "package.json",
          JSON.stringify(
            {
              name: "frontend-browser-smoke",
              scripts: {
                "test:e2e": passingNodeScript,
              },
            },
            null,
            2,
          ),
        );
        writeFile(repoRoot, "package-lock.json", "{}\n");
      },
      assertDiscovery(discovery) {
        assert.ok(
          discovery.command_group_candidates.some((candidate) => candidate.command_group.role === "e2e"),
        );
      },
      assertProfile(profile) {
        assert.ok(profileCommandGroups(profile).some((group) => group.role === "e2e"));
      },
      assertPlan(plan) {
        assert.ok(plan.command_groups.some((group) => group.role === "e2e"));
      },
      assertVerify(_verifySummary, stepResults) {
        assert.ok(stepResults.some((result) => result.command_group_role === "e2e" && result.status === "passed"));
      },
    },
    {
      name: "monorepo",
      verificationLabel: "post-change-smoke",
      expectedStatus: "passed",
      setup(repoRoot) {
        writeFile(
          repoRoot,
          "package.json",
          JSON.stringify({ name: "monorepo-smoke", workspaces: ["apps/*"] }, null, 2),
        );
        writeFile(repoRoot, "package-lock.json", "{}\n");
        writeFile(
          repoRoot,
          "apps/api/package.json",
          JSON.stringify({ name: "api", scripts: { test: passingNodeScript } }, null, 2),
        );
      },
      assertDiscovery(discovery) {
        assert.ok(discovery.package_boundaries.some((boundary) => boundary.working_dir === "apps/api"));
      },
      assertProfile(profile) {
        assert.ok(profileCommandGroups(profile).some((group) => group.working_dir === "apps/api"));
      },
      assertPlan(plan) {
        assert.ok(plan.package_boundaries.some((boundary) => boundary.working_dir === "apps/api"));
      },
      assertVerify(_verifySummary, stepResults) {
        assert.ok(stepResults.some((result) => result.working_dir === "apps/api"));
      },
    },
    {
      name: "no-tests",
      verificationLabel: "post-change-smoke",
      expectedStatus: "failed",
      setup(repoRoot) {
        writeFile(repoRoot, "README.md", "# No tests smoke\n");
      },
      assertDiscovery(discovery) {
        assert.equal(discovery.command_group_candidates.length, 0);
        assert.deepEqual(discovery.outcomes.map((outcome) => outcome.outcome), ["no-tests"]);
      },
      assertProfile(profile) {
        const verification = /** @type {Record<string, unknown>} */ (profile.verification ?? {});
        assert.deepEqual(profileCommandGroups(profile), []);
        assert.equal(/** @type {Array<Record<string, unknown>>} */ (verification.discovery_outcomes)[0].outcome, "no-tests");
      },
      assertPlan(plan) {
        assert.deepEqual(plan.command_groups, []);
        assert.equal(plan.discovery_outcomes[0].outcome, "no-tests");
      },
      assertVerify(_verifySummary, stepResults) {
        assert.equal(stepResults[0].command_kind, "selection");
        assert.match(String(stepResults[0].summary), /No bounded verification commands/u);
      },
    },
    {
      name: "broken-baseline",
      verificationLabel: "baseline-smoke",
      expectedStatus: "failed",
      setup(repoRoot) {
        writeFile(
          repoRoot,
          "package.json",
          JSON.stringify({ name: "broken-baseline-smoke", scripts: { test: failingNodeScript } }, null, 2),
        );
        writeFile(repoRoot, "package-lock.json", "{}\n");
      },
      assertDiscovery(discovery) {
        assert.ok(discovery.command_group_candidates.some((candidate) => candidate.command_group.phase === "baseline"));
      },
      assertProfile(profile) {
        assert.ok(profileCommandGroups(profile).some((group) => group.phase === "baseline" && group.role === "test"));
      },
      assertPlan(plan) {
        assert.ok(plan.command_groups.some((group) => group.phase === "baseline" && group.role === "test"));
      },
      assertVerify(_verifySummary, stepResults) {
        assert.ok(
          stepResults.some(
            (result) =>
              result.command_group_phase === "baseline" &&
              result.command_group_enforcement === "required" &&
              result.command_group_outcome === "broken-baseline",
          ),
        );
      },
    },
  ];

  for (const scenario of scenarios) {
    runArchetypeScenario(scenario);
  }
});
