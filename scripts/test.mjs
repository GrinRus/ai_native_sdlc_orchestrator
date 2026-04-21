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
    sections.set(id, content.slice(start, end));
  }

  return sections;
}

const waveSectionMap = new Map();
for (const file of waveFiles) {
  const content = read(file);
  const sections = parseWaveSlices(content);
  for (const [id, section] of sections.entries()) {
    if (waveSectionMap.has(id)) {
      console.error(`Duplicate slice id found in wave docs: ${id}`);
      process.exit(1);
    }
    for (const heading of ["### Local tasks", "### Acceptance criteria", "### Done evidence", "### Out of scope"]) {
      if (!section.includes(heading)) {
        console.error(`Slice ${id} is missing required section '${heading}'.`);
        process.exit(1);
      }
    }
    waveSectionMap.set(id, section);
  }
}

const waveSliceIds = [...waveSectionMap.keys()].sort();

const masterBacklog = read("docs/backlog/mvp-implementation-backlog.md");
const masterSliceIds = [...masterBacklog.matchAll(/^\| (W\d-S\d+) \|/gm)].map((match) => match[1]);
const uniqueMasterSliceIds = [...new Set(masterSliceIds)].sort();

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
for (const line of depLines) {
  const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
  const id = cells[0];
  const depCell = cells[1];
  if (depCell.toLowerCase() === "none") continue;
  for (const dep of depCell.split(",").map((item) => item.trim())) {
    if (!waveSectionMap.has(dep)) {
      console.error(`Slice ${id} depends on unknown slice ${dep}.`);
      process.exit(1);
    }
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

const contractsTestPath = path.join(root, "packages/contracts/test/contracts-loader.test.mjs");
const contractsTestRun = spawnSync(process.execPath, ["--test", contractsTestPath], {
  cwd: root,
  stdio: "inherit",
});

if (contractsTestRun.status !== 0) {
  process.exit(contractsTestRun.status ?? 1);
}

console.log("contracts loader tests ok: coverage, validation, and index mapping");
