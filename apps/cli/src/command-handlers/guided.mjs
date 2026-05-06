import fs from "node:fs";
import path from "node:path";

import {
  initializeProjectRuntime,
  resolveOptionalAssetModeFlag,
  resolveOptionalBooleanFlag,
  resolveOptionalStringFlag,
  resolveOptionalStringListFlag,
  resolveRuntimeRoot,
} from "../command-runtime.mjs";

export const GUIDED_COMMANDS = Object.freeze([
  "doctor",
  "onboard",
  "app",
  "next",
]);

export const GUIDED_COMMAND_GROUP = Object.freeze({
  group_id: "guided-first-run",
  commands: GUIDED_COMMANDS,
});

/**
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * @param {string} command
 * @param {string} projectRoot
 * @returns {string}
 */
function projectCommand(command, projectRoot) {
  return `aor ${command} --project-ref ${shellQuote(projectRoot)}`;
}

/**
 * @param {string} projectRoot
 * @param {string} runtimeRoot
 * @returns {{ status: "ready" | "blocked", checks: Array<Record<string, unknown>>, blockers: Array<Record<string, string>> }}
 */
function inspectReadiness(projectRoot, runtimeRoot) {
  const checks = [];
  const blockers = [];

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    check_id: "node-version",
    status: nodeMajor >= 22 ? "pass" : "fail",
    detail: `Node.js ${process.versions.node}`,
  });
  if (nodeMajor < 22) {
    blockers.push({
      code: "node-version-too-old",
      summary: "AOR requires Node.js 22 or newer.",
      next_command: "Install Node.js 22+ and rerun aor doctor.",
    });
  }

  if (!fs.existsSync(projectRoot)) {
    checks.push({
      check_id: "project-ref",
      status: "fail",
      detail: `Project path '${projectRoot}' does not exist.`,
    });
    blockers.push({
      code: "project-ref-missing",
      summary: "The target repository path does not exist.",
      next_command: "Create or clone the repository, then rerun aor doctor --project-ref <path>.",
    });
    return { status: "blocked", checks, blockers };
  }

  const projectStat = fs.statSync(projectRoot);
  checks.push({
    check_id: "project-ref",
    status: projectStat.isDirectory() ? "pass" : "fail",
    detail: projectRoot,
  });
  if (!projectStat.isDirectory()) {
    blockers.push({
      code: "project-ref-not-directory",
      summary: "The target project reference is not a directory.",
      next_command: "Pass a repository directory to --project-ref.",
    });
    return { status: "blocked", checks, blockers };
  }

  checks.push({
    check_id: "git-root",
    status: fs.existsSync(path.join(projectRoot, ".git")) ? "pass" : "warn",
    detail: "Git metadata is recommended for bounded delivery and review evidence.",
  });
  checks.push({
    check_id: "package-json",
    status: fs.existsSync(path.join(projectRoot, "package.json")) ? "pass" : "warn",
    detail: "package.json is optional but improves command discovery for JavaScript/TypeScript projects.",
  });
  checks.push({
    check_id: "runtime-root",
    status: fs.existsSync(runtimeRoot) ? "pass" : "warn",
    detail: fs.existsSync(runtimeRoot)
      ? `Runtime root exists at ${runtimeRoot}.`
      : `Runtime root is not initialized yet. Run ${projectCommand("onboard", projectRoot)}.`,
  });

  return {
    status: blockers.length > 0 ? "blocked" : "ready",
    checks,
    blockers,
  };
}

/**
 * @param {{ flags: Record<string, string | string[] | true>, cwd: string }} options
 * @returns {{ projectRoot: string, runtimeRoot: string }}
 */
function resolveGuidedProject(options) {
  const projectRef = resolveOptionalStringFlag("project-ref", options.flags["project-ref"]) ?? ".";
  const projectRoot = path.resolve(options.cwd, projectRef);
  return {
    projectRoot,
    runtimeRoot: resolveRuntimeRoot(options.flags["runtime-root"], projectRoot),
  };
}

