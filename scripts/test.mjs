#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

const waveFiles = [
  "docs/backlog/wave-0-implementation-slices.md",
  "docs/backlog/wave-1-implementation-slices.md",
  "docs/backlog/wave-2-implementation-slices.md",
  "docs/backlog/wave-3-implementation-slices.md",
  "docs/backlog/wave-4-implementation-slices.md",
  "docs/backlog/wave-5-implementation-slices.md",
];

function parseWaveSlices(content) {
  const regex = /^## (W\d-S\d+) — .+$/gm;
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
const masterSliceIds = [...masterBacklog.matchAll(/^\| (W\d-S\d+) \|/gm)].map((match) => match[1]);
const uniqueMasterSliceIds = [...new Set(masterSliceIds)].sort();
const masterRows = [...masterBacklog.matchAll(/^\| (W\d-S\d+) \| ([^|]+) \| ([^|]+) \| (ready|blocked|active|done) \| ([^|]+) \| ([^|]+) \|$/gm)];
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
const epicSliceIds = [...epicMap.matchAll(/`(W\d-S\d+)`/gm)].map((match) => match[1]);
const uniqueEpicSliceIds = [...new Set(epicSliceIds)].sort();

const depGraph = read("docs/backlog/slice-dependency-graph.md");
const depSliceIds = [...depGraph.matchAll(/^\| (W\d-S\d+) \|/gm)].map((match) => match[1]);
const uniqueDepSliceIds = [...new Set(depSliceIds)].sort();

function sameSet(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
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

const depLines = depGraph.split("\n").filter((line) => /^\| W\d-S\d+ \|/.test(line));
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

const cliTestsPath = path.join(root, "apps/cli/test/cli.test.mjs");
const cliTestRun = spawnSync(process.execPath, ["--test", cliTestsPath], {
  cwd: root,
  stdio: "inherit",
});

if (cliTestRun.status !== 0) {
  process.exit(cliTestRun.status ?? 1);
}

console.log("cli tests ok: bootstrap command contracts, parsing, and help output");

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

const orchestratorCoreTests = [
  path.join(root, "packages/orchestrator-core/test/project-init.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/handoff-packets.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/asset-loader.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/project-analysis.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/project-validate.test.mjs"),
  path.join(root, "packages/orchestrator-core/test/project-verify.test.mjs"),
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
