import fs from "node:fs";
import path from "node:path";

const IGNORED_DIR_NAMES = new Set([
  ".aor",
  ".git",
  ".hg",
  ".next",
  ".svn",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "venv",
]);
const MANIFEST_FILE_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "setup.cfg",
  "tox.ini",
  "noxfile.py",
  "pytest.ini",
  "go.mod",
  "Cargo.toml",
]);
const PHASES = Object.freeze(["baseline", "post-change"]);
const PHASE_ORDER = new Map(PHASES.map((phase, index) => [phase, index]));
const ROLE_ORDER = new Map(
  ["setup", "build", "lint", "typecheck", "test", "e2e", "full-suite", "custom"].map((role, index) => [role, index]),
);
const CONFIDENCE_RANK = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
});
const BROWSER_CONFIGS = Object.freeze([
  {
    tool: "playwright",
    role: "e2e",
    commands: {
      npm: "npx playwright test",
      pnpm: "pnpm exec playwright test",
      yarn: "yarn playwright test",
      bun: "bunx playwright test",
    },
    fileNames: [
      "playwright.config.js",
      "playwright.config.mjs",
      "playwright.config.cjs",
      "playwright.config.ts",
    ],
  },
  {
    tool: "cypress",
    role: "e2e",
    commands: {
      npm: "npx cypress run",
      pnpm: "pnpm exec cypress run",
      yarn: "yarn cypress run",
      bun: "bunx cypress run",
    },
    fileNames: ["cypress.config.js", "cypress.config.mjs", "cypress.config.cjs", "cypress.config.ts"],
  },
  {
    tool: "vitest",
    role: "test",
    commands: {
      npm: "npx vitest run",
      pnpm: "pnpm exec vitest run",
      yarn: "yarn vitest run",
      bun: "bunx vitest run",
    },
    fileNames: ["vitest.config.js", "vitest.config.mjs", "vitest.config.cjs", "vitest.config.ts"],
  },
]);

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function exists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @param {string} [fragment]
 * @returns {string}
 */
function toSourceRef(projectRoot, filePath, fragment = "") {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
  return fragment ? `${relative}#${fragment}` : relative;
}

/**
 * @param {string} projectRoot
 * @param {string} dir
 * @returns {string}
 */
function toWorkingDir(projectRoot, dir) {
  const relative = path.relative(projectRoot, dir).replace(/\\/g, "/");
  return relative.length > 0 ? relative : ".";
}

/**
 * @param {string} value
 * @returns {string}
 */
function trimHyphens(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") start += 1;
  while (end > start && value[end - 1] === "-") end -= 1;
  return value.slice(start, end);
}

/**
 * @param {string} character
 * @returns {boolean}
 */
