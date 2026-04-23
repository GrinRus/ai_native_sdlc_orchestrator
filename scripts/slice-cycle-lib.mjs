import fs from "node:fs";
import path from "node:path";

export const VALID_STATES = new Set(["ready", "blocked", "active", "done"]);

export const DEFAULT_PATHS = {
  masterBacklog: "docs/backlog/mvp-implementation-backlog.md",
  dependencyGraph: "docs/backlog/slice-dependency-graph.md",
  backlogDir: "docs/backlog",
};

export function discoverWaveFiles(rootDir) {
  const backlogDir = path.join(rootDir, DEFAULT_PATHS.backlogDir);
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
    throw new Error("Could not find any wave implementation documents under docs/backlog/.");
  }

  if (entries[0].waveIndex !== 0) {
    throw new Error("Wave documents must start at wave-0-implementation-slices.md.");
  }

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (current.waveIndex !== previous.waveIndex + 1) {
      throw new Error(
        `Wave document numbering gap detected between ${previous.name} and ${current.name}.`,
      );
    }
  }

  return entries.map((entry) => path.posix.join(DEFAULT_PATHS.backlogDir, entry.name));
}

function ensureState(state, context) {
  if (!VALID_STATES.has(state)) {
    throw new Error(`Unsupported state '${state}' in ${context}. Expected one of: ${[...VALID_STATES].join(", ")}.`);
  }
}

