import fs from "node:fs";
import path from "node:path";
import { loadBacklogModel, summarizeStates } from "../slice-cycle-lib.mjs";

const EVIDENCE = [
  "README.md",
  "docs/backlog/self-hosted-production-readiness.md",
  "docs/ops/production-readiness-gate.md",
  "docs/ops/self-hosted-release.md",
  "docs/research/26-w71-audit-disposition.json",
];

const INDEX_SPECS = [
  { directory: "docs/contracts", index: "docs/contracts/00-index.md", label: "contract" },
  { directory: "docs/ops", index: "docs/ops/00-runbook-index.md", label: "runbook" },
];

const RUNTIME_GUIDANCE = [
  "README.md",
  "docs/architecture/12-orchestrator-operating-model.md",
  "docs/contracts/project-profile.md",
  "docs/ops/installed-user-first-run.md",
  "docs/ops/local-workspace-registry.md",
  "docs/ops/project-topology-onboarding.md",
  "docs/ops/self-hosted-backup-restore.md",
  "docs/ops/self-hosted-release.md",
];

const EVIDENCE_TIER_REGISTRY = "docs/product/story-evidence-tiers.json";
const STORY_MATRIX = "docs/product/user-story-coverage-matrix.md";
const W71_WAVE = "docs/backlog/wave-71-implementation-slices.md";
const W71_ROADMAP = "docs/backlog/mvp-roadmap.md";
const W71_SUMMARY = "docs/backlog/w71-planning-readiness.json";

const TIER_ORDER = ["unit", "contract", "fixture", "mocked-browser", "integrated-local", "live-provider"];

function readText(rootDir, file) {
  return fs.readFileSync(path.join(rootDir, file), "utf8");
}

function fileExists(rootDir, file) {
  return fs.existsSync(path.join(rootDir, file));
}

