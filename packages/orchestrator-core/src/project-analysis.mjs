import fs from "node:fs";
import path from "node:path";

import { resolveAdapterMatrix } from "../../adapter-sdk/src/index.mjs";
import { loadContractFile, validateContractDocument } from "../../contracts/src/index.mjs";
import { resolveRouteMatrix } from "../../provider-routing/src/route-resolution.mjs";

import { resolveAssetBundleMatrix } from "./asset-loader.mjs";
import { loadEvaluationRegistry } from "./evaluation-registry.mjs";
import { resolveStepPolicyMatrix } from "./policy-resolution.mjs";
import { initializeProjectRuntime, resolveProjectRegistryRoots } from "./project-init.mjs";
import { resolveProjectRepoScope } from "./repo-scope.mjs";

const LANGUAGE_BY_EXTENSION = Object.freeze({
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
});
const STEP_CLASS_ORDER = Object.freeze([
  "discovery",
  "research",
  "spec",
  "planning",
  "implement",
  "review",
  "qa",
  "repair",
  "eval",
  "harness",
]);
const ARCHITECTURE_DOC_REFS = Object.freeze([
  "docs/architecture/04-system-of-record-and-core-entities.md",
  "docs/architecture/12-orchestrator-operating-model.md",
  "docs/architecture/14-cli-command-catalog.md",
]);
const ARCHITECTURE_CONTRACT_REFS = Object.freeze([
  "docs/contracts/project-analysis-report.md",
  "docs/contracts/step-result.md",
  "docs/contracts/wave-ticket.md",
  "docs/contracts/handoff-packet.md",
]);

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {{
 *   projectRoot: string,
 *   runtimeLayout: { artifactsRoot: string },
 *   inputPacketPath?: string,
 * }} options
 * @returns {{
 *   inputPacketPath: string | null,
 *   inputPacketRef: string | null,
 *   missionId: string | null,
 *   requestTitle: string | null,
 *   requestBrief: string | null,
 *   allowedPaths: string[],
 *   forbiddenPaths: string[],
 *   expectedEvidence: string[],
 *   changeBudget: Record<string, unknown> | null,
 *   sourceKind: string | null,
 *   productIntake: Record<string, unknown>,
 *   productIntakeCompleteness: Record<string, unknown>,
 * } | null}
 */
function resolveFeatureTraceability(options) {
  const explicitInputPacketPath =
    typeof options.inputPacketPath === "string" && options.inputPacketPath.trim().length > 0
      ? path.isAbsolute(options.inputPacketPath)
        ? options.inputPacketPath
        : path.resolve(options.projectRoot, options.inputPacketPath)
      : null;

  let packetPath = explicitInputPacketPath;
  if (!packetPath) {
    const candidates = fs
      .readdirSync(options.runtimeLayout.artifactsRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.json$/u.test(entry.name) &&
          entry.name.includes(".artifact.intake.") &&
          !entry.name.endsWith(".body.json"),
      )
      .map((entry) => path.join(options.runtimeLayout.artifactsRoot, entry.name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    packetPath = candidates[0] ?? null;
  }

  if (!packetPath || !fs.existsSync(packetPath)) {
    return null;
  }

  const loadedPacket = loadContractFile({
    filePath: packetPath,
    family: "artifact-packet",
  });
  if (!loadedPacket.ok) {
    return null;
  }
  const packet = asRecord(loadedPacket.document);
  const bodyRef = typeof packet.body_ref === "string" && packet.body_ref.trim().length > 0 ? packet.body_ref : null;
  const packetBody = bodyRef && fs.existsSync(bodyRef)
    ? /** @type {Record<string, unknown>} */ (JSON.parse(fs.readFileSync(bodyRef, "utf8")))
    : {};
  const missionTraceability = asRecord(packetBody.mission_traceability);
  const featureRequest = asRecord(packetBody.feature_request);
  const productIntake = asRecord(packetBody.product_intake);
  const productIntakeCompleteness = asRecord(packetBody.product_intake_completeness);
  const requestDocument = asRecord(featureRequest.request_document);

  return {
    inputPacketPath: packetPath,
    inputPacketRef: toEvidenceRef(options.projectRoot, packetPath),
    missionId: typeof missionTraceability.mission_id === "string" ? missionTraceability.mission_id : null,
    scenarioFamily:
      typeof missionTraceability.scenario_family === "string"
        ? missionTraceability.scenario_family
        : typeof requestDocument.scenario_family === "string"
          ? requestDocument.scenario_family
          : null,
    providerVariantId:
      typeof missionTraceability.provider_variant_id === "string"
        ? missionTraceability.provider_variant_id
        : typeof requestDocument.provider_variant_id === "string"
          ? requestDocument.provider_variant_id
          : null,
    featureSize:
      typeof missionTraceability.feature_size === "string"
        ? missionTraceability.feature_size
        : typeof requestDocument.feature_size === "string"
          ? requestDocument.feature_size
          : null,
    matrixCell:
      typeof missionTraceability.matrix_cell === "object" &&
      missionTraceability.matrix_cell !== null &&
      !Array.isArray(missionTraceability.matrix_cell)
        ? missionTraceability.matrix_cell
        : typeof requestDocument.matrix_cell === "object" &&
            requestDocument.matrix_cell !== null &&
            !Array.isArray(requestDocument.matrix_cell)
          ? requestDocument.matrix_cell
          : null,
    coverageFollowUp:
      typeof missionTraceability.coverage_follow_up === "object" &&
      missionTraceability.coverage_follow_up !== null &&
      !Array.isArray(missionTraceability.coverage_follow_up)
        ? missionTraceability.coverage_follow_up
        : typeof requestDocument.coverage_follow_up === "object" &&
            requestDocument.coverage_follow_up !== null &&
            !Array.isArray(requestDocument.coverage_follow_up)
          ? requestDocument.coverage_follow_up
          : null,
    requestTitle: typeof featureRequest.title === "string" ? featureRequest.title : null,
    requestBrief: typeof featureRequest.brief === "string" ? featureRequest.brief : null,
    allowedPaths: Array.isArray(requestDocument.allowed_paths)
      ? requestDocument.allowed_paths.filter((entry) => typeof entry === "string")
      : [],
    forbiddenPaths: Array.isArray(requestDocument.forbidden_paths)
      ? requestDocument.forbidden_paths.filter((entry) => typeof entry === "string")
      : [],
    expectedEvidence: Array.isArray(requestDocument.expected_evidence)
      ? requestDocument.expected_evidence.filter((entry) => typeof entry === "string")
      : [],
    changeBudget:
      typeof requestDocument.change_budget === "object" && requestDocument.change_budget !== null
        ? asRecord(requestDocument.change_budget)
        : null,
    sourceKind: typeof missionTraceability.source_kind === "string" ? missionTraceability.source_kind : null,
    productIntake,
    productIntakeCompleteness,
  };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function asRecordArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry)).map(asRecord) : [];
}

