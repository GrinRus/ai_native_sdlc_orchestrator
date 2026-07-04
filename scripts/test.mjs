#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const privateHarnessName = ["live", "e2e"].join("-");
const privateHarnessTimeoutEnv = ["AOR", "LIVE", "E2E", "TEST", "SUITE", "TIMEOUT", "MS"].join("_");
const privateHarnessContextEnv = ["AOR", "PROOF", "RUNNER", "TEST", "CONTEXT", "FILE"].join("_");
const productionProofFixturePath = path.posix.join(
  "scripts",
  "production-readiness",
  "fixtures",
  "w25-s03-production-proof.json",
);
const executableProofEvidencePattern = new RegExp(
  [
    "proof",
    "overall_status=pass",
    "real_code_change_proof_complete=true",
    "external_runner_mode=real-external-process",
    escapeRegExp(productionProofFixturePath),
  ].join("|"),
  "iu",
);
const privateHarnessTestSuiteTimeoutMs = parsePositiveInteger(
  process.env[privateHarnessTimeoutEnv],
  20 * 60 * 1000,
);
const privateHarnessContextFile = path.join(
  os.tmpdir(),
  ["aor", privateHarnessName, "test-context", String(process.pid)].join("-"),
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function isTimedOutRun(run) {
  return run.error?.code === "ETIMEDOUT" || run.signal === "SIGTERM" || run.signal === "SIGKILL";
}

function removeFileIfExists(filePath) {
  fs.rmSync(filePath, { force: true });
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function printPrivateHarnessTimeoutDiagnostic(run, testFiles) {
  if (!isTimedOutRun(run)) return;

  const context = readJsonIfExists(privateHarnessContextFile);
  const contextParts =
    context && typeof context === "object"
      ? [
          `state=${String(context.state ?? "unknown")}`,
          `test_file=${String(context.test_file ?? "unknown")}`,
          `profile=${String(context.profile ?? "unknown")}`,
          `run_id=${String(context.run_id ?? "unknown")}`,
          `subprocess_timeout_ms=${String(context.timeout_ms ?? "unknown")}`,
        ]
      : ["no private rehearsal subprocess context file was available"];

  console.error(
    [
      `private rehearsal test suite timed out after ${privateHarnessTestSuiteTimeoutMs}ms; failing closed.`,
      `test_files=${testFiles.map((file) => path.relative(root, file)).join(", ")}`,
      `signal=${String(run.signal)}`,
      run.error ? `error=${run.error.message}` : "",
      `last_context=${contextParts.join("; ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function discoverWaveFiles() {
  const backlogDir = path.join(root, "docs/backlog");
  const entries = fs
    .readdirSync(backlogDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .map((name) => {
      const match = /^wave-(\d+)-implementation-slices\.md$/.exec(name);
      if (!match) return null;
      return {
        waveIndex: Number(match[1]),
        name,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.waveIndex !== b.waveIndex) return a.waveIndex - b.waveIndex;
      return a.name.localeCompare(b.name);
    });

  if (entries.length === 0) {
    console.error("Could not find any wave implementation documents under docs/backlog/.");
    process.exit(1);
  }

  if (entries[0].waveIndex !== 0) {
    console.error("Wave documents must start at wave-0-implementation-slices.md.");
    process.exit(1);
  }

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (current.waveIndex !== previous.waveIndex + 1) {
      console.error(`Wave numbering gap detected between ${previous.name} and ${current.name}.`);
      process.exit(1);
    }
  }

  return entries.map((entry) => path.posix.join("docs/backlog", entry.name));
}

const waveFiles = discoverWaveFiles();
const latestWaveIndex = Math.max(
  ...waveFiles.map((file) => {
    const match = /^wave-(\d+)-implementation-slices\.md$/.exec(path.basename(file));
    return match ? Number(match[1]) : Number.NEGATIVE_INFINITY;
  }),
);
const latestWaveLabel = `W${latestWaveIndex}`;
const latestWaveFileName = `wave-${latestWaveIndex}-implementation-slices.md`;

function parseWaveSlices(content) {
  const regex = /^## (W\d+-S\d+) — .+$/gm;
  const matches = [...content.matchAll(regex)];
  const sections = new Map();

  for (let i = 0; i < matches.length; i += 1) {
    const id = matches[i][1];
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length;
    const section = content.slice(start, end);

    const stateMatch = section.match(/^- \*\*State:\*\* (ready|blocked|active|done)\s*$/m);
    if (!stateMatch) {
      console.error(`Slice ${id} is missing a valid '- **State:** <state>' line.`);
      process.exit(1);
    }

    const depsMatch = section.match(/^- \*\*Hard dependencies:\*\* (.+)\s*$/m);
    if (!depsMatch) {
      console.error(`Slice ${id} is missing '- **Hard dependencies:** ...'.`);
      process.exit(1);
    }

    const hardDependencies =
      depsMatch[1].trim().toLowerCase() === "none"
        ? []
        : depsMatch[1]
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);

    sections.set(id, {
      section,
      state: stateMatch[1],
      hardDependencies,
    });
  }

  return sections;
}

const waveSectionMap = new Map();
for (const file of waveFiles) {
  const content = read(file);
  const sections = parseWaveSlices(content);
  for (const [id, sectionData] of sections.entries()) {
    if (waveSectionMap.has(id)) {
      console.error(`Duplicate slice id found in wave docs: ${id}`);
      process.exit(1);
    }
    const section = sectionData.section;
    for (const heading of ["### Local tasks", "### Acceptance criteria", "### Done evidence", "### Out of scope"]) {
      if (!section.includes(heading)) {
        console.error(`Slice ${id} is missing required section '${heading}'.`);
        process.exit(1);
      }
    }
    waveSectionMap.set(id, sectionData);
  }
}

const waveSliceIds = [...waveSectionMap.keys()].sort();

const masterBacklog = read("docs/backlog/mvp-implementation-backlog.md");
const masterSliceIds = [...masterBacklog.matchAll(/^\| (W\d+-S\d+) \|/gm)].map((match) => match[1]);
const uniqueMasterSliceIds = [...new Set(masterSliceIds)].sort();
const masterRows = [...masterBacklog.matchAll(/^\| (W\d+-S\d+) \| ([^|]+) \| ([^|]+) \| (ready|blocked|active|done) \| ([^|]+) \| ([^|]+) \|$/gm)];
const masterSliceMap = new Map();
for (const row of masterRows) {
  const sliceId = row[1];
  const state = row[4];
  const depCell = row[6].trim();
  const hardDependencies =
    depCell.toLowerCase() === "none"
      ? []
      : depCell
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

  masterSliceMap.set(sliceId, {
    state,
    hardDependencies,
  });
}

const epicMap = read("docs/backlog/orchestrator-epics.md");
const epicSliceIds = [...epicMap.matchAll(/`(W\d+-S\d+)`/gm)].map((match) => match[1]);
const uniqueEpicSliceIds = [...new Set(epicSliceIds)].sort();

const depGraph = read("docs/backlog/slice-dependency-graph.md");
const depSliceIds = [...depGraph.matchAll(/^\| (W\d+-S\d+) \|/gm)].map((match) => match[1]);
const uniqueDepSliceIds = [...new Set(depSliceIds)].sort();

function sameSet(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function assertLatestWaveSourceOfTruth() {
  const requiredLatestWaveDocs = [
    "README.md",
    "docs/backlog/backlog-operating-model.md",
    "docs/backlog/mvp-roadmap.md",
    "docs/backlog/mvp-implementation-backlog.md",
    "docs/backlog/orchestrator-epics.md",
    "docs/backlog/slice-dependency-graph.md",
  ];

  for (const file of requiredLatestWaveDocs) {
    const content = read(file);
    if (!content.includes(latestWaveLabel) && !content.includes(latestWaveFileName)) {
      console.error(`${file} must reference latest defined wave ${latestWaveLabel}.`);
      process.exit(1);
    }
  }

  if (latestWaveIndex > 11) {
    const staleClaimFiles = ["README.md", "docs/backlog/backlog-operating-model.md"];
    for (const file of staleClaimFiles) {
      const content = read(file);
      if (/\bthrough\s+(?:wave\s*)?W?11\b/iu.test(content)) {
        console.error(`${file} contains a stale planning-coverage claim through W11.`);
        process.exit(1);
      }
    }
  }

  const operatingModel = read("docs/backlog/backlog-operating-model.md");
  const currentCoverageHeading = /^## Current planning coverage\s*$/m.exec(operatingModel);
  if (currentCoverageHeading) {
    const sectionStart = currentCoverageHeading.index + currentCoverageHeading[0].length;
    const sectionTail = operatingModel.slice(sectionStart);
    const nextSectionIndex = sectionTail.search(/\n##\s+/);
    const currentCoverageSection =
      nextSectionIndex >= 0 ? sectionTail.slice(0, nextSectionIndex) : sectionTail;
    if (!currentCoverageSection.includes(latestWaveLabel)) {
      console.error(`docs/backlog/backlog-operating-model.md current planning coverage must mention ${latestWaveLabel}.`);
      process.exit(1);
    }
  } else {
    console.error(`docs/backlog/backlog-operating-model.md current planning coverage must mention ${latestWaveLabel}.`);
    process.exit(1);
  }

  const roadmap = read("docs/backlog/mvp-roadmap.md");
  const roadmapWaveRangeMatch = /wave-0-implementation-slices\.md` through `docs\/backlog\/wave-(\d+)-implementation-slices\.md`/u.exec(
    roadmap,
  );
  if (roadmapWaveRangeMatch && Number(roadmapWaveRangeMatch[1]) !== latestWaveIndex) {
    console.error(`docs/backlog/mvp-roadmap.md wave document range must end at ${latestWaveFileName}.`);
    process.exit(1);
  }

  console.log(`source-of-truth latest-wave checks ok: ${latestWaveLabel}`);
}

function collectProofChangedPaths(proof) {
  return [
    ...(Array.isArray(proof.changed_paths) ? proof.changed_paths : []),
    ...(Array.isArray(proof.no_upstream_write_assertion?.changed_paths)
      ? proof.no_upstream_write_assertion.changed_paths
      : []),
    ...(Array.isArray(proof.evidence?.runtime_harness?.meaningful_changed_paths)
      ? proof.evidence.runtime_harness.meaningful_changed_paths
      : []),
  ];
}

function validateProofBundleIntegrity(proof, bundlePath) {
  const errors = [];
  const externalRunnerMode = String(proof.proof_method?.external_runner_mode ?? "");

  if (proof.proof_scope === "coverage_with_findings" && !externalRunnerMode.includes("mock")) {
    errors.push(`${bundlePath} is coverage_with_findings but does not record a mock external runner mode.`);
  }

  if (proof.proof_scope === "full_code_changing_runtime") {
    if (proof.real_code_change_proof_complete !== true) {
      errors.push(`${bundlePath} claims full_code_changing_runtime without real_code_change_proof_complete=true.`);
    }
    if (externalRunnerMode.includes("mock")) {
      errors.push(`${bundlePath} claims full_code_changing_runtime but records a mock external runner mode.`);
    }
    if (externalRunnerMode !== "real-external-process") {
      errors.push(`${bundlePath} claims full_code_changing_runtime without external_runner_mode=real-external-process.`);
    }
    if (proof.proof_method?.mock_runner_allowed === true) {
      errors.push(`${bundlePath} claims full_code_changing_runtime while allowing a mock runner.`);
    }
    if (proof.proof_method?.examples_root_override) {
      errors.push(`${bundlePath} claims full_code_changing_runtime while using an examples_root_override.`);
    }

    const noUpstreamWrite = proof.no_upstream_write_assertion ?? {};
    if (noUpstreamWrite.status !== "pass") {
      errors.push(`${bundlePath} claims full_code_changing_runtime without no_upstream_write_assertion.status=pass.`);
    }
    if (noUpstreamWrite.write_back_to_remote === true) {
      errors.push(`${bundlePath} claims full_code_changing_runtime but allows write_back_to_remote.`);
    }
    if (noUpstreamWrite.target_head_unchanged !== true) {
      errors.push(`${bundlePath} claims full_code_changing_runtime without target_head_unchanged=true.`);
    }
    if (Array.isArray(noUpstreamWrite.commit_refs) && noUpstreamWrite.commit_refs.length > 0) {
      errors.push(`${bundlePath} claims full_code_changing_runtime but records upstream commit refs.`);
    }

    const changedPaths = collectProofChangedPaths(proof);
    if (changedPaths.length === 0) {
      errors.push(`${bundlePath} claims full_code_changing_runtime without meaningful implementation changed paths.`);
    }
    for (const changedPath of changedPaths) {
      if (path.isAbsolute(changedPath) || changedPath.startsWith(".aor/") || changedPath.includes("/.aor/")) {
        errors.push(`${bundlePath} records a runtime or absolute changed path: ${changedPath}`);
      }
    }

    const serializedProof = JSON.stringify(proof);
    const forbiddenPatterns = [
      { pattern: /\/Users\//u, label: "local absolute path" },
      { pattern: /\.aor\/projects/u, label: "runtime project path" },
      { pattern: /target-checkouts/u, label: "target checkout path" },
      { pattern: /ctx7sk-[A-Za-z0-9_-]+/u, label: "Context7 token" },
      { pattern: /sk-[A-Za-z0-9_-]{10,}/u, label: "API secret" },
    ];
    for (const { pattern, label } of forbiddenPatterns) {
      if (pattern.test(serializedProof)) {
        errors.push(`${bundlePath} contains ${label}; production proof fixtures must be sanitized.`);
      }
    }
  }

  return errors;
}

function assertProofBundleIntegrity() {
  const bundlePaths = [productionProofFixturePath];

  for (const bundlePath of bundlePaths) {
    const proof = JSON.parse(read(bundlePath));
    const errors = validateProofBundleIntegrity(proof, bundlePath);
    if (errors.length > 0) {
      for (const error of errors) console.error(error);
      process.exit(1);
    }
  }

  const mockBackedFullRuntimeClaim = {
    fixture_id: "negative.mock-backed-full-runtime-claim",
    proof_scope: "full_code_changing_runtime",
    real_code_change_proof_complete: true,
    proof_method: {
      external_runner_mode: "deterministic-external-process-mock",
      mock_runner_allowed: true,
      examples_root_override: "fixture://negative/mock-backed-full-runtime-claim",
    },
    targets: [
      {
        overall_status: "pass",
      },
    ],
    changed_paths: ["source/utils/merge.ts"],
    no_upstream_write_assertion: {
      status: "pass",
      write_back_to_remote: false,
      target_head_unchanged: true,
      commit_refs: [],
      changed_paths: ["source/utils/merge.ts"],
    },
  };
  const negativeErrors = validateProofBundleIntegrity(
    mockBackedFullRuntimeClaim,
    "fixture://negative/mock-backed-full-runtime-claim",
  );
  if (!negativeErrors.some((error) => error.includes("mock"))) {
    console.error("Proof integrity negative check did not reject a mock-backed full_code_changing_runtime claim.");
    process.exit(1);
  }

  const scopes = bundlePaths.map((bundlePath) => `${path.basename(bundlePath)}=${JSON.parse(read(bundlePath)).proof_scope}`);
  console.log(`proof integrity ok: ${scopes.join(", ")}`);
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;
  let inCodeSpan = false;

  for (const char of inner) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "`") {
      inCodeSpan = !inCodeSpan;
      current += char;
      continue;
    }

    if (char === "|" && !inCodeSpan) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeMarkdownInline(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDelimitedMarkdownList(cell, delimiter) {
  const normalized = normalizeMarkdownInline(cell);
  if (!normalized || normalized.toLowerCase() === "none") {
    return [];
  }

  return normalized
    .split(delimiter)
    .map((item) => normalizeMarkdownInline(item))
    .filter(Boolean);
}

function assertArrayExact(label, command, documented, expected) {
  if (JSON.stringify(documented) === JSON.stringify(expected)) {
    return;
  }

  const missing = expected.filter((item) => !documented.includes(item));
  const extra = documented.filter((item) => !expected.includes(item));
  const firstMismatchIndex = documented.findIndex((item, index) => item !== expected[index]);
  const orderDetail =
    missing.length === 0 && extra.length === 0 && firstMismatchIndex >= 0
      ? ` First order mismatch at index ${firstMismatchIndex}: documented '${documented[firstMismatchIndex]}', actual '${expected[firstMismatchIndex]}'.`
      : "";
  console.error(
    `${label} mismatch for '${command}': missing [${missing.join(", ")}], extra [${extra.join(", ")}].${orderDetail}`,
  );
  process.exit(1);
}

function parseCliCommandCatalogDocumentation() {
  const catalog = read("docs/architecture/14-cli-command-catalog.md");
  const rows = new Map();

  for (const line of catalog.split("\n")) {
    if (!/^\| `aor /.test(line)) {
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    const commandMatch = /^`aor (.+)`$/.exec(cells[0] ?? "");
    if (!commandMatch || cells.length !== 5) {
      console.error(`Malformed CLI command catalog row: ${line}`);
      process.exit(1);
    }

    rows.set(commandMatch[1], {
      status: normalizeMarkdownInline(cells[1]),
      inputs: parseDelimitedMarkdownList(cells[2], ";"),
      outputs: parseDelimitedMarkdownList(cells[3], ","),
      contractFamilies: parseDelimitedMarkdownList(cells[4], ","),
    });
  }

  return rows;
}

function assertCliCommandCatalogDocumentation(commandCatalogModule) {
  const documentedRows = parseCliCommandCatalogDocumentation();
  const implementedCommands = commandCatalogModule.getImplementedCommands();
  const implementedCommandNames = implementedCommands.map((definition) => definition.command);

  assertArrayExact(
    "CLI command catalog row order",
    "docs/architecture/14-cli-command-catalog.md",
    [...documentedRows.keys()],
    implementedCommandNames,
  );

  for (const definition of implementedCommands) {
    const documented = documentedRows.get(definition.command);
    if (!documented) {
      console.error(`docs/architecture/14-cli-command-catalog.md is missing '${definition.command}'.`);
      process.exit(1);
    }

    if (documented.status !== definition.status) {
      console.error(
        `Status mismatch for '${definition.command}': documented '${documented.status}', actual '${definition.status}'.`,
      );
      process.exit(1);
    }

    assertArrayExact(
      "CLI command inputs",
      definition.command,
      documented.inputs,
      definition.inputs.filter((input) => input !== "--help").map(normalizeMarkdownInline),
    );
    assertArrayExact(
      "CLI command outputs",
      definition.command,
      documented.outputs,
      definition.outputs.map(normalizeMarkdownInline),
    );
    assertArrayExact(
      "CLI command contract families",
      definition.command,
      documented.contractFamilies,
      definition.contractFamilies.map(normalizeMarkdownInline),
    );
  }

  console.log(`CLI command catalog docs ok: ${implementedCommands.length} implemented command rows aligned.`);
}

function parseContractLoaderCoverageDocumentation() {
  const coverage = read("docs/contracts/contract-loader-coverage.md");
  const rows = new Map();

  for (const line of coverage.split("\n")) {
    if (!/^\|[^|]+\| `[^`]+\.md` \| `[^`]+` \|/.test(line)) {
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    if (cells.length !== 6) {
      console.error(`Malformed contract loader coverage row: ${line}`);
      process.exit(1);
    }

    const family = normalizeMarkdownInline(cells[2]);
    rows.set(family, {
      familyGroup: normalizeMarkdownInline(cells[0]),
      sourceContract: normalizeMarkdownInline(cells[1]),
      exampleGlob: normalizeMarkdownInline(cells[3]),
      status: normalizeMarkdownInline(cells[4]),
    });
  }

  return rows;
}

function assertContractLoaderCoverageDocumentation(familyIndex) {
  const groupLabels = {
    "core-packets-and-profiles": "Core packets and profiles",
    "execution-and-quality": "Execution and quality",
    "platform-assets": "Platform assets",
    operations: "Operations",
  };
  const documentedRows = parseContractLoaderCoverageDocumentation();
  const familyNames = familyIndex.map((entry) => entry.family);

  assertArrayExact(
    "contract loader coverage row order",
    "docs/contracts/contract-loader-coverage.md",
    [...documentedRows.keys()],
    familyNames,
  );

  for (const entry of familyIndex) {
    const documented = documentedRows.get(entry.family);
    if (!documented) {
      console.error(`docs/contracts/contract-loader-coverage.md is missing '${entry.family}'.`);
      process.exit(1);
    }

    const expected = {
      familyGroup: groupLabels[entry.familyGroup] ?? entry.familyGroup,
      sourceContract: path.basename(entry.sourceContract),
      exampleGlob: entry.exampleGlob,
      status: entry.status,
    };

    for (const [field, expectedValue] of Object.entries(expected)) {
      if (documented[field] !== expectedValue) {
        console.error(
          `Contract loader coverage mismatch for '${entry.family}' field '${field}': documented '${documented[field]}', actual '${expectedValue}'.`,
        );
        process.exit(1);
      }
    }
  }

  console.log(`contract loader coverage docs ok: ${familyIndex.length} contract families aligned.`);
}

const userStoryFamilies = [
  {
    prefix: "PSO",
    roleCluster: "Product sponsor / owner",
    total: 8,
    tierCounts: { MVP: 6, "MVP+": 1, Later: 1 },
  },
  {
    prefix: "DIS",
    roleCluster: "Discovery / research",
    total: 8,
    tierCounts: { MVP: 6, "MVP+": 1, Later: 1 },
  },
  {
    prefix: "ARC",
    roleCluster: "Architect / tech lead",
    total: 8,
    tierCounts: { MVP: 5, "MVP+": 2, Later: 1 },
  },
  {
    prefix: "EMP",
    roleCluster: "Engineering manager / planner",
    total: 8,
    tierCounts: { MVP: 6, "MVP+": 1, Later: 1 },
  },
  {
    prefix: "DEV",
    roleCluster: "Delivery engineer",
    total: 10,
    tierCounts: { MVP: 7, "MVP+": 2, Later: 1 },
  },
  {
    prefix: "RQA",
    roleCluster: "Reviewer / QA",
    total: 6,
    tierCounts: { MVP: 4, "MVP+": 1, Later: 1 },
  },
  {
    prefix: "AIP",
    roleCluster: "AI platform owner",
    total: 12,
    tierCounts: { MVP: 6, "MVP+": 4, Later: 2 },
  },
  {
    prefix: "OPS",
    roleCluster: "Operator / SRE",
    total: 11,
    tierCounts: { MVP: 9, "MVP+": 1, Later: 1 },
  },
  {
    prefix: "SEC",
    roleCluster: "Security / compliance",
    total: 6,
    tierCounts: { MVP: 4, "MVP+": 1, Later: 1 },
  },
  {
    prefix: "RMO",
    roleCluster: "Repository / multirepo owner",
    total: 6,
    tierCounts: { MVP: 4, "MVP+": 1, Later: 1 },
  },
  {
    prefix: "INC",
    roleCluster: "Incident / improvement owner",
    total: 6,
    tierCounts: { MVP: 3, "MVP+": 2, Later: 1 },
  },
  {
    prefix: "PBO",
    roleCluster: "Project bootstrap / onboarding",
    total: 9,
    tierCounts: { MVP: 6, "MVP+": 2, Later: 1 },
  },
  {
    prefix: "DTX",
    roleCluster: "Delivery transaction / Git / PR",
    total: 8,
    tierCounts: { MVP: 5, "MVP+": 2, Later: 1 },
  },
  {
    prefix: "FIN",
    roleCluster: "Finance / audit / hygiene",
    total: 8,
    tierCounts: { MVP: 4, "MVP+": 3, Later: 1 },
  },
];

const validStoryTiers = new Set(["MVP", "MVP+", "Later"]);
const validCoverageStatuses = new Set(["baseline-covered", "proof-covered", "partial", "blocked"]);
const coveredCoverageStatuses = new Set(["baseline-covered", "proof-covered"]);

function hasExplicitExternalBlocker(row) {
  return (
    row.coverageStatus === "blocked" &&
    row.gapSlices.length === 0 &&
    /(outside .*scope|out of scope|future|external prerequisite|not in scope)/iu.test(row.evidence)
  );
}

function parseUserStoryCoverageMatrixDocumentation() {
  const matrix = read("docs/product/user-story-coverage-matrix.md");
  const rows = new Map();

  for (const line of matrix.split("\n")) {
    if (!/^\| [A-Z]{3}-\d{2} \|/.test(line)) {
      continue;
    }

    const cells = splitMarkdownTableRow(line);
    if (cells.length !== 7) {
      console.error(`Malformed user-story coverage row: ${line}`);
      process.exit(1);
    }

    const [storyId, roleCluster, tier, outcome, coverageStatus, evidence, gapSliceCell] = cells.map(
      normalizeMarkdownInline,
    );

    if (rows.has(storyId)) {
      console.error(`Duplicate user-story id found in coverage matrix: ${storyId}`);
      process.exit(1);
    }

    rows.set(storyId, {
      storyId,
      roleCluster,
      tier,
      outcome,
      coverageStatus,
      evidence,
      gapSlices: parseDelimitedMarkdownList(gapSliceCell, ","),
    });
  }

  return rows;
}

function assertUserStoryCoverageMatrixDocumentation() {
  const supportedStories = read("docs/product/00-supported-user-stories.md");
  if (!supportedStories.includes("docs/product/user-story-coverage-matrix.md")) {
    console.error("docs/product/00-supported-user-stories.md must reference the user story coverage matrix.");
    process.exit(1);
  }

  const rows = parseUserStoryCoverageMatrixDocumentation();
  const expectedTotal = userStoryFamilies.reduce((sum, family) => sum + family.total, 0);
  if (rows.size !== expectedTotal) {
    console.error(
      `User-story coverage matrix row count mismatch: documented ${rows.size}, expected ${expectedTotal}.`,
    );
    process.exit(1);
  }

  const familyByPrefix = new Map(userStoryFamilies.map((family) => [family.prefix, family]));
  const tierCountsByPrefix = new Map(
    userStoryFamilies.map((family) => [family.prefix, { MVP: 0, "MVP+": 0, Later: 0 }]),
  );

  for (const family of userStoryFamilies) {
    for (let index = 1; index <= family.total; index += 1) {
      const storyId = `${family.prefix}-${String(index).padStart(2, "0")}`;
      if (!rows.has(storyId)) {
        console.error(`User-story coverage matrix is missing ${storyId}.`);
        process.exit(1);
      }
    }
  }

  for (const row of rows.values()) {
    const idMatch = /^([A-Z]{3})-\d{2}$/.exec(row.storyId);
    const prefix = idMatch?.[1];
    const family = prefix ? familyByPrefix.get(prefix) : null;
    if (!family) {
      console.error(`User-story coverage matrix contains unknown story id '${row.storyId}'.`);
      process.exit(1);
    }

    if (row.roleCluster !== family.roleCluster) {
      console.error(
        `User-story ${row.storyId} role cluster mismatch: documented '${row.roleCluster}', expected '${family.roleCluster}'.`,
      );
      process.exit(1);
    }

    if (!validStoryTiers.has(row.tier)) {
      console.error(`User-story ${row.storyId} has invalid tier '${row.tier}'.`);
      process.exit(1);
    }

    if (!validCoverageStatuses.has(row.coverageStatus)) {
      console.error(`User-story ${row.storyId} has invalid coverage status '${row.coverageStatus}'.`);
      process.exit(1);
    }

    if (!row.outcome || !row.evidence) {
      console.error(`User-story ${row.storyId} must include a non-empty outcome and evidence cell.`);
      process.exit(1);
    }

    if (coveredCoverageStatuses.has(row.coverageStatus) && row.gapSlices.length > 0) {
      console.error(`Covered user-story ${row.storyId} must not reference gap slices.`);
      process.exit(1);
    }

    if (
      row.coverageStatus === "proof-covered" &&
      !executableProofEvidencePattern.test(row.evidence)
    ) {
      console.error(
        `Proof-covered user-story ${row.storyId} must cite executable proof evidence, not only baseline implementation evidence.`,
      );
      process.exit(1);
    }

    if (
      !coveredCoverageStatuses.has(row.coverageStatus) &&
      row.gapSlices.length === 0 &&
      !hasExplicitExternalBlocker(row)
    ) {
      console.error(
        `Non-covered user-story ${row.storyId} must reference at least one gap slice or explain an external blocker.`,
      );
      process.exit(1);
    }

    for (const gapSlice of row.gapSlices) {
      if (!waveSectionMap.has(gapSlice)) {
        console.error(`User-story ${row.storyId} references unknown gap slice '${gapSlice}'.`);
        process.exit(1);
      }

      const gapSliceState = masterSliceMap.get(gapSlice)?.state ?? waveSectionMap.get(gapSlice)?.state;
      if (!coveredCoverageStatuses.has(row.coverageStatus) && gapSliceState === "done") {
        console.error(
          `Non-covered user-story ${row.storyId} references done gap slice '${gapSlice}'. Move completed evidence into the evidence cell or mark the story covered.`,
        );
        process.exit(1);
      }
    }

    tierCountsByPrefix.get(prefix)[row.tier] += 1;
  }

  for (const family of userStoryFamilies) {
    const actualTierCounts = tierCountsByPrefix.get(family.prefix);
    for (const tier of Object.keys(family.tierCounts)) {
      if (actualTierCounts[tier] !== family.tierCounts[tier]) {
        console.error(
          `User-story tier count mismatch for ${family.prefix} ${tier}: documented ${actualTierCounts[tier]}, expected ${family.tierCounts[tier]}.`,
        );
        process.exit(1);
      }
    }
  }

  console.log(`user-story coverage matrix ok: ${rows.size} stories across ${userStoryFamilies.length} role clusters.`);
}

if (!sameSet(waveSliceIds, uniqueMasterSliceIds)) {
  console.error("Wave docs and master backlog disagree about slice ids.");
  process.exit(1);
}

if (!sameSet(waveSliceIds, uniqueEpicSliceIds)) {
  console.error("Wave docs and epic map disagree about slice ids.");
  process.exit(1);
}

if (!sameSet(waveSliceIds, uniqueDepSliceIds)) {
  console.error("Wave docs and dependency graph disagree about slice ids.");
  process.exit(1);
}

const depLines = depGraph.split("\n").filter((line) => /^\| W\d+-S\d+ \|/.test(line));
const depSliceMap = new Map();
for (const line of depLines) {
  const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
  const id = cells[0];
  const depCell = cells[1];
  const dependencies =
    depCell.toLowerCase() === "none"
      ? []
      : depCell
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

  depSliceMap.set(id, dependencies);

  for (const dep of dependencies) {
    if (!waveSectionMap.has(dep)) {
      console.error(`Slice ${id} depends on unknown slice ${dep}.`);
      process.exit(1);
    }
  }
}

for (const sliceId of waveSliceIds) {
  const waveSlice = waveSectionMap.get(sliceId);
  const masterSlice = masterSliceMap.get(sliceId);
  if (!masterSlice) {
    console.error(`Slice ${sliceId} exists in wave docs but not in master backlog rows.`);
    process.exit(1);
  }

  if (waveSlice.state !== masterSlice.state) {
    console.error(
      `State mismatch for ${sliceId}: wave docs state '${waveSlice.state}' does not match master backlog state '${masterSlice.state}'.`,
    );
    process.exit(1);
  }

  const depSlice = depSliceMap.get(sliceId) ?? [];
  const waveDeps = [...waveSlice.hardDependencies].sort();
  const masterDeps = [...masterSlice.hardDependencies].sort();
  const graphDeps = [...depSlice].sort();

  if (JSON.stringify(waveDeps) !== JSON.stringify(masterDeps)) {
    console.error(`Hard dependency mismatch for ${sliceId}: wave docs and master backlog disagree.`);
    process.exit(1);
  }

  if (JSON.stringify(waveDeps) !== JSON.stringify(graphDeps)) {
    console.error(`Hard dependency mismatch for ${sliceId}: wave docs and dependency graph disagree.`);
    process.exit(1);
  }
}

const roadmap = read("docs/backlog/mvp-roadmap.md");
for (const file of waveFiles) {
  const fileName = path.basename(file);
  if (!roadmap.includes(fileName)) {
    console.error(`Roadmap does not reference ${fileName}.`);
    process.exit(1);
  }
}

console.log(`backlog consistency ok: ${waveSliceIds.length} slices across ${waveFiles.length} waves`);
assertLatestWaveSourceOfTruth();
assertProofBundleIntegrity();
assertUserStoryCoverageMatrixDocumentation();

const readme = read("README.md");
const readmeCommandSurfaceMatch = readme.match(
  /CLI command surface currently includes \*\*(\d+) implemented\*\* commands and \*\*(\d+) planned\*\* commands/u,
);
if (!readmeCommandSurfaceMatch) {
  console.error("README command surface section must include implemented/planned command counts in the expected format.");
  process.exit(1);
}

const commandCatalogModule = await import(pathToFileURL(path.join(root, "apps/cli/src/command-catalog.mjs")).href);
const implementedCommandsCount = commandCatalogModule.getImplementedCommands().length;
const plannedCommandsCount = commandCatalogModule.getPlannedCommands().length;
const documentedImplementedCount = Number.parseInt(readmeCommandSurfaceMatch[1], 10);
const documentedPlannedCount = Number.parseInt(readmeCommandSurfaceMatch[2], 10);

if (documentedImplementedCount !== implementedCommandsCount || documentedPlannedCount !== plannedCommandsCount) {
  console.error(
    `README command surface counts are stale: documented ${documentedImplementedCount}/${documentedPlannedCount}, actual ${implementedCommandsCount}/${plannedCommandsCount}.`,
  );
  process.exit(1);
}

console.log(
  `README command surface counts ok: ${implementedCommandsCount} implemented and ${plannedCommandsCount} planned commands.`,
);
assertCliCommandCatalogDocumentation(commandCatalogModule);

const contractsModule = await import(pathToFileURL(path.join(root, "packages/contracts/src/index.mjs")).href);
assertContractLoaderCoverageDocumentation(contractsModule.getContractFamilyIndex());

const contractsTestDir = path.join(root, "packages/contracts/test");
const contractsTestFiles = fs
  .readdirSync(contractsTestDir)
  .filter((fileName) => fileName.endsWith(".test.mjs"))
  .sort()
  .map((fileName) => path.join(contractsTestDir, fileName));

const contractsTestRun = spawnSync(process.execPath, ["--test", ...contractsTestFiles], {
  cwd: root,
  stdio: "inherit",
});

if (contractsTestRun.status !== 0) {
  process.exit(contractsTestRun.status ?? 1);
}

console.log("contracts loader tests ok: coverage, validation, and index mapping");

const sliceCycleTestsPath = path.join(root, "scripts/test/slice-cycle.test.mjs");
const sliceCycleTestRun = spawnSync(process.execPath, ["--test", sliceCycleTestsPath], {
  cwd: root,
  stdio: "inherit",
});

if (sliceCycleTestRun.status !== 0) {
  process.exit(sliceCycleTestRun.status ?? 1);
}

console.log("slice cycle tests ok: selection, state sync, and plan extraction");

const productionReadinessTestsPath = path.join(root, "scripts/test/production-readiness.test.mjs");
const productionReadinessTestRun = spawnSync(process.execPath, ["--test", productionReadinessTestsPath], {
  cwd: root,
  stdio: "inherit",
});

if (productionReadinessTestRun.status !== 0) {
  process.exit(productionReadinessTestRun.status ?? 1);
}

console.log("production readiness tests ok: gate passes only with real W25 proof evidence");

const releaseFlowTestsPath = path.join(root, "scripts/test/release-flow.test.mjs");
const releaseFlowTestRun = spawnSync(process.execPath, ["--test", releaseFlowTestsPath], {
  cwd: root,
  stdio: "inherit",
});

if (releaseFlowTestRun.status !== 0) {
  process.exit(releaseFlowTestRun.status ?? 1);
}

console.log("release flow tests ok: package metadata, branch guards, and publish event rules");

const readmeBlackBoxTestsPath = path.join(root, "scripts/test/readme-black-box.test.mjs");
const readmeBlackBoxTestRun = spawnSync(process.execPath, ["--test", readmeBlackBoxTestsPath], {
  cwd: root,
  stdio: "inherit",
});

if (readmeBlackBoxTestRun.status !== 0) {
  process.exit(readmeBlackBoxTestRun.status ?? 1);
}

console.log("README black-box tests ok: documented no-write quickstart runs on an external target repo");

const webDistFreshnessRun = spawnSync(process.execPath, ["./scripts/web-dist-freshness.mjs", "check"], {
  cwd: root,
  stdio: "inherit",
});

if (webDistFreshnessRun.status !== 0) {
  process.exit(webDistFreshnessRun.status ?? 1);
}

console.log("web app test bundle ok: local app smoke can serve packaged SPA assets");

const privateHarnessTestDir = path.join(
  root,
  "scripts",
  privateHarnessName,
  "test",
);
const privateHarnessTestFiles = fs
  .readdirSync(privateHarnessTestDir)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => path.join(privateHarnessTestDir, file));
removeFileIfExists(privateHarnessContextFile);
const privateHarnessTestRun = spawnSync(process.execPath, ["--test", ...privateHarnessTestFiles], {
  cwd: root,
  env: {
    ...process.env,
    [privateHarnessContextEnv]: privateHarnessContextFile,
  },
  killSignal: "SIGKILL",
  stdio: "inherit",
  timeout: privateHarnessTestSuiteTimeoutMs,
});

if (privateHarnessTestRun.status !== 0) {
  printPrivateHarnessTimeoutDiagnostic(privateHarnessTestRun, privateHarnessTestFiles);
  process.exit(privateHarnessTestRun.status ?? 1);
}
removeFileIfExists(privateHarnessContextFile);

console.log("private rehearsal tests ok: internal installed-user harness suite");

const cliTestsPath = path.join(root, "apps/cli/test/cli.test.mjs");
const cliTestRun = spawnSync(process.execPath, ["--test", cliTestsPath], {
  cwd: root,
  stdio: "inherit",
});

if (cliTestRun.status !== 0) {
  process.exit(cliTestRun.status ?? 1);
}

console.log("cli tests ok: bootstrap command contracts, parsing, and help output");

const apiTests = [
  path.join(root, "apps/api/test/read-surface.test.mjs"),
  path.join(root, "apps/api/test/live-event-stream.test.mjs"),
  path.join(root, "apps/api/test/http-transport.test.mjs"),
];
const apiTestRun = spawnSync(process.execPath, ["--test", ...apiTests], {
  cwd: root,
  stdio: "inherit",
});

if (apiTestRun.status !== 0) {
  process.exit(apiTestRun.status ?? 1);
}

console.log("api tests ok: control-plane read surface smoke endpoints");

const observabilityTests = [
  path.join(root, "packages/observability/test/redaction.test.mjs"),
  path.join(root, "packages/observability/test/quality-repair-request.test.mjs"),
];
const observabilityTestRun = spawnSync(process.execPath, ["--test", ...observabilityTests], {
  cwd: root,
  stdio: "inherit",
});

if (observabilityTestRun.status !== 0) {
  process.exit(observabilityTestRun.status ?? 1);
}

console.log("observability tests ok: redaction, secret-safe payload helpers, and quality repair requests");

const webTests = [
  path.join(root, "apps/web/test/operator-console.test.mjs"),
];
const webTestRun = spawnSync(process.execPath, ["--test", ...webTests], {
  cwd: root,
  stdio: "inherit",
});

if (webTestRun.status !== 0) {
  process.exit(webTestRun.status ?? 1);
}

console.log("web tests ok: detachable operator console baseline smoke paths");

const providerRoutingTests = [
  path.join(root, "packages/provider-routing/test/route-resolution.test.mjs"),
];
const providerRoutingTestRun = spawnSync(process.execPath, ["--test", ...providerRoutingTests], {
  cwd: root,
  stdio: "inherit",
});

if (providerRoutingTestRun.status !== 0) {
  process.exit(providerRoutingTestRun.status ?? 1);
}

console.log("provider-routing tests ok: deterministic route registry and override resolution");

const adapterSdkTests = [path.join(root, "packages/adapter-sdk/test/adapter-sdk.test.mjs")];
const adapterSdkTestRun = spawnSync(process.execPath, ["--test", ...adapterSdkTests], {
  cwd: root,
  stdio: "inherit",
});

if (adapterSdkTestRun.status !== 0) {
  process.exit(adapterSdkTestRun.status ?? 1);
}

console.log("adapter-sdk tests ok: envelopes, capability negotiation, and deterministic mock execution");

const harnessTests = [
  path.join(root, "packages/harness/test/scorer-interface.test.mjs"),
  path.join(root, "packages/harness/test/capture-format.test.mjs"),
];
const harnessTestRun = spawnSync(process.execPath, ["--test", ...harnessTests], {
  cwd: root,
  stdio: "inherit",
});

if (harnessTestRun.status !== 0) {
  process.exit(harnessTestRun.status ?? 1);
}

console.log("harness tests ok: scorer interface plus capture-format compatibility helpers");

const orchestratorCoreTests = [
  path.join(root, "packages/orchestrator-core/test/artifact-display-summary.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/provider-step-status.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/execution-evidence-summary.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/project-init.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/next-action.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/handoff-packets.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/evaluation-registry.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/eval-runner.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/certification-decision.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/compiler-revision.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/harness-capture-replay.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/asset-loader.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/context-compiler.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/policy-resolution.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/delivery-plan.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/delivery-driver.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/step-execution-engine.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/project-analysis.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/project-validate.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/project-verify.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/archetype-smoke.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/live-e2e-boundary.test.mjs"),
];
const orchestratorCoreTestRun = spawnSync(process.execPath, ["--test", ...orchestratorCoreTests], {
  cwd: root,
  stdio: "inherit",
});

if (orchestratorCoreTestRun.status !== 0) {
  process.exit(orchestratorCoreTestRun.status ?? 1);
}

console.log("orchestrator-core tests ok: project init, analysis, and deterministic validation flows");

const referenceIntegrityCheckPath = path.join(root, "scripts/reference-integrity.mjs");
const referenceIntegrityRun = spawnSync(process.execPath, [referenceIntegrityCheckPath], {
  cwd: root,
  stdio: "inherit",
});

if (referenceIntegrityRun.status !== 0) {
  process.exit(referenceIntegrityRun.status ?? 1);
}

console.log("reference integrity checks ok: examples refs are consistent");