function normalizeDeps(rawCell) {
  const value = rawCell.trim();
  if (value.toLowerCase() === "none") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readMarkdown(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function parseNumberedList(sectionContent, heading) {
  const block = extractSectionBlock(sectionContent, heading);
  if (!block) return [];
  return [...block.matchAll(/^\d+\.\s+(.+)$/gm)].map((match) => match[1].trim());
}

function parseBulletList(sectionContent, heading) {
  const block = extractSectionBlock(sectionContent, heading);
  if (!block) return [];
  return [...block.matchAll(/^-\s+(.+)$/gm)].map((match) => match[1].trim());
}

function extractSectionBlock(content, heading) {
  const headingRegex = new RegExp(`^### ${escapeRegex(heading)}\\s*$`, "m");
  const headingMatch = headingRegex.exec(content);
  if (!headingMatch) return "";

  const blockStart = headingMatch.index + headingMatch[0].length;
  const remainder = content.slice(blockStart);
  const nextHeadingMatch = /^###\s+/m.exec(remainder);
  const blockEnd = nextHeadingMatch ? blockStart + nextHeadingMatch.index : content.length;
  return content.slice(blockStart, blockEnd).trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toOrderIndex(order) {
  const index = new Map();
  order.forEach((sliceId, position) => index.set(sliceId, position));
  return index;
}

function sortByOrder(ids, orderIndex) {
  return [...ids].sort((a, b) => {
    const aIndex = orderIndex.get(a);
    const bIndex = orderIndex.get(b);
    const safeA = aIndex === undefined ? Number.POSITIVE_INFINITY : aIndex;
    const safeB = bIndex === undefined ? Number.POSITIVE_INFINITY : bIndex;
    if (safeA !== safeB) return safeA - safeB;
    return a.localeCompare(b);
  });
}

export function parseMasterBacklog(content) {
  const rows = [...content.matchAll(/^\|\s*(W\d+-S\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(ready|blocked|active|done)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/gm)];
  const slices = new Map();

  for (const row of rows) {
    const sliceId = row[1];
    const title = row[2].trim();
    const epic = row[3].trim();
    const state = row[4].trim();
    const hardDependencies = normalizeDeps(row[6]);
    ensureState(state, `master backlog row '${sliceId}'`);

    slices.set(sliceId, {
      sliceId,
      title,
      epic,
      state,
      hardDependencies,
    });
  }

  if (slices.size === 0) {
    throw new Error("Failed to parse slices from docs/backlog/mvp-implementation-backlog.md.");
  }

  return slices;
}

export function parseTopologicalOrder(content) {
  const heading = "## Topological order";
  const headingIndex = content.indexOf(heading);
  if (headingIndex < 0) {
    throw new Error("Could not find 'Topological order' section in dependency graph.");
  }

  const afterHeading = content.slice(headingIndex + heading.length).replace(/^\s+/, "");
  const nextHeadingIndex = afterHeading.indexOf("\n## ");
  const sectionBody = nextHeadingIndex >= 0 ? afterHeading.slice(0, nextHeadingIndex) : afterHeading;

  const order = [...sectionBody.matchAll(/^\d+\.\s+(W\d+-S\d+)\s*$/gm)].map((match) => match[1]);
  if (order.length === 0) {
    throw new Error("Topological order section does not list any slice ids.");
  }

  return order;
}

export function parseDependencyRows(content) {
  const rows = [...content.matchAll(/^\|\s*(W\d+-S\d+)\s*\|\s*([^|]+?)\s*\|\s*$/gm)];
  const dependencies = new Map();

  for (const row of rows) {
    const sliceId = row[1];
    const depsCell = row[2].trim();
    if (sliceId === "Slice ID") continue;
    dependencies.set(sliceId, normalizeDeps(depsCell));
  }

  if (dependencies.size === 0) {
    throw new Error("Failed to parse dependency rows from docs/backlog/slice-dependency-graph.md.");
  }

  return dependencies;
}

export function parseWaveSlices(content, waveFile) {
  const headingRegex = /^##\s+(W\d+-S\d+)\s+—\s+(.+)$/gm;
  const matches = [...content.matchAll(headingRegex)];
  const slices = new Map();

  for (let index = 0; index < matches.length; index += 1) {
    const sliceId = matches[index][1];
    const title = matches[index][2].trim();
    const start = matches[index].index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? content.length) : content.length;
    const section = content.slice(start, end);

    const stateMatch = section.match(/^-\s+\*\*State:\*\*\s*(ready|blocked|active|done)\s*$/m);
    if (!stateMatch) {
      throw new Error(`Slice ${sliceId} in ${waveFile} is missing '- **State:** ...'.`);
    }

    const depsMatch = section.match(/^-\s+\*\*Hard dependencies:\*\*\s*(.+)\s*$/m);
    if (!depsMatch) {
      throw new Error(`Slice ${sliceId} in ${waveFile} is missing '- **Hard dependencies:** ...'.`);
    }

    const state = stateMatch[1].trim();
    ensureState(state, `${waveFile} section '${sliceId}'`);

    slices.set(sliceId, {
      sliceId,
      title,
      state,
      hardDependencies: normalizeDeps(depsMatch[1]),
      waveFile,
      localTasks: parseNumberedList(section, "Local tasks"),
      acceptanceCriteria: parseNumberedList(section, "Acceptance criteria"),
      doneEvidence: parseBulletList(section, "Done evidence"),
      outOfScope: parseBulletList(section, "Out of scope"),
    });
  }

  return slices;
}

export function loadBacklogModel(rootDir) {
  const masterBacklogContent = readMarkdown(rootDir, DEFAULT_PATHS.masterBacklog);
  const dependencyGraphContent = readMarkdown(rootDir, DEFAULT_PATHS.dependencyGraph);
  const waveFiles = discoverWaveFiles(rootDir);

  const masterSlices = parseMasterBacklog(masterBacklogContent);
  const dependencyRows = parseDependencyRows(dependencyGraphContent);
  const order = parseTopologicalOrder(dependencyGraphContent);

  const waveSlices = new Map();
  for (const waveFile of waveFiles) {
    const waveContent = readMarkdown(rootDir, waveFile);
    const parsedWaveSlices = parseWaveSlices(waveContent, waveFile);
    for (const [sliceId, waveSlice] of parsedWaveSlices.entries()) {
      if (waveSlices.has(sliceId)) {
        throw new Error(`Duplicate slice id '${sliceId}' across wave documents.`);
      }
      waveSlices.set(sliceId, waveSlice);
    }
  }

  const orderIndex = toOrderIndex(order);
  const slices = new Map();

  for (const [sliceId, masterSlice] of masterSlices.entries()) {
    if (!waveSlices.has(sliceId)) {
      throw new Error(`Slice '${sliceId}' exists in master backlog but missing in wave docs.`);
    }
    if (!dependencyRows.has(sliceId)) {
      throw new Error(`Slice '${sliceId}' exists in master backlog but missing in dependency graph tables.`);
    }

    const waveSlice = waveSlices.get(sliceId);

    if (masterSlice.state !== waveSlice.state) {
      throw new Error(
        `State mismatch for ${sliceId}: master backlog has '${masterSlice.state}', wave doc has '${waveSlice.state}'.`,
      );
    }

    const masterDeps = [...masterSlice.hardDependencies].sort();
    const waveDeps = [...waveSlice.hardDependencies].sort();
    const graphDeps = [...dependencyRows.get(sliceId)].sort();

    if (JSON.stringify(masterDeps) !== JSON.stringify(waveDeps)) {
      throw new Error(
        `Hard dependency mismatch for ${sliceId}: master backlog and wave docs disagree (${masterDeps.join(", ")} vs ${waveDeps.join(", ")}).`,
      );
    }

    if (JSON.stringify(masterDeps) !== JSON.stringify(graphDeps)) {
      throw new Error(
        `Hard dependency mismatch for ${sliceId}: master backlog and dependency graph disagree (${masterDeps.join(", ")} vs ${graphDeps.join(", ")}).`,
      );
    }

    slices.set(sliceId, {
      sliceId,
      title: masterSlice.title,
      epic: masterSlice.epic,
      state: masterSlice.state,
      hardDependencies: masterSlice.hardDependencies,
      waveFile: waveSlice.waveFile,
      localTasks: waveSlice.localTasks,
      acceptanceCriteria: waveSlice.acceptanceCriteria,
      doneEvidence: waveSlice.doneEvidence,
      outOfScope: waveSlice.outOfScope,
    });
  }

  for (const sliceId of waveSlices.keys()) {
    if (!masterSlices.has(sliceId)) {
      throw new Error(`Slice '${sliceId}' exists in wave docs but missing in master backlog.`);
    }
  }

  const sortedMasterIds = [...masterSlices.keys()].sort();
  const sortedOrderIds = [...new Set(order)].sort();
  if (JSON.stringify(sortedMasterIds) !== JSON.stringify(sortedOrderIds)) {
    throw new Error("Topological order list and master backlog slice ids disagree.");
  }

  for (const [sliceId, slice] of slices.entries()) {
    for (const depId of slice.hardDependencies) {
      if (!slices.has(depId)) {
        throw new Error(`Slice '${sliceId}' depends on unknown slice '${depId}'.`);
      }
    }
  }

  return {
    rootDir,
    waveFiles,
    order,
    orderIndex,
    slices,
  };
}

export function summarizeStates(model) {
  const summary = {
    total: model.slices.size,
    ready: 0,
    blocked: 0,
    active: 0,
    done: 0,
  };

  for (const slice of model.slices.values()) {
    summary[slice.state] += 1;
  }

  return summary;
}

export function dependenciesDone(model, sliceId) {
  const slice = model.slices.get(sliceId);
  if (!slice) throw new Error(`Unknown slice '${sliceId}'.`);
  return slice.hardDependencies.every((depId) => model.slices.get(depId)?.state === "done");
}

function collectUnfinishedDependencies(model, sliceId, visited = new Set()) {
  if (visited.has(sliceId)) return [];
  visited.add(sliceId);

  const slice = model.slices.get(sliceId);
  if (!slice) throw new Error(`Unknown slice '${sliceId}'.`);

  const unresolved = [];
  for (const depId of slice.hardDependencies) {
    const dep = model.slices.get(depId);
    if (!dep) throw new Error(`Slice '${sliceId}' depends on unknown slice '${depId}'.`);
    if (dep.state !== "done") {
      unresolved.push(depId);
      unresolved.push(...collectUnfinishedDependencies(model, depId, visited));
    }
  }

  return unresolved;
}

export function computeStateSyncChanges(model) {
  const changes = [];

  for (const slice of model.slices.values()) {
    if (slice.state === "done" || slice.state === "active") continue;

    const nextState = dependenciesDone(model, slice.sliceId) ? "ready" : "blocked";
    if (nextState !== slice.state) {
      changes.push({
        sliceId: slice.sliceId,
        title: slice.title,
        currentState: slice.state,
        nextState,
      });
    }
  }

  const orderSorted = sortByOrder(
    changes.map((change) => change.sliceId),
    model.orderIndex,
  );

  const byId = new Map(changes.map((change) => [change.sliceId, change]));
  return orderSorted.map((sliceId) => byId.get(sliceId));
}

export function selectNextSlice(model) {
  const slices = [...model.slices.values()];
  const activeSlices = slices.filter((slice) => slice.state === "active");

  if (activeSlices.length > 1) {
    const ids = sortByOrder(
      activeSlices.map((slice) => slice.sliceId),
      model.orderIndex,
    );
    throw new Error(`Expected at most one active slice, found: ${ids.join(", ")}.`);
  }

  if (activeSlices.length === 1) {
    const active = activeSlices[0];
    return {
      mode: "active",
      slice: active,
      readyCandidates: [],
      blockedTarget: null,
      blockedChain: [],
    };
  }

  const readyCandidates = sortByOrder(
    slices.filter((slice) => slice.state === "ready").map((slice) => slice.sliceId),
    model.orderIndex,
  );

  if (readyCandidates.length > 0) {
    return {
      mode: "ready",
      slice: model.slices.get(readyCandidates[0]),
      readyCandidates,
      blockedTarget: null,
      blockedChain: [],
    };
  }

  const allDone = slices.every((slice) => slice.state === "done");
  if (allDone) {
    return {
      mode: "complete",
      slice: null,
      readyCandidates: [],
      blockedTarget: null,
      blockedChain: [],
    };
  }

  for (const targetId of model.order) {
    const target = model.slices.get(targetId);
    if (!target || target.state === "done") continue;

    const unresolvedDeps = sortByOrder(
      [...new Set(collectUnfinishedDependencies(model, targetId))],
      model.orderIndex,
    );

    const unblockerId = unresolvedDeps[0] ?? targetId;

    return {
      mode: "unblocker",
      slice: model.slices.get(unblockerId),
      readyCandidates: [],
      blockedTarget: target,
      blockedChain: unresolvedDeps,
    };
  }

  return {
    mode: "complete",
    slice: null,
    readyCandidates: [],
    blockedTarget: null,
    blockedChain: [],
  };
}

export function getSlicePlan(model, sliceId) {
  const slice = model.slices.get(sliceId);
  if (!slice) throw new Error(`Unknown slice id '${sliceId}'.`);

  return {
    sliceId: slice.sliceId,
    title: slice.title,
    epic: slice.epic,
    state: slice.state,
    hardDependencies: slice.hardDependencies,
    waveFile: slice.waveFile,
    localTasks: slice.localTasks,
    acceptanceCriteria: slice.acceptanceCriteria,
    doneEvidence: slice.doneEvidence,
    outOfScope: slice.outOfScope,
  };
}

function replaceMasterState(content, sliceId, nextState) {
  const rowRegex = new RegExp(
    `^(\\|\\s*${escapeRegex(sliceId)}\\s*\\|\\s*[^|]+\\|\\s*[^|]+\\|\\s*)(ready|blocked|active|done)(\\s*\\|.*)$`,
    "m",
  );

  if (!rowRegex.test(content)) {
    throw new Error(`Could not find slice '${sliceId}' row in master backlog table.`);
  }

  return content.replace(rowRegex, `$1${nextState}$3`);
}

function replaceWaveState(content, sliceId, nextState) {
  const headingRegex = new RegExp(`^##\\s+${escapeRegex(sliceId)}\\s+—\\s+.+$`, "m");
  const headingMatch = headingRegex.exec(content);
  if (!headingMatch || headingMatch.index === undefined) {
    throw new Error(`Could not find section heading for slice '${sliceId}' in wave document.`);
  }

  const sectionStart = headingMatch.index;
  const sectionTail = content.slice(sectionStart);
  const nextSectionMatch = /^##\s+W\d-S\d+\s+—\s+.+$/m.exec(sectionTail.slice(headingMatch[0].length));
  const sectionEnd = nextSectionMatch
    ? sectionStart + headingMatch[0].length + nextSectionMatch.index
    : content.length;

  const section = content.slice(sectionStart, sectionEnd);
  const stateRegex = /(-\s+\*\*State:\*\*\s*)(ready|blocked|active|done)(\s*)/;

  if (!stateRegex.test(section)) {
    throw new Error(`Could not find '- **State:** ...' in slice section '${sliceId}'.`);
  }

  const updatedSection = section.replace(stateRegex, `$1${nextState}$3`);
  return `${content.slice(0, sectionStart)}${updatedSection}${content.slice(sectionEnd)}`;
}

export function applySliceStateTransition(model, sliceId, nextState, options = {}) {
  ensureState(nextState, `transition target '${nextState}'`);

  const slice = model.slices.get(sliceId);
  if (!slice) {
    throw new Error(`Unknown slice id '${sliceId}'.`);
  }

  const { force = false } = options;

  if (!force && nextState === "done" && !dependenciesDone(model, sliceId)) {
    const missing = slice.hardDependencies.filter((depId) => model.slices.get(depId)?.state !== "done");
    throw new Error(`Cannot mark ${sliceId} as done: unresolved hard dependencies: ${missing.join(", ")}.`);
  }

  if (!force && nextState === "active") {
    const activeSlices = [...model.slices.values()].filter(
      (candidate) => candidate.state === "active" && candidate.sliceId !== sliceId,
    );

    if (activeSlices.length > 0) {
      throw new Error(`Cannot mark ${sliceId} as active while active slice exists: ${activeSlices[0].sliceId}.`);
    }
  }

  const masterPath = path.join(model.rootDir, DEFAULT_PATHS.masterBacklog);
  const wavePath = path.join(model.rootDir, slice.waveFile);

  const masterContent = fs.readFileSync(masterPath, "utf8");
  const waveContent = fs.readFileSync(wavePath, "utf8");

  const updatedMaster = replaceMasterState(masterContent, sliceId, nextState);
  const updatedWave = replaceWaveState(waveContent, sliceId, nextState);

  fs.writeFileSync(masterPath, updatedMaster, "utf8");
  fs.writeFileSync(wavePath, updatedWave, "utf8");
}

export function applyStateSyncChanges(model, changes) {
  if (changes.length === 0) {
    return;
  }

  const masterPath = path.join(model.rootDir, DEFAULT_PATHS.masterBacklog);
  let masterContent = fs.readFileSync(masterPath, "utf8");

  const waveContentByFile = new Map();
  for (const slice of model.slices.values()) {
    if (!waveContentByFile.has(slice.waveFile)) {
      waveContentByFile.set(slice.waveFile, fs.readFileSync(path.join(model.rootDir, slice.waveFile), "utf8"));
    }
  }

  for (const change of changes) {
    const slice = model.slices.get(change.sliceId);
    if (!slice) continue;

    masterContent = replaceMasterState(masterContent, change.sliceId, change.nextState);

    const previousWaveContent = waveContentByFile.get(slice.waveFile);
    waveContentByFile.set(
      slice.waveFile,
      replaceWaveState(previousWaveContent, change.sliceId, change.nextState),
    );
  }

  fs.writeFileSync(masterPath, masterContent, "utf8");
  for (const [waveFile, content] of waveContentByFile.entries()) {
    fs.writeFileSync(path.join(model.rootDir, waveFile), content, "utf8");
  }
}
