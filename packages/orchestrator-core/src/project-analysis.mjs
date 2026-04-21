import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

import { initializeProjectRuntime } from "./project-init.mjs";

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
 *  cwd?: string,
 *  projectRef?: string,
 *  projectProfile?: string,
 *  runtimeRoot?: string,
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

  const report = {
    report_id: `${init.projectId}.analysis.v1`,
    project_id: init.projectId,
    version: 1,
    generated_from: {
      command: "aor project analyze",
      project_root: init.projectRoot,
      selected_profile_ref: init.projectProfileRef,
    },
    repo_facts: {
      topology: repoFacts.topology,
      package_manager: repoFacts.package_manager,
      languages: repoFacts.languages,
      ci_systems: repoFacts.ci_systems,
    },
    toolchain_facts: toolchainFacts,
    command_catalog: commandCatalog,
    service_boundaries: repoFacts.service_boundaries,
    verification_plan: verificationPlan,
    status: "ready-for-bootstrap",
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

  const reportPath = path.join(init.runtimeLayout.reportsRoot, "project-analysis-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...init,
    reportPath,
    report,
  };
}