/**
 * @param {unknown[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((entry) => typeof entry === "string" && entry.length > 0))];
}

/**
 * @param {{ field: string, reason: string, unknownFacts: Array<{ field: string, confidence: "low", value: "unknown", reason: string }> }} options
 * @returns {"unknown"}
 */
function markUnknown(options) {
  options.unknownFacts.push({
    field: options.field,
    confidence: "low",
    value: "unknown",
    reason: options.reason,
  });
  return "unknown";
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function exists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * @param {string} root
 * @returns {Set<string>}
 */
function detectLanguages(root) {
  const detected = new Set();
  const stack = [{ dir: root, depth: 0 }];
  let visited = 0;

  while (stack.length > 0 && visited < 2000) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs.readdirSync(current.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".aor") {
        continue;
      }

      const entryPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 3) {
          stack.push({ dir: entryPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile()) continue;
      visited += 1;

      const extension = path.extname(entry.name).toLowerCase();
      const language = LANGUAGE_BY_EXTENSION[extension];
      if (language) {
        detected.add(language);
      }
    }
  }

  return detected;
}

/**
 * @param {string} root
 * @returns {{ packageJson: Record<string, unknown> | null, scripts: Record<string, string> }}
 */
function loadPackageScripts(root) {
  const packageJsonPath = path.join(root, "package.json");
  if (!exists(packageJsonPath)) {
    return { packageJson: null, scripts: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const scripts = typeof parsed.scripts === "object" && parsed.scripts ? parsed.scripts : {};
    /** @type {Record<string, string>} */
    const normalizedScripts = {};

    for (const [name, value] of Object.entries(scripts)) {
      if (typeof value === "string" && value.trim().length > 0) {
        normalizedScripts[name] = value;
      }
    }

    return {
      packageJson: parsed,
      scripts: normalizedScripts,
    };
  } catch {
    return { packageJson: null, scripts: {} };
  }
}

/**
 * @param {string} root
 * @returns {{ buildCommands: string[], testCommands: string[], lintCommands: string[] }}
 */
function detectCommandCandidates(root) {
  const { scripts } = loadPackageScripts(root);

  /** @type {string[]} */
  const buildCommands = [];
  /** @type {string[]} */
  const testCommands = [];
  /** @type {string[]} */
  const lintCommands = [];

  for (const [name] of Object.entries(scripts)) {
    if (/^build($|:)/.test(name)) {
      buildCommands.push(`pnpm ${name}`);
    }
    if (/^test($|:)/.test(name)) {
      testCommands.push(`pnpm ${name}`);
    }
    if (/^lint($|:)/.test(name)) {
      lintCommands.push(`pnpm ${name}`);
    }
  }

  const makefilePath = path.join(root, "Makefile");
  if (exists(makefilePath)) {
    const makefile = fs.readFileSync(makefilePath, "utf8");
    if (/^test\s*:/m.test(makefile)) testCommands.push("make test");
    if (/^lint\s*:/m.test(makefile) || /^codestyle\s*:/m.test(makefile)) lintCommands.push("make codestyle");
    if (/^build\s*:/m.test(makefile)) buildCommands.push("make build");
  }

  return {
    buildCommands: [...new Set(buildCommands)],
    testCommands: [...new Set(testCommands)],
    lintCommands: [...new Set(lintCommands)],
  };
}

/**
 * @param {string} root
 * @param {Array<{ field: string, confidence: "low", value: "unknown", reason: string }>} unknownFacts
 */
function detectRepoFacts(root, unknownFacts) {
  const hasPnpmWorkspace = exists(path.join(root, "pnpm-workspace.yaml"));
  const hasPackageJson = exists(path.join(root, "package.json"));
  const hasMakefile = exists(path.join(root, "Makefile"));
  const hasPyproject = exists(path.join(root, "pyproject.toml"));

  let topology = "unknown";
  if (hasPnpmWorkspace || exists(path.join(root, "apps")) || exists(path.join(root, "packages"))) {
    topology = "monorepo";
  } else if (hasPackageJson || hasMakefile || hasPyproject) {
    topology = "single-repo";
  } else {
    markUnknown({
      field: "repo_facts.topology",
      reason: "Unable to infer topology from workspace files or common repo directories.",
      unknownFacts,
    });
  }

  let packageManager = "unknown";
  if (exists(path.join(root, "pnpm-lock.yaml")) || hasPnpmWorkspace) {
    packageManager = "pnpm";
  } else if (exists(path.join(root, "package-lock.json"))) {
    packageManager = "npm";
  } else if (exists(path.join(root, "yarn.lock"))) {
    packageManager = "yarn";
  } else {
    markUnknown({
      field: "repo_facts.package_manager",
      reason: "No known JavaScript package-manager lockfile found.",
      unknownFacts,
    });
  }

  const languages = [...detectLanguages(root)].sort();
  if (languages.length === 0) {
    markUnknown({
      field: "repo_facts.languages",
      reason: "No known source-language extensions detected in the first scan window.",
      unknownFacts,
    });
    languages.push("unknown");
  }

  const ciSystems = exists(path.join(root, ".github", "workflows"))
    ? ["github-actions"]
    : [
        markUnknown({
          field: "repo_facts.ci_systems",
          reason: "No .github/workflows directory found.",
          unknownFacts,
        }),
      ];

  const serviceBoundaries = ["apps", "packages", "services", "libs"]
    .filter((segment) => exists(path.join(root, segment)))
    .map((segment) => ({ service_id: segment, paths: [`${segment}/**`] }));

  if (serviceBoundaries.length === 0) {
    serviceBoundaries.push({
      service_id: "unknown",
      paths: ["unknown"],
      confidence: "low",
      reason: "No common service boundary directories found.",
    });
    markUnknown({
      field: "service_boundaries",
      reason: "No apps/packages/services/libs directories found.",
      unknownFacts,
    });
  }

  return {
    topology,
    package_manager: packageManager,
    languages,
    ci_systems: ciSystems,
    service_boundaries: serviceBoundaries,
  };
}

/**
 * @param {{ buildCommands: string[], testCommands: string[], lintCommands: string[] }} commands
 * @param {Array<{ field: string, confidence: "low", value: "unknown", reason: string }>} unknownFacts
 */
function createVerificationPlan(commands, unknownFacts) {
  const smokeCommands = [...commands.lintCommands, ...commands.testCommands, ...commands.buildCommands];
  if (smokeCommands.length === 0) {
    markUnknown({
      field: "verification_plan.smoke_commands",
      reason: "No runnable command candidates were discovered from scripts or Makefile.",
      unknownFacts,
    });
  }

  return {
    preflight: ["project-init-state", "project-profile-load", "analysis-report-write"],
    smoke_commands: smokeCommands.length > 0 ? smokeCommands : ["unknown"],
  };
}

/**
 * @param {{
 *   routeResolutionMatrix: Array<{ step_class: string }>,
 *   assetResolutionMatrix: Array<{ step_class: string }>,
 *   policyResolutionMatrix: Array<{ step_class: string }>,
 *   evaluationRegistry: { datasets: Array<{ dataset_ref: string }>, suites: Array<{ suite_ref: string }> },
 * }} options
 */
function resolveDiscoveryCompleteness(options) {
  const expectedStepCount = STEP_CLASS_ORDER.length;
  const routeCoverage = new Set(options.routeResolutionMatrix.map((entry) => entry.step_class)).size;
  const assetCoverage = new Set(options.assetResolutionMatrix.map((entry) => entry.step_class)).size;
  const policyCoverage = new Set(options.policyResolutionMatrix.map((entry) => entry.step_class)).size;

  const checks = [
    {
      check_id: "route-matrix-coverage",
      status: routeCoverage === expectedStepCount ? "pass" : "fail",
      blocking: true,
      expected: expectedStepCount,
      actual: routeCoverage,
      summary:
        routeCoverage === expectedStepCount
          ? "Route matrix includes every supported step class."
          : "Route matrix is missing one or more supported step classes.",
    },
    {
      check_id: "asset-matrix-coverage",
      status: assetCoverage === expectedStepCount ? "pass" : "fail",
      blocking: true,
      expected: expectedStepCount,
      actual: assetCoverage,
      summary:
        assetCoverage === expectedStepCount
          ? "Asset matrix includes wrapper and prompt provenance for every supported step class."
          : "Asset matrix is missing wrapper/prompt provenance for one or more step classes.",
    },
    {
      check_id: "policy-matrix-coverage",
      status: policyCoverage === expectedStepCount ? "pass" : "fail",
      blocking: true,
      expected: expectedStepCount,
      actual: policyCoverage,
      summary:
        policyCoverage === expectedStepCount
          ? "Policy matrix includes deterministic bounds for every supported step class."
          : "Policy matrix is missing deterministic bounds for one or more step classes.",
    },
    {
      check_id: "evaluation-registry-coverage",
      status:
        options.evaluationRegistry.datasets.length > 0 && options.evaluationRegistry.suites.length > 0 ? "pass" : "fail",
      blocking: true,
      expected: "at least one dataset and one suite",
      actual: `datasets=${options.evaluationRegistry.datasets.length}, suites=${options.evaluationRegistry.suites.length}`,
      summary:
        options.evaluationRegistry.datasets.length > 0 && options.evaluationRegistry.suites.length > 0
          ? "Evaluation registry exposes suite and dataset refs for downstream quality flows."
          : "Evaluation registry does not expose both suite and dataset refs for downstream quality flows.",
    },
  ];
  const blocking = checks.some((check) => check.blocking && check.status === "fail");

  return {
    status: blocking ? "fail" : "pass",
    blocking,
    checks,
  };
}

/**
 * @param {{
 *   routeResolutionMatrix: Array<{ step_class: string, resolved_route_id: string }>,
 *   assetResolutionMatrix: Array<{ step_class: string, wrapper: { wrapper_ref: string }, prompt_bundle: { prompt_bundle_ref: string } }>,
 *   policyResolutionMatrix: Array<{ step_class: string, policy: { policy_id: string } }>,
 *   evaluationRegistry: { datasets: Array<{ dataset_ref: string }>, suites: Array<{ suite_ref: string }> },
 * }} options
 */
function resolveArchitectureTraceability(options) {
  return {
    architecture_doc_refs: [...ARCHITECTURE_DOC_REFS],
    contract_refs: [...ARCHITECTURE_CONTRACT_REFS],
    planning_artifact_families: ["project-analysis-report", "step-result", "wave-ticket", "handoff-packet"],
    step_linkage: STEP_CLASS_ORDER.map((stepClass) => {
      const route = options.routeResolutionMatrix.find((entry) => entry.step_class === stepClass) ?? null;
      const assets = options.assetResolutionMatrix.find((entry) => entry.step_class === stepClass) ?? null;
      const policy = options.policyResolutionMatrix.find((entry) => entry.step_class === stepClass) ?? null;

      return {
        step_class: stepClass,
        route_id: route?.resolved_route_id ?? null,
        wrapper_ref: assets?.wrapper?.wrapper_ref ?? null,
        prompt_bundle_ref: assets?.prompt_bundle?.prompt_bundle_ref ?? null,
        policy_id: policy?.policy?.policy_id ?? null,
      };
    }),
    evaluation_refs: {
      suite_refs: options.evaluationRegistry.suites.map((suite) => suite.suite_ref),
      dataset_refs: options.evaluationRegistry.datasets.map((dataset) => dataset.dataset_ref),
    },
  };
}

/**
 * @param {Array<Record<string, unknown>>} assetResolutionMatrix
 */
function collectContextAssetRefs(assetResolutionMatrix) {
  const contextBundleRefs = [];
  const contextDocRefs = [];
  const contextRuleRefs = [];
  const contextSkillRefs = [];

  for (const entry of assetResolutionMatrix) {
    const contextBundles = asRecord(entry.context_bundles);
    const expandedRefs = asRecord(contextBundles.expanded_refs);
    contextBundleRefs.push(...asStringArray(contextBundles.bundle_refs));
    contextDocRefs.push(...asStringArray(expandedRefs.context_doc_refs));
    contextRuleRefs.push(...asStringArray(expandedRefs.context_rule_refs));
    contextSkillRefs.push(...asStringArray(expandedRefs.context_skill_refs));
  }

  return {
    context_bundle_refs: uniqueStrings(contextBundleRefs),
    context_doc_refs: uniqueStrings(contextDocRefs),
    context_rule_refs: uniqueStrings(contextRuleRefs),
    context_skill_refs: uniqueStrings(contextSkillRefs),
  };
}

/**
 * @param {{
 *   projectId: string,
 *   repoFacts: Record<string, unknown>,
 *   serviceBoundaries: Array<Record<string, unknown>>,
 *   assetResolutionMatrix: Array<Record<string, unknown>>,
 *   featureTraceability: ReturnType<typeof resolveFeatureTraceability>,
 *   analysisReportRef: string,
 * }} options
 */
function resolveDiscoveryResearchReport(options) {
  const productIntake = asRecord(options.featureTraceability?.productIntake);
  const productIntakeCompleteness = asRecord(options.featureTraceability?.productIntakeCompleteness);
  const sourceRefs = asRecordArray(productIntake.source_refs);
  const goals = asStringArray(productIntake.goals);
  const kpis = asRecordArray(productIntake.kpis);
  const definitionOfDone = asStringArray(productIntake.definition_of_done);
  const contextAssets = collectContextAssetRefs(options.assetResolutionMatrix);
  const checks = [
    {
      check_id: "repository-facts-linked",
      status: options.repoFacts.topology && options.repoFacts.topology !== "unknown" ? "pass" : "fail",
      blocking: true,
      summary:
        options.repoFacts.topology && options.repoFacts.topology !== "unknown"
          ? "Repository facts are available for discovery research."
          : "Repository facts are missing or unknown.",
    },
    {
      check_id: "context-assets-linked",
      status: contextAssets.context_bundle_refs.length > 0 ? "pass" : "fail",
      blocking: true,
      summary:
        contextAssets.context_bundle_refs.length > 0
          ? "Runtime context asset refs are linked to discovery research."
          : "Runtime context asset refs are missing.",
    },
    {
      check_id: "local-research-inputs",
      status: sourceRefs.length > 0 ? "pass" : "fail",
      blocking: true,
      summary:
        sourceRefs.length > 0
          ? "Local research source refs are linked to discovery research."
          : "Local issue, PRD, RFC, note, or mail-like source refs are missing.",
    },
    {
      check_id: "product-acceptance-evidence",
      status: goals.length > 0 && kpis.length > 0 && definitionOfDone.length > 0 ? "pass" : "fail",
      blocking: true,
      summary:
        goals.length > 0 && kpis.length > 0 && definitionOfDone.length > 0
          ? "Goals, KPIs, and Definition of Done are present for ADR handoff."
          : "Goals, KPIs, or Definition of Done are missing from product intake.",
    },
  ];
  const blocking = checks.some((check) => check.blocking && check.status === "fail");
  const openQuestions = checks
    .filter((check) => check.status === "fail")
    .map((check) => ({
      question_id: check.check_id,
      status: "open",
      summary: check.summary,
      blocking: check.blocking,
    }));
  const status = blocking ? "incomplete" : "adr-ready";

  return {
    report_id: `${options.projectId}.discovery-research.v1`,
    project_id: options.projectId,
    version: 1,
    generated_from: {
      command: "aor discovery run",
      project_analysis_report_ref: options.analysisReportRef,
      intake_packet_ref: options.featureTraceability?.inputPacketRef ?? null,
    },
    repository_facts: {
      topology: options.repoFacts.topology ?? null,
      languages: asStringArray(options.repoFacts.languages),
      service_boundaries: options.serviceBoundaries,
    },
    context_assets: contextAssets,
    research_inputs: {
      intake_packet_ref: options.featureTraceability?.inputPacketRef ?? null,
      source_refs: sourceRefs,
      goals,
      kpis,
      definition_of_done: definitionOfDone,
      product_intake_completeness: productIntakeCompleteness,
    },
    open_questions: openQuestions,
    adr_ready_recommendations: [
      {
        recommendation_id: blocking ? "adr.discovery-research-blocked" : "adr.discovery-research-ready",
        status: blocking ? "blocked" : "ready",
        title: blocking
          ? "ADR candidate is blocked until local research inputs and product acceptance evidence are present."
          : "Discovery evidence is ready to seed an ADR candidate before specification handoff.",
        rationale_refs: sourceRefs.map((entry) => entry.ref).filter((entry) => typeof entry === "string"),
        proposed_adr_refs: blocking ? [] : ["docs/architecture/adr/discovery-research-decision.md"],
      },
    ],
    completeness: {
      status,
      blocking,
      checks,
    },
    status,
  };
}

/**
 * @param {{
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
 *  routeOverrides?: Record<string, string>,
 *  policyOverrides?: Record<string, string>,
 *  adapterOverrides?: Record<string, string>,
 *  routesRoot?: string,
 *  wrappersRoot?: string,
 *  promptsRoot?: string,
 *  contextBundlesRoot?: string,
 *  policiesRoot?: string,
 *  adaptersRoot?: string,
 *  evaluationWorkspaceRoot?: string,
 * }} options
 */
export function analyzeProjectRuntime(options = {}) {
  const init = initializeProjectRuntime(options);
  /** @type {Array<{ field: string, confidence: "low", value: "unknown", reason: string }>} */
  const unknownFacts = [];

  const repoFacts = detectRepoFacts(init.projectRoot, unknownFacts);
  const commandCandidates = detectCommandCandidates(init.projectRoot);

  const toolchainFacts = {
    build_commands: commandCandidates.buildCommands,
    test_commands: commandCandidates.testCommands,
    lint_commands: commandCandidates.lintCommands,
  };

  if (toolchainFacts.build_commands.length === 0) {
    markUnknown({
      field: "toolchain_facts.build_commands",
      reason: "No build command candidate found.",
      unknownFacts,
    });
    toolchainFacts.build_commands = ["unknown"];
  }

  if (toolchainFacts.test_commands.length === 0) {
    markUnknown({
      field: "toolchain_facts.test_commands",
      reason: "No test command candidate found.",
      unknownFacts,
    });
    toolchainFacts.test_commands = ["unknown"];
  }

  if (toolchainFacts.lint_commands.length === 0) {
    markUnknown({
      field: "toolchain_facts.lint_commands",
      reason: "No lint command candidate found.",
      unknownFacts,
    });
    toolchainFacts.lint_commands = ["unknown"];
  }

  const commandCatalog = {
    required_for_smoke_verify: [
      ...new Set([
        ...commandCandidates.lintCommands,
        ...commandCandidates.testCommands,
        ...commandCandidates.buildCommands,
      ]),
    ],
  };

  if (commandCatalog.required_for_smoke_verify.length === 0) {
    commandCatalog.required_for_smoke_verify = ["unknown"];
  }

  const verificationPlan = createVerificationPlan(commandCandidates, unknownFacts);
  const loadedProjectProfile = loadContractFile({
    filePath: init.projectProfilePath,
    family: "project-profile",
  });
  const projectProfile = asRecord(loadedProjectProfile.document);
  const registryResolution = resolveProjectRegistryRoots(projectProfile, { projectRoot: init.projectRoot });
  const registryRoots = registryResolution.roots;
  const routesRoot = options.routesRoot
    ? path.isAbsolute(options.routesRoot)
      ? options.routesRoot
      : path.resolve(init.projectRoot, options.routesRoot)
    : registryRoots.routes;
  const wrappersRoot = options.wrappersRoot
    ? path.isAbsolute(options.wrappersRoot)
      ? options.wrappersRoot
      : path.resolve(init.projectRoot, options.wrappersRoot)
    : registryRoots.wrappers;
  const promptsRoot = options.promptsRoot
    ? path.isAbsolute(options.promptsRoot)
      ? options.promptsRoot
      : path.resolve(init.projectRoot, options.promptsRoot)
    : registryRoots.prompts;
  const contextBundlesRoot = options.contextBundlesRoot
    ? path.isAbsolute(options.contextBundlesRoot)
      ? options.contextBundlesRoot
      : path.resolve(init.projectRoot, options.contextBundlesRoot)
    : registryRoots.context_bundles;
  const policiesRoot = options.policiesRoot
    ? path.isAbsolute(options.policiesRoot)
      ? options.policiesRoot
      : path.resolve(init.projectRoot, options.policiesRoot)
    : registryRoots.policies;
  const adaptersRoot = options.adaptersRoot
    ? path.isAbsolute(options.adaptersRoot)
      ? options.adaptersRoot
      : path.resolve(init.projectRoot, options.adaptersRoot)
    : registryRoots.adapters;
  const routeResolutionMatrix = resolveRouteMatrix({
    projectProfilePath: init.projectProfilePath,
    routesRoot,
    stepOverrides: options.routeOverrides,
  });
  const assetResolutionMatrix = resolveAssetBundleMatrix({
    projectProfilePath: init.projectProfilePath,
    routesRoot,
    wrappersRoot,
    promptsRoot,
    contextBundlesRoot,
    routeOverrides: options.routeOverrides,
  });
  const policyResolutionMatrix = resolveStepPolicyMatrix({
    projectProfilePath: init.projectProfilePath,
    routesRoot,
    policiesRoot,
    routeOverrides: options.routeOverrides,
    policyOverrides: options.policyOverrides,
  });
  const adapterResolutionMatrix = resolveAdapterMatrix({
    adaptersRoot,
    routeResolutionMatrix,
    adapterOverrides: options.adapterOverrides,
  });
  const evaluationWorkspaceRoot = options.evaluationWorkspaceRoot
    ? path.isAbsolute(options.evaluationWorkspaceRoot)
      ? options.evaluationWorkspaceRoot
      : path.resolve(init.projectRoot, options.evaluationWorkspaceRoot)
    : registryRoots.evaluation;
  const evaluationRegistry = loadEvaluationRegistry({
    workspaceRoot: init.projectRoot,
    examplesRoot: evaluationWorkspaceRoot,
  });

  if (!evaluationRegistry.ok) {
    const issueSummary = evaluationRegistry.issues
      .map((issue) => `${issue.code}: ${issue.message}`)
      .slice(0, 5)
      .join("; ");
    throw new Error(`Evaluation registry validation failed: ${issueSummary}`);
  }
  const discoveryCompleteness = resolveDiscoveryCompleteness({
    routeResolutionMatrix,
    assetResolutionMatrix,
    policyResolutionMatrix,
    evaluationRegistry,
  });
  const architectureTraceability = resolveArchitectureTraceability({
    routeResolutionMatrix,
    assetResolutionMatrix,
    policyResolutionMatrix,
    evaluationRegistry,
  });
  const featureTraceability = resolveFeatureTraceability({
    projectRoot: init.projectRoot,
    runtimeLayout: init.runtimeLayout,
    inputPacketPath:
      typeof options.inputPacketPath === "string" && options.inputPacketPath.trim().length > 0
        ? options.inputPacketPath
        : undefined,
  });
  const repoScopeProof = resolveProjectRepoScope({ profile: projectProfile });
  const reportPath = path.join(init.runtimeLayout.reportsRoot, "project-analysis-report.json");
  const discoveryResearchReportPath = path.join(init.runtimeLayout.reportsRoot, "discovery-research-report.json");
  const discoveryResearchReport = resolveDiscoveryResearchReport({
    projectId: init.projectId,
    repoFacts,
    serviceBoundaries: repoFacts.service_boundaries,
    assetResolutionMatrix,
    featureTraceability,
    analysisReportRef: toEvidenceRef(init.projectRoot, reportPath),
  });

  const report = {
    report_id: `${init.projectId}.analysis.v1`,
    project_id: init.projectId,
    version: 1,
    generated_from: {
      command: "aor project analyze",
      project_root: init.projectRoot,
      selected_profile_ref: init.projectProfileRef,
    },
    asset_mode: registryResolution.assetMode,
    registry_roots: registryRoots,
    repo_facts: {
      topology: repoFacts.topology,
      declared_topology: repoScopeProof.topology,
      declared_repo_count: repoScopeProof.repo_count,
      declared_repo_ids: repoScopeProof.repo_ids,
      repo_graph: repoScopeProof.repo_graph,
      package_manager: repoFacts.package_manager,
      languages: repoFacts.languages,
      ci_systems: repoFacts.ci_systems,
    },
    toolchain_facts: toolchainFacts,
    command_catalog: commandCatalog,
    service_boundaries: repoFacts.service_boundaries,
    route_resolution: {
      routes_root: path.relative(init.projectRoot, routesRoot) || ".",
      applied_overrides: options.routeOverrides ?? {},
      matrix: routeResolutionMatrix,
    },
    asset_resolution: {
      wrappers_root: path.relative(init.projectRoot, wrappersRoot) || ".",
      prompts_root: path.relative(init.projectRoot, promptsRoot) || ".",
      matrix: assetResolutionMatrix,
    },
    policy_resolution: {
      policies_root: path.relative(init.projectRoot, policiesRoot) || ".",
      applied_overrides: options.policyOverrides ?? {},
      matrix: policyResolutionMatrix,
    },
    evaluation_registry: {
      examples_root: path.relative(init.projectRoot, evaluationRegistry.examplesRoot) || ".",
      dataset_refs: evaluationRegistry.datasets.map((dataset) => dataset.dataset_ref),
      suite_refs: evaluationRegistry.suites.map((suite) => suite.suite_ref),
      datasets: evaluationRegistry.datasets,
      suites: evaluationRegistry.suites,
    },
    discovery_research: {
      report_id: discoveryResearchReport.report_id,
      report_ref: toEvidenceRef(init.projectRoot, discoveryResearchReportPath),
      status: discoveryResearchReport.status,
      adr_ready: discoveryResearchReport.status === "adr-ready",
      blocking: discoveryResearchReport.completeness.blocking,
      open_questions: discoveryResearchReport.open_questions,
      checks: discoveryResearchReport.completeness.checks,
      recommendation_refs: discoveryResearchReport.adr_ready_recommendations.map(
        (recommendation) => recommendation.recommendation_id,
      ),
    },
    feature_traceability: featureTraceability
      ? {
          status: featureTraceability.missionId || featureTraceability.inputPacketRef ? "pass" : "warn",
          input_packet_ref: featureTraceability.inputPacketRef,
          mission_id: featureTraceability.missionId,
          scenario_family: featureTraceability.scenarioFamily,
          provider_variant_id: featureTraceability.providerVariantId,
          feature_size: featureTraceability.featureSize,
          matrix_cell: featureTraceability.matrixCell,
          coverage_follow_up: featureTraceability.coverageFollowUp,
          request_title: featureTraceability.requestTitle,
          request_brief: featureTraceability.requestBrief,
          allowed_paths: featureTraceability.allowedPaths,
          forbidden_paths: featureTraceability.forbiddenPaths,
          expected_evidence: featureTraceability.expectedEvidence,
          change_budget: featureTraceability.changeBudget,
          source_kind: featureTraceability.sourceKind,
          product_intake: featureTraceability.productIntake,
          product_intake_completeness: featureTraceability.productIntakeCompleteness,
        }
      : null,
    repo_scope_proof: {
      topology: repoScopeProof.topology,
      repo_count: repoScopeProof.repo_count,
      repos: repoScopeProof.repos,
      repo_graph: repoScopeProof.repo_graph,
      impacted_repo_scope: repoScopeProof.impacted_repo_scope,
      per_repo_validation_evidence: repoScopeProof.per_repo_validation_evidence,
      integration_validation_refs: repoScopeProof.integration_validation_refs,
      coordination_required: repoScopeProof.coordination_required,
    },
    discovery_completeness: discoveryCompleteness,
    architecture_traceability: architectureTraceability,
    verification_plan: verificationPlan,
    status: discoveryCompleteness.blocking ? "discovery-incomplete" : "ready-for-bootstrap",
    unknown_facts: unknownFacts,
  };

  const validation = validateContractDocument({
    family: "project-analysis-report",
    document: report,
    source: "runtime://project-analysis-report",
  });

  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated analysis report failed contract validation: ${issueSummary}`);
  }

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const researchValidation = validateContractDocument({
    family: "discovery-research-report",
    document: discoveryResearchReport,
    source: "runtime://discovery-research-report",
  });

  if (!researchValidation.ok) {
    const issueSummary = researchValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated discovery research report failed contract validation: ${issueSummary}`);
  }
  fs.writeFileSync(discoveryResearchReportPath, `${JSON.stringify(discoveryResearchReport, null, 2)}\n`, "utf8");
  const routeResolutionPath = path.join(init.runtimeLayout.reportsRoot, "route-resolution-report.json");
  fs.writeFileSync(
    routeResolutionPath,
    `${JSON.stringify(
      {
        report_id: `${init.projectId}.route-resolution.v1`,
        project_id: init.projectId,
        generated_from: {
          command: "aor project analyze",
          selected_profile_ref: init.projectProfileRef,
        },
        routes_root: path.relative(init.projectRoot, routesRoot) || ".",
        applied_overrides: options.routeOverrides ?? {},
        matrix: routeResolutionMatrix,
        status: "resolved",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const assetResolutionPath = path.join(init.runtimeLayout.reportsRoot, "asset-resolution-report.json");
  fs.writeFileSync(
    assetResolutionPath,
    `${JSON.stringify(
      {
        report_id: `${init.projectId}.asset-resolution.v1`,
        project_id: init.projectId,
        generated_from: {
          command: "aor project analyze",
          selected_profile_ref: init.projectProfileRef,
        },
        wrappers_root: path.relative(init.projectRoot, wrappersRoot) || ".",
        prompts_root: path.relative(init.projectRoot, promptsRoot) || ".",
        matrix: assetResolutionMatrix,
        status: "resolved",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const policyResolutionPath = path.join(init.runtimeLayout.reportsRoot, "policy-resolution-report.json");
  fs.writeFileSync(
    policyResolutionPath,
    `${JSON.stringify(
      {
        report_id: `${init.projectId}.policy-resolution.v1`,
        project_id: init.projectId,
        generated_from: {
          command: "aor project analyze",
          selected_profile_ref: init.projectProfileRef,
        },
        policies_root: path.relative(init.projectRoot, policiesRoot) || ".",
        applied_overrides: options.policyOverrides ?? {},
        matrix: policyResolutionMatrix,
        status: "resolved",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const evaluationRegistryPath = path.join(init.runtimeLayout.reportsRoot, "evaluation-registry-report.json");
  fs.writeFileSync(
    evaluationRegistryPath,
    `${JSON.stringify(
      {
        report_id: `${init.projectId}.evaluation-registry.v1`,
        project_id: init.projectId,
        generated_from: {
          command: "aor project analyze",
          selected_profile_ref: init.projectProfileRef,
        },
        examples_root: path.relative(init.projectRoot, evaluationRegistry.examplesRoot) || ".",
        dataset_refs: evaluationRegistry.datasets.map((dataset) => dataset.dataset_ref),
        suite_refs: evaluationRegistry.suites.map((suite) => suite.suite_ref),
        datasets: evaluationRegistry.datasets,
        suites: evaluationRegistry.suites,
        issues: evaluationRegistry.issues,
        status: "resolved",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    ...init,
    reportPath,
    discoveryResearchReportPath,
    routeResolutionPath,
    assetResolutionPath,
    policyResolutionPath,
    evaluationRegistryPath,
    report,
    discoveryResearchReport,
    routeResolutionMatrix,
    assetResolutionMatrix,
    policyResolutionMatrix,
    adapterResolutionMatrix,
    evaluationRegistry,
  };
}