function parseMarkdownTableRow(line) {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function parseStoryMatrix(rootDir) {
  const rows = new Map();
  for (const line of readText(rootDir, STORY_MATRIX).split(/\r?\n/u)) {
    if (!line.startsWith("| ") || line.includes("|---") || line.startsWith("| Story ID ")) continue;
    const cells = parseMarkdownTableRow(line);
    if (cells.length !== 7) continue;
    rows.set(cells[0], { storyId: cells[0], coverageStatus: cells[4], evidence: cells[5], gap: cells[6] });
  }
  return rows;
}

export function checkRuntimeRootGuidance(rootDir) {
  const findings = [];
  for (const file of RUNTIME_GUIDANCE) {
    const text = readText(rootDir, file);
    if (!/AOR_HOME|AOR Home|~\/.aor/u.test(text)) {
      findings.push(`${file} must name the central AOR Home runtime root.`);
    }
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      if (!/\.aor(?:\/|`)/u.test(line)) continue;
      if (/AOR Home|portable|export|legacy|historical|qualification|rehearsal|ignored|explicitly/u.test(line)) continue;
      if (/runtime (?:outputs?|state)|materiali[sz](?:e|ed|ation).*runtime|target[- ](?:repo|repository).*runtime/iu.test(line)) {
        findings.push(`${file}:${index + 1} describes mutable runtime state as target-local .aor; use AOR Home or label an explicit portable export.`);
      }
    }
  }
  return findings;
}

export function checkBidirectionalIndexes(rootDir) {
  const findings = [];
  const reports = [];
  for (const spec of INDEX_SPECS) {
    const indexText = readText(rootDir, spec.index);
    const listed = [...indexText.matchAll(/(?:^[-*] `([^`]+\.md)`|\]\(([^)#]+\.md)(?:#[^)]*)?\))/gmu)]
      .map((match) => match[1] ?? path.basename(match[2]))
      .filter((file, index, values) => values.indexOf(file) === index);
    const files = fs.readdirSync(path.join(rootDir, spec.directory), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("00-") && entry.name !== "AGENTS.md")
      .map((entry) => entry.name)
      .sort();
    const missing = files.filter((file) => !listed.includes(file));
    const dangling = listed.filter((file) => !fileExists(rootDir, `${spec.directory}/${file}`));
    for (const file of missing) findings.push(`${spec.label} '${file}' is not registered in ${spec.index}.`);
    for (const file of dangling) findings.push(`${spec.label} index ${spec.index} points to missing '${file}'.`);
    reports.push({ ...spec, discovered: files.length, listed: listed.length, missing, dangling });
  }
  return { findings, reports };
}

export function checkPlanningSummary(rootDir) {
  const findings = [];
  let model;
  try {
    model = loadBacklogModel(rootDir);
  } catch (error) {
    return { findings: [`Backlog model could not be loaded: ${error.message}`], report: null };
  }
  const waveSlices = [...model.slices.values()].filter((slice) => slice.sliceId.startsWith("W71-"));
  const states = summarizeStates({ slices: new Map(waveSlices.map((slice) => [slice.sliceId, slice])) });
  const waveText = readText(rootDir, W71_WAVE);
  const roadmapText = readText(rootDir, W71_ROADMAP);
  if (!roadmapText.match(/^\| W71 \|[^\n]*\| 15 \|/mu)) findings.push("Roadmap W71 row must declare 15 slices.");
  if (!waveText.includes("W71-S13") || !waveText.includes("W71-S14")) findings.push("W71 wave document must include S13 and S14.");
  if (!fileExists(rootDir, W71_SUMMARY)) findings.push(`${W71_SUMMARY} is missing.`);
  else {
    try {
      const summary = JSON.parse(readText(rootDir, W71_SUMMARY));
      if (summary.schema_version !== 1 || summary.wave_id !== "W71" || summary.latest_wave !== "W71") findings.push(`${W71_SUMMARY} must identify schema 1, W71, and latest_wave=W71.`);
      if (summary.slice_count !== waveSlices.length) findings.push(`${W71_SUMMARY} slice_count disagrees with the backlog model.`);
      for (const status of ["ready", "active", "blocked", "done"]) {
        if (summary.status_counts?.[status] !== states[status]) findings.push(`${W71_SUMMARY} status count for ${status} disagrees with the backlog model.`);
      }
      if (!Array.isArray(summary.historical_snapshot_labels) || summary.historical_snapshot_labels.length === 0) findings.push(`${W71_SUMMARY} must retain historical snapshot labels.`);
    } catch (error) {
      findings.push(`${W71_SUMMARY} is invalid JSON: ${error.message}`);
    }
  }
  return { findings, report: { wave_id: "W71", latest_wave: "W71", slice_count: waveSlices.length, status_counts: states } };
}

export function checkEvidenceTiers(rootDir) {
  const findings = [];
  if (!fileExists(rootDir, EVIDENCE_TIER_REGISTRY)) return { findings: [`${EVIDENCE_TIER_REGISTRY} is missing.`], report: null };
  let registry;
  try { registry = JSON.parse(readText(rootDir, EVIDENCE_TIER_REGISTRY)); } catch (error) { return { findings: [`${EVIDENCE_TIER_REGISTRY} is invalid JSON: ${error.message}`], report: null }; }
  if (registry.schema_version !== 1) findings.push(`${EVIDENCE_TIER_REGISTRY} must declare schema_version=1.`);
  if (JSON.stringify(registry.tiers ?? []) !== JSON.stringify(TIER_ORDER.map((id, index) => ({ id, order: index + 1 })))) {
    findings.push(`${EVIDENCE_TIER_REGISTRY} tiers must remain ordered from unit through live-provider.`);
  }
  const rows = parseStoryMatrix(rootDir);
  const protectedStories = registry.protected_story_ids ?? {};
  for (const [storyId, policy] of Object.entries(protectedStories)) {
    const row = rows.get(storyId);
    if (!row) { findings.push(`${storyId} from the evidence-tier registry is missing from the story matrix.`); continue; }
    if (!Array.isArray(policy.allowed_statuses) || !policy.allowed_statuses.includes(row.coverageStatus)) findings.push(`${storyId} has status '${row.coverageStatus}' outside its audited allowed statuses.`);
    if (policy.owner_slice && !row.gap.includes(policy.owner_slice)) findings.push(`${storyId} must retain ${policy.owner_slice} as its proof owner.`);
    if (row.coverageStatus === "proof-covered" && policy.requires_s14 !== false) findings.push(`${storyId} cannot be proof-covered before W71-S14 integrated evidence.`);
    for (const forbidden of ["source regex", "screenshot", "handcrafted", "service-only", "route-fulfilled"]) {
      if (row.coverageStatus === "proof-covered" && row.evidence.toLowerCase().includes(forbidden)) findings.push(`${storyId} proof claim relies on forbidden ${forbidden} evidence.`);
    }
  }
  const storyCount = [...rows.keys()].length;
  if (storyCount !== 116) findings.push(`Evidence-tier validation expected 116 story rows, found ${storyCount}.`);
  return { findings, report: { tier_count: (registry.tiers ?? []).length, protected_story_count: Object.keys(protectedStories).length, story_count: storyCount } };
}

export function checkReadinessSourceOfTruth(rootDir) {
  const findings = [];
  const documents = new Map(EVIDENCE.map((file) => [file, readText(rootDir, file)]));
  const readme = documents.get(EVIDENCE[0]);
  const readiness = documents.get(EVIDENCE[1]);
  const opsRunbook = documents.get(EVIDENCE[2]);
  const releaseRunbook = documents.get(EVIDENCE[3]);
  const w71Disposition = documents.get(EVIDENCE[4]);

  for (const required of [
    "W69 and W70 are development-complete",
    "W66 remains the release-qualification blocker",
    "release_clearance=false",
  ]) {
    if (!readme.includes(required)) {
      findings.push(`README.md must preserve current development/release status wording '${required}'.`);
    }
  }
  for (const required of ["W71", "audit-hold", "release_clearance", "story_downgrades"]) {
    if (!w71Disposition.includes(required)) findings.push("W71 disposition must preserve the current post-W70 audit hold and story downgrade registry.");
  }
  for (const required of ["pnpm production:ready", "docs/ops/self-hosted-release.md"]) {
    if (!readme.includes(required)) findings.push(`README.md must mention '${required}'.`);
  }
  if (!readme.includes("hosted SaaS") || !readme.includes("enterprise identity")) {
    findings.push("README.md must keep hosted SaaS and enterprise identity out of the supported mode.");
  }
  if (!readiness.includes("historical bounded self-hosted release clearance")) {
    findings.push("self-hosted production readiness doc must preserve historical bounded clearance without presenting it as current.");
  }
  if (!readiness.includes("pnpm production:ready")) {
    findings.push("self-hosted production readiness doc must document the production gate command.");
  }
  if (!/sanitized production proof fixture/u.test(readiness)) {
    findings.push("self-hosted production readiness doc must cite the sanitized production proof fixture.");
  }
  if (!opsRunbook.includes("pnpm production:ready") || !/sanitized (?:production )?proof fixture/u.test(opsRunbook)) {
    findings.push("production-readiness runbook must document command usage and proof evidence.");
  }
  for (const required of [
    "bounded self-hosted release clearance",
    "pnpm production:ready",
    "sanitized production proof fixture",
    "hosted SaaS",
    "enterprise identity",
    "no-upstream-write",
  ]) {
    if (!releaseRunbook.includes(required)) {
      findings.push(`self-hosted release runbook must mention '${required}'.`);
    }
  }
  for (const [file, text] of documents) {
    for (const required of ["W66", "audit-hold"]) {
      if (!text.includes(required)) findings.push(`${file} must preserve the ${required} qualification history.`);
    }
  }

  findings.push(...checkRuntimeRootGuidance(rootDir));
  const indexCheck = checkBidirectionalIndexes(rootDir);
  findings.push(...indexCheck.findings);
  const planningCheck = checkPlanningSummary(rootDir);
  findings.push(...planningCheck.findings);
  const evidenceTierCheck = checkEvidenceTiers(rootDir);
  findings.push(...evidenceTierCheck.findings);

  if (findings.length > 0) {
    return {
      id: "source-of-truth-alignment",
      status: "fail",
      summary: "Production readiness source-of-truth docs are inconsistent.",
      findings,
      evidence: [...EVIDENCE, ...RUNTIME_GUIDANCE, ...INDEX_SPECS.map((spec) => spec.index), STORY_MATRIX, EVIDENCE_TIER_REGISTRY, W71_SUMMARY],
      index_report: indexCheck.reports,
      planning_report: planningCheck.report,
      evidence_tier_report: evidenceTierCheck.report,
    };
  }
  return {
    id: "source-of-truth-alignment",
    status: "pass",
    summary: "README, readiness source-of-truth, production gate, and release runbook align on the W66 qualification disposition.",
    evidence: [...EVIDENCE, ...RUNTIME_GUIDANCE, ...INDEX_SPECS.map((spec) => spec.index), STORY_MATRIX, EVIDENCE_TIER_REGISTRY, W71_SUMMARY],
    index_report: indexCheck.reports,
    planning_report: planningCheck.report,
    evidence_tier_report: evidenceTierCheck.report,
  };
}