/**
 * @param {{ command: string, flags: Record<string, string | string[] | true>, cwd: string, outputState: Record<string, unknown> }} context
 * @returns {boolean}
 */
export function handleGuidedCommand(context) {
  const { command, flags, cwd, outputState } = context;

  if (command === "doctor") {
    const { projectRoot, runtimeRoot } = resolveGuidedProject({ flags, cwd });
    const readiness = inspectReadiness(projectRoot, runtimeRoot);

    outputState.resolvedProjectRef = projectRoot;
    outputState.resolvedRuntimeRoot = runtimeRoot;
    outputState.guidedCommand = "aor doctor";
    outputState.guidedStage = "doctor";
    outputState.guidedStatus = readiness.status;
    outputState.guidedSummary =
      readiness.status === "ready"
        ? "Environment is ready for guided onboarding. Warnings stay visible but do not block first-run discovery."
        : "Environment has blockers that must be resolved before onboarding.";
    outputState.guidedReadiness = {
      status: readiness.status,
      checks: readiness.checks,
    };
    outputState.guidedActionableBlockers = readiness.blockers;
    outputState.guidedRecommendedCommands =
      readiness.status === "ready"
        ? [projectCommand("onboard", projectRoot), projectCommand("next", projectRoot)]
        : readiness.blockers.map((blocker) => blocker.next_command);
    outputState.readOnly = true;
    outputState.futureControlHooks = ["onboard", "next", "app"];
    return true;
  }

  if (command === "onboard") {
    const initResult = initializeProjectRuntime({
      cwd,
      projectRef: resolveOptionalStringFlag("project-ref", flags["project-ref"]) ?? ".",
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      assetMode: resolveOptionalAssetModeFlag(flags["asset-mode"]),
      materializeProjectProfile: resolveOptionalBooleanFlag(
        "materialize-project-profile",
        flags["materialize-project-profile"],
      ),
      bootstrapTemplate: resolveOptionalStringFlag("bootstrap-template", flags["bootstrap-template"]),
      materializeBootstrapAssets: resolveOptionalBooleanFlag(
        "materialize-bootstrap-assets",
        flags["materialize-bootstrap-assets"],
      ),
      repoBuildCommands: resolveOptionalStringListFlag("repo-build-command", flags["repo-build-command"]),
      repoLintCommands: resolveOptionalStringListFlag("repo-lint-command", flags["repo-lint-command"]),
      repoTestCommands: resolveOptionalStringListFlag("repo-test-command", flags["repo-test-command"]),
      command: "aor onboard",
    });

    outputState.resolvedProjectRef = initResult.projectRoot;
    outputState.resolvedRuntimeRoot = initResult.runtimeRoot;
    outputState.runtimeLayout = initResult.runtimeLayout;
    outputState.runtimeStateFile = initResult.stateFile;
    outputState.projectProfileRef = initResult.projectProfileRef;
    outputState.artifactPacketId = initResult.artifactPacketId;
    outputState.artifactPacketFile = initResult.artifactPacketFile;
    outputState.artifactPacketBodyFile = initResult.artifactPacketBodyFile;
    outputState.onboardingReportId = initResult.onboardingReportId;
    outputState.onboardingReportFile = initResult.onboardingReportFile;
    outputState.assetMode = initResult.assetMode;
    outputState.registryRoots = initResult.registryRoots;
    outputState.bootstrapMaterializationStatus = initResult.bootstrapMaterializationStatus;
    outputState.materializedProjectProfileFile = initResult.materializedProjectProfileFile;
    outputState.materializedBootstrapAssetsRoot = initResult.materializedBootstrapAssetsRoot;
    outputState.bootstrapMaterializationIdempotent = initResult.bootstrapMaterializationIdempotent;
    outputState.guidedCommand = "aor onboard";
    outputState.guidedStage = "onboard";
    outputState.guidedStatus = "ready";
    outputState.guidedSummary =
      "Onboarding ran through the existing project init path. Low-level project commands remain available and scriptable.";
    outputState.guidedLowLevelCommand = "project init";
    outputState.guidedActionableBlockers = [];
    outputState.guidedRecommendedCommands = [
      projectCommand("doctor", initResult.projectRoot),
      projectCommand("next", initResult.projectRoot),
      projectCommand("app", initResult.projectRoot),
    ];
    return true;
  }

  if (command === "app") {
    const { projectRoot, runtimeRoot } = resolveGuidedProject({ flags, cwd });
    const readiness = inspectReadiness(projectRoot, runtimeRoot);
    const controlPlane =
      resolveOptionalStringFlag("control-plane", flags["control-plane"]) ?? "http://localhost:3000";

    outputState.resolvedProjectRef = projectRoot;
    outputState.resolvedRuntimeRoot = runtimeRoot;
    outputState.guidedCommand = "aor app";
    outputState.guidedStage = "optional-app";
    outputState.guidedStatus = readiness.status;
    outputState.guidedSummary =
      readiness.status === "ready"
        ? "The web console is optional. Headless CLI and API operation remain valid when it is absent or detached."
        : "The optional web console can be attached after project blockers are resolved.";
    outputState.guidedLowLevelCommand = "ui attach";
    outputState.guidedActionableBlockers = readiness.blockers;
    outputState.guidedRecommendedCommands =
      readiness.status === "ready"
        ? [
            `${projectCommand("ui attach", projectRoot)} --control-plane ${shellQuote(controlPlane)}`,
            projectCommand("ui detach", projectRoot),
            projectCommand("run status", projectRoot),
          ]
        : readiness.blockers.map((blocker) => blocker.next_command);
    outputState.guidedWebSurface = {
      optional: true,
      mandatory: false,
      control_plane: controlPlane,
      attach_command: `${projectCommand("ui attach", projectRoot)} --control-plane ${shellQuote(controlPlane)}`,
      detach_command: projectCommand("ui detach", projectRoot),
      web_app_root: "apps/web",
      headless_safe: true,
    };
    outputState.readOnly = true;
    outputState.futureControlHooks = ["ui attach", "ui detach", "run status"];
    return true;
  }

  if (command === "next") {
    const { projectRoot, runtimeRoot } = resolveGuidedProject({ flags, cwd });
    const readiness = inspectReadiness(projectRoot, runtimeRoot);
    const runtimeInitialized = fs.existsSync(runtimeRoot);
    const lowLevelCommand = runtimeInitialized ? "intake create" : "project init";

    outputState.resolvedProjectRef = projectRoot;
    outputState.resolvedRuntimeRoot = runtimeRoot;
    outputState.guidedCommand = "aor next";
    outputState.guidedStage = "next-action-preview";
    outputState.guidedStatus = readiness.status;
    outputState.guidedSummary =
      readiness.status === "ready" && runtimeInitialized
        ? "Runtime root exists. This first-run preview points to the current safe low-level command until the deterministic next-action resolver lands."
        : readiness.status === "ready"
          ? "Project is ready for onboarding. Run the guided onboard wrapper before creating mission evidence."
          : "Next action is blocked by project readiness issues.";
    outputState.guidedLowLevelCommand = lowLevelCommand;
    outputState.guidedReadiness = {
      status: readiness.status,
      runtime_initialized: runtimeInitialized,
      checks: readiness.checks,
    };
    outputState.guidedActionableBlockers = readiness.blockers;
    outputState.guidedRecommendedCommands =
      readiness.status !== "ready"
        ? readiness.blockers.map((blocker) => blocker.next_command)
        : runtimeInitialized
          ? [projectCommand("intake create", projectRoot), projectCommand("run status", projectRoot)]
          : [projectCommand("onboard", projectRoot), projectCommand("doctor", projectRoot)];
    outputState.readOnly = true;
    outputState.futureControlHooks = ["onboard", "intake create", "run status"];
    return true;
  }

  return false;
}