function isIdCharacter(character) {
  if (character.length !== 1) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    character === "." ||
    character === "_" ||
    character === "-"
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function collapseInvalidIdCharacters(value) {
  let result = "";
  let inReplacementRun = false;
  for (const character of value) {
    if (isIdCharacter(character)) {
      result += character;
      inReplacementRun = false;
      continue;
    }
    if (!inReplacementRun) {
      result += "-";
      inReplacementRun = true;
    }
  }
  return result;
}

/**
 * @param {string} value
 * @returns {string}
 */
function collapsePathSeparators(value) {
  let result = "";
  let inSeparatorRun = false;
  for (const character of value) {
    if (character === "." || character === "/") {
      if (!inSeparatorRun) {
        result += "-";
        inSeparatorRun = true;
      }
      continue;
    }
    result += character;
    inSeparatorRun = false;
  }
  return result;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeIdPart(value) {
  const normalized = trimHyphens(collapseInvalidIdCharacters(value.toLowerCase()));
  if (!normalized || normalized === ".") {
    return "root";
  }
  return trimHyphens(collapsePathSeparators(normalized)) || "root";
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
 * @param {unknown[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [
    ...new Set(
      values.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()),
    ),
  ];
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function collectManifestDirs(root) {
  /** @type {Set<string>} */
  const dirs = new Set();
  /** @type {Array<{ dir: string, depth: number }>} */
  const pending = [{ dir: root, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !exists(current.dir) || current.depth > 6) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isFile() && MANIFEST_FILE_NAMES.has(entry.name)) {
        dirs.add(current.dir);
        continue;
      }
      if (entry.isDirectory() && !IGNORED_DIR_NAMES.has(entry.name)) {
        pending.push({ dir: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return [...dirs].sort((left, right) => {
    const leftRelative = path.relative(root, left);
    const rightRelative = path.relative(root, right);
    return leftRelative.localeCompare(rightRelative);
  });
}

/**
 * @param {string} filePath
 * @returns {{ document: Record<string, unknown> | null, scripts: Record<string, string> }}
 */
function loadPackageJson(filePath) {
  if (!exists(filePath)) {
    return { document: null, scripts: {} };
  }
  try {
    const document = asRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
    const scripts = asRecord(document.scripts);
    /** @type {Record<string, string>} */
    const normalizedScripts = {};
    for (const [name, value] of Object.entries(scripts)) {
      if (typeof value === "string" && value.trim().length > 0) {
        normalizedScripts[name] = value.trim();
      }
    }
    return { document, scripts: normalizedScripts };
  } catch {
    return { document: null, scripts: {} };
  }
}

/**
 * @param {string} projectRoot
 * @param {string} dir
 * @param {Record<string, unknown> | null} packageJson
 * @returns {{ packageManager: string, sourceRefs: string[], confidence: "high" | "medium" }}
 */
function resolveNodePackageManager(projectRoot, dir, packageJson) {
  const packageManagerField = typeof packageJson?.packageManager === "string" ? packageJson.packageManager.trim() : "";
  if (packageManagerField.length > 0) {
    const packageManager = packageManagerField.split("@")[0];
    if (["pnpm", "npm", "yarn", "bun"].includes(packageManager)) {
      return {
        packageManager,
        sourceRefs: [toSourceRef(projectRoot, path.join(dir, "package.json"), "packageManager")],
        confidence: "high",
      };
    }
  }

  let current = dir;
  while (true) {
    const candidates = [
      ["pnpm", "pnpm-lock.yaml"],
      ["pnpm", "pnpm-workspace.yaml"],
      ["npm", "package-lock.json"],
      ["yarn", "yarn.lock"],
      ["bun", "bun.lockb"],
      ["bun", "bun.lock"],
    ];
    for (const [packageManager, fileName] of candidates) {
      const filePath = path.join(current, fileName);
      if (exists(filePath)) {
        return {
          packageManager,
          sourceRefs: [toSourceRef(projectRoot, filePath)],
          confidence: "high",
        };
      }
    }

    if (current === projectRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    const relativeParent = path.relative(projectRoot, parent);
    if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) break;
    current = parent;
  }

  return {
    packageManager: "npm",
    sourceRefs: [toSourceRef(projectRoot, path.join(dir, "package.json"))],
    confidence: "medium",
  };
}

/**
 * @param {string} packageManager
 * @param {string} scriptName
 * @returns {string}
 */
function nodeScriptCommand(packageManager, scriptName) {
  if (packageManager === "pnpm") return `pnpm run ${scriptName}`;
  if (packageManager === "yarn") return `yarn run ${scriptName}`;
  if (packageManager === "bun") return `bun run ${scriptName}`;
  return `npm run ${scriptName}`;
}

/**
 * @param {string} scriptName
 * @param {string} scriptValue
 * @returns {"build" | "lint" | "test" | "typecheck" | "e2e" | null}
 */
function classifyNodeScript(scriptName, scriptValue) {
  const name = scriptName.toLowerCase();
  const value = scriptValue.toLowerCase();
  if (/(^|[:_-])(e2e|browser|playwright|cypress)($|[:_-])/u.test(name) || /\b(playwright|cypress)\b/u.test(value)) {
    return "e2e";
  }
  if (name === "typecheck" || name.startsWith("typecheck:") || name.includes(":typecheck") || /\btsc\b/u.test(value)) {
    return "typecheck";
  }
  if (name === "build" || name.startsWith("build:") || name.includes(":build")) {
    return "build";
  }
  if (name === "lint" || name.startsWith("lint:") || name.includes(":lint") || name.includes("codestyle")) {
    return "lint";
  }
  if (name === "test" || name.startsWith("test:") || name.includes(":test") || name.includes("unit")) {
    return "test";
  }
  return null;
}

/**
 * @param {string} role
 * @returns {"build" | "quick" | "focused-test" | "browser-e2e" | "install" | "full-suite"}
 */
function timeoutClassForRole(role) {
  if (role === "setup") return "install";
  if (role === "build" || role === "typecheck") return "build";
  if (role === "lint") return "quick";
  if (role === "e2e") return "browser-e2e";
  if (role === "full-suite") return "full-suite";
  return "focused-test";
}

/**
 * @param {Array<unknown>} existing
 * @param {Array<Record<string, unknown>>} next
 * @returns {Array<Record<string, unknown>>}
 */
function mergeToolRequirements(existing, next) {
  const byTool = new Map();
  for (const entry of [...existing, ...next]) {
    const record = asRecord(entry);
    const tool = typeof record.tool === "string" ? record.tool.trim() : "";
    if (tool.length === 0 || byTool.has(tool)) continue;
    byTool.set(tool, { ...record, tool });
  }
  return [...byTool.values()].sort((left, right) => String(left.tool).localeCompare(String(right.tool)));
}

/**
 * @param {Map<string, Record<string, unknown>>} candidates
 * @param {{
 *   repoId: string,
 *   workingDir: string,
 *   role: "build" | "lint" | "test" | "typecheck" | "e2e" | "custom",
 *   commands: string[],
 *   sourceRefs: string[],
 *   confidence: "low" | "medium" | "high",
 *   packageManager?: string,
 *   toolRequirements?: Array<Record<string, unknown>>,
 * }} options
 */
function addCommandGroupCandidate(candidates, options) {
  const commands = uniqueStrings(options.commands);
  if (commands.length === 0) return;

  for (const phase of PHASES) {
    const idParts = [phase, options.role];
    const workingDirId = normalizeIdPart(options.workingDir);
    if (workingDirId !== "root") {
      idParts.push(workingDirId);
    }
    const groupId = idParts.join("-");
    const key = `${options.repoId}:${options.workingDir}:${phase}:${options.role}`;
    const existing = candidates.get(key);
    const detectedFrom = uniqueStrings(options.sourceRefs);
    const toolRequirements = Array.isArray(options.toolRequirements) ? options.toolRequirements : [];

    if (existing) {
      const commandGroup = asRecord(existing.command_group);
      commandGroup.commands = uniqueStrings([
        ...(Array.isArray(commandGroup.commands) ? commandGroup.commands : []),
        ...commands,
      ]);
      commandGroup.detected_from = uniqueStrings([
        ...(Array.isArray(commandGroup.detected_from) ? commandGroup.detected_from : []),
        ...detectedFrom,
      ]);
      commandGroup.tool_requirements = mergeToolRequirements(
        Array.isArray(commandGroup.tool_requirements) ? commandGroup.tool_requirements : [],
        toolRequirements,
      );
      const confidence = typeof existing.confidence === "string" ? existing.confidence : "low";
      existing.confidence =
        CONFIDENCE_RANK[options.confidence] > CONFIDENCE_RANK[confidence] ? options.confidence : confidence;
      existing.source_refs = uniqueStrings([
        ...(Array.isArray(existing.source_refs) ? existing.source_refs : []),
        ...detectedFrom,
      ]);
      continue;
    }

    candidates.set(key, {
      candidate_id: groupId,
      confidence: options.confidence,
      source_refs: detectedFrom,
      command_group: {
        id: groupId,
        repo_id: options.repoId,
        working_dir: options.workingDir,
        role: options.role,
        phase,
        enforcement: "required",
        timeout_class: timeoutClassForRole(options.role),
        commands,
        detected_from: detectedFrom,
        ...(options.packageManager ? { package_manager: options.packageManager } : {}),
        ...(toolRequirements.length > 0 ? { tool_requirements: mergeToolRequirements([], toolRequirements) } : {}),
      },
    });
  }
}

/**
 * @param {Array<Record<string, unknown>>} detections
 * @param {{
 *   stack: string,
 *   kind: string,
 *   workingDir: string,
 *   confidence: "low" | "medium" | "high",
 *   sourceRefs: string[],
 * }} options
 */
function addDetection(detections, options) {
  const key = `${options.stack}:${options.kind}:${options.workingDir}`;
  const existing = detections.find((entry) => entry.key === key);
  if (existing) {
    existing.source_refs = uniqueStrings([...(Array.isArray(existing.source_refs) ? existing.source_refs : []), ...options.sourceRefs]);
    const confidence = typeof existing.confidence === "string" ? existing.confidence : "low";
    existing.confidence =
      CONFIDENCE_RANK[options.confidence] > CONFIDENCE_RANK[confidence] ? options.confidence : existing.confidence;
    return;
  }
  detections.push({
    key,
    stack: options.stack,
    kind: options.kind,
    working_dir: options.workingDir,
    confidence: options.confidence,
    source_refs: uniqueStrings(options.sourceRefs),
  });
}

/**
 * @param {Array<Record<string, unknown>>} packageBoundaries
 * @param {{ repoId: string, workingDir: string, sourceRefs: string[], stacks: string[] }} options
 */
function addPackageBoundary(packageBoundaries, options) {
  const existing = packageBoundaries.find((entry) => entry.working_dir === options.workingDir);
  if (existing) {
    existing.source_refs = uniqueStrings([
      ...(Array.isArray(existing.source_refs) ? existing.source_refs : []),
      ...options.sourceRefs,
    ]);
    existing.stacks = uniqueStrings([...(Array.isArray(existing.stacks) ? existing.stacks : []), ...options.stacks]).sort();
    return;
  }
  packageBoundaries.push({
    repo_id: options.repoId,
    working_dir: options.workingDir,
    stacks: uniqueStrings(options.stacks).sort(),
    source_refs: uniqueStrings(options.sourceRefs),
  });
}

/**
 * @param {Array<Record<string, unknown>>} outcomes
 * @param {{ workingDir: string, outcome: string, confidence: "low" | "medium" | "high", sourceRefs: string[], reason: string }} options
 */
function addOutcome(outcomes, options) {
  const key = `${options.workingDir}:${options.outcome}`;
  const existing = outcomes.find((entry) => entry.key === key);
  if (existing) {
    existing.source_refs = uniqueStrings([...(Array.isArray(existing.source_refs) ? existing.source_refs : []), ...options.sourceRefs]);
    return;
  }
  outcomes.push({
    key,
    working_dir: options.workingDir,
    outcome: options.outcome,
    confidence: options.confidence,
    source_refs: uniqueStrings(options.sourceRefs),
    reason: options.reason,
  });
}

/**
 * @param {string} projectRoot
 * @param {string} dir
 * @returns {boolean}
 */
function hasPythonTestDirectory(projectRoot, dir) {
  const testsDir = path.join(dir, "tests");
  if (!exists(testsDir)) return false;
  const pending = [{ dir: testsDir, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.depth > 2) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isFile() && /^test_.*\.py$/u.test(entry.name)) return true;
      if (entry.isDirectory() && !IGNORED_DIR_NAMES.has(entry.name) && entryPath.startsWith(projectRoot)) {
        pending.push({ dir: entryPath, depth: current.depth + 1 });
      }
    }
  }
  return false;
}

/**
 * @param {string} projectRoot
 * @param {string} dir
 * @returns {{ sourceRefs: string[], pytest: boolean, unittest: boolean, tox: boolean, nox: boolean, lint: boolean, typecheck: boolean }}
 */
function detectPythonSignals(projectRoot, dir) {
  const pyprojectPath = path.join(dir, "pyproject.toml");
  const setupCfgPath = path.join(dir, "setup.cfg");
  const pytestIniPath = path.join(dir, "pytest.ini");
  const toxPath = path.join(dir, "tox.ini");
  const noxPath = path.join(dir, "noxfile.py");
  const sourceRefs = [
    exists(pyprojectPath) ? toSourceRef(projectRoot, pyprojectPath) : null,
    exists(setupCfgPath) ? toSourceRef(projectRoot, setupCfgPath) : null,
    exists(pytestIniPath) ? toSourceRef(projectRoot, pytestIniPath) : null,
    exists(toxPath) ? toSourceRef(projectRoot, toxPath) : null,
    exists(noxPath) ? toSourceRef(projectRoot, noxPath) : null,
  ];
  const pyproject = readText(pyprojectPath);
  const setupCfg = readText(setupCfgPath);
  const testDir = hasPythonTestDirectory(projectRoot, dir);
  return {
    sourceRefs: uniqueStrings(sourceRefs),
    pytest:
      exists(pytestIniPath) ||
      /\[tool\.pytest\b/u.test(pyproject) ||
      /\[tool:pytest\b/u.test(setupCfg) ||
      /\bpytest\b/u.test(pyproject) ||
      testDir,
    unittest: testDir && !/\bpytest\b/u.test(pyproject) && !exists(pytestIniPath),
    tox: exists(toxPath),
    nox: exists(noxPath),
    lint: /\b(tool\.)?ruff\b/u.test(pyproject) || /\bflake8\b/u.test(setupCfg),
    typecheck: /\b(tool\.)?mypy\b/u.test(pyproject) || /\bmypy\b/u.test(setupCfg),
  };
}

/**
 * @param {string} packageManager
 * @param {string} tool
 * @returns {string}
 */
function browserToolCommand(packageManager, tool) {
  const config = BROWSER_CONFIGS.find((entry) => entry.tool === tool);
  if (!config) return `${tool} run`;
  return config.commands[packageManager] ?? config.commands.npm;
}

/**
 * @param {Map<string, Record<string, unknown>>} candidates
 * @returns {Set<string>}
 */
function commandRolesByWorkingDir(candidates) {
  const roles = new Set();
  for (const candidate of candidates.values()) {
    const commandGroup = asRecord(candidate.command_group);
    roles.add(`${commandGroup.working_dir}:${commandGroup.role}`);
  }
  return roles;
}

/**
 * @param {Record<string, unknown>} candidate
 * @returns {Record<string, unknown>}
 */
function withoutInternalKeys(candidate) {
  const cleaned = { ...candidate };
  delete cleaned.key;
  cleaned.command_group = asRecord(cleaned.command_group);
  return cleaned;
}

/**
 * @param {{
 *   projectRoot: string,
 *   repoId?: string,
 * }} options
 * @returns {{
 *   project_root: string,
 *   package_boundaries: Array<Record<string, unknown>>,
 *   detections: Array<Record<string, unknown>>,
 *   command_group_candidates: Array<Record<string, unknown>>,
 *   outcomes: Array<Record<string, unknown>>,
 *   suggestions: Array<Record<string, unknown>>,
 * }}
 */
export function discoverVerificationCommandGroups(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const repoId = typeof options.repoId === "string" && options.repoId.trim().length > 0 ? options.repoId.trim() : "main";
  if (!exists(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Invalid project root '${options.projectRoot}'.`);
  }

  /** @type {Array<Record<string, unknown>>} */
  const detections = [];
  /** @type {Array<Record<string, unknown>>} */
  const packageBoundaries = [];
  /** @type {Array<Record<string, unknown>>} */
  const outcomes = [];
  /** @type {Array<Record<string, unknown>>} */
  const suggestions = [];
  /** @type {Map<string, Record<string, unknown>>} */
  const candidates = new Map();

  const manifestDirs = collectManifestDirs(projectRoot);
  for (const dir of manifestDirs) {
    const workingDir = toWorkingDir(projectRoot, dir);
    /** @type {string[]} */
    const boundarySources = [];
    /** @type {string[]} */
    const stacks = [];

    const packageJsonPath = path.join(dir, "package.json");
    const { document: packageJson, scripts } = loadPackageJson(packageJsonPath);
    if (packageJson) {
      const packageManager = resolveNodePackageManager(projectRoot, dir, packageJson);
      const sourceRefs = uniqueStrings([toSourceRef(projectRoot, packageJsonPath), ...packageManager.sourceRefs]);
      boundarySources.push(...sourceRefs);
      stacks.push("node");
      addDetection(detections, {
        stack: "node",
        kind: "package",
        workingDir,
        confidence: packageManager.confidence,
        sourceRefs,
      });

      for (const [scriptName, scriptValue] of Object.entries(scripts)) {
        const role = classifyNodeScript(scriptName, scriptValue);
        if (!role) continue;
        addCommandGroupCandidate(candidates, {
          repoId,
          workingDir,
          role,
          commands: [nodeScriptCommand(packageManager.packageManager, scriptName)],
          sourceRefs: [toSourceRef(projectRoot, packageJsonPath, `scripts.${scriptName}`), ...packageManager.sourceRefs],
          confidence: "high",
          packageManager: packageManager.packageManager,
          toolRequirements: [{ tool: packageManager.packageManager }],
        });
      }

      for (const config of BROWSER_CONFIGS) {
        const configPath = config.fileNames.map((fileName) => path.join(dir, fileName)).find((filePath) => exists(filePath));
        if (!configPath) continue;
        const sourceRefsForConfig = [toSourceRef(projectRoot, configPath), ...packageManager.sourceRefs];
        addDetection(detections, {
          stack: "frontend-browser",
          kind: config.tool,
          workingDir,
          confidence: "high",
          sourceRefs: sourceRefsForConfig,
        });
        addCommandGroupCandidate(candidates, {
          repoId,
          workingDir,
          role: /** @type {"test" | "e2e"} */ (config.role),
          commands: [browserToolCommand(packageManager.packageManager, config.tool)],
          sourceRefs: sourceRefsForConfig,
          confidence: "high",
          packageManager: packageManager.packageManager,
          toolRequirements: [{ tool: packageManager.packageManager }, { tool: config.tool }],
        });
      }
    }

    const pythonSignals = detectPythonSignals(projectRoot, dir);
    if (pythonSignals.sourceRefs.length > 0) {
      boundarySources.push(...pythonSignals.sourceRefs);
      stacks.push("python");
      addDetection(detections, {
        stack: "python",
        kind: "project",
        workingDir,
        confidence: "high",
        sourceRefs: pythonSignals.sourceRefs,
      });
      if (pythonSignals.pytest) {
        addCommandGroupCandidate(candidates, {
          repoId,
          workingDir,
          role: "test",
          commands: ["python -m pytest"],
          sourceRefs: pythonSignals.sourceRefs,
          confidence: "high",
          toolRequirements: [{ tool: "python" }, { tool: "pytest" }],
        });
      } else if (pythonSignals.unittest) {
        addCommandGroupCandidate(candidates, {
          repoId,
          workingDir,
          role: "test",
          commands: ["python -m unittest discover"],
          sourceRefs: pythonSignals.sourceRefs,
          confidence: "medium",
          toolRequirements: [{ tool: "python" }],
        });
      }
      if (pythonSignals.tox) {
        addCommandGroupCandidate(candidates, {
          repoId,
          workingDir,
          role: "test",
          commands: ["python -m tox"],
          sourceRefs: pythonSignals.sourceRefs,
          confidence: "high",
          toolRequirements: [{ tool: "python" }, { tool: "tox" }],
        });
      }
      if (pythonSignals.nox) {
        addCommandGroupCandidate(candidates, {
          repoId,
          workingDir,
          role: "test",
          commands: ["python -m nox"],
          sourceRefs: pythonSignals.sourceRefs,
          confidence: "high",
          toolRequirements: [{ tool: "python" }, { tool: "nox" }],
        });
      }
      if (pythonSignals.lint) {
        addCommandGroupCandidate(candidates, {
          repoId,
          workingDir,
          role: "lint",
          commands: ["python -m ruff check ."],
          sourceRefs: pythonSignals.sourceRefs,
          confidence: "medium",
          toolRequirements: [{ tool: "python" }, { tool: "ruff" }],
        });
      }
      if (pythonSignals.typecheck) {
        addCommandGroupCandidate(candidates, {
          repoId,
          workingDir,
          role: "typecheck",
          commands: ["python -m mypy ."],
          sourceRefs: pythonSignals.sourceRefs,
          confidence: "medium",
          toolRequirements: [{ tool: "python" }, { tool: "mypy" }],
        });
      }
    }

    const goModPath = path.join(dir, "go.mod");
    if (exists(goModPath)) {
      const sourceRefs = [toSourceRef(projectRoot, goModPath)];
      boundarySources.push(...sourceRefs);
      stacks.push("go");
      addDetection(detections, {
        stack: "go",
        kind: "module",
        workingDir,
        confidence: "high",
        sourceRefs,
      });
      addCommandGroupCandidate(candidates, {
        repoId,
        workingDir,
        role: "test",
        commands: ["go test ./..."],
        sourceRefs,
        confidence: "high",
        toolRequirements: [{ tool: "go" }],
      });
      addCommandGroupCandidate(candidates, {
        repoId,
        workingDir,
        role: "build",
        commands: ["go build ./..."],
        sourceRefs,
        confidence: "medium",
        toolRequirements: [{ tool: "go" }],
      });
    }

    const cargoPath = path.join(dir, "Cargo.toml");
    if (exists(cargoPath)) {
      const sourceRefs = [toSourceRef(projectRoot, cargoPath)];
      const cargoText = readText(cargoPath);
      boundarySources.push(...sourceRefs);
      stacks.push("rust");
      addDetection(detections, {
        stack: "rust",
        kind: /\[workspace\]/u.test(cargoText) ? "workspace" : "crate",
        workingDir,
        confidence: "high",
        sourceRefs,
      });
      addCommandGroupCandidate(candidates, {
        repoId,
        workingDir,
        role: "test",
        commands: ["cargo test"],
        sourceRefs,
        confidence: "high",
        toolRequirements: [{ tool: "cargo" }],
      });
      addCommandGroupCandidate(candidates, {
        repoId,
        workingDir,
        role: "build",
        commands: ["cargo build"],
        sourceRefs,
        confidence: "medium",
        toolRequirements: [{ tool: "cargo" }],
      });
    }

    if (stacks.length > 0) {
      addPackageBoundary(packageBoundaries, {
        repoId,
        workingDir,
        stacks,
        sourceRefs: boundarySources,
      });
    }
  }

  const rolesByWorkingDir = commandRolesByWorkingDir(candidates);
  for (const boundary of packageBoundaries) {
    const workingDir = typeof boundary.working_dir === "string" ? boundary.working_dir : ".";
    const hasTestLikeCommand = rolesByWorkingDir.has(`${workingDir}:test`) || rolesByWorkingDir.has(`${workingDir}:e2e`);
    if (!hasTestLikeCommand) {
      addOutcome(outcomes, {
        workingDir,
        outcome: "no-tests",
        confidence: "medium",
        sourceRefs: Array.isArray(boundary.source_refs) ? boundary.source_refs : [],
        reason: "No test or browser verification command was discovered for this package boundary.",
      });
    }
  }

  if (packageBoundaries.length === 0 && candidates.size === 0) {
    addOutcome(outcomes, {
      workingDir: ".",
      outcome: "no-tests",
      confidence: "low",
      sourceRefs: [],
      reason: "No recognized project manifest or verification command signal was discovered.",
    });
    suggestions.push({
      suggestion_id: "custom-verification-needed",
      kind: "custom",
      working_dir: ".",
      confidence: "low",
      source_refs: [],
      reason: "Add verification.command_groups manually when this repository has project-specific checks.",
    });
  }

  return {
    project_root: projectRoot,
    package_boundaries: packageBoundaries
      .map((entry) => {
        const cleaned = { ...entry };
        delete cleaned.key;
        return cleaned;
      })
      .sort((left, right) => String(left.working_dir).localeCompare(String(right.working_dir))),
    detections: detections
      .map((entry) => {
        const cleaned = { ...entry };
        delete cleaned.key;
        return cleaned;
      })
      .sort((left, right) =>
        `${left.working_dir}:${left.stack}:${left.kind}`.localeCompare(`${right.working_dir}:${right.stack}:${right.kind}`),
      ),
    command_group_candidates: [...candidates.values()]
      .map((candidate) => withoutInternalKeys(candidate))
      .sort((left, right) => {
        const leftGroup = asRecord(left.command_group);
        const rightGroup = asRecord(right.command_group);
        const workingDirCompare = String(leftGroup.working_dir).localeCompare(String(rightGroup.working_dir));
        if (workingDirCompare !== 0) return workingDirCompare;
        const phaseCompare =
          (PHASE_ORDER.get(String(leftGroup.phase)) ?? 999) - (PHASE_ORDER.get(String(rightGroup.phase)) ?? 999);
        if (phaseCompare !== 0) return phaseCompare;
        return (ROLE_ORDER.get(String(leftGroup.role)) ?? 999) - (ROLE_ORDER.get(String(rightGroup.role)) ?? 999);
      }),
    outcomes: outcomes
      .map((entry) => {
        const cleaned = { ...entry };
        delete cleaned.key;
        return cleaned;
      })
      .sort((left, right) => `${left.working_dir}:${left.outcome}`.localeCompare(`${right.working_dir}:${right.outcome}`)),
    suggestions,
  };
}
