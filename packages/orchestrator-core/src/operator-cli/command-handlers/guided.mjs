import fs from "node:fs";
import path from "node:path";

import {
  initializeProjectRuntime,
  materializeIntakeArtifactPacket,
  normalizeDeliveryMode,
  resolveNextAction,
  resolveOptionalAssetModeFlag,
  resolveOptionalBooleanFlag,
  resolveOptionalCsvFlag,
  resolveOptionalRefOrPathFlag,
  resolveOptionalStringFlag,
  resolveOptionalStringListFlag,
  resolveRuntimeRoot,
} from "../command-runtime.mjs";

export const GUIDED_COMMANDS = Object.freeze([
  "doctor",
  "onboard",
  "mission create",
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
 * @param {string | string[] | true | undefined} value
 * @returns {Array<{ kpi_id: string, name: string, target: string, measurement?: string }>}
 */
function resolveKpiFlags(value) {
  if (value === undefined) return [];
  if (value === true) {
    throw new Error("Flag '--kpi' requires a value.");
  }
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry, index) => {
    const [kpiId, name, target, ...measurementParts] = entry.split(":").map((part) => part.trim());
    const measurement = measurementParts.join(":").trim();
    if (!kpiId || !name || !target) {
      throw new Error(
        `Flag '--kpi' value ${index + 1} must use 'kpi_id:name:target[:measurement]' format.`,
      );
    }
    return {
      kpi_id: kpiId,
      name,
      target,
      ...(measurement ? { measurement } : {}),
    };
  });
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

  if (command === "mission create") {
    const missionInit = initializeProjectRuntime({
      cwd,
      projectRef: resolveOptionalStringFlag("project-ref", flags["project-ref"]) ?? ".",
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
      command: "aor mission create",
    });
    const requestFileInput = resolveOptionalStringFlag("request-file", flags["request-file"]);
    const requestFile = resolveOptionalRefOrPathFlag({
      cwd,
      projectRoot: missionInit.projectRoot,
      flagValue: requestFileInput,
      flagName: "request-file",
    });
    if (requestFile && !fs.existsSync(requestFile)) {
      throw new Error(`Request file '${requestFileInput}' was not found.`);
    }
    const deliveryMode = normalizeDeliveryMode(
      resolveOptionalStringFlag("delivery-mode", flags["delivery-mode"]) ?? "no-write",
    );
    const missionId = resolveOptionalStringFlag("mission-id", flags["mission-id"]) ?? null;
    const goals = resolveOptionalStringListFlag("goal", flags.goal);
    const constraints = resolveOptionalStringListFlag("constraint", flags.constraint);
    const definitionOfDone = resolveOptionalStringListFlag("dod", flags.dod);
    const kpis = resolveKpiFlags(flags.kpi);
    const intakePacket = materializeIntakeArtifactPacket({
      projectId: missionInit.projectId,
      projectRoot: missionInit.projectRoot,
      projectProfileRef: missionInit.projectProfileRef,
      runtimeLayout: missionInit.runtimeLayout,
      command: "aor mission create",
      missionId,
      requestTitle:
        resolveOptionalStringFlag("title", flags.title) ??
        (missionId ? `Guided mission ${missionId}` : "Guided mission request"),
      requestBrief:
        resolveOptionalStringFlag("brief", flags.brief) ??
        goals[0] ??
        "Prepare one bounded guided mission request.",
      requestConstraints: constraints,
      goals,
      kpis,
      definitionOfDone,
      allowedPaths: resolveOptionalCsvFlag("allowed-path", flags["allowed-path"]),
      forbiddenPaths: resolveOptionalCsvFlag("forbidden-path", flags["forbidden-path"]),
      deliveryMode,
      requestFile: requestFile ?? null,
      sourceKind: resolveOptionalStringFlag("source-kind", flags["source-kind"]) ?? null,
      sourceRef: resolveOptionalStringFlag("source-ref", flags["source-ref"]) ?? null,
    });
    const completeness = intakePacket.packetBody.product_intake_completeness;
    const complete = completeness.status === "complete";

    outputState.resolvedProjectRef = missionInit.projectRoot;
    outputState.resolvedRuntimeRoot = missionInit.runtimeRoot;
    outputState.runtimeLayout = missionInit.runtimeLayout;
    outputState.runtimeStateFile = missionInit.stateFile;
    outputState.projectProfileRef = missionInit.projectProfileRef;
    outputState.artifactPacketId = intakePacket.packet.packet_id;
    outputState.artifactPacketFile = intakePacket.packetFile;
    outputState.artifactPacketBodyFile = intakePacket.packetBodyFile;
    outputState.productIntake = intakePacket.packetBody.product_intake;
    outputState.productIntakeCompleteness = completeness;
    outputState.productIntakeSourceRefs = intakePacket.packetBody.product_intake.source_refs;
    outputState.deliveryMode = deliveryMode;
    outputState.guidedCommand = "aor mission create";
    outputState.guidedStage = "mission-intake";
    outputState.guidedStatus = complete ? "ready" : "blocked";
    outputState.guidedSummary = complete
      ? "Guided mission intake is complete and preserved as an intake-request artifact packet."
      : "Guided mission intake was saved, but missing product evidence blocks the next lifecycle stage.";
    outputState.guidedLowLevelCommand = "intake create";
    outputState.guidedActionableBlockers = complete
      ? []
      : completeness.missing_fields.map((field) => ({
          code: `mission-${field}-missing`,
          summary: `Mission intake is missing ${field}.`,
          next_command: projectCommand("mission create", missionInit.projectRoot),
        }));
    outputState.guidedRecommendedCommands = complete
      ? [projectCommand("next", missionInit.projectRoot)]
      : [projectCommand("mission create", missionInit.projectRoot)];
    outputState.futureControlHooks = ["next", "discovery run", "spec build"];
    return true;
  }

  if (command === "app") {
    const { projectRoot, runtimeRoot } = resolveGuidedProject({ flags, cwd });
    const readiness = inspectReadiness(projectRoot, runtimeRoot);
    const host = resolveOptionalStringFlag("host", flags.host) ?? "127.0.0.1";
    const port = resolveOptionalStringFlag("port", flags.port) ?? "0";
    const open = resolveOptionalStringFlag("open", flags.open) ?? "true";

    outputState.resolvedProjectRef = projectRoot;
    outputState.resolvedRuntimeRoot = runtimeRoot;
    outputState.guidedCommand = "aor app";
    outputState.guidedStage = "optional-app";
    outputState.guidedStatus = readiness.status;
    outputState.guidedSummary =
      readiness.status === "ready"
        ? "The local web console can launch from this project. Headless CLI and API operation remain valid when it is stopped."
        : "The optional local web console can launch after project blockers are resolved.";
    outputState.guidedLowLevelCommand = "app launch";
    outputState.guidedActionableBlockers = readiness.blockers;
    outputState.guidedRecommendedCommands =
      readiness.status === "ready"
        ? [
            `${projectCommand("app", projectRoot)} --host ${shellQuote(host)} --port ${shellQuote(port)} --open ${shellQuote(open)}`,
            `${projectCommand("app", projectRoot)} --smoke true --open false --json`,
            projectCommand("ui detach", projectRoot),
            projectCommand("run status", projectRoot),
          ]
        : readiness.blockers.map((blocker) => blocker.next_command);
    outputState.guidedWebSurface = {
      optional: true,
      mandatory: false,
      host,
      port,
      open,
      launch_command: `${projectCommand("app", projectRoot)} --host ${shellQuote(host)} --port ${shellQuote(port)} --open ${shellQuote(open)}`,
      smoke_command: `${projectCommand("app", projectRoot)} --smoke true --open false --json`,
      detach_command: projectCommand("ui detach", projectRoot),
      web_app_root: "apps/web",
      app_mode: "local-spa",
      headless_safe: true,
    };
    outputState.readOnly = true;
    outputState.futureControlHooks = ["ui attach", "ui detach", "run status"];
    return true;
  }

  if (command === "next") {
    const next = resolveNextAction({
      cwd,
      projectRef: resolveOptionalStringFlag("project-ref", flags["project-ref"]) ?? ".",
      projectProfile: resolveOptionalStringFlag("project-profile", flags["project-profile"]),
      runtimeRoot: resolveOptionalStringFlag("runtime-root", flags["runtime-root"]),
    });
    const report = next.nextActionReport;
    const primary = report.primary_action;

    outputState.resolvedProjectRef = next.projectRoot;
    outputState.resolvedRuntimeRoot = next.runtimeRoot;
    outputState.runtimeLayout = next.runtimeLayout;
    outputState.runtimeStateFile = next.stateFile;
    outputState.projectProfileRef = next.projectProfileRef;
    outputState.onboardingReportId = next.onboardingReportId;
    outputState.onboardingReportFile = next.onboardingReportFile;
    outputState.assetMode = next.assetMode;
    outputState.registryRoots = next.registryRoots;
    outputState.nextActionReportId = next.nextActionReportId;
    outputState.nextActionReportFile = next.nextActionReportFile;
    outputState.nextActionStatus = report.status;
    outputState.nextActionPrimary = primary;
    outputState.nextActionBlockers = report.blockers;
    outputState.nextActionEvidenceRefs = report.evidence_refs;
    outputState.nextActionMissionState = report.mission_state;
    outputState.nextActionClosureState = report.closure_state;
    outputState.nextActionBoundedExecution = report.bounded_execution;
    outputState.guidedCommand = "aor next";
    outputState.guidedStage = report.project_state.stage;
    outputState.guidedStatus = report.status;
    outputState.guidedSummary = primary.reason;
    outputState.guidedLowLevelCommand = primary.low_level_command;
    outputState.guidedReadiness = {
      status: report.status,
      stage: report.project_state.stage,
      report_file: next.nextActionReportFile,
    };
    outputState.guidedActionableBlockers = report.blockers;
    outputState.guidedRecommendedCommands = [primary.command];
    outputState.readOnly = false;
    outputState.futureControlHooks = [
      "mission create",
      "discovery run",
      "spec build",
      "review run",
      "review decide",
      "deliver prepare",
      "release prepare",
      "learning handoff",
      "run status",
    ];
    return true;
  }

  return false;
}
