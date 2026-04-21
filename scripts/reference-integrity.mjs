#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { loadExampleContracts, validateExampleReferences } from "../packages/contracts/src/index.mjs";

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

const referenceValidation = validateExampleReferences({ workspaceRoot });
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
  `reference integrity ok: ${referenceValidation.checkedReferences} refs checked in ${examplesRootRelative}`,
);
