#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { loadExampleContracts, validateExampleReferences } from "../packages/contracts/src/index.mjs";
import { checkReadinessSourceOfTruth } from "./readiness/source-of-truth.mjs";

const workspaceRoot = process.cwd();

const loadedExamples = loadExampleContracts({ workspaceRoot });
if (!loadedExamples.ok) {
  console.error("Contract loading failed before reference integrity checks:");
  for (const issue of loadedExamples.issues) {
    console.error(
      `- [${issue.code}] ${issue.source}${issue.field ? ` (${issue.field})` : ""}: ${issue.message}`,
    );
  }
  process.exit(1);
}

const referenceValidation = validateExampleReferences({ workspaceRoot, loadedExamples });
if (!referenceValidation.ok) {
  console.error("Example reference integrity failed:");
  for (const issue of referenceValidation.issues) {
    const fieldPart = issue.field ? ` (${issue.field})` : "";
    const referencePart = issue.reference ? ` [ref=${issue.reference}]` : "";
    console.error(`- [${issue.code}] ${issue.source}${fieldPart}${referencePart}: ${issue.message}`);
  }
  process.exit(1);
}

const examplesRootRelative = path.relative(workspaceRoot, referenceValidation.examplesRoot) || ".";
console.log(
  `reference integrity ok: ${referenceValidation.checkedReferences} refs and ${referenceValidation.checkedCompatibility} compatibility checks in ${examplesRootRelative}`,
);

const sourceOfTruth = checkReadinessSourceOfTruth(workspaceRoot);
if (sourceOfTruth.status !== "pass") {
  console.error("Source-of-truth integrity failed:");
  for (const finding of sourceOfTruth.findings ?? []) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(
  `source-of-truth integrity ok: ${sourceOfTruth.planning_report?.slice_count ?? 0} W71 slices, ${sourceOfTruth.evidence_tier_report?.story_count ?? 0} stories, and bidirectional indexes checked`,
);
